"use client";

import { useState, useCallback } from "react";
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

  // Find insertion points for additions
  const additionMap = new Map<string, DocumentChange[]>();
  for (const add of additions) {
    const key = add.referenceText || "__end__";
    if (!additionMap.has(key)) {
      additionMap.set(key, []);
    }
    additionMap.get(key)!.push(add);
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
  const [feature, setFeature] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [affectedDocs, setAffectedDocs] = useState<AffectedDoc[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [selectedDoc, setSelectedDoc] = useState<AffectedDoc | null>(null);
  const [docDetail, setDocDetail] = useState<DocDetail | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = useCallback(async () => {
    if (!feature.trim()) return;

    setAnalyzing(true);
    setAffectedDocs([]);
    setStreamingText("");
    setError(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feature: feature.trim() }),
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
  }, [feature]);

  const handleDocClick = useCallback(async (doc: AffectedDoc) => {
    setSelectedDoc(doc);
    setDrawerOpen(true);

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
  }, []);

  const getChangeStats = (doc: AffectedDoc) => {
    const deletes = doc.changes.filter((c) => c.type === "delete").length;
    const adds = doc.changes.filter((c) => c.type === "add").length;
    return { deletes, adds };
  };

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
                输入新功能描述，AI 自动检索并标注需要更新的文档
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-5xl px-6 py-8">
        {/* Input Section */}
        <section className="mb-8">
          <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-teal-600" />
              <span className="text-sm font-medium text-stone-700">
                新功能描述
              </span>
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
                描述越详细，AI 分析结果越准确
              </p>
              <Button
                onClick={handleAnalyze}
                disabled={!feature.trim() || analyzing}
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
        </section>

        {/* Streaming Progress */}
        {analyzing && streamingText && (
          <section className="mb-8">
            <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-teal-600" />
                <span className="text-sm font-medium text-stone-700">
                  AI 正在分析文档...
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
              输入新功能描述后，点击「开始分析」查看需要更新的文档
            </p>
          </section>
        )}
      </main>

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
