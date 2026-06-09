import { NextRequest, NextResponse } from "next/server";
import {
  buildHelpDocumentFromHtml,
  extractLanguage,
  extractPageLinks,
  fetchHtml,
  parseHttpUrl,
} from "@/lib/import-help-document";

export const maxDuration = 60;

const MAX_DISCOVERED_LINKS = 300;
const MAX_CRAWL_PAGES = 80;
const MAX_IMPORTED_DOCUMENTS = 50;

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

export async function POST(request: NextRequest) {
  const { url } = await request.json();

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "请输入帮助中心首页链接" }, { status: 400 });
  }

  try {
    const seedUrl = normalizeUrl(parseHttpUrl(url));
    const languagePrefix = getLanguagePrefix(seedUrl);
    const queuedUrls = new Set<string>([seedUrl.toString()]);
    const crawledUrls = new Set<string>();
    const importedUrlKeys = new Set<string>();
    const queue: URL[] = [seedUrl];
    const documents = [];
    const failed: { url: string; reason: string }[] = [];
    let discoveredCount = 1;
    let seedLanguage: "zh" | "en" | "unknown" = "unknown";

    while (queue.length > 0 && crawledUrls.size < MAX_CRAWL_PAGES && documents.length < MAX_IMPORTED_DOCUMENTS) {
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

    if (documents.length === 0) {
      return NextResponse.json(
        {
          error: "未能从该帮助中心页面导入有效文档，请确认链接是帮助中心首页或包含文档导航的页面",
          failed,
          crawledCount: crawledUrls.size,
          discoveredCount,
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      documents,
      failed,
      discoveredCount,
      crawledCount: crawledUrls.size,
      importedCount: documents.length,
      limited: queue.length > 0 || queuedUrls.size >= MAX_DISCOVERED_LINKS || documents.length >= MAX_IMPORTED_DOCUMENTS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "批量导入失败，请确认网页可访问后重试";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
