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
}

type ActiveTab = "help-center" | "analyze";
type LanguageFilter = "all" | "zh" | "en" | "unknown";

const STORAGE_KEY = "dicloak-helpcenter-uploaded-docs";
const SUPPORTED_FILE_EXTENSIONS = [".md", ".txt"];

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
  const [previewDoc, setPreviewDoc] = useState<DocDetail | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const storedDocs = window.localStorage.getItem(STORAGE_KEY);
      if (storedDocs) {
        const parsedDocs = JSON.parse(storedDocs) as DocDetail[];
        setHelpDocs(parsedDocs);
      }
    } catch {
      setUploadError("本地帮助文档读取失败，请重新上传");
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(helpDocs));
    } catch {
      setUploadError("帮助文档保存到本地失败，请减少文档数量后重试");
    }
  }, [helpDocs]);

  const mergeHelpDocs = useCallback((incomingDocs: DocDetail[]) => {
    setHelpDocs((currentDocs) => {
      const nextDocs = [...currentDocs];
      for (const incomingDoc of incomingDocs) {
        const existingIndex = nextDocs.findIndex((doc) => doc.id === incomingDoc.id);
        if (existingIndex >= 0) {
          nextDocs[existingIndex] = incomingDoc;
        } else {
          nextDocs.push(incomingDoc);
        }
      }
      return nextDocs;
    });
  }, []);

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

      const importedDoc = data.document as DocDetail;
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
      const response = await fetch("/api/import-site", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmedUrl }),
      });
      const data = await response.json();

      if (!response.ok || !Array.isArray(data.documents)) {
        throw new Error(data.error || "批量导入失败");
      }

      const importedDocs = data.documents as DocDetail[];
      mergeHelpDocs(importedDocs);
      setSiteUrlInput("");
      const failedCount = Array.isArray(data.failed) ? data.failed.length : 0;
      const crawledCount = typeof data.crawledCount === "number" ? data.crawledCount : 0;
      const discoveredCount = typeof data.discoveredCount === "number" ? data.discoveredCount : importedDocs.length;
      setUploadMessage(
        `已批量导入 ${importedDocs.length} 篇帮助文档，扫描 ${crawledCount} 个页面，发现 ${discoveredCount} 个链接${failedCount > 0 ? `，${failedCount} 个链接导入失败` : ""}`
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

  const handleRemoveDoc = useCallback((docId: string) => {
    setHelpDocs((currentDocs) => currentDocs.filter((doc) => doc.id !== docId));
    setAffectedDocs((currentDocs) => currentDocs.filter((doc) => doc.docId !== docId));
    setPreviewDoc((currentDoc) => (currentDoc?.id === docId ? null : currentDoc));
  }, []);

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
              const data = JSON.parse(line.slice(6));
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
                    当前显示 {filteredHelpDocs.length} / {helpDocs.length} 篇文档
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
                  {filteredHelpDocs.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex max-w-full items-start justify-between gap-4 rounded-lg border border-stone-200 bg-white p-4 transition-colors hover:border-teal-200 hover:bg-teal-50/30"
                    >
                      <button
                        type="button"
                        onClick={() => handlePreviewDoc(doc)}
                        className="min-w-0 flex-1 overflow-hidden text-left"
                      >
                        <div className="mb-1 flex items-center gap-2">
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
                          title={doc.sourceUrl ? `${doc.content.length.toLocaleString()} 字符 · 更新于 ${doc.lastUpdated} · 点击查看文档内容 · ${doc.sourceUrl}` : undefined}
                        >
                          {doc.content.length.toLocaleString()} 字符 · 更新于 {doc.lastUpdated} · 点击查看文档内容
                          {doc.sourceUrl ? ` · ${doc.sourceUrl}` : ""}
                        </p>
                      </button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0 text-red-500 hover:bg-red-50 hover:text-red-600"
                        onClick={() => handleRemoveDoc(doc.id)}
                      >
                        删除
                      </Button>
                    </div>
                  ))}
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
                    检索 {helpDocs.length} 篇帮助文档
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
                    描述越详细，AI 在上传帮助文档中的检索结果越准确
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
            {analyzing && streamingText && (
              <section className="mb-8">
                <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
                  <div className="mb-3 flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-teal-600" />
                    <span className="text-sm font-medium text-stone-700">
                      AI 正在检索帮助文档...
                    </span>
                  </div>
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
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-stone-900">
                    需要更新的文档
                  </h2>
                  <Badge variant="secondary" className="text-xs">
                    共 {affectedDocs.length} 篇
                  </Badge>
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
                                className="text-[10px] text-stone-400"
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