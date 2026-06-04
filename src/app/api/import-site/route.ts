import { NextRequest, NextResponse } from "next/server";
import {
  extractLanguage,
  extractPageLinks,
  fetchHtml,
  importHelpDocument,
  parseHttpUrl,
} from "@/lib/import-help-document";

const MAX_DISCOVERED_LINKS = 240;
const MAX_IMPORTED_DOCUMENTS = 120;

function getLanguagePrefix(url: URL) {
  const match = /^\/(zh|en)(\/|$)/i.exec(url.pathname);
  return match ? `/${match[1].toLowerCase()}/` : null;
}

function isLikelyDocumentUrl(url: URL, seedUrl: URL, languagePrefix: string | null) {
  if (url.origin !== seedUrl.origin) return false;
  if (languagePrefix && !url.pathname.toLowerCase().startsWith(languagePrefix)) return false;

  const path = url.pathname.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|svg|pdf|zip|rar|7z|css|js|ico|xml|json)$/i.test(path)) {
    return false;
  }
  if (path.includes("/wp-admin") || path.includes("/wp-json") || path.includes("/feed")) {
    return false;
  }

  return path.split("/").filter(Boolean).length >= (languagePrefix ? 2 : 1);
}

export async function POST(request: NextRequest) {
  const { url } = await request.json();

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "请输入帮助中心首页链接" }, { status: 400 });
  }

  try {
    const seedUrl = parseHttpUrl(url);
    const languagePrefix = getLanguagePrefix(seedUrl);
    const seedHtml = await fetchHtml(seedUrl);
    const seedLanguage = extractLanguage(seedUrl, seedHtml);
    const discoveredLinks = extractPageLinks(seedHtml, seedUrl)
      .map((link) => parseHttpUrl(link))
      .filter((link) => isLikelyDocumentUrl(link, seedUrl, languagePrefix))
      .slice(0, MAX_DISCOVERED_LINKS);

    const uniqueLinks = Array.from(new Map(discoveredLinks.map((link) => [link.toString(), link])).values());
    const documents = [];
    const failed: { url: string; reason: string }[] = [];

    for (const link of uniqueLinks.slice(0, MAX_IMPORTED_DOCUMENTS)) {
      try {
        const document = await importHelpDocument(link);
        if (seedLanguage === "zh" || seedLanguage === "en") {
          document.language = document.language === "unknown" ? seedLanguage : document.language;
          document.category = document.language === "en" ? "Web Page" : "网页";
        }
        documents.push(document);
      } catch (error) {
        failed.push({
          url: link.toString(),
          reason: error instanceof Error ? error.message : "导入失败",
        });
      }
    }

    if (documents.length === 0) {
      return NextResponse.json(
        {
          error: "未能从该帮助中心页面导入有效文档，请确认链接是帮助中心首页或包含文档导航的页面",
          failed,
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      documents,
      failed,
      discoveredCount: uniqueLinks.length,
      importedCount: documents.length,
      limited: uniqueLinks.length > MAX_IMPORTED_DOCUMENTS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "批量导入失败，请确认网页可访问后重试";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}