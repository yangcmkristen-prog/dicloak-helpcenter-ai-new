import { Buffer } from "node:buffer";
import { NextRequest, NextResponse } from "next/server";
import {
  buildHelpDocumentFromHtml,
  extractLanguage,
  extractPageLinks,
  fetchHtml,
  parseHttpUrl,
} from "@/lib/import-help-document";

export const maxDuration = 60;

const MAX_DISCOVERED_LINKS = 1000;
const MAX_TOTAL_CRAWL_PAGES = 600;
const MAX_TOTAL_IMPORTED_DOCUMENTS = 250;
const MAX_CRAWL_PAGES_PER_BATCH = 80;
const MAX_IMPORTED_DOCUMENTS_PER_BATCH = 20;

function getLanguagePrefix(url: URL) {
  const match = /^\/(zh|en)(\/|$)/i.exec(url.pathname);
  return match ? `/${match[1].toLowerCase()}/` : null;
}

function normalizeUrl(url: URL) {
  const normalizedUrl = new URL(url.toString());
  normalizedUrl.hash = "";
  normalizedUrl.search = "";
  return normalizedUrl;
}

function safeParseHttpUrl(url: string) {
  try {
    return normalizeUrl(parseHttpUrl(url));
  } catch {
    return null;
  }
}

function hasPathPrefix(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function isSameLanguageHelpUrl(url: URL, seedUrl: URL, languagePrefix: string | null) {
  if (url.origin !== seedUrl.origin) return false;

  const path = url.pathname.toLowerCase().replace(/\/$/, "") || "/";
  if (languagePrefix) {
    const normalizedPrefix = languagePrefix.replace(/\/$/, "");
    if (!hasPathPrefix(path, normalizedPrefix)) return false;
  } else if (hasPathPrefix(path, "/zh") || hasPathPrefix(path, "/vn")) {
    return false;
  }

  if (/\.(png|jpe?g|gif|webp|svg|pdf|zip|rar|7z|css|js|ico|xml|json|mp4|mov|avi)$/i.test(path)) {
    return false;
  }
  if (path.includes("/wp-admin") || path.includes("/wp-json") || path.includes("/feed")) {
    return false;
  }

  return path.split("/").filter(Boolean).length >= (languagePrefix ? 2 : 1);
}

function isDirectoryOrPaginationUrl(url: URL) {
  const parts = url.pathname.toLowerCase().split("/").filter(Boolean);
  return parts.some((part) => ["category", "tag", "author", "page", "search"].includes(part));
}

function isLikelyArticlePage(url: URL, seedUrl: URL, html: string) {
  if (normalizeUrl(url).toString() === normalizeUrl(seedUrl).toString()) return false;
  if (isDirectoryOrPaginationUrl(url)) return false;

  const hasTitle = /<h1\b[\s\S]*?<\/h1>/i.test(html) || /<meta[^>]*property=["']og:title["'][^>]*>/i.test(html);
  const hasArticleContainer = /<article\b/i.test(html) || /\b(?:class|id)=["'][^"']*(?:post|entry|article|single)[^"']*["']/i.test(html);
  const hasArticleMeta = /by\s+DICloak/i.test(html) || /(?:published|updated|post-\d+|作者|发布日期|更新时间)/i.test(html);

  return hasTitle && (hasArticleContainer || hasArticleMeta);
}

interface ImportSiteRequestBody {
  url?: unknown;
  cursor?: unknown;
}

interface ImportSiteCursor {
  seedUrl: string;
  queue: string[];
  queuedUrls: string[];
  crawledUrls: string[];
  importedUrlKeys: string[];
  discoveredCount: number;
  seedLanguage: "zh" | "en" | "unknown";
}

function encodeImportSiteCursor(cursor: ImportSiteCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf-8").toString("base64url");
}

function decodeImportSiteCursor(cursor: unknown): ImportSiteCursor | null {
  if (typeof cursor !== "string" || cursor.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8")) as Partial<ImportSiteCursor>;

    if (
      typeof parsed.seedUrl === "string" &&
      Array.isArray(parsed.queue) &&
      Array.isArray(parsed.queuedUrls) &&
      Array.isArray(parsed.crawledUrls) &&
      Array.isArray(parsed.importedUrlKeys) &&
      typeof parsed.discoveredCount === "number" &&
      (parsed.seedLanguage === "zh" || parsed.seedLanguage === "en" || parsed.seedLanguage === "unknown")
    ) {
      return {
        seedUrl: parsed.seedUrl,
        queue: parsed.queue.filter((item): item is string => typeof item === "string"),
        queuedUrls: parsed.queuedUrls.filter((item): item is string => typeof item === "string"),
        crawledUrls: parsed.crawledUrls.filter((item): item is string => typeof item === "string"),
        importedUrlKeys: parsed.importedUrlKeys.filter((item): item is string => typeof item === "string"),
        discoveredCount: parsed.discoveredCount,
        seedLanguage: parsed.seedLanguage,
      };
    }
  } catch {
    return null;
  }

  return null;
}

export async function POST(request: NextRequest) {
  const { url, cursor } = (await request.json()) as ImportSiteRequestBody;

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "请输入帮助中心首页链接" }, { status: 400 });
  }

  try {
    const seedUrl = normalizeUrl(parseHttpUrl(url));
    const languagePrefix = getLanguagePrefix(seedUrl);
    const savedCursor = decodeImportSiteCursor(cursor);

    if (savedCursor && savedCursor.seedUrl !== seedUrl.toString()) {
      return NextResponse.json({ error: "续传状态与当前帮助中心链接不匹配，请重新开始导入" }, { status: 400 });
    }

    const queuedUrls = new Set<string>(savedCursor?.queuedUrls ?? [seedUrl.toString()]);
    const crawledUrls = new Set<string>(savedCursor?.crawledUrls ?? []);
    const importedUrlKeys = new Set<string>(savedCursor?.importedUrlKeys ?? []);
    const queue: URL[] = (savedCursor?.queue ?? [seedUrl.toString()])
      .map((item) => safeParseHttpUrl(item))
      .filter((item): item is URL => Boolean(item));

    const documents = [];
    const failed: { url: string; reason: string }[] = [];
    let discoveredCount = savedCursor?.discoveredCount ?? 1;
    let seedLanguage: "zh" | "en" | "unknown" = savedCursor?.seedLanguage ?? "unknown";
    let batchCrawledCount = 0;

    while (
      queue.length > 0 &&
      batchCrawledCount < MAX_CRAWL_PAGES_PER_BATCH &&
      crawledUrls.size < MAX_TOTAL_CRAWL_PAGES &&
      documents.length < MAX_IMPORTED_DOCUMENTS_PER_BATCH &&
      importedUrlKeys.size < MAX_TOTAL_IMPORTED_DOCUMENTS
    ) {
      const currentUrl = queue.shift();
      if (!currentUrl) break;

      const currentKey = currentUrl.toString();
      if (crawledUrls.has(currentKey)) continue;

      let html = "";
      try {
        html = await fetchHtml(currentUrl);
      } catch (error) {
        failed.push({
          url: currentKey,
          reason: error instanceof Error ? error.message : "网页获取失败",
        });
        crawledUrls.add(currentKey);
        continue;
      }

      crawledUrls.add(currentKey);
      batchCrawledCount += 1;

      if (currentKey === seedUrl.toString()) {
        seedLanguage = extractLanguage(currentUrl, html);
      }

      const pageLinks = extractPageLinks(html, currentUrl)
        .map((link) => safeParseHttpUrl(link))
        .filter((link): link is URL => Boolean(link))
        .filter((link) => isSameLanguageHelpUrl(link, seedUrl, languagePrefix));

      for (const link of pageLinks) {
        const linkKey = link.toString();
        if (!queuedUrls.has(linkKey) && queuedUrls.size < MAX_DISCOVERED_LINKS) {
          queuedUrls.add(linkKey);
          queue.push(link);
          discoveredCount += 1;
        }
      }

      if (!isLikelyArticlePage(currentUrl, seedUrl, html)) {
        continue;
      }

      try {
        const document = buildHelpDocumentFromHtml(currentUrl, html);
        if (seedLanguage === "zh" || seedLanguage === "en") {
          document.language = document.language === "unknown" ? seedLanguage : document.language;
          document.category = document.language === "en" ? "Web Page" : "网页";
        }
        if (!importedUrlKeys.has(document.sourceUrl)) {
          documents.push(document);
          importedUrlKeys.add(document.sourceUrl);
        }
      } catch (error) {
        failed.push({
          url: currentKey,
          reason: error instanceof Error ? error.message : "导入失败",
        });
      }
    }

    const hasMore =
      queue.length > 0 &&
      crawledUrls.size < MAX_TOTAL_CRAWL_PAGES &&
      importedUrlKeys.size < MAX_TOTAL_IMPORTED_DOCUMENTS;

    const nextCursor = hasMore
      ? encodeImportSiteCursor({
          seedUrl: seedUrl.toString(),
          queue: queue.map((item) => item.toString()),
          queuedUrls: Array.from(queuedUrls),
          crawledUrls: Array.from(crawledUrls),
          importedUrlKeys: Array.from(importedUrlKeys),
          discoveredCount,
          seedLanguage,
        })
      : null;

    if (documents.length === 0 && !hasMore) {
      return NextResponse.json(
        {
          error: "未能从该帮助中心页面导入有效文档，请确认链接是帮助中心首页或包含文档导航的页面",
          failed,
          crawledCount: crawledUrls.size,
          discoveredCount,
          hasMore: false,
          nextCursor: null,
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      documents,
      failed,
      discoveredCount,
      crawledCount: crawledUrls.size,
      batchCrawledCount,
      importedCount: documents.length,
      totalImportedCount: importedUrlKeys.size,
      hasMore,
      nextCursor,
      limited: hasMore || queuedUrls.size >= MAX_DISCOVERED_LINKS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "批量导入失败，请确认网页可访问后重试";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
