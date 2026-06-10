"use client";

import { useState, useCallback, useEffect, type ChangeEvent, type ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FileText,
  Search,
  Loader2,
  Trash2,
  Plus,
  BookOpen,
  ChevronRight,
  Sparkles,
  AlertCircle,
  Upload,
  FileUp,
  CheckCircle2,
  Link as LinkIcon,
} from "lucide-react";

// Types
interface DocumentChange {
  type: "delete" | "add";
  originalText?: string;
  newContent?: string;
  position?: string;
  referenceText?: string;
  reason: string;
}

interface AffectedDoc {
  docId: string;
  docName: string;
  reason: string;
  changes: DocumentChange[];
}

interface DocDetail {
  id: string;
  title: string;
  category: string;
  lastUpdated: string;
  content: string;
  sourceUrl?: string;
  htmlContent?: string;
  language?: "zh" | "en" | "unknown";
  linkedDocId?: string;
}

interface RetrievalStats {
  totalDocuments: number;
  candidateDocuments: number;
  candidateLimit: number;
  searchTerms: string[];
}

interface ImportSiteResponse {
  documents?: unknown;
  error?: string;
  failed?: unknown;
  crawledCount?: unknown;
  discoveredCount?: unknown;
  importedCount?: unknown;
  totalImportedCount?: unknown;
  hasMore?: boolean;
  nextCursor?: string | null;
}

type ActiveTab = "help-center" | "analyze";
type LanguageFilter = "all" | "zh" | "en" | "unknown";

const SUPPORTED_FILE_EXTENSIONS = [".md", ".txt"];
const DOCS_PER_PAGE = 10;

function isSupportedHelpDocument(file: File) {
  const lowerName = file.name.toLowerCase();
  return SUPPORTED_FILE_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
}

function getDocumentTitle(fileName: string, content: string) {
  const firstMarkdownTitle = content
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("# "));

  if (firstMarkdownTitle) {
    return firstMarkdownTitle.replace(/^#+\s*/, "").trim();
  }

  return fileName.replace(/\.(md|txt)$/i, "");
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function parseJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const responseText = await response.text();

  try {
    return (responseText ? JSON.parse(responseText) : {}) as T;
  } catch {
    throw new Error(
      response.ok
        ? `${fallbackMessage}：接口返回格式异常`
        : `${fallbackMessage}：接口返回非 JSON 错误：${responseText.slice(0, 200) || response.statusText}`
    );
  }
}

function removeLinkedDocId(doc: DocDetail): DocDetail {
  const nextDoc = { ...doc };
  delete nextDoc.linkedDocId;
  return nextDoc;
}

function getStringField(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function htmlToPlainText(htmlContent: string) {
  return htmlContent
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHelpDocument(rawDoc: unknown): DocDetail | null {
  if (!rawDoc || typeof rawDoc !== "object") return null;

  const doc = rawDoc as Record<string, unknown>;
  const id = getStringField(doc.id);
  const title = getStringField(doc.title);
  const lastUpdated = getStringField(doc.lastUpdated) ?? getStringField(doc.last_updated);

  if (!id || !title || !lastUpdated) return null;

  const language = getStringField(doc.language);
  const htmlContent = getStringField(doc.htmlContent) ?? getStringField(doc.html_content);
  const content = getStringField(doc.content) ?? (htmlContent ? htmlToPlainText(htmlContent) : "");

  return {
    id,
    title,
    category: getStringField(doc.category) ?? "未分类",
    lastUpdated,
    content,
    sourceUrl: getStringField(doc.sourceUrl) ?? getStringField(doc.source_url),
    htmlContent,
    language: language === "zh" || language === "en" || language === "unknown" ? language : "unknown",
    linkedDocId: getStringField(doc.linkedDocId) ?? getStringField(doc.linked_doc_id),
  };
}

function normalizeHelpDocuments(rawDocs: unknown): DocDetail[] {
  if (!Array.isArray(rawDocs)) return [];
  return rawDocs.flatMap((rawDoc) => {
    const normalizedDoc = normalizeHelpDocument(rawDoc);
    return normalizedDoc ? [normalizedDoc] : [];
  });
}

function hasReadableContent(doc: DocDetail) {
  return doc.content.trim().length > 0 || Boolean(doc.htmlContent?.trim());
}

function renderInlineFormatting(text: string) {
  const parts: ReactNode[] = [];
  const boldPattern = /\*\*(.*?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = boldPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <strong key={`${match.index}-${match[1]}`} className="font-semibold text-stone-900">
        {match[1]}
      </strong>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

function renderFormattedDocument(content: string) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");

  return (
    <article className="space-y-3 text-stone-700">
      {lines.map((line, index) => {
        const trimmedLine = line.trim();

        if (!trimmedLine) {
          return <div key={index} className="h-2" />;
        }

        if (/^---+$/.test(trimmedLine)) {
          return <hr key={index} className="my-5 border-stone-200" />;
        }

        const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmedLine);
        if (headingMatch) {
          const level = headingMatch[1].length;
          const headingText = renderInlineFormatting(headingMatch[2]);

          if (level === 1) {
            return (
              <h1 key={index} className="mt-2 text-2xl font-semibold leading-tight tracking-tight text-stone-950">
                {headingText}
              </h1>
            );
          }

          if (level === 2) {
            return (
              <h2 key={index} className="mt-6 text-xl font-semibold leading-snug text-stone-900">
                {headingText}
              </h2>
            );
          }

          if (level === 3) {
            return (
              <h3 key={index} className="mt-5 text-base font-semibold leading-snug text-stone-900">
                {headingText}
              </h3>
            );
          }

          return (
            <h4 key={index} className="mt-4 text-sm font-semibold leading-snug text-stone-800">
              {headingText}
            </h4>
          );
        }

        const unorderedListMatch = /^[-*]\s+(.+)$/.exec(trimmedLine);
        if (unorderedListMatch) {
          return (
            <div key={index} className="flex gap-2 pl-2 text-sm leading-7">
              <span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-600" />
              <p>{renderInlineFormatting(unorderedListMatch[1])}</p>
            </div>
          );
        }

        const orderedListMatch = /^(\d+)\.\s+(.+)$/.exec(trimmedLine);
        if (orderedListMatch) {
          return (
            <div key={index} className="flex gap-2 pl-2 text-sm leading-7">
              <span className="min-w-5 shrink-0 font-medium text-teal-700">
                {orderedListMatch[1]}.
              </span>
              <p>{renderInlineFormatting(orderedListMatch[2])}</p>
            </div>
          );
        }

        return (
          <p key={index} className="text-sm leading-7 text-stone-700">
            {renderInlineFormatting(trimmedLine)}
          </p>
        );
      })}
    </article>
  );
}


function renderHtmlDocument(htmlContent: string) {
  return (
    <article
      className="space-y-4 text-sm leading-7 text-stone-700 [&_a]:text-teal-700 [&_a]:underline [&_blockquote]:rounded-lg [&_blockquote]:border-l-4 [&_blockquote]:border-teal-500 [&_blockquote]:bg-teal-50 [&_blockquote]:px-4 [&_blockquote]:py-2 [&_h1]:mt-2 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1]:text-stone-950 [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-stone-900 [&_h3]:mt-5 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-stone-900 [&_h4]:mt-4 [&_h4]:font-semibold [&_h4]:text-stone-800 [&_hr]:my-5 [&_hr]:border-stone-200 [&_img]:my-4 [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-stone-200 [&_img]:shadow-sm [&_li]:my-1 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-6 [&_p]:my-3 [&_strong]:font-semibold [&_strong]:text-stone-900 [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-stone-200 [&_td]:p-2 [&_th]:border [&_th]:border-stone-200 [&_th]:bg-stone-50 [&_th]:p-2 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6"
      dangerouslySetInnerHTML={{ __html: htmlContent }}
    />
  );
}

// Render document with highlighted changes
function renderDocumentWithChanges(
  content: string,
  changes: DocumentChange[]
) {
  if (changes.length === 0) {
    return <pre className="whitespace-pre-wrap text-sm leading-relaxed">{content}</pre>;
  }

  // Sort changes: deletions first, then additions
  const deletions = changes.filter((c) => c.type === "delete");
  const additions = changes.filter((c) => c.type === "add");

  // Split content into segments based on deletions
  let remaining = content;
  const segments: { type: "text" | "delete"; content: string }[] = [];

  // Process deletions - find and mark deleted text
  for (const del of deletions) {
    if (del.originalText && remaining.includes(del.originalText)) {
      const idx = remaining.indexOf(del.originalText);
      if (idx > 0) {
        segments.push({ type: "text", content: remaining.substring(0, idx) });
      }
      segments.push({ type: "delete", content: del.originalText });
      remaining = remaining.substring(idx + del.originalText.length);
    }
  }
  if (remaining) {
    segments.push({ type: "text", content: remaining });
  }

  // If no deletions found in text, show full content
  if (segments.length === 0) {
    segments.push({ type: "text", content });
  }

  return (
    <div className="space-y-1">
      {segments.map((seg, i) => {
        // Check if there are additions to insert before this segment
        const additionsBefore: DocumentChange[] = [];
        const additionsAfter: DocumentChange[] = [];

        for (const add of additions) {
          if (
            add.position === "before" &&
            seg.type === "text" &&
            add.referenceText &&
            seg.content.includes(add.referenceText)
          ) {
            additionsBefore.push(add);
          }
          if (
            (add.position === "after" || !add.position) &&
            ((add.referenceText && seg.type === "text" && seg.content.includes(add.referenceText)) ||
              (!add.referenceText && seg.type === "text" && i === segments.length - 1))
          ) {
            additionsAfter.push(add);
          }
        }

        return (
          <div key={i}>
            {additionsBefore.map((add, j) => (
              <div
                key={`add-before-${i}-${j}`}
                className="my-2 rounded-md border border-green-300 bg-green-50 p-3"
              >
                <div className="mb-1.5 flex items-center gap-1.5">
                  <Plus className="h-3.5 w-3.5 text-green-600" />
                  <span className="text-xs font-medium text-green-700">
                    新增内容
                  </span>
                </div>
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-green-900">
                  {add.newContent}
                </div>
                {add.reason && (
                  <div className="mt-1.5 border-t border-green-200 pt-1.5 text-xs text-green-600">
                    原因：{add.reason}
                  </div>
                )}
              </div>
            ))}

            {seg.type === "delete" ? (
              <div className="my-2 rounded-md border border-red-300 bg-red-50 p-3">
                <div className="mb-1.5 flex items-center gap-1.5">
                  <Trash2 className="h-3.5 w-3.5 text-red-600" />
                  <span className="text-xs font-medium text-red-700">
                    需删除
                  </span>
                </div>
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-red-900 line-through decoration-red-400 decoration-2">
                  {seg.content}
                </div>
                {deletions.find((d) => d.originalText === seg.content)?.reason && (
                  <div className="mt-1.5 border-t border-red-200 pt-1.5 text-xs text-red-600">
                    原因：
                    {deletions.find((d) => d.originalText === seg.content)?.reason}
                  </div>
                )}
              </div>
            ) : (
              <pre className="whitespace-pre-wrap text-sm leading-relaxed">
                {seg.content}
              </pre>
            )}

            {additionsAfter.map((add, j) => (
              <div
                key={`add-after-${i}-${j}`}
                className="my-2 rounded-md border border-green-300 bg-green-50 p-3"
              >
                <div className="mb-1.5 flex items-center gap-1.5">
                  <Plus className="h-3.5 w-3.5 text-green-600" />
                  <span className="text-xs font-medium text-green-700">
                    新增内容
                  </span>
                </div>
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-green-900">
                  {add.newContent}
                </div>
                {add.reason && (
                  <div className="mt-1.5 border-t border-green-200 pt-1.5 text-xs text-green-600">
                    原因：{add.reason}
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("help-center");
  const [feature, setFeature] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [affectedDocs, setAffectedDocs] = useState<AffectedDoc[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [retrievalStats, setRetrievalStats] = useState<RetrievalStats | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<AffectedDoc | null>(null);
  const [docDetail, setDocDetail] = useState<DocDetail | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [helpDocs, setHelpDocs] = useState<DocDetail[]>([]);
  const [urlInput, setUrlInput] = useState("");
  const [siteUrlInput, setSiteUrlInput] = useState("");
  const [importingUrl, setImportingUrl] = useState(false);
  const [importingSite, setImportingSite] = useState(false);
  const [docSearch, setDocSearch] = useState("");
  const [languageFilter, setLanguageFilter] = useState<LanguageFilter>("all");
  const [docsPage, setDocsPage] = useState(1);
  const [previewDoc, setPreviewDoc] = useState<DocDetail | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [linkingDoc, setLinkingDoc] = useState<DocDetail | null>(null);
  const [linkDrawerOpen, setLinkDrawerOpen] = useState(false);
  const [linkDocSearch, setLinkDocSearch] = useState("");
  const [linkPreviewDocId, setLinkPreviewDocId] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [syncing, setSyncing] = useState(false);

  // 从 Supabase 加载文档
  useEffect(() => {
    async function loadDocs() {
      try {
        setSyncing(true);
        const response = await fetch("/api/docs");
        const data = await response.json();
        if (data.documents && Array.isArray(data.documents)) {
          const docs = normalizeHelpDocuments(data.documents);
          setHelpDocs(docs);
        }
      } catch {
        setUploadError("文档同步失败，请刷新页面重试");
      } finally {
        setSyncing(false);
      }
    }
    loadDocs();
  }, []);

  // 同步文档到 Supabase（合并：新增或更新）
  const syncDocsToSupabase = useCallback(async (docs: DocDetail[]) => {
    const normalizedDocs = normalizeHelpDocuments(docs).filter(hasReadableContent);
    if (normalizedDocs.length === 0) return;

    try {
      const rows = normalizedDocs.map((doc) => ({
        id: doc.id,
        title: doc.title,
        category: doc.category || "未分类",
        last_updated: doc.lastUpdated || new Date().toISOString().split("T")[0],
        content: doc.content,
        source_url: doc.sourceUrl || null,
        html_content: doc.htmlContent || null,
        language: doc.language || "unknown",
        linked_doc_id: doc.linkedDocId || null,
      }));

      const response = await fetch("/api/docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rows),
      });

      if (!response.ok) {
        throw new Error("文档同步到云端失败");
      }
    } catch {
      setUploadError("文档同步到云端失败，请检查网络连接");
    }
  }, []);

  const persistDocLinksToSupabase = useCallback(async (docs: DocDetail[]) => {
    if (docs.length === 0) return;

    try {
      const response = await fetch("/api/docs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          links: docs.map((doc) => ({
            id: doc.id,
            linked_doc_id: doc.linkedDocId || null,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error("文档关联同步到云端失败");
      }
    } catch {
      setUploadError("文档关联同步到云端失败，请刷新页面重试");
    }
  }, []);

  const mergeHelpDocs = useCallback((incomingDocs: DocDetail[]) => {
    const normalizedIncomingDocs = normalizeHelpDocuments(incomingDocs).filter(hasReadableContent);

    setHelpDocs((currentDocs) => {
      const nextDocs = [...currentDocs];

      for (const incomingDoc of normalizedIncomingDocs) {
        const existingIndex = nextDocs.findIndex((doc) => doc.id === incomingDoc.id);

        if (existingIndex >= 0) {
          const existingDoc = nextDocs[existingIndex];
          const incomingHasContent = hasReadableContent(incomingDoc);

          nextDocs[existingIndex] = {
            ...existingDoc,
            ...incomingDoc,
            content: incomingHasContent ? incomingDoc.content : existingDoc.content,
            htmlContent: incomingDoc.htmlContent ?? existingDoc.htmlContent,
            linkedDocId: incomingDoc.linkedDocId ?? existingDoc.linkedDocId,
          };
        } else {
          nextDocs.push(incomingDoc);
        }
      }

      return nextDocs;
    });

    syncDocsToSupabase(normalizedIncomingDocs);
  }, [syncDocsToSupabase]);

  const handleFileUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (selectedFiles.length === 0) return;

    setUploadError(null);
    setUploadMessage(null);

    const unsupportedFiles = selectedFiles.filter((file) => !isSupportedHelpDocument(file));
    if (unsupportedFiles.length > 0) {
      setUploadError(`仅支持上传 md、txt 格式：${unsupportedFiles.map((file) => file.name).join("、")}`);
      return;
    }

    try {
      const uploadedDocs = await Promise.all(
        selectedFiles.map(async (file) => {
          const content = await file.text();
          const now = new Date();
          return {
            id: `upload-${file.name}-${file.lastModified}`,
            title: getDocumentTitle(file.name, content),
            category: file.name.toLowerCase().endsWith(".md") ? "Markdown" : "Text",
            lastUpdated: formatDate(now),
            content,
          } satisfies DocDetail;
        })
      );

      mergeHelpDocs(uploadedDocs);
      setUploadMessage(`已导入 ${uploadedDocs.length} 篇帮助文档，AI 将在这些文档中检索修改建议`);
    } catch {
      setUploadError("文档读取失败，请确认文件内容可读取后重试");
    }
  }, [mergeHelpDocs]);


  const handleImportUrl = useCallback(async () => {
    const trimmedUrl = urlInput.trim();
    if (!trimmedUrl) return;

    setImportingUrl(true);
    setUploadError(null);
    setUploadMessage(null);

    try {
      const response = await fetch("/api/import-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmedUrl }),
      });
      const data = await response.json();

      if (!response.ok || !data.document) {
        throw new Error(data.error || "链接导入失败");
      }

      const importedDoc = normalizeHelpDocument(data.document);
      if (!importedDoc || !hasReadableContent(importedDoc)) {
        throw new Error("链接导入结果缺少文档正文，请稍后重试");
      }

      mergeHelpDocs([importedDoc]);
      setUrlInput("");
      setUploadMessage(`已从链接导入《${importedDoc.title}》，AI 将在该网页文档中检索修改建议`);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "链接导入失败，请确认网页可访问后重试");
    } finally {
      setImportingUrl(false);
    }
  }, [mergeHelpDocs, urlInput]);

  const handleImportSite = useCallback(async () => {
    const trimmedUrl = siteUrlInput.trim();
    if (!trimmedUrl) return;

    setImportingSite(true);
    setUploadError(null);
    setUploadMessage(null);

    try {
      let cursor: string | undefined;
      let hasMore = false;
      let batchIndex = 0;
      let totalImportedCount = 0;
      let totalFailedCount = 0;
      let latestCrawledCount = 0;
      let latestDiscoveredCount = 0;

      do {
        batchIndex += 1;

        if (batchIndex > 80) {
          throw new Error("批量导入批次数过多，请稍后重新开始导入");
        }

        const response = await fetch("/api/import-site", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: trimmedUrl, cursor }),
        });

        const data = await parseJsonResponse<ImportSiteResponse>(response, "批量导入失败");

        if (!response.ok) {
          throw new Error(data.error || "批量导入失败");
        }

        const importedDocs = Array.isArray(data.documents)
          ? normalizeHelpDocuments(data.documents).filter(hasReadableContent)
          : [];

        if (importedDocs.length > 0) {
          mergeHelpDocs(importedDocs);
          totalImportedCount += importedDocs.length;
        }

        const failedCount = Array.isArray(data.failed) ? data.failed.length : 0;
        totalFailedCount += failedCount;
        latestCrawledCount = typeof data.crawledCount === "number" ? data.crawledCount : latestCrawledCount;
        latestDiscoveredCount = typeof data.discoveredCount === "number" ? data.discoveredCount : latestDiscoveredCount;

        cursor = typeof data.nextCursor === "string" ? data.nextCursor : undefined;
        hasMore = Boolean(data.hasMore && cursor);

        setUploadMessage(
          `正在分批导入：已完成 ${batchIndex} 批，已导入 ${totalImportedCount} 篇，已扫描 ${latestCrawledCount} 个页面`
        );
      } while (hasMore);

      if (totalImportedCount === 0) {
        throw new Error("批量导入结果缺少文档正文，请稍后重试");
      }

      setSiteUrlInput("");
      setUploadMessage(
        `已批量导入 ${totalImportedCount} 篇帮助文档，扫描 ${latestCrawledCount} 个页面，发现 ${latestDiscoveredCount} 个链接${
          totalFailedCount > 0 ? `，${totalFailedCount} 个链接导入失败` : ""
        }`
      );
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "批量导入失败，请确认帮助中心页面可访问后重试");
    } finally {
      setImportingSite(false);
    }
  }, [mergeHelpDocs, siteUrlInput]);

  const handlePreviewDoc = useCallback((doc: DocDetail) => {
    setPreviewDoc(doc);
    setPreviewOpen(true);
  }, []);

  const handleOpenLinkDrawer = useCallback((doc: DocDetail) => {
    setLinkingDoc(doc);
    setLinkDocSearch("");
    setLinkPreviewDocId(doc.linkedDocId ?? null);
    setLinkDrawerOpen(true);
  }, []);

  const handleLinkDocs = useCallback((targetDoc: DocDetail) => {
    if (!linkingDoc || linkingDoc.id === targetDoc.id) return;

    let docsToSync: DocDetail[] = [];

    setHelpDocs((currentDocs) => {
      const nextDocs = currentDocs.map((doc) => {
        if (doc.id === linkingDoc.id) {
          return { ...doc, linkedDocId: targetDoc.id };
        }
        if (doc.id === targetDoc.id) {
          return { ...doc, linkedDocId: linkingDoc.id };
        }
        if (doc.linkedDocId === linkingDoc.id || doc.linkedDocId === targetDoc.id) {
          return removeLinkedDocId(doc);
        }
        return doc;
      });

      docsToSync = nextDocs.filter(
        (doc) =>
          doc.id === linkingDoc.id ||
          doc.id === targetDoc.id ||
          currentDocs.some((currentDoc) => currentDoc.id === doc.id && currentDoc.linkedDocId !== doc.linkedDocId)
      );

      return nextDocs;
    });

    void persistDocLinksToSupabase(docsToSync);
    setUploadMessage(`已关联《${linkingDoc.title}》和《${targetDoc.title}》`);
    setLinkDrawerOpen(false);
    setLinkingDoc(null);
    setLinkPreviewDocId(null);
  }, [linkingDoc, persistDocLinksToSupabase]);

  const handleUnlinkDoc = useCallback((docId: string) => {
    let docsToSync: DocDetail[] = [];

    setHelpDocs((currentDocs) => {
      const currentDoc = currentDocs.find((doc) => doc.id === docId);
      const linkedDocId = currentDoc?.linkedDocId;

      const nextDocs = currentDocs.map((doc) => {
        if (doc.id === docId || (linkedDocId && doc.id === linkedDocId)) {
          return removeLinkedDocId(doc);
        }
        return doc;
      });

      docsToSync = nextDocs.filter((doc) => currentDocs.some((currentDoc) => currentDoc.id === doc.id && currentDoc.linkedDocId !== doc.linkedDocId));

      return nextDocs;
    });

    void persistDocLinksToSupabase(docsToSync);
    setUploadMessage("已取消文档关联");
    setLinkDrawerOpen(false);
    setLinkingDoc(null);
    setLinkPreviewDocId(null);
  }, [persistDocLinksToSupabase]);

  const deleteDocFromSupabase = useCallback(async (docId: string) => {
    const response = await fetch("/api/docs", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: docId }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(
        typeof data.error === "string" ? data.error : "云端删除失败"
      );
    }
  }, []);

  const handleRemoveDoc = useCallback(async (docId: string) => {
    let docsToSync: DocDetail[] = [];

    setHelpDocs((currentDocs) => {
      const nextDocs = currentDocs
        .filter((doc) => doc.id !== docId)
        .map((doc) => {
          if (doc.linkedDocId === docId) {
            return removeLinkedDocId(doc);
          }
          return doc;
        });

      docsToSync = nextDocs.filter((doc) =>
        currentDocs.some((currentDoc) => currentDoc.id === doc.id && currentDoc.linkedDocId !== doc.linkedDocId)
      );

      return nextDocs;
    });

    void persistDocLinksToSupabase(docsToSync);
    await deleteDocFromSupabase(docId);

    setAffectedDocs((currentDocs) => currentDocs.filter((doc) => doc.docId !== docId));
    setPreviewDoc((currentDoc) => (currentDoc?.id === docId ? null : currentDoc));
    setLinkingDoc((currentDoc) => (currentDoc?.id === docId ? null : currentDoc));
  }, [deleteDocFromSupabase, persistDocLinksToSupabase]);

  const handleAnalyze = useCallback(async () => {
    if (!feature.trim()) return;

    if (helpDocs.length === 0) {
      setActiveTab("help-center");
      setError("请先在「帮助中心」上传 md 或 txt 格式的帮助文档");
      return;
    }

    setAnalyzing(true);
    setAffectedDocs([]);
    setStreamingText("");
    setRetrievalStats(null);
    setError(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feature: feature.trim(), documents: helpDocs }),
      });

      if (!response.ok) {
        throw new Error("分析请求失败");
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("无法读取响应流");

      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6)) as {
                error?: string;
                done?: boolean;
                content?: string;
                retrieval?: RetrievalStats;
              };
              if (data.retrieval) {
                setRetrievalStats(data.retrieval);
              }
              if (data.error) {
                setError(data.error);
                break;
              }
              if (data.done) {
                // Parse the accumulated text as JSON
                try {
                  // Extract JSON from the text (might have markdown code block wrapping)
                  let jsonStr = fullText.trim();
                  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
                  if (jsonMatch) {
                    jsonStr = jsonMatch[1].trim();
                  }
                  // Try to find the JSON object
                  const braceStart = jsonStr.indexOf("{");
                  const braceEnd = jsonStr.lastIndexOf("}");
                  if (braceStart !== -1 && braceEnd > braceStart) {
                    jsonStr = jsonStr.substring(braceStart, braceEnd + 1);
                  }

                  const result = JSON.parse(jsonStr);
                  if (result.affectedDocs && Array.isArray(result.affectedDocs)) {
                    setAffectedDocs(result.affectedDocs);
                    setActiveTab("analyze");
                  }
                } catch {
                  setError("AI 返回格式异常，请重试");
                }
              }
              if (data.content) {
                fullText += data.content;
                setStreamingText(fullText);
              }
            } catch {
              // Ignore parse errors for individual chunks
            }
          }
        }
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "分析过程出错，请重试"
      );
    } finally {
      setAnalyzing(false);
    }
  }, [feature, helpDocs]);

  const handleDocClick = useCallback(async (doc: AffectedDoc) => {
    setSelectedDoc(doc);
    setDrawerOpen(true);

    const uploadedDoc = helpDocs.find((helpDoc) => helpDoc.id === doc.docId);
    if (uploadedDoc) {
      setDocDetail(uploadedDoc);
      return;
    }

    setDocDetail(null);
    try {
      const response = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: doc.docId }),
      });
      const data = await response.json();
      if (data.document) {
        setDocDetail(data.document);
      }
    } catch {
      // Fallback - still show changes
    }
  }, [helpDocs]);

  const getChangeStats = (doc: AffectedDoc) => {
    const deletes = doc.changes.filter((c) => c.type === "delete").length;
    const adds = doc.changes.filter((c) => c.type === "add").length;
    return { deletes, adds };
  };

  const totalCharacters = helpDocs.reduce((sum, doc) => sum + doc.content.length, 0);
  const normalizedDocSearch = docSearch.trim().toLowerCase();
  const filteredHelpDocs = helpDocs.filter((doc) => {
    const matchesSearch =
      !normalizedDocSearch ||
      doc.title.toLowerCase().includes(normalizedDocSearch) ||
      doc.sourceUrl?.toLowerCase().includes(normalizedDocSearch);
    const matchesLanguage = languageFilter === "all" || (doc.language || "unknown") === languageFilter;
    return matchesSearch && matchesLanguage;
  });
  const totalDocPages = Math.max(1, Math.ceil(filteredHelpDocs.length / DOCS_PER_PAGE));
  const currentDocsPage = Math.min(docsPage, totalDocPages);
  const paginatedHelpDocs = filteredHelpDocs.slice(
    (currentDocsPage - 1) * DOCS_PER_PAGE,
    currentDocsPage * DOCS_PER_PAGE
  );

  const normalizedLinkDocSearch = linkDocSearch.trim().toLowerCase();
  const linkCandidateDocs = helpDocs.filter((doc) => {
    if (!linkingDoc || doc.id === linkingDoc.id) return false;
    return (
      !normalizedLinkDocSearch ||
      doc.title.toLowerCase().includes(normalizedLinkDocSearch) ||
      doc.category.toLowerCase().includes(normalizedLinkDocSearch) ||
      doc.sourceUrl?.toLowerCase().includes(normalizedLinkDocSearch)
    );
  });
  const linkPreviewDoc = helpDocs.find((doc) => doc.id === linkPreviewDocId) ?? null;

  useEffect(() => {
    setDocsPage(1);
  }, [docSearch, languageFilter]);

  useEffect(() => {
    setDocsPage((currentPage) => Math.min(currentPage, Math.max(1, Math.ceil(filteredHelpDocs.length / DOCS_PER_PAGE))));
  }, [filteredHelpDocs.length]);

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto max-w-5xl px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-600">
              <BookOpen className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-stone-900">
                帮助中心文档维护助手
              </h1>
              <p className="text-sm text-stone-500">
                上传帮助文档并输入新功能描述，AI 自动检索并标注需要更新的文档
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-5xl px-6 py-8">
        {/* Navigation Tabs */}
        <div className="mb-6 flex rounded-xl border border-stone-200 bg-white p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setActiveTab("help-center")}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === "help-center"
                ? "bg-teal-600 text-white shadow-sm"
                : "text-stone-500 hover:bg-stone-50 hover:text-stone-900"
            }`}
          >
            <BookOpen className="h-4 w-4" />
            帮助中心
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("analyze")}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === "analyze"
                ? "bg-teal-600 text-white shadow-sm"
                : "text-stone-500 hover:bg-stone-50 hover:text-stone-900"
            }`}
          >
            <Sparkles className="h-4 w-4" />
            新功能分析
          </button>
        </div>

        {activeTab === "help-center" && (
          <section className="space-y-6">
            <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <FileUp className="h-4 w-4 text-teal-600" />
                    <h2 className="text-base font-semibold text-stone-900">
                      上传帮助文档
                    </h2>
                  </div>
                  <p className="text-sm leading-relaxed text-stone-500">
                    支持上传 Markdown（.md）和文本（.txt）格式，也可以导入单篇或批量导入帮助中心链接。AI 分析新功能时会优先在这里的帮助文档中检索需要修改的内容。
                  </p>
                </div>
                <Badge variant="secondary" className="shrink-0 text-xs">
                  {helpDocs.length} 篇文档
                </Badge>
              </div>

              <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-stone-300 bg-stone-50 px-6 py-10 text-center transition-colors hover:border-teal-300 hover:bg-teal-50/50">
                <Upload className="mb-3 h-8 w-8 text-teal-600" />
                <span className="text-sm font-medium text-stone-900">
                  点击上传帮助文档
                </span>
                <span className="mt-1 text-xs text-stone-400">
                  可一次选择多个 .md / .txt 文件
                </span>
                <input
                  type="file"
                  multiple
                  accept=".md,.txt,text/markdown,text/plain"
                  onChange={handleFileUpload}
                  className="sr-only"
                />
              </label>

              <div className="mt-5 rounded-xl border border-stone-200 bg-stone-50 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <LinkIcon className="h-4 w-4 text-teal-600" />
                  <span className="text-sm font-medium text-stone-700">
                    导入帮助文档链接
                  </span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={urlInput}
                    onChange={(event) => setUrlInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void handleImportUrl();
                      }
                    }}
                    placeholder="https://help.dicloak.com/zh/..."
                    disabled={importingUrl}
                    className="min-w-0 flex-1 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm outline-none transition-colors placeholder:text-stone-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleImportUrl}
                    disabled={!urlInput.trim() || importingUrl}
                    className="shrink-0"
                  >
                    {importingUrl ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        导入中
                      </>
                    ) : (
                      "导入链接"
                    )}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-stone-400">
                  支持中英文帮助中心网页；不同语言 URL 会作为不同文档导入。
                </p>
              </div>

              <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-teal-600" />
                  <span className="text-sm font-medium text-stone-700">
                    批量导入帮助中心
                  </span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={siteUrlInput}
                    onChange={(event) => setSiteUrlInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void handleImportSite();
                      }
                    }}
                    placeholder="https://help.dicloak.com/zh/"
                    disabled={importingSite}
                    className="min-w-0 flex-1 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm outline-none transition-colors placeholder:text-stone-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleImportSite}
                    disabled={!siteUrlInput.trim() || importingSite}
                    className="shrink-0"
                  >
                    {importingSite ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        批量导入中
                      </>
                    ) : (
                      "批量导入"
                    )}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-stone-400">
                  输入 https://help.dicloak.com/zh/ 或英文入口，系统会扫描同语言路径下的文档链接并导入。
                </p>
              </div>

              {uploadMessage && (
                <div className="mt-4 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
                  <CheckCircle2 className="h-4 w-4" />
                  {uploadMessage}
                </div>
              )}
              {uploadError && (
                <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <AlertCircle className="h-4 w-4" />
                  {uploadError}
                </div>
              )}
              {syncing && (
                <div className="mt-4 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在同步云端帮助文档...
                </div>
              )}
            </div>

            <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-stone-900">
                    已上传文档
                  </h2>
                  <p className="mt-1 text-sm text-stone-500">
                    共 {helpDocs.length} 篇，约 {totalCharacters.toLocaleString()} 字符
                  </p>
                </div>
                {helpDocs.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setActiveTab("analyze")}
                  >
                    去分析
                    <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                )}
              </div>

              {helpDocs.length > 0 && (
                <div className="mb-4 grid gap-3 rounded-lg border border-stone-200 bg-stone-50 p-4 sm:grid-cols-[1fr_auto]">
                  <input
                    type="search"
                    value={docSearch}
                    onChange={(event) => setDocSearch(event.target.value)}
                    placeholder="按文档名称或链接搜索"
                    className="min-w-0 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm outline-none transition-colors placeholder:text-stone-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
                  />
                  <select
                    value={languageFilter}
                    onChange={(event) => setLanguageFilter(event.target.value as LanguageFilter)}
                    className="rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 outline-none transition-colors focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
                  >
                    <option value="all">全部语言</option>
                    <option value="zh">中文</option>
                    <option value="en">English</option>
                    <option value="unknown">未知语言</option>
                  </select>
                  <p className="text-xs text-stone-400 sm:col-span-2">
                    当前显示 {filteredHelpDocs.length} / {helpDocs.length} 篇文档，每页 10 条
                  </p>
                </div>
              )}

              {helpDocs.length === 0 ? (
                <div className="rounded-lg border border-stone-200 bg-stone-50 p-8 text-center">
                  <FileText className="mx-auto mb-3 h-8 w-8 text-stone-300" />
                  <p className="text-sm font-medium text-stone-500">
                    暂无帮助文档
                  </p>
                  <p className="mt-1 text-xs text-stone-400">
                    上传后，AI 会基于这些文档判断新功能影响范围
                  </p>
                </div>
              ) : filteredHelpDocs.length === 0 ? (
                <div className="rounded-lg border border-stone-200 bg-stone-50 p-8 text-center">
                  <FileText className="mx-auto mb-3 h-8 w-8 text-stone-300" />
                  <p className="text-sm font-medium text-stone-500">
                    没有匹配的文档
                  </p>
                  <p className="mt-1 text-xs text-stone-400">
                    请调整搜索关键词或语言筛选条件
                  </p>
                </div>
              ) : (
                <div className="grid gap-3">
                  {paginatedHelpDocs.map((doc) => {
                    const linkedDoc = doc.linkedDocId ? helpDocs.find((helpDoc) => helpDoc.id === doc.linkedDocId) : null;

                    return (
                      <div
                        key={doc.id}
                        className="grid max-w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-3 overflow-hidden rounded-lg border border-stone-200 bg-white p-4 transition-colors hover:border-teal-200 hover:bg-teal-50/30"
                      >
                        <div className="min-w-0 overflow-hidden text-left">
                          <button
                            type="button"
                            onClick={() => handlePreviewDoc(doc)}
                            className="block min-w-0 overflow-hidden text-left"
                          >
                            <div className="mb-1 flex min-w-0 items-center gap-2">
                              <FileText className="h-4 w-4 shrink-0 text-stone-400" />
                              <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-stone-900">
                                {doc.title}
                              </h3>
                              <Badge variant="outline" className="shrink-0 text-[10px] text-stone-400">
                                {doc.category}
                              </Badge>
                              {doc.language && doc.language !== "unknown" && (
                                <Badge variant="secondary" className="shrink-0 text-[10px]">
                                  {doc.language === "zh" ? "中文" : "English"}
                                </Badge>
                              )}
                            </div>
                            <p
                              className="truncate text-xs text-stone-400"
                              title={doc.sourceUrl || undefined}
                            >
                              {doc.content.length.toLocaleString()} 字符 · 更新于 {doc.lastUpdated} · 点击查看文档内容
                              {doc.sourceUrl ? ` · ${doc.sourceUrl}` : ""}
                            </p>
                          </button>

                          <div className="mt-2 flex min-w-0 items-center gap-2 rounded-md bg-stone-50 px-2 py-1.5 text-xs text-stone-500">
                            <LinkIcon className="h-3.5 w-3.5 shrink-0 text-teal-600" />
                            <span className="shrink-0">关联文档：</span>
                            {linkedDoc ? (
                              <button
                                type="button"
                                onClick={() => handlePreviewDoc(linkedDoc)}
                                className="min-w-0 flex-1 truncate text-left font-medium text-teal-700 hover:underline"
                                title={linkedDoc.title}
                              >
                                {linkedDoc.title}
                              </button>
                            ) : (
                              <span className="min-w-0 flex-1 truncate text-stone-400">
                                未关联，可点击右侧「关联」选择对应语言文档
                              </span>
                            )}
                            {linkedDoc?.language && linkedDoc.language !== "unknown" && (
                              <Badge variant="secondary" className="shrink-0 text-[10px]">
                                {linkedDoc.language === "zh" ? "中文" : "English"}
                              </Badge>
                            )}
                          </div>
                        </div>

                        <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row">
                          <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0 text-teal-700 hover:bg-teal-50"
                            onClick={() => handleOpenLinkDrawer(doc)}
                          >
                            {linkedDoc ? "更换关联" : "关联"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="shrink-0 text-red-500 hover:bg-red-50 hover:text-red-600"
                            onClick={() => handleRemoveDoc(doc.id)}
                          >
                            删除
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {filteredHelpDocs.length > DOCS_PER_PAGE && (
                <div className="mt-4 flex flex-col gap-3 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm text-stone-600 sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    第 {currentDocsPage} / {totalDocPages} 页 · 每页 10 条
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setDocsPage((page) => Math.max(1, page - 1))}
                      disabled={currentDocsPage <= 1}
                    >
                      上一页
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setDocsPage((page) => Math.min(totalDocPages, page + 1))}
                      disabled={currentDocsPage >= totalDocPages}
                    >
                      下一页
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === "analyze" && (
          <>
            {/* Input Section */}
            <section className="mb-8">
              <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-teal-600" />
                    <span className="text-sm font-medium text-stone-700">
                      新功能描述
                    </span>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {retrievalStats
                      ? `预检索 ${retrievalStats.candidateDocuments}/${retrievalStats.totalDocuments} 篇`
                      : `检索 ${helpDocs.length} 篇帮助文档`}
                  </Badge>
                </div>
                <Textarea
                  placeholder="请描述即将上线的新功能，例如：新增团队空间功能，支持创建团队空间并邀请成员加入，团队空间内可以共享项目、文档和日程..."
                  className="min-h-[140px] resize-none text-base leading-relaxed"
                  value={feature}
                  onChange={(e) => setFeature(e.target.value)}
                  disabled={analyzing}
                />
                <div className="mt-4 flex items-center justify-between">
                  <p className="text-xs text-stone-400">
                    将先从 {helpDocs.length} 篇帮助文档中预检索最多 30 篇候选文档，再交给 AI 分析，降低 token 消耗
                  </p>
                  <Button
                    onClick={handleAnalyze}
                    disabled={!feature.trim() || analyzing || helpDocs.length === 0}
                    className="bg-teal-600 hover:bg-teal-700"
                  >
                    {analyzing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        正在分析...
                      </>
                    ) : (
                      <>
                        <Search className="mr-2 h-4 w-4" />
                        开始分析
                      </>
                    )}
                  </Button>
                </div>
                {helpDocs.length === 0 && (
                  <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                    请先到「帮助中心」上传 md 或 txt 帮助文档，再开始新功能分析。
                  </div>
                )}
              </div>
            </section>

            {/* Streaming Progress */}
            {analyzing && (streamingText || retrievalStats) && (
              <section className="mb-8">
                <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
                  <div className="mb-3 flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-teal-600" />
                    <span className="text-sm font-medium text-stone-700">
                      AI 正在分析候选帮助文档...
                    </span>
                  </div>
                  {retrievalStats && (
                    <div className="mb-3 rounded-lg border border-teal-100 bg-teal-50 p-3 text-xs text-teal-700">
                      已先从 {retrievalStats.totalDocuments} 篇文档中预检索出 {retrievalStats.candidateDocuments} 篇候选文档
                      {retrievalStats.searchTerms.length > 0 ? `，命中关键词：${retrievalStats.searchTerms.slice(0, 8).join("、")}` : ""}
                    </div>
                  )}
                  <ScrollArea className="h-[200px] rounded-lg bg-stone-50 p-4">
                    <pre className="whitespace-pre-wrap text-xs text-stone-500">
                      {streamingText}
                    </pre>
                  </ScrollArea>
                </div>
              </section>
            )}

            {/* Error */}
            {error && (
              <section className="mb-8">
                <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                  <div className="flex items-center gap-2 text-red-700">
                    <AlertCircle className="h-4 w-4" />
                    <span className="text-sm font-medium">{error}</span>
                  </div>
                </div>
              </section>
            )}

            {/* Results */}
            {affectedDocs.length > 0 && !analyzing && (
              <section>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold text-stone-900">
                      已上传文档
                    </h2>
                    {syncing && (
                      <Badge variant="secondary" className="gap-1 text-xs">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        同步中
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-stone-500">
                    共 {helpDocs.length} 篇，约 {totalCharacters.toLocaleString()} 字符
                  </p>
                </div>

                <div className="grid gap-4">
                  {affectedDocs.map((doc) => {
                    const stats = getChangeStats(doc);
                    return (
                      <button
                        key={doc.docId}
                        onClick={() => handleDocClick(doc)}
                        className="group w-full rounded-xl border border-stone-200 bg-white p-5 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-md"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="mb-2 flex items-center gap-2">
                              <FileText className="h-4 w-4 text-stone-400" />
                              <span className="font-medium text-stone-900">
                                {doc.docName}
                              </span>
                              <Badge
                                variant="outline"
                                className="shrink-0 text-[10px] text-stone-400"
                              >
                                {doc.docId}
                              </Badge>
                            </div>
                            <p className="mb-3 text-sm text-stone-500">
                              {doc.reason}
                            </p>
                            <div className="flex items-center gap-3">
                              {stats.deletes > 0 && (
                                <div className="flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5">
                                  <Trash2 className="h-3 w-3 text-red-500" />
                                  <span className="text-xs font-medium text-red-600">
                                    删除 {stats.deletes} 处
                                  </span>
                                </div>
                              )}
                              {stats.adds > 0 && (
                                <div className="flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-0.5">
                                  <Plus className="h-3 w-3 text-green-500" />
                                  <span className="text-xs font-medium text-green-600">
                                    新增 {stats.adds} 处
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                          <ChevronRight className="mt-1 h-5 w-5 text-stone-300 transition-colors group-hover:text-teal-500" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Empty State */}
            {!analyzing && affectedDocs.length === 0 && !error && !streamingText && (
              <section className="py-16 text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-stone-100">
                  <FileText className="h-8 w-8 text-stone-300" />
                </div>
                <h3 className="mb-1 text-sm font-medium text-stone-500">
                  尚未进行分析
                </h3>
                <p className="text-sm text-stone-400">
                  上传帮助文档并输入新功能描述后，点击「开始分析」查看需要更新的文档
                </p>
              </section>
            )}
          </>
        )}
      </main>

      {/* Document Link Drawer */}
      <Sheet open={linkDrawerOpen} onOpenChange={setLinkDrawerOpen}>
        <SheetContent
          side="right"
          className="w-[840px] max-w-[94vw] sm:max-w-[840px] overflow-hidden p-0"
        >
          {linkingDoc && (
            <>
              <SheetHeader className="border-b border-stone-200 px-6 py-4">
                <SheetTitle className="flex min-w-0 items-center gap-2 text-lg">
                  <LinkIcon className="h-5 w-5 shrink-0 text-teal-600" />
                  <span className="min-w-0 truncate">关联文档：{linkingDoc.title}</span>
                </SheetTitle>
                <SheetDescription className="text-left">
                  选择对应的中文或英文文档，系统会自动建立双向关联；不需要关联的文档可以保持未关联。
                </SheetDescription>
              </SheetHeader>

              <div className="grid h-[calc(100vh-120px)] grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
                <div className="min-w-0 border-b border-stone-200 p-4 lg:border-b-0 lg:border-r">
                  <input
                    value={linkDocSearch}
                    onChange={(event) => setLinkDocSearch(event.target.value)}
                    placeholder="搜索要关联的文档名称或链接"
                    className="mb-3 w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
                  />
                  {linkingDoc.linkedDocId && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mb-3 w-full text-stone-600"
                      onClick={() => handleUnlinkDoc(linkingDoc.id)}
                    >
                      取消当前关联
                    </Button>
                  )}
                  <ScrollArea className="h-[calc(100vh-235px)] pr-2">
                    <div className="space-y-2">
                      {linkCandidateDocs.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-stone-200 p-5 text-center text-sm text-stone-400">
                          没有匹配的可关联文档
                        </div>
                      ) : (
                        linkCandidateDocs.map((candidateDoc) => (
                          <div
                            key={candidateDoc.id}
                            className="rounded-lg border border-stone-200 bg-white p-3"
                          >
                            <div className="mb-2 flex min-w-0 items-center gap-2">
                              <FileText className="h-4 w-4 shrink-0 text-stone-400" />
                              <p className="min-w-0 flex-1 truncate text-sm font-medium text-stone-900" title={candidateDoc.title}>
                                {candidateDoc.title}
                              </p>
                              {candidateDoc.language && candidateDoc.language !== "unknown" && (
                                <Badge variant="secondary" className="shrink-0 text-[10px]">
                                  {candidateDoc.language === "zh" ? "中文" : "English"}
                                </Badge>
                              )}
                            </div>
                            <p className="mb-3 truncate text-xs text-stone-400" title={candidateDoc.sourceUrl || undefined}>
                              {candidateDoc.category} · {candidateDoc.content.length.toLocaleString()} 字符
                              {candidateDoc.sourceUrl ? ` · ${candidateDoc.sourceUrl}` : ""}
                            </p>
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                size="sm"
                                className="bg-teal-600 hover:bg-teal-700"
                                onClick={() => handleLinkDocs(candidateDoc)}
                              >
                                选择关联
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setLinkPreviewDocId(candidateDoc.id)}
                              >
                                预览
                              </Button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </div>

                <div className="min-w-0 overflow-hidden bg-stone-50">
                  {linkPreviewDoc ? (
                    <ScrollArea className="h-full">
                      <div className="p-5">
                        <div className="mb-3 min-w-0 rounded-lg border border-stone-200 bg-white p-4">
                          <div className="mb-1 flex min-w-0 items-center gap-2">
                            <FileText className="h-4 w-4 shrink-0 text-teal-600" />
                            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-stone-900" title={linkPreviewDoc.title}>
                              {linkPreviewDoc.title}
                            </h3>
                          </div>
                          <p className="truncate text-xs text-stone-400" title={linkPreviewDoc.sourceUrl || undefined}>
                            {linkPreviewDoc.category} · {linkPreviewDoc.content.length.toLocaleString()} 字符 · 更新于 {linkPreviewDoc.lastUpdated}
                            {linkPreviewDoc.sourceUrl ? ` · ${linkPreviewDoc.sourceUrl}` : ""}
                          </p>
                        </div>
                        <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
                          {linkPreviewDoc.htmlContent
                            ? renderHtmlDocument(linkPreviewDoc.htmlContent)
                            : renderFormattedDocument(linkPreviewDoc.content)}
                        </div>
                      </div>
                    </ScrollArea>
                  ) : (
                    <div className="flex h-full items-center justify-center p-8 text-center text-sm text-stone-400">
                      点击左侧文档的「预览」查看内容，确认后再选择关联。
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Uploaded Document Preview Drawer */}
      <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
        <SheetContent
          side="right"
          className="w-[760px] max-w-[92vw] sm:max-w-[760px] overflow-hidden p-0"
        >
          {previewDoc && (
            <>
              <SheetHeader className="border-b border-stone-200 px-6 py-4">
                <SheetTitle className="flex items-center gap-2 text-lg">
                  <FileText className="h-5 w-5 text-teal-600" />
                  {previewDoc.title}
                </SheetTitle>
                <SheetDescription className="text-left">
                  {previewDoc.category} · {previewDoc.content.length.toLocaleString()} 字符 · 更新于 {previewDoc.lastUpdated}
                  {previewDoc.sourceUrl && (
                    <>
                      {" · "}
                      <a
                        href={previewDoc.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-teal-700 underline underline-offset-2"
                      >
                        查看原网页
                      </a>
                    </>
                  )}
                </SheetDescription>
              </SheetHeader>

              <ScrollArea className="h-[calc(100vh-120px)]">
                <div className="px-6 py-6">
                  <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
                    {previewDoc.htmlContent
                      ? renderHtmlDocument(previewDoc.htmlContent)
                      : renderFormattedDocument(previewDoc.content)}
                  </div>
                </div>
              </ScrollArea>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Document Detail Drawer */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent
          side="right"
          className="w-[700px] max-w-[90vw] sm:max-w-[700px] overflow-hidden p-0"
        >
          {selectedDoc && (
            <>
              <SheetHeader className="border-b border-stone-200 px-6 py-4">
                <SheetTitle className="flex items-center gap-2 text-lg">
                  <FileText className="h-5 w-5 text-teal-600" />
                  {selectedDoc.docName}
                </SheetTitle>
                <SheetDescription className="text-left">
                  {selectedDoc.reason}
                </SheetDescription>
                <div className="mt-2 flex items-center gap-3">
                  {getChangeStats(selectedDoc).deletes > 0 && (
                    <div className="flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1">
                      <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      <span className="text-xs font-medium text-red-600">
                        需删除 {getChangeStats(selectedDoc).deletes} 处
                      </span>
                    </div>
                  )}
                  {getChangeStats(selectedDoc).adds > 0 && (
                    <div className="flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1">
                      <Plus className="h-3.5 w-3.5 text-green-500" />
                      <span className="text-xs font-medium text-green-600">
                        需新增 {getChangeStats(selectedDoc).adds} 处
                      </span>
                    </div>
                  )}
                </div>
              </SheetHeader>

              <ScrollArea className="h-[calc(100vh-200px)]">
                <div className="px-6 py-5">
                  {/* Change Details */}
                  <div className="mb-6">
                    <h3 className="mb-3 text-sm font-semibold text-stone-700">
                      修改详情
                    </h3>
                    <div className="space-y-3">
                      {selectedDoc.changes.map((change, i) => (
                        <div
                          key={i}
                          className={`rounded-lg border p-4 ${
                            change.type === "delete"
                              ? "border-red-200 bg-red-50/50"
                              : "border-green-200 bg-green-50/50"
                          }`}
                        >
                          <div className="mb-2 flex items-center gap-2">
                            {change.type === "delete" ? (
                              <Trash2 className="h-4 w-4 text-red-500" />
                            ) : (
                              <Plus className="h-4 w-4 text-green-500" />
                            )}
                            <span
                              className={`text-sm font-medium ${
                                change.type === "delete"
                                  ? "text-red-700"
                                  : "text-green-700"
                              }`}
                            >
                              {change.type === "delete" ? "删除内容" : "新增内容"}
                            </span>
                            {change.position && (
                              <Badge
                                variant="outline"
                                className="text-[10px]"
                              >
                                {change.position === "after"
                                  ? "在引用文本之后"
                                  : change.position === "before"
                                  ? "在引用文本之前"
                                  : "替换"}
                              </Badge>
                            )}
                          </div>
                          {change.type === "delete" && change.originalText && (
                            <div className="mb-2 rounded bg-white p-3 text-sm text-red-800 line-through">
                              {change.originalText}
                            </div>
                          )}
                          {change.type === "add" && (
                            <div className="mb-2 rounded bg-white p-3 text-sm text-green-800">
                              {change.newContent}
                            </div>
                          )}
                          {change.referenceText && (
                            <div className="mb-1 text-xs text-stone-400">
                              定位参考：「{change.referenceText}」
                            </div>
                          )}
                          <div className="text-xs text-stone-500">
                            原因：{change.reason}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Full Document with Highlights */}
                  {docDetail && (
                    <div>
                      <h3 className="mb-3 text-sm font-semibold text-stone-700">
                        文档全文（含标注）
                      </h3>
                      <div className="rounded-lg border border-stone-200 bg-white p-5">
                        {renderDocumentWithChanges(
                          docDetail.content,
                          selectedDoc.changes
                        )}
                      </div>
                    </div>
                  )}

                  {!docDetail && (
                    <div className="rounded-lg border border-stone-200 bg-white p-5 text-center text-sm text-stone-400">
                      文档原文加载中...
                    </div>
                  )}
                </div>
              </ScrollArea>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
