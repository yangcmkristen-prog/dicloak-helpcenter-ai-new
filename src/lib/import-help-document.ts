export interface ImportedHelpDocument {
  id: string;
  title: string;
  category: string;
  lastUpdated: string;
  content: string;
  sourceUrl: string;
  htmlContent: string;
  language: "zh" | "en" | "unknown";
}

const MAX_HTML_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15000;

export function decodeHtmlEntities(text: string) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}

export function stripTags(html: string) {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

export function getFirstMatch(html: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) return decodeHtmlEntities(match[1].trim());
  }
  return "";
}

function hasPathPrefix(path: string, prefix: string) {
  const normalizedPath = path.toLowerCase().replace(/\/$/, "") || "/";
  return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
}

function isDicloakEnglishHelpPath(url: URL) {
  if (url.hostname.toLowerCase() !== "help.dicloak.com") return false;

  return !hasPathPrefix(url.pathname, "/zh") && !hasPathPrefix(url.pathname, "/vn");
}

export function extractLanguage(url: URL, html: string): "zh" | "en" | "unknown" {
  if (hasPathPrefix(url.pathname, "/zh")) return "zh";
  if (hasPathPrefix(url.pathname, "/vn")) return "unknown";
  if (hasPathPrefix(url.pathname, "/en")) return "en";
  if (isDicloakEnglishHelpPath(url)) return "en";

  const htmlLang = getFirstMatch(html, [/<html[^>]*\slang=["']?([^"'\s>]+)["']?/i]);
  if (htmlLang.toLowerCase().startsWith("zh")) return "zh";
  if (htmlLang.toLowerCase().startsWith("en")) return "en";
  return "unknown";
}

function absolutizeUrl(value: string, baseUrl: string) {
  try {
    return new URL(decodeHtmlEntities(value), baseUrl).toString();
  } catch {
    return value;
  }
}

export function extractArticleHtml(html: string) {
  const articlePatterns = [
    /<article\b[^>]*>([\s\S]*?)<\/article>/i,
    /<main\b[^>]*>([\s\S]*?)<\/main>/i,
    /<div\b[^>]*(?:class|id)=["'][^"']*(?:article|content|post|entry)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  ];

  for (const pattern of articlePatterns) {
    const match = pattern.exec(html);
    if (match?.[1] && stripTags(match[1]).length > 80) {
      return match[1];
    }
  }

  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  return bodyMatch?.[1] || html;
}

export function sanitizeArticleHtml(articleHtml: string, baseUrl: string) {
  let sanitized = articleHtml
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, "")
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, "")
    .replace(/\s+on\w+=("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+style=("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+(href|src)=("javascript:[^"]*"|'javascript:[^']*')/gi, "");

  sanitized = sanitized.replace(/\s(src|href)=("([^"]*)"|'([^']*)')/gi, (_full, attr: string, quoted: string, doubleValue?: string, singleValue?: string) => {
    const rawValue = doubleValue ?? singleValue ?? "";
    const absoluteValue = absolutizeUrl(rawValue, baseUrl);
    const quote = quoted.startsWith("'") ? "'" : '"';
    return ` ${attr}=${quote}${absoluteValue}${quote}`;
  });

  return sanitized.trim();
}

export function htmlToMarkdown(html: string) {
  let markdown = html
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*hr\s*\/?\s*>/gi, "\n\n---\n\n")
    .replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, (_, text: string) => `\n# ${stripTags(text)}\n`)
    .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, (_, text: string) => `\n## ${stripTags(text)}\n`)
    .replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, (_, text: string) => `\n### ${stripTags(text)}\n`)
    .replace(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi, (_, text: string) => `\n#### ${stripTags(text)}\n`)
    .replace(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi, (_, text: string) => `**${stripTags(text)}**`)
    .replace(/<b\b[^>]*>([\s\S]*?)<\/b>/gi, (_, text: string) => `**${stripTags(text)}**`)
    .replace(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi, (_, src: string) => `\n![图片](${decodeHtmlEntities(src)})\n`)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, text: string) => `\n- ${stripTags(text)}`)
    .replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_, text: string) => `\n${stripTags(text)}\n`)
    .replace(/<div\b[^>]*>([\s\S]*?)<\/div>/gi, (_, text: string) => `\n${stripTags(text)}\n`)
    .replace(/<[^>]*>/g, " ");

  markdown = decodeHtmlEntities(markdown)
    .split("\n")
    .map((line) => line.trim())
    .filter((line, index, lines) => line || lines[index - 1])
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return markdown;
}

export function createDocumentId(url: URL) {
  return `url-${url.pathname.replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-").replace(/^-|-$/g, "") || url.hostname}`.toLowerCase();
}

export function parseHttpUrl(url: string) {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url.trim());
  } catch {
    throw new Error("请输入有效的 HTTP/HTTPS 链接");
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("仅支持 HTTP/HTTPS 链接");
  }

  return parsedUrl;
}

export async function fetchHtml(url: URL) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "DICloak Help Center Importer/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`网页获取失败：HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      throw new Error("该链接不是 HTML 网页，暂不支持导入");
    }

    const htmlBuffer = await response.arrayBuffer();
    if (htmlBuffer.byteLength > MAX_HTML_BYTES) {
      throw new Error("网页内容过大，请导入单篇帮助文档链接");
    }

    return new TextDecoder("utf-8").decode(htmlBuffer);
  } finally {
    clearTimeout(timeout);
  }
}

export function buildHelpDocumentFromHtml(url: URL, html: string): ImportedHelpDocument {
  const articleHtml = extractArticleHtml(html);
  const htmlContent = sanitizeArticleHtml(articleHtml, url.toString());
  const markdownContent = htmlToMarkdown(htmlContent);

  if (markdownContent.length < 20) {
    throw new Error("未能解析出有效文档内容，请确认链接是帮助文档详情页");
  }

  const title =
    getFirstMatch(htmlContent, [/<h1\b[^>]*>([\s\S]*?)<\/h1>/i]) ||
    getFirstMatch(html, [/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i, /<title\b[^>]*>([\s\S]*?)<\/title>/i]) ||
    url.pathname.split("/").filter(Boolean).at(-1) ||
    url.hostname;

  const language = extractLanguage(url, html);

  return {
    id: createDocumentId(url),
    title: stripTags(title),
    category: language === "en" ? "Web Page" : "网页",
    lastUpdated: new Date().toISOString().slice(0, 10),
    content: markdownContent,
    sourceUrl: url.toString(),
    htmlContent,
    language,
  };
}

export async function importHelpDocument(url: URL): Promise<ImportedHelpDocument> {
  const html = await fetchHtml(url);
  return buildHelpDocumentFromHtml(url, html);
}

export function extractPageLinks(html: string, baseUrl: URL) {
  const links = new Set<string>();
  const linkPattern = /<a\b[^>]*\bhref=("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(html)) !== null) {
    const rawHref = decodeHtmlEntities(match[2] || match[3] || match[4] || "").trim();
    if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("mailto:") || rawHref.startsWith("tel:")) {
      continue;
    }

    try {
      const linkUrl = new URL(rawHref, baseUrl.toString());
      linkUrl.hash = "";
      linkUrl.search = "";
      links.add(linkUrl.toString());
    } catch {
      // Ignore malformed hrefs.
    }
  }

  return Array.from(links);
}
