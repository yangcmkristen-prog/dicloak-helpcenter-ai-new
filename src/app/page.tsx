"use client";

import { useState, useCallback, useEffect, useRef, type ChangeEvent, type ClipboardEvent, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  BookOpen,
  ChevronRight,
  Sparkles,
  AlertCircle,
  Upload,
  FileUp,
  CheckCircle2,
  History,
  Edit3,
  RefreshCw,
  MessageSquareText,
  Image as ImageIcon,
  X,
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
  language?: "zh" | "en" | "unknown";
  linkedFromDocId?: string | null;
  reason: string;
  insertPosition?: string;
  deleteSummary?: string;
  addSummary?: string;
  unifiedDiff?: string;
  changes?: DocumentChange[];
}

interface SuggestedNewDoc {
  title: string;
  category: string;
  language?: "zh" | "en" | "unknown";
  reason: string;
  content: string;
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
  linkedDocIds?: string[];
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

interface AnalyzeImageAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl: string;
}

interface AnalysisHistoryRecord {
  id: string;
  feature: string;
  instruction?: string;
  editedDocIds?: string[];
  createdAt: string;
  model: AnalyzeModel;
  imageNames: string[];
  affectedDocs: AffectedDoc[];
  suggestedNewDocs: SuggestedNewDoc[];
  retrievalStats: RetrievalStats | null;
}

type ActiveTab = "help-center" | "analyze";
type LanguageFilter = "all" | "zh" | "en" | "unknown";
type AnalyzeModel = "deepseek-v4-flash" | "deepseek-v4-pro";

const SUPPORTED_FILE_EXTENSIONS = [".md", ".txt"];
const DOCS_PER_PAGE = 10;

const ANALYSIS_HISTORY_STORAGE_KEY = "dicloak-analysis-history";
const MAX_ANALYSIS_HISTORY = 50;
const MAX_ANALYZE_IMAGES = 8;

function isSupportedHelpDocument(file: File) {
  const lowerName = file.name.toLowerCase();
  return SUPPORTED_FILE_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
}

function isSupportedAnalyzeImage(file: File) {
  return file.type.startsWith("image/");
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("图片读取结果异常"));
      }
    };
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getHistoryTitle(record: AnalysisHistoryRecord) {
  const trimmedFeature = record.feature.trim();
  if (trimmedFeature) return trimmedFeature;
  if (record.imageNames.length > 0) return `截图分析：${record.imageNames.join("、")}`;
  return "未命名分析";
}

function normalizeAnalysisHistoryRecord(rawRecord: unknown): AnalysisHistoryRecord | null {
  if (!rawRecord || typeof rawRecord !== "object") return null;
  const record = rawRecord as Record<string, unknown>;
  const id = getStringField(record.id);
  const feature = getStringField(record.feature);
  const createdAt = getStringField(record.createdAt);
  const model = getStringField(record.model);

  if (!id || feature === undefined || !createdAt || (model !== "deepseek-v4-flash" && model !== "deepseek-v4-pro")) {
    return null;
  }

  return {
    id,
    feature,
    createdAt,
    model,
    instruction: getStringField(record.instruction),
    editedDocIds: Array.isArray(record.editedDocIds) ? record.editedDocIds.filter((id): id is string => typeof id === "string") : [],
    imageNames: Array.isArray(record.imageNames) ? record.imageNames.filter((name): name is string => typeof name === "string") : [],
    affectedDocs: Array.isArray(record.affectedDocs) ? (record.affectedDocs as AffectedDoc[]) : [],
    suggestedNewDocs: Array.isArray(record.suggestedNewDocs) ? (record.suggestedNewDocs as SuggestedNewDoc[]) : [],
    retrievalStats: record.retrievalStats && typeof record.retrievalStats === "object" ? (record.retrievalStats as RetrievalStats) : null,
  };
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

function getLinkedDocIdsFromValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
  }

  if (typeof value !== "string" || value.trim().length === 0) return [];

  const trimmedValue = value.trim();
  if (trimmedValue.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmedValue) as unknown;
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string" && id.trim().length > 0) : [];
    } catch {
      return [trimmedValue];
    }
  }

  return [trimmedValue];
}

function getDocLinkedIds(doc: Pick<DocDetail, "linkedDocId" | "linkedDocIds">) {
  return Array.from(new Set([...(doc.linkedDocIds ?? []), ...(doc.linkedDocId ? [doc.linkedDocId] : [])]));
}

function setDocLinkedIds(doc: DocDetail, linkedDocIds: string[]) {
  const uniqueLinkedDocIds = Array.from(new Set(linkedDocIds.filter((id) => id !== doc.id)));
  return { ...doc, linkedDocIds: uniqueLinkedDocIds, linkedDocId: uniqueLinkedDocIds[0] };
}

function haveSameLinkedDocIds(firstDoc: DocDetail, secondDoc: DocDetail) {
  return getDocLinkedIds(firstDoc).join("|") === getDocLinkedIds(secondDoc).join("|");
}

function removeLinkedDocId(doc: DocDetail): DocDetail {
  return setDocLinkedIds(doc, []);
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
    linkedDocIds: getLinkedDocIdsFromValue(doc.linkedDocIds ?? doc.linked_doc_ids ?? doc.linkedDocId ?? doc.linked_doc_id),
    linkedDocId: getLinkedDocIdsFromValue(doc.linkedDocIds ?? doc.linked_doc_ids ?? doc.linkedDocId ?? doc.linked_doc_id)[0],
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

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function markdownToRichHtml(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const htmlLines: string[] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      htmlLines.push("<p><br></p>");
      continue;
    }

    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmedLine);
    if (headingMatch) {
      const level = headingMatch[1].length;
      htmlLines.push(`<h${level}>${escapeHtml(headingMatch[2])}</h${level}>`);
      continue;
    }

    const unorderedListMatch = /^[-*]\s+(.+)$/.exec(trimmedLine);
    if (unorderedListMatch) {
      htmlLines.push(`<ul><li>${escapeHtml(unorderedListMatch[1])}</li></ul>`);
      continue;
    }

    const orderedListMatch = /^(\d+)\.\s+(.+)$/.exec(trimmedLine);
    if (orderedListMatch) {
      htmlLines.push(`<ol start="${orderedListMatch[1]}"><li>${escapeHtml(orderedListMatch[2])}</li></ol>`);
      continue;
    }

    htmlLines.push(`<p>${escapeHtml(trimmedLine)}</p>`);
  }

  return htmlLines.join("\n");
}

function richHtmlToMarkdown(htmlContent: string) {
  const parser = new DOMParser();
  const documentContent = parser.parseFromString(htmlContent, "text/html");

  const renderNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent ?? "";
    }

    if (!(node instanceof HTMLElement)) return "";

    const children = Array.from(node.childNodes).map(renderNode).join("");
    const tagName = node.tagName.toLowerCase();

    if (tagName === "strong" || tagName === "b") return `**${children}**`;
    if (tagName === "em" || tagName === "i") return `*${children}*`;
    if (tagName === "br") return "\n";
    if (/^h[1-4]$/.test(tagName)) return `${"#".repeat(Number(tagName[1]))} ${children.trim()}\n\n`;
    if (tagName === "li") return `- ${children.trim()}\n`;
    if (tagName === "p" || tagName === "div") return `${children.trim()}\n\n`;
    if (tagName === "ul" || tagName === "ol") return `${children.trim()}\n\n`;

    return children;
  };

  return Array.from(documentContent.body.childNodes)
    .map(renderNode)
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface RichTextEditorProps {
  initialHtml: string;
  onChange: (html: string) => void;
}

function RichTextEditor({ initialHtml, onChange }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const initialHtmlRef = useRef(initialHtml);

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = initialHtmlRef.current;
    }
  }, []);

  const runCommand = (command: string, value?: string) => {
    const editor = editorRef.current;
    if (!editor) return;

    editor.focus();
    document.execCommand(command, false, value);
    onChange(editor.innerHTML);
  };

  const toolbarButtonProps = (command: string, value?: string) => ({
    onMouseDown: (event: React.MouseEvent<HTMLButtonElement>) => event.preventDefault(),
    onClick: () => runCommand(command, value),
  });

  return (
    <>
      <div className="mb-2 flex flex-wrap gap-1 rounded-md border border-amber-100 bg-white p-1.5">
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" {...toolbarButtonProps("bold")}>加粗</Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" {...toolbarButtonProps("formatBlock", "h2")}>标题</Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" {...toolbarButtonProps("insertUnorderedList")}>列表</Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" {...toolbarButtonProps("formatBlock", "p")}>正文</Button>
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={(event) => onChange(event.currentTarget.innerHTML)}
        className="h-[min(60vh,640px)] min-h-[360px] overflow-y-auto overscroll-contain rounded-md border border-stone-200 bg-white p-4 text-sm leading-7 text-stone-700 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 [&_h1]:mb-4 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mb-3 [&_h2]:mt-5 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-3 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-6"
      />
    </>
  );
}
async function copyMarkdownAsRichText(markdown: string) {
  const html = markdownToRichHtml(markdown);

  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([markdown], { type: "text/plain" }),
      }),
    ]);
    return;
  }

  await navigator.clipboard.writeText(markdown);
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

function normalizeDiffForDisplay(diff?: string) {
  return (diff || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "[图片占位符：相关界面截图]")
    .replace(/https?:\/\/help\.dicloak\.com\/wp-content\/uploads\/[^\s)]+/g, "[图片占位符：相关界面截图]");
}

function getDiffLineDisplayParts(line: string) {
  const isDelete = line.startsWith("-") && !line.startsWith("---");
  const isAdd = line.startsWith("+") && !line.startsWith("+++");
  const isHeader = line.startsWith("---") || line.startsWith("+++") || line.startsWith("@@");
  const hasDiffMarker = isDelete || isAdd;
  const displayLine = hasDiffMarker || (!isHeader && line.startsWith(" ")) ? line.slice(1) : line;

  return {
    displayLine,
    isAdd,
    isDelete,
    isHeader,
    marker: isAdd ? "+" : isDelete ? "-" : "",
  };
}

function getSelectedDiffMarkdown(container: HTMLDivElement, selection: Selection) {
  if (selection.rangeCount === 0) return "";

  const range = selection.getRangeAt(0);
  const selectedLines = Array.from(container.querySelectorAll<HTMLElement>("[data-diff-content]"))
    .filter((element) => range.intersectsNode(element))
    .map((element) => element.dataset.diffContent ?? "");

  if (selectedLines.length > 0) {
    return selectedLines.join("\n").replace(/ /g, " ");
  }

  return selection.toString().replace(/ /g, " ");
}

function handleDiffCopy(event: ClipboardEvent<HTMLDivElement>) {
  const selection = window.getSelection();

  if (!selection || selection.isCollapsed) return;

  const plainMarkdown = getSelectedDiffMarkdown(event.currentTarget, selection);
  if (!plainMarkdown.trim()) return;

  event.preventDefault();
  event.clipboardData.setData("text/plain", plainMarkdown);
  event.clipboardData.setData("text/markdown", plainMarkdown);
}

function renderUnifiedDiff(diff?: string) {
  const normalizedDiff = normalizeDiffForDisplay(diff);

  if (!normalizedDiff.trim()) {
    return (
      <div className="rounded-lg border border-dashed border-stone-200 bg-stone-50 p-6 text-center text-sm text-stone-400">
        暂无 diff 内容
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-lg border border-stone-200 bg-white text-sm shadow-sm"
      onCopy={handleDiffCopy}
    >
      {normalizedDiff.split("\n").map((line, index) => {
        const { displayLine, isAdd, isDelete, isHeader, marker } = getDiffLineDisplayParts(line);

        return (
          <div
            key={`${index}-${line}`}
            className={`grid grid-cols-[56px_28px_minmax(0,1fr)] border-b border-stone-100 last:border-b-0 ${
              isDelete
                ? "bg-red-50 text-red-900"
                : isAdd
                  ? "bg-green-50 text-green-900"
                  : isHeader
                    ? "bg-stone-100 text-stone-600"
                    : "bg-white text-stone-700"
            }`}
          >
            <span className="select-none border-r border-stone-200 px-3 py-1.5 text-right font-mono text-xs text-stone-400">
              {index + 1}
            </span>
            <span className="select-none px-2 py-1.5 text-center font-mono text-xs font-semibold text-stone-400">
              {marker}
            </span>
            <div
              className="min-w-0 overflow-x-auto whitespace-pre-wrap px-3 py-1.5 font-sans leading-6"
              data-diff-content={displayLine}
            >
              {displayLine || " "}
            </div>
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
  const [analyzeModel, setAnalyzeModel] = useState<AnalyzeModel>("deepseek-v4-flash");
  const [affectedDocs, setAffectedDocs] = useState<AffectedDoc[]>([]);
  const [suggestedNewDocs, setSuggestedNewDocs] = useState<SuggestedNewDoc[]>([]);
  const [selectedAffectedDocId, setSelectedAffectedDocId] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [retrievalStats, setRetrievalStats] = useState<RetrievalStats | null>(null);
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
  const [analyzeImages, setAnalyzeImages] = useState<AnalyzeImageAttachment[]>([]);
  const [analysisHistory, setAnalysisHistory] = useState<AnalysisHistoryRecord[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [revisionInstruction, setRevisionInstruction] = useState("");
  const [revisionDialogOpen, setRevisionDialogOpen] = useState(false);
  const [editingAffectedDocs, setEditingAffectedDocs] = useState(false);
  const [editedAffectedContents, setEditedAffectedContents] = useState<Record<string, string>>({});

  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    try {
      const rawHistory = window.localStorage.getItem(ANALYSIS_HISTORY_STORAGE_KEY);
      const parsedHistory = rawHistory ? JSON.parse(rawHistory) : [];
      if (Array.isArray(parsedHistory)) {
        setAnalysisHistory(
          parsedHistory
            .map((record) => normalizeAnalysisHistoryRecord(record))
            .filter((record): record is AnalysisHistoryRecord => Boolean(record))
            .slice(0, MAX_ANALYSIS_HISTORY)
        );
      }
    } catch {
      setAnalysisHistory([]);
    }
  }, []);

  const handleCopyRichMarkdown = useCallback(async (markdown: string) => {
    try {
      await copyMarkdownAsRichText(markdown);
      setUploadMessage("已复制富文本，可直接粘贴到文档编辑器");
    } catch {
      setError("复制失败，请手动选择文档内容复制");
    }
  }, []);

  const persistAnalysisHistory = useCallback((history: AnalysisHistoryRecord[]) => {
    setAnalysisHistory(history);
    try {
      window.localStorage.setItem(ANALYSIS_HISTORY_STORAGE_KEY, JSON.stringify(history));
    } catch {
      setError("分析完成，但历史记录保存失败：浏览器本地存储空间不足");
    }
  }, []);

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
        linked_doc_id: getDocLinkedIds(doc).length > 0 ? JSON.stringify(getDocLinkedIds(doc)) : null,
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
            linked_doc_id: getDocLinkedIds(doc).length > 0 ? JSON.stringify(getDocLinkedIds(doc)) : null,
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
    const incomingDocIds = new Set(normalizedIncomingDocs.map((doc) => doc.id));
    let docsToSync: DocDetail[] = normalizedIncomingDocs;

    setHelpDocs((currentDocs) => {
      const nextDocs = [...currentDocs];

      for (const incomingDoc of normalizedIncomingDocs) {
        const existingIndex = nextDocs.findIndex((doc) => doc.id === incomingDoc.id);

        if (existingIndex >= 0) {
          const existingDoc = nextDocs[existingIndex];
          const incomingHasContent = hasReadableContent(incomingDoc);
          const preservedLinkedDocIds = getDocLinkedIds(incomingDoc).length > 0 ? getDocLinkedIds(incomingDoc) : getDocLinkedIds(existingDoc);

          nextDocs[existingIndex] = {
            ...existingDoc,
            ...incomingDoc,
            content: incomingHasContent ? incomingDoc.content : existingDoc.content,
            htmlContent: incomingDoc.htmlContent ?? existingDoc.htmlContent,
            linkedDocIds: preservedLinkedDocIds,
            linkedDocId: preservedLinkedDocIds[0],
          };
        } else {
          nextDocs.push(incomingDoc);
        }
      }

      docsToSync = nextDocs.filter((doc) => incomingDocIds.has(doc.id));
      return nextDocs;
    });

    syncDocsToSupabase(docsToSync);
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
    setLinkPreviewDocId(getDocLinkedIds(doc)[0] ?? null);
    setLinkDrawerOpen(true);
  }, []);

  const handleLinkDocs = useCallback((targetDoc: DocDetail) => {
    if (!linkingDoc || linkingDoc.id === targetDoc.id) return;

    let docsToSync: DocDetail[] = [];

    setHelpDocs((currentDocs) => {
      const nextDocs = currentDocs.map((doc) => {
        if (doc.id === linkingDoc.id) {
          return setDocLinkedIds(doc, [...getDocLinkedIds(doc), targetDoc.id]);
        }
        if (doc.id === targetDoc.id) {
          return setDocLinkedIds(doc, [...getDocLinkedIds(doc), linkingDoc.id]);
        }
        return doc;
      });

      docsToSync = nextDocs.filter((doc) => currentDocs.some((currentDoc) => currentDoc.id === doc.id && !haveSameLinkedDocIds(currentDoc, doc)));

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
      const linkedDocIds = currentDoc ? getDocLinkedIds(currentDoc) : [];

      const nextDocs = currentDocs.map((doc) => {
        if (doc.id === docId) {
          return removeLinkedDocId(doc);
        }
        if (linkedDocIds.includes(doc.id)) {
          return setDocLinkedIds(doc, getDocLinkedIds(doc).filter((linkedId) => linkedId !== docId));
        }
        return doc;
      });

      docsToSync = nextDocs.filter((doc) => currentDocs.some((currentDoc) => currentDoc.id === doc.id && !haveSameLinkedDocIds(currentDoc, doc)));

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
          if (getDocLinkedIds(doc).includes(docId)) {
            return setDocLinkedIds(doc, getDocLinkedIds(doc).filter((linkedId) => linkedId !== docId));
          }
          return doc;
        });

      docsToSync = nextDocs.filter((doc) =>
        currentDocs.some((currentDoc) => currentDoc.id === doc.id && !haveSameLinkedDocIds(currentDoc, doc))
      );

      return nextDocs;
    });

    void persistDocLinksToSupabase(docsToSync);
    await deleteDocFromSupabase(docId);

    setAffectedDocs((currentDocs) => currentDocs.filter((doc) => doc.docId !== docId));
    setPreviewDoc((currentDoc) => (currentDoc?.id === docId ? null : currentDoc));
    setLinkingDoc((currentDoc) => (currentDoc?.id === docId ? null : currentDoc));
  }, [deleteDocFromSupabase, persistDocLinksToSupabase]);

  const handleAnalyzeImageUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (selectedFiles.length === 0) return;

    const unsupportedFiles = selectedFiles.filter((file) => !isSupportedAnalyzeImage(file));
    if (unsupportedFiles.length > 0) {
      setError(`仅支持上传图片文件：${unsupportedFiles.map((file) => file.name).join("、")}`);
      return;
    }

    try {
      const availableSlots = Math.max(0, MAX_ANALYZE_IMAGES - analyzeImages.length);
      const filesToRead = selectedFiles.slice(0, availableSlots);

      if (filesToRead.length === 0) {
        setError(`最多支持上传 ${MAX_ANALYZE_IMAGES} 张功能截图`);
        return;
      }

      const nextImages = await Promise.all(
        filesToRead.map(async (file) => ({
          id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
          name: file.name,
          type: file.type || "image/*",
          size: file.size,
          dataUrl: await fileToDataUrl(file),
        } satisfies AnalyzeImageAttachment))
      );

      setAnalyzeImages((currentImages) => [...currentImages, ...nextImages].slice(0, MAX_ANALYZE_IMAGES));
      setError(selectedFiles.length > filesToRead.length ? `已添加 ${filesToRead.length} 张截图，最多支持 ${MAX_ANALYZE_IMAGES} 张` : null);
    } catch {
      setError("图片读取失败，请重新选择图片后再试");
    }
  }, [analyzeImages.length]);

  const handleRemoveAnalyzeImage = useCallback((imageId: string) => {
    setAnalyzeImages((currentImages) => currentImages.filter((image) => image.id !== imageId));
  }, []);

  const restoreAnalysisHistory = useCallback((record: AnalysisHistoryRecord) => {
    setFeature(record.feature);
    setAnalyzeModel(record.model);
    setAffectedDocs(record.affectedDocs);
    setSuggestedNewDocs(record.suggestedNewDocs);
    setRetrievalStats(record.retrievalStats);
    setSelectedAffectedDocId(record.affectedDocs[0]?.docId ?? null);
    setStreamingText("");
    setError(null);
    setActiveTab("analyze");
    setRevisionInstruction(record.instruction ?? "");
    setEditingAffectedDocs(false);
    setEditedAffectedContents({});
    setHistoryOpen(false);
  }, []);

  const clearAnalysisHistory = useCallback(() => {
    persistAnalysisHistory([]);
  }, [persistAnalysisHistory]);

  const getAffectedDocKey = useCallback((doc: Pick<AffectedDoc, "docId" | "language">) => `${doc.docId}::${doc.language ?? "unknown"}`, []);

  const buildEditableContent = useCallback((doc: AffectedDoc) => {
    const originalDoc = helpDocs.find((helpDoc) => helpDoc.id === doc.docId);
    return markdownToRichHtml(originalDoc?.content || normalizeDiffForDisplay(doc.unifiedDiff));
  }, [helpDocs]);

  const handleEnableAffectedDocEditing = useCallback(() => {
    setEditedAffectedContents((currentContents) => {
      const nextContents = { ...currentContents };
      for (const doc of affectedDocs) {
        const key = getAffectedDocKey(doc);
        if (!(key in nextContents)) {
          nextContents[key] = buildEditableContent(doc);
        }
      }
      return nextContents;
    });
    setEditingAffectedDocs(true);
  }, [affectedDocs, buildEditableContent, getAffectedDocKey]);

  const parseAnalyzeStream = useCallback(async (response: Response) => {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("无法读取响应流");

    const decoder = new TextDecoder();
    let fullText = "";
    let latestRetrievalStats: RetrievalStats | null = null;
    let nextAffectedDocs: AffectedDoc[] = [];
    let nextNewDocs: SuggestedNewDoc[] = [];
    let pendingChunk = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      pendingChunk += decoder.decode(value, { stream: true });
      const lines = pendingChunk.split("\n");
      pendingChunk = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;

        const data = JSON.parse(line.slice(6)) as {
          error?: string;
          done?: boolean;
          content?: string;
          retrieval?: RetrievalStats;
        };

        if (data.retrieval) {
          latestRetrievalStats = data.retrieval;
          setRetrievalStats(data.retrieval);
        }
        if (data.error) throw new Error(data.error);
        if (data.content) {
          fullText += data.content;
          setStreamingText(fullText);
        }
        if (data.done) {
          let jsonStr = fullText.trim();
          const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (jsonMatch) jsonStr = jsonMatch[1].trim();

          const braceStart = jsonStr.indexOf("{");
          const braceEnd = jsonStr.lastIndexOf("}");
          if (braceStart !== -1 && braceEnd > braceStart) {
            jsonStr = jsonStr.substring(braceStart, braceEnd + 1);
          }

          const result = JSON.parse(jsonStr) as {
            affectedDocs?: AffectedDoc[];
            newDocs?: SuggestedNewDoc[];
          };

          nextAffectedDocs = Array.isArray(result.affectedDocs) ? result.affectedDocs : [];
          nextNewDocs = Array.isArray(result.newDocs) ? result.newDocs : [];
        }
      }
    }

    return { nextAffectedDocs, nextNewDocs, latestRetrievalStats };
  }, []);

  const handleAnalyze = useCallback(async () => {
    const trimmedFeature = feature.trim();
    if (!trimmedFeature && analyzeImages.length === 0) return;

    if (helpDocs.length === 0) {
      setActiveTab("help-center");
      setError("请先在「帮助中心」上传 md 或 txt 格式的帮助文档");
      return;
    }

    setAnalyzing(true);
    setAffectedDocs([]);
    setSuggestedNewDocs([]);
    setSelectedAffectedDocId(null);
    setStreamingText("");
    setRetrievalStats(null);
    setError(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feature: trimmedFeature,
          model: analyzeModel,
          images: analyzeImages.map((image) => ({
            name: image.name,
            type: image.type,
            dataUrl: image.dataUrl,
          })),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let message = "分析请求失败";

        try {
          const errorData = JSON.parse(errorText) as { error?: string };
          message = errorData.error || message;
        } catch {
          message = errorText || message;
        }

        throw new Error(message);
      }

      const { nextAffectedDocs, nextNewDocs, latestRetrievalStats } = await parseAnalyzeStream(response);

      setAffectedDocs(nextAffectedDocs);
      setSuggestedNewDocs(nextNewDocs);
      setSelectedAffectedDocId(nextAffectedDocs[0]?.docId ?? null);
      setActiveTab("analyze");
      setEditingAffectedDocs(false);
      setEditedAffectedContents({});

      const nextRecord: AnalysisHistoryRecord = {
        id: crypto.randomUUID(),
        feature: trimmedFeature,
        createdAt: new Date().toISOString(),
        model: analyzeModel,
        imageNames: analyzeImages.map((image) => image.name),
        affectedDocs: nextAffectedDocs,
        suggestedNewDocs: nextNewDocs,
        retrievalStats: latestRetrievalStats,
      };
      persistAnalysisHistory([nextRecord, ...analysisHistory].slice(0, MAX_ANALYSIS_HISTORY));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "分析过程出错，请重试"
      );
    } finally {
      setAnalyzing(false);
    }
  }, [feature, analyzeImages, helpDocs, analyzeModel, parseAnalyzeStream, persistAnalysisHistory, analysisHistory]);


  const handleRegenerate = useCallback(async () => {
    if (affectedDocs.length === 0) return;

    const editedDocuments = affectedDocs.flatMap((doc) => {
      const originalDoc = helpDocs.find((helpDoc) => helpDoc.id === doc.docId);
      if (!originalDoc) return [];
      const key = getAffectedDocKey(doc);
      return [{
        ...originalDoc,
        content: editedAffectedContents[key] ? richHtmlToMarkdown(editedAffectedContents[key]) : originalDoc.content,
        htmlContent: undefined,
      }];
    });

    if (editedDocuments.length === 0) {
      setError("未找到可重新生成的已影响文档，请先完成一次分析");
      return;
    }

    const trimmedInstruction = revisionInstruction.trim();
    const regenerateFeature = trimmedInstruction
      ? `${feature.trim() || "基于当前已编辑文档重新生成帮助中心修改建议"}\n\n用户补充的修改建议：${trimmedInstruction}\n\n请基于已编辑文档内容重新生成最新 AI 建议 diff。`
      : `${feature.trim() || "基于当前已编辑文档重新生成帮助中心修改建议"}\n\n修改建议为空：请基于已编辑文档内容重新生成其他语言版本，并确保同一关联文档的中英文内容语义、术语、入口、按钮、字段保持一致。`;

    setAnalyzing(true);
    setStreamingText("");
    setRetrievalStats(null);
    setError(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feature: regenerateFeature,
          documents: editedDocuments,
          model: analyzeModel,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(typeof data.error === "string" ? data.error : "重新生成失败");
      }

      const { nextAffectedDocs, nextNewDocs, latestRetrievalStats } = await parseAnalyzeStream(response);
      setAffectedDocs(nextAffectedDocs);
      setSuggestedNewDocs(nextNewDocs);
      setSelectedAffectedDocId(nextAffectedDocs[0]?.docId ?? null);
      setEditingAffectedDocs(false);
      setEditedAffectedContents({});

      const nextRecord: AnalysisHistoryRecord = {
        id: crypto.randomUUID(),
        feature: feature.trim(),
        instruction: trimmedInstruction || "修改建议为空：基于已编辑内容重新生成其他语言版本",
        editedDocIds: editedDocuments.map((doc) => doc.id),
        createdAt: new Date().toISOString(),
        model: analyzeModel,
        imageNames: [],
        affectedDocs: nextAffectedDocs,
        suggestedNewDocs: nextNewDocs,
        retrievalStats: latestRetrievalStats,
      };
      persistAnalysisHistory([nextRecord, ...analysisHistory].slice(0, MAX_ANALYSIS_HISTORY));
    } catch (err) {
      setError(err instanceof Error ? err.message : "重新生成过程出错，请重试");
    } finally {
      setAnalyzing(false);
    }
  }, [affectedDocs, helpDocs, getAffectedDocKey, editedAffectedContents, revisionInstruction, feature, analyzeModel, parseAnalyzeStream, persistAnalysisHistory, analysisHistory]);

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
        <div className="mx-auto max-w-[1440px] px-6 py-5">
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
      <main className="mx-auto max-w-[1440px] px-6 py-8">
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
                    const linkedDocs = getDocLinkedIds(doc).map((linkedId) => helpDocs.find((helpDoc) => helpDoc.id === linkedId)).filter((linkedDoc): linkedDoc is DocDetail => Boolean(linkedDoc));

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
                            {linkedDocs.length > 0 ? (
                              <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                                {linkedDocs.map((linkedDoc) => (
                                  <button
                                    key={linkedDoc.id}
                                    type="button"
                                    onClick={() => handlePreviewDoc(linkedDoc)}
                                    className="max-w-full truncate rounded bg-white px-1.5 py-0.5 font-medium text-teal-700 hover:underline"
                                    title={linkedDoc.title}
                                  >
                                    {linkedDoc.title}
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <span className="min-w-0 flex-1 truncate text-stone-400">
                                未关联，可点击右侧「关联」选择对应语言文档
                              </span>
                            )}
                            {linkedDocs.length > 0 && (
                              <Badge variant="secondary" className="shrink-0 text-[10px]">
                                {linkedDocs.length} 个关联
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
                            {linkedDocs.length > 0 ? "管理关联" : "关联"}
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
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setHistoryOpen(true)}
                      className="h-8 gap-1.5 text-xs"
                    >
                      <History className="h-3.5 w-3.5" />
                      历史记录
                      {analysisHistory.length > 0 && (
                        <span className="rounded-full bg-stone-100 px-1.5 text-[10px] text-stone-500">
                          {analysisHistory.length}
                        </span>
                      )}
                    </Button>
                    <Badge variant="secondary" className="text-xs">
                      {retrievalStats
                        ? `预检索 ${retrievalStats.candidateDocuments}/${retrievalStats.totalDocuments} 篇`
                        : `检索 ${helpDocs.length} 篇帮助文档`}
                    </Badge>
                  </div>
                </div>
                <Textarea
                  placeholder="请描述即将上线的新功能，例如：新增团队空间功能，支持创建团队空间并邀请成员加入，团队空间内可以共享项目、文档和日程... 也可以只上传功能截图，让 AI 识别界面并撰写描述和步骤。"
                  className="min-h-[140px] resize-none text-base leading-relaxed"
                  value={feature}
                  onChange={(e) => setFeature(e.target.value)}
                  disabled={analyzing}
                />

                <div className="mt-4 rounded-xl border border-dashed border-stone-200 bg-stone-50 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <ImageIcon className="h-4 w-4 text-teal-600" />
                      <div>
                        <p className="text-sm font-medium text-stone-700">上传功能截图</p>
                        <p className="text-xs text-stone-400">支持多张图片，AI 会结合截图理解功能设置、字段和操作步骤。</p>
                      </div>
                    </div>
                    <label className={`inline-flex items-center rounded-md border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-700 shadow-sm transition-colors ${analyzing ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-stone-50"}`}>
                      <Upload className="mr-2 h-4 w-4" />
                      选择图片
                      <input
                        type="file"
                        multiple
                        accept="image/*"
                        onChange={handleAnalyzeImageUpload}
                        disabled={analyzing}
                        className="sr-only"
                      />
                    </label>
                  </div>

                  {analyzeImages.length > 0 ? (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {analyzeImages.map((image) => (
                        <div key={image.id} className="group overflow-hidden rounded-lg border border-stone-200 bg-white">
                          <div className="relative aspect-video bg-stone-100">
                            <div
                              role="img"
                              aria-label={image.name}
                              className="h-full w-full bg-cover bg-center"
                              style={{ backgroundImage: `url(${image.dataUrl})` }}
                            />
                            <button
                              type="button"
                              onClick={() => handleRemoveAnalyzeImage(image.id)}
                              disabled={analyzing}
                              className="absolute right-2 top-2 rounded-full bg-white/90 p-1 text-stone-500 shadow-sm transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                              aria-label={`移除 ${image.name}`}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <div className="p-2">
                            <p className="truncate text-xs font-medium text-stone-700" title={image.name}>{image.name}</p>
                            <p className="text-[11px] text-stone-400">{(image.size / 1024).toFixed(1)} KB</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-stone-200 bg-white p-4 text-center text-xs text-stone-400">
                      暂未上传截图；可仅输入文字描述，也可上传截图辅助 AI 撰写功能说明。
                    </div>
                  )}
                </div>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <p className="text-xs text-stone-400">
                    将先从 {helpDocs.length} 篇帮助文档中预检索最多 12 篇中文候选文档，并只附带这些中文文档关联的英文文档，再交给 AI 分析，降低 token 消耗
                  </p>

                  <div className="flex flex-col gap-2 sm:items-end">
                    <select
                      value={analyzeModel}
                      onChange={(event) => setAnalyzeModel(event.target.value as AnalyzeModel)}
                      disabled={analyzing}
                      className="rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 outline-none transition-colors focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
                    >
                      <option value="deepseek-v4-flash">DeepSeek V4 Flash（默认，成本低）</option>
                      <option value="deepseek-v4-pro">DeepSeek V4 Pro（质量更高）</option>
                    </select>

                    <Button
                      onClick={handleAnalyze}
                      disabled={(!feature.trim() && analyzeImages.length === 0) || analyzing || helpDocs.length === 0}
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
              <section className="grid min-w-0 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
                <div className="min-w-0 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-base font-semibold text-stone-900">
                      AI 建议修改的文档
                    </h2>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setRevisionDialogOpen(true)}>
                        <MessageSquareText className="mr-1.5 h-3.5 w-3.5" />
                        修改建议
                      </Button>
                      <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={handleEnableAffectedDocEditing}>
                        <Edit3 className="mr-1.5 h-3.5 w-3.5" />
                        修改内容
                      </Button>
                      <Button type="button" size="sm" className="h-8 bg-teal-600 text-xs hover:bg-teal-700" onClick={handleRegenerate} disabled={analyzing}>
                        {analyzing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                        重新生成
                      </Button>
                    </div>
                  </div>

                  {revisionInstruction.trim() && (
                    <div className="mb-3 rounded-lg border border-blue-100 bg-blue-50 p-2 text-xs leading-5 text-blue-700">
                      当前修改建议：{revisionInstruction.trim()}
                    </div>
                  )}

                  <div className="grid gap-2">
                    {affectedDocs.map((doc) => {
                      const isSelected = (selectedAffectedDocId ?? affectedDocs[0]?.docId) === doc.docId;
                      const deleteCount = doc.unifiedDiff?.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---")).length ?? 0;
                      const addCount = doc.unifiedDiff?.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).length ?? 0;

                      return (
                        <button
                          key={`${doc.docId}-${doc.language ?? "unknown"}`}
                          type="button"
                          onClick={() => setSelectedAffectedDocId(doc.docId)}
                          className={[
                            "w-full min-w-0 overflow-hidden rounded-lg border p-3 text-left transition-colors",
                            isSelected ? "border-teal-300 bg-teal-50" : "border-stone-200 bg-white hover:border-teal-200 hover:bg-teal-50/40",
                          ].join(" ")}
                        >
                          <div className="mb-1 flex min-w-0 items-center gap-2">
                            <FileText className="h-4 w-4 shrink-0 text-stone-400" />
                            <span className="line-clamp-2 min-w-0 flex-1 break-words text-sm font-medium text-stone-900">
                              {doc.docName}
                            </span>
                            {doc.language && (
                              <Badge variant="secondary" className="shrink-0 text-[10px]">
                                {doc.language === "zh" ? "中文" : doc.language === "en" ? "English" : "未知"}
                              </Badge>
                            )}
                          </div>
                          <p className="line-clamp-2 min-w-0 break-words text-xs text-stone-500">
                            {doc.reason}
                          </p>
                          <div className="mt-2 flex items-center gap-2">
                            {deleteCount > 0 && (
                              <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-600">
                                -{deleteCount}
                              </span>
                            )}
                            {addCount > 0 && (
                              <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-600">
                                +{addCount}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="min-w-0 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                  {(() => {
                    const selectedDoc = affectedDocs.find((doc) => doc.docId === (selectedAffectedDocId ?? affectedDocs[0]?.docId)) ?? affectedDocs[0];
                    const originalDoc = helpDocs.find((doc) => doc.id === selectedDoc.docId);

                    return (
                      <div className="grid min-w-0 gap-4">
                        <div>
                          <div className="mb-2 flex min-w-0 items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h2 className="break-words text-base font-semibold text-stone-900">
                                {selectedDoc.docName}
                              </h2>
                              <p className="mt-1 break-words text-xs text-stone-500">
                                {selectedDoc.reason}
                              </p>
                            </div>
                            {selectedDoc.language && (
                              <Badge variant="secondary" className="shrink-0">
                                {selectedDoc.language === "zh" ? "中文" : selectedDoc.language === "en" ? "English" : "未知"}
                              </Badge>
                            )}
                          </div>

                          <div className="grid min-w-0 gap-2 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm text-stone-700">
                            <div className="min-w-0 break-words">
                              <span className="font-medium text-stone-900">建议插入位置：</span>
                              {selectedDoc.insertPosition || "未指定"}
                            </div>
                            <div className="min-w-0 break-words">
                              <span className="font-medium text-stone-900">建议删除内容：</span>
                              {selectedDoc.deleteSummary || "无"}
                            </div>
                            <div className="min-w-0 break-words">
                              <span className="font-medium text-stone-900">建议新增内容：</span>
                              {selectedDoc.addSummary || "无"}
                            </div>
                          </div>
                        </div>

                        {editingAffectedDocs && (
                          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <h3 className="text-sm font-semibold text-amber-900">编辑内容</h3>
                              <Badge variant="outline" className="bg-white text-xs text-amber-700">可直接修改后重新生成</Badge>
                            </div>
                            <RichTextEditor
                              key={getAffectedDocKey(selectedDoc)}
                              initialHtml={editedAffectedContents[getAffectedDocKey(selectedDoc)] ?? buildEditableContent(selectedDoc)}
                              onChange={(html) => {
                                const key = getAffectedDocKey(selectedDoc);
                                setEditedAffectedContents((currentContents) => ({
                                  ...currentContents,
                                  [key]: html,
                                }));
                              }}
                            />
                          </div>
                        )}

                        <div>
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <h3 className="text-sm font-semibold text-stone-900">
                              AI 建议 diff
                            </h3>
                            {originalDoc && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => handlePreviewDoc(originalDoc)}
                              >
                                查看原文完整内容
                              </Button>
                            )}
                          </div>
                          <div className="max-h-[760px] overflow-auto">
                            {renderUnifiedDiff(selectedDoc.unifiedDiff)}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {suggestedNewDocs.length > 0 && (
                  <div className="lg:col-span-2 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                    <h2 className="mb-3 text-base font-semibold text-stone-900">
                      建议新增的文档
                    </h2>
                    <div className="grid gap-3">
                      {suggestedNewDocs.map((doc) => (
                        <div key={`${doc.title}-${doc.language ?? "unknown"}`} className="rounded-lg border border-stone-200 bg-stone-50 p-4">
                          <div className="mb-2 flex items-center gap-2">
                            <h3 className="font-medium text-stone-900">{doc.title}</h3>
                            <Badge variant="outline">{doc.category}</Badge>
                            {doc.language && <Badge variant="secondary">{doc.language}</Badge>}
                          </div>
                          <p className="mb-3 text-sm text-stone-500">{doc.reason}</p>
                          <pre className="whitespace-pre-wrap rounded-md bg-white p-3 text-sm leading-6 text-stone-700">
                            {doc.content}
                          </pre>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* Suggested New Docs */}
            {suggestedNewDocs.length > 0 && !analyzing && (
              <section className="mt-6 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-stone-900">
                      建议新增的文档
                    </h2>
                    <p className="mt-1 text-sm text-stone-500">
                      当新功能不适合插入现有文档时，AI 会建议新建独立帮助文档。
                    </p>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {suggestedNewDocs.length} 篇建议新增
                  </Badge>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  {suggestedNewDocs.map((doc, index) => (
                    <article
                      key={`${doc.title}-${index}`}
                      className="rounded-xl border border-stone-200 bg-stone-50 p-4"
                    >
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <FileText className="h-4 w-4 text-teal-600" />
                        <h3 className="min-w-0 flex-1 text-base font-semibold text-stone-900">
                          {doc.title}
                        </h3>
                        <Badge variant="outline" className="text-xs">
                          {doc.category}
                        </Badge>
                        {doc.language && (
                          <Badge variant="secondary" className="text-xs">
                            {doc.language === "zh" ? "中文" : doc.language === "en" ? "English" : "未知语言"}
                          </Badge>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => void handleCopyRichMarkdown(doc.content)}
                        >
                          复制富文本
                        </Button>
                      </div>

                      <p className="mb-4 text-sm leading-6 text-stone-500">
                        {doc.reason}
                      </p>

                      <div className="max-h-[520px] overflow-auto rounded-lg border border-stone-200 bg-white p-4">
                        {renderFormattedDocument(doc.content)}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {/* Empty State */}
            {!analyzing && affectedDocs.length === 0 && suggestedNewDocs.length === 0 && !error && !streamingText && (
              <section className="py-16 text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-stone-100">
                  <FileText className="h-8 w-8 text-stone-300" />
                </div>
                <h3 className="mb-1 text-sm font-medium text-stone-500">
                  尚未进行分析
                </h3>
                <p className="text-sm text-stone-400">
                  上传帮助文档并输入新功能描述或功能截图后，点击「开始分析」查看需要更新的文档
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
                  可选择一个或多个对应的中文/英文文档，系统会自动建立双向关联；同一文档支持关联多个文档。
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
                  {getDocLinkedIds(linkingDoc).length > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mb-3 w-full text-stone-600"
                      onClick={() => handleUnlinkDoc(linkingDoc.id)}
                    >
                      取消所有关联
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

      <Dialog open={revisionDialogOpen} onOpenChange={setRevisionDialogOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>填写修改建议</DialogTitle>
            <DialogDescription>
              重新生成时，AI 会结合这里的建议，并基于「修改内容」中的已编辑文本输出新的 diff；留空则优先生成关联文档的其他语言一致版本。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={revisionInstruction}
            onChange={(event) => setRevisionInstruction(event.target.value)}
            placeholder="例如：步骤说明更口语化；补充注意事项；英文版需使用 Settings / Team Workspace 等固定术语..."
            className="min-h-[160px] resize-none"
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRevisionInstruction("")}>清空</Button>
            <Button type="button" className="bg-teal-600 hover:bg-teal-700" onClick={() => setRevisionDialogOpen(false)}>保存建议</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Analysis History Drawer */}
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent
          side="right"
          className="w-[920px] max-w-[94vw] sm:max-w-[920px] overflow-hidden p-0"
        >
          <SheetHeader className="border-b border-stone-200 px-6 py-4">
            <SheetTitle className="flex items-center gap-2 text-lg">
              <History className="h-5 w-5 text-teal-600" />
              新功能分析历史
            </SheetTitle>
            <SheetDescription className="text-left">
              历史记录保存在当前浏览器中，点击任一记录可恢复当时的 AI 建议修改文档、diff 和建议新增文档。
            </SheetDescription>
          </SheetHeader>

          <div className="flex h-[calc(100vh-120px)] flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-stone-100 px-6 py-3 text-sm text-stone-500">
              <span>共 {analysisHistory.length} 条历史分析</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={clearAnalysisHistory}
                disabled={analysisHistory.length === 0}
              >
                清空历史
              </Button>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-3 px-6 py-5">
                {analysisHistory.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-stone-200 bg-stone-50 p-8 text-center">
                    <History className="mx-auto mb-3 h-8 w-8 text-stone-300" />
                    <p className="text-sm font-medium text-stone-500">暂无历史记录</p>
                    <p className="mt-1 text-xs text-stone-400">完成一次新功能分析后，系统会自动保存结果。</p>
                  </div>
                ) : (
                  analysisHistory.map((record) => (
                    <button
                      key={record.id}
                      type="button"
                      onClick={() => restoreAnalysisHistory(record)}
                      className="w-full rounded-xl border border-stone-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-teal-200 hover:bg-teal-50/40"
                    >
                      <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <h3 className="line-clamp-2 text-sm font-semibold text-stone-900">
                            {getHistoryTitle(record)}
                          </h3>
                          <p className="mt-1 text-xs text-stone-400">
                            {formatDateTime(record.createdAt)} · {record.model === "deepseek-v4-pro" ? "DeepSeek V4 Pro" : "DeepSeek V4 Flash"}
                          </p>
                        </div>
                        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-stone-300" />
                      </div>

                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full bg-teal-50 px-2 py-1 text-teal-700">
                          修改文档 {record.affectedDocs.length} 篇
                        </span>
                        <span className="rounded-full bg-stone-100 px-2 py-1 text-stone-600">
                          新增建议 {record.suggestedNewDocs.length} 篇
                        </span>
                        {record.editedDocIds && record.editedDocIds.length > 0 && (
                          <span className="rounded-full bg-purple-50 px-2 py-1 text-purple-700">
                            重新生成 {record.editedDocIds.length} 篇
                          </span>
                        )}
                        {record.imageNames.length > 0 && (
                          <span className="rounded-full bg-blue-50 px-2 py-1 text-blue-700">
                            截图 {record.imageNames.length} 张
                          </span>
                        )}
                        {record.retrievalStats && (
                          <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">
                            预检索 {record.retrievalStats.candidateDocuments}/{record.retrievalStats.totalDocuments} 篇
                          </span>
                        )}
                      </div>

                      {record.instruction && (
                        <p className="mt-3 line-clamp-2 text-xs text-blue-600">
                          修改建议：{record.instruction}
                        </p>
                      )}

                      {record.affectedDocs.length > 0 && (
                        <p className="mt-3 line-clamp-2 text-xs text-stone-500">
                          {record.affectedDocs.map((doc) => doc.docName).join("、")}
                        </p>
                      )}
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
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
    </div>
  );
}
