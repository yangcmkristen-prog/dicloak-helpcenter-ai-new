import { NextRequest } from "next/server";
import { streamDeepSeekChatCompletion, type ChatMessage, type DeepSeekModel } from "@/lib/deepseek-client";
import { describeImagesWithVisionModel } from "@/lib/vision-client";
import { helpDocuments, type HelpDocument } from "@/lib/documents";
import { getSupabaseClient } from "@/storage/database/supabase-client";

export const maxDuration = 60;

const CANDIDATE_DOCUMENT_LIMIT = 12;
const MAX_MATCHED_TERMS = 8;

interface AnalyzeRequestBody {
  feature?: unknown;
  documents?: unknown;
  model?: unknown;
  images?: unknown;
  }

  interface AnalyzeImagePayload {
    name?: unknown;
    type?: unknown;
    dataUrl?: unknown;
}

interface DocumentPayload {
  id?: unknown;
  title?: unknown;
  category?: unknown;
  lastUpdated?: unknown;
  last_updated?: unknown;
  content?: unknown;
  language?: unknown;
  linkedDocId?: unknown;
  linkedDocIds?: unknown;
  linked_doc_id?: unknown;
  linked_doc_ids?: unknown;
}

interface RankedDocument {
  doc: HelpDocument;
  score: number;
  matchedTerms: string[];
}

function normalizeLinkedDocIds(value: unknown) {
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

function getDocumentLinkedIds(doc: HelpDocument) {
  return Array.from(
    new Set([
      ...normalizeLinkedDocIds("linkedDocIds" in doc ? doc.linkedDocIds : undefined),
      ...normalizeLinkedDocIds("linked_doc_ids" in doc ? doc.linked_doc_ids : undefined),
      ...normalizeLinkedDocIds("linkedDocId" in doc ? doc.linkedDocId : undefined),
      ...normalizeLinkedDocIds("linked_doc_id" in doc ? doc.linked_doc_id : undefined),
    ])
  );
}

function normalizeText(text: string) {
  return text.toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, " ").trim();
}

function countTermMatches(text: string, term: string) {
  if (!term) return 0;

  let count = 0;
  let startIndex = 0;
  while (count < 12) {
    const index = text.indexOf(term, startIndex);
    if (index === -1) break;
    count += 1;
    startIndex = index + term.length;
  }
  return count;
}

function extractSearchTerms(feature: string) {
  const terms = new Set<string>();
  const normalizedFeature = normalizeText(feature);

  for (const word of normalizedFeature.match(/[a-z0-9][a-z0-9_-]{1,}/gi) ?? []) {
    const normalizedWord = word.toLowerCase();
    if (!ENGLISH_STOP_WORDS.has(normalizedWord)) {
      terms.add(normalizedWord);
    }
  }

  for (const phrase of feature.match(/[\u4e00-\u9fa5]{2,}/g) ?? []) {
    if (phrase.length <= 8) {
      terms.add(phrase);
    }

    for (let index = 0; index < phrase.length - 1; index += 1) {
      terms.add(phrase.slice(index, index + 2));
    }

    for (let index = 0; index < phrase.length - 2; index += 1) {
      terms.add(phrase.slice(index, index + 3));
    }
  }

  return Array.from(terms).slice(0, 80);
}

function detectFeatureLanguage(feature: string): "zh" | "en" | "unknown" {
  if (/[\u4e00-\u9fa5]/.test(feature)) return "zh";
  if (/[a-z]/i.test(feature)) return "en";
  return "unknown";
}

function getDocumentLanguage(doc: HelpDocument) {
  return "language" in doc && typeof doc.language === "string" ? doc.language : "unknown";
}

function scoreDocument(doc: HelpDocument, feature: string, terms: string[], featureLanguage: "zh" | "en" | "unknown"): RankedDocument {
  const title = normalizeText(doc.title);
  const category = normalizeText(doc.category);
  const content = normalizeText(doc.content);
  const sourceUrl = "sourceUrl" in doc && typeof doc.sourceUrl === "string" ? normalizeText(doc.sourceUrl) : "";
  const normalizedFeature = normalizeText(feature);

  let score = 0;
  const matchedTerms: string[] = [];

  if (normalizedFeature.length > 8) {
    if (title.includes(normalizedFeature)) score += 80;
    if (content.includes(normalizedFeature)) score += 40;
  }

  for (const term of terms) {
    let termScore = 0;

    if (title.includes(term)) termScore += 28;
    if (category.includes(term)) termScore += 10;
    if (sourceUrl.includes(term)) termScore += 8;

    const contentMatches = countTermMatches(content, term);
    if (contentMatches > 0) {
      termScore += Math.min(contentMatches, 8) * (term.length >= 3 ? 3 : 1.5);
    }

    if (termScore > 0) {
      score += termScore;
      if (matchedTerms.length < MAX_MATCHED_TERMS) {
        matchedTerms.push(term);
      }
    }
  }

  const docLanguage = getDocumentLanguage(doc);
  if (featureLanguage !== "unknown" && docLanguage === featureLanguage) {
    score += 6;
  }

  return { doc, score, matchedTerms };
}

function selectCandidateDocuments(documents: HelpDocument[], feature: string) {
  const terms = extractSearchTerms(feature);
  const featureLanguage = detectFeatureLanguage(feature);
  const rankedDocuments = documents
    .map((doc) => scoreDocument(doc, feature, terms, featureLanguage))
    .sort((a, b) => b.score - a.score || b.doc.content.length - a.doc.content.length);

  const matchedDocuments = rankedDocuments.filter((item) => item.score > 0);
  const selectedRankedDocuments = (matchedDocuments.length > 0 ? matchedDocuments : rankedDocuments).slice(0, CANDIDATE_DOCUMENT_LIMIT);

  return {
    totalDocuments: documents.length,
    candidateDocuments: selectedRankedDocuments.map((item) => item.doc),
    rankedDocuments: selectedRankedDocuments,
    candidateLimit: CANDIDATE_DOCUMENT_LIMIT,
    searchTerms: terms.slice(0, 20),
  };
}

function normalizeDocumentPayload(doc: DocumentPayload): HelpDocument | null {
  const lastUpdated = typeof doc.lastUpdated === "string" ? doc.lastUpdated : doc.last_updated;

  if (
    typeof doc.id === "string" &&
    typeof doc.title === "string" &&
    typeof doc.category === "string" &&
    typeof lastUpdated === "string" &&
    typeof doc.content === "string" &&
    doc.content.trim().length > 0
  ) {
    const linkedDocIds = normalizeLinkedDocIds(doc.linkedDocIds ?? doc.linked_doc_ids ?? doc.linkedDocId ?? doc.linked_doc_id);

    return {
      ...(doc as HelpDocument),
      lastUpdated,
      language: typeof doc.language === "string" ? doc.language : "unknown",
      linkedDocId: linkedDocIds[0],
      linkedDocIds,
    };
  }

  return null;
}

function normalizeDeepSeekModel(model: unknown): DeepSeekModel {
  return model === "deepseek-v4-pro" ? "deepseek-v4-pro" : "deepseek-v4-flash";
}

function normalizeAnalyzeImages(images: unknown) {
  if (!Array.isArray(images)) return [];

  return images
    .map((image): { name: string; type: string; dataUrl: string } | null => {
      if (!image || typeof image !== "object") return null;
      const payload = image as AnalyzeImagePayload;
      if (typeof payload.dataUrl !== "string" || !payload.dataUrl.startsWith("data:image/")) return null;

      return {
        name: typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : "功能截图",
        type: typeof payload.type === "string" && payload.type.trim() ? payload.type.trim() : "image/*",
        dataUrl: payload.dataUrl,
      };
    })
    .filter((image): image is { name: string; type: string; dataUrl: string } => Boolean(image))
    .slice(0, 8);
}

const ENGLISH_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "will",
  "can",
  "you",
  "your",
  "are",
  "new",
  "add",
  "use",
  "user",
  "users",
  "feature",
  "support",
]);

async function loadSupabaseDocuments(): Promise<HelpDocument[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("help_documents")
    .select("id, title, category, last_updated, content, source_url, html_content, language, linked_doc_id")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`查询帮助文档失败: ${error.message}`);
  }

  return (data || [])
    .map((doc: Record<string, unknown>) =>
      normalizeDocumentPayload({
        id: doc.id,
        title: doc.title,
        category: doc.category,
        last_updated: doc.last_updated,
        content: doc.content,
        sourceUrl: doc.source_url,
        htmlContent: doc.html_content,
        language: doc.language,
        linked_doc_id: doc.linked_doc_id,
        linked_doc_ids: doc.linked_doc_id,
      } as DocumentPayload)
    )
    .filter((doc): doc is HelpDocument => Boolean(doc));
}

export async function POST(request: NextRequest) {
  const { feature, documents, model, images } = (await request.json()) as AnalyzeRequestBody;
  const selectedModel = normalizeDeepSeekModel(model);
  const featureText = typeof feature === "string" ? feature.trim() : "";
  const analyzeImages = normalizeAnalyzeImages(images);

  if (!featureText && analyzeImages.length === 0) {
    return new Response(JSON.stringify({ error: "请输入新功能描述或上传功能截图" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const customDocuments = Array.isArray(documents)
    ? documents
        .map((doc) => normalizeDocumentPayload(doc as DocumentPayload))
        .filter((doc): doc is HelpDocument => Boolean(doc))
    : [];

  let supabaseDocuments: HelpDocument[] = [];
  if (customDocuments.length === 0) {
    try {
      supabaseDocuments = await loadSupabaseDocuments();
    } catch {
      supabaseDocuments = [];
    }
  }

  const allDocuments =
    customDocuments.length > 0
      ? customDocuments
      : supabaseDocuments.length > 0
        ? supabaseDocuments
        : helpDocuments;
  const zhDocuments = allDocuments.filter((doc) => getDocumentLanguage(doc) === "zh");
  const searchableDocuments = zhDocuments.length > 0 ? zhDocuments : allDocuments;
  let imageDescriptions = "";
  if (analyzeImages.length > 0) {
    try {
      imageDescriptions = await describeImagesWithVisionModel(analyzeImages);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "图片识别失败";
      return new Response(JSON.stringify({ error: errorMessage }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const retrievalQuery = [featureText, imageDescriptions, analyzeImages.map((image) => image.name).join(" ")]
    .filter(Boolean)
    .join(" ");
  const retrievalResult = selectCandidateDocuments(searchableDocuments, retrievalQuery);
  const searchableCandidateDocuments = retrievalResult.candidateDocuments;

  const documentById = new Map(allDocuments.map((doc) => [doc.id, doc]));

  const relatedEnglishDocuments = searchableCandidateDocuments.flatMap((doc) =>
    getDocumentLinkedIds(doc).flatMap((linkedDocId) => {
      const linkedDoc = documentById.get(linkedDocId);
      if (!linkedDoc || getDocumentLanguage(linkedDoc) !== "en") return [];

      return [{
        zhDocId: doc.id,
        zhDocTitle: doc.title,
        enDoc: linkedDoc,
      }];
    })
  );

  // 第一阶段先做轻量关键词召回，只把最相关候选文档交给 LLM，降低 300+ 文档场景下的 token 消耗。
  const docSummaries = retrievalResult.rankedDocuments
    .map((item, index) => {
      const doc = item.doc;
      const matchedTerms = item.matchedTerms.length > 0 ? item.matchedTerms.join("、") : "无明确关键词命中";
      return `【候选序号: ${index + 1}】【预检索分数: ${item.score.toFixed(1)}】【命中词: ${matchedTerms}】\n【文档ID: ${doc.id}】【标题: ${doc.title}】【分类: ${doc.category}】【更新时间: ${doc.lastUpdated}】\n内容:\n${doc.content}`;
    })
    .join("\n\n---\n\n");

  const linkedEnglishDocSummaries = relatedEnglishDocuments
    .map((item) => {
      const doc = item.enDoc;
      return `【关联中文文档ID: ${item.zhDocId}】【关联中文标题: ${item.zhDocTitle}】\n【英文文档ID: ${doc.id}】【标题: ${doc.title}】【分类: ${doc.category}】【更新时间: ${doc.lastUpdated}】\n内容:\n${doc.content}`;
    })
    .join("\n\n---\n\n");

  const systemPrompt = `你是 DICloak 帮助中心文档维护专家。

  任务：根据用户输入的新功能描述，分析帮助中心文档是否需要修改或新增，并输出可直接用于前端渲染的文档建议。

  重要规则：
  1. 用户会用中文描述新功能。
  2. 优先分析中文候选文档。
  3. 如果新功能与现有中文文档主题强相关，则修改现有中文文档，放入 affectedDocs。
  4. 每次必须同时输出中文和英文两个版本：中文候选文档需要修改时，必须同时把该中文文档关联的所有英文文档也放入 affectedDocs，并分别输出中英两个文档的 diff。
  5. 如果新功能属于独立功能模块、单独入口或内容较多，不适合插入现有文档，则建议新建文档，放入 newDocs。
  6. 不允许为了复用文档而强行添加到不相关文档中。
  7. 不要引用候选文档和关联英文文档之外的任何文档。
  8. 不要编造不存在的功能、入口、步骤或限制。
  9. 中英两个版本的功能术语、入口、按钮、字段、截图占位符必须语义一致，如果有中英两个版本的截图信息，则按照对应语言版本的术语输出。

  你必须严格返回 JSON，不要返回 Markdown，不要返回解释文字。

  返回格式如下：
  {
    "affectedDocs": [
      {
        "docId": "文档ID",
        "docName": "文档标题",
        "language": "zh|en",
        "linkedFromDocId": "如果是英文关联文档，填写对应中文文档ID；否则为null",
        "reason": "修改原因",
        "insertPosition": "建议插入位置",
        "deleteSummary": "建议删除内容摘要；如果没有删除则写无",
        "addSummary": "建议新增内容摘要；如果没有新增则写无",
        "unifiedDiff": "--- 原内容\\n+++ 建议内容\\n@@\\n 原文模块完整上下文\\n-需要删除或替换的原文\\n+建议新增或替换后的内容\\n 原文模块完整上下文"
      }
    ],
    "newDocs": [
      {
        "title": "建议标题",
        "category": "所属分类",
        "language": "zh",
        "reason": "为什么建议新增",
        "content": "完整新文档内容"
      }
    ]
  }

  affectedDocs 规则：
  1. affectedDocs 只放需要修改的现有文档。
  2. docId 和 docName 必须来自候选文档或关联英文文档，不要编造。
  3. 中文文档需要修改时，language 写 zh。
  4. 英文关联文档必须同步修改，language 写 en，并填写 linkedFromDocId。
  5. 如果一个中文文档关联多个英文文档，需要为每个英文关联文档各输出一条 affectedDocs。
  6. 如果没有需要修改的现有文档，affectedDocs 返回 []。

  diff 规则：
  1. unifiedDiff 必须使用统一 diff 风格。
  2. 删除行必须以 - 开头。
  3. 新增行必须以 + 开头。
  4. 上下文行以空格开头。
  5. 每个现有文档只输出一个 unifiedDiff 字符串。
  6. diff 必须至少包含被修改内容所在模块或小节的完整上下文，不要只输出孤立的一两句话。
  7. 如果只需要新增内容，也必须在 diff 中保留建议插入位置前后的原文上下文。
  8. 如果不需要删除内容，不要编造删除行。
  9. 禁止输出 Markdown 图片语法，例如 ![图片](https://...)。
  10. 禁止输出真实图片 URL。
  11. 需要图片时统一使用图片占位符，例如：[图片占位符：功能入口]、[图片占位符：配置页面]、[图片占位符：操作结果]。

  newDocs 规则：
  1. newDocs 只放建议新增的独立文档。
  2. 只有当新功能不适合放进现有候选文档时，才建议新增文档。
  3. 如果建议新增文档，必须同时输出 language=zh 和 language=en 两篇 newDocs。
  4. 如果没有建议新增文档，newDocs 返回 []。
  5. 新增文档必须包含 title、category、language、reason、content。
  6. content 必须是完整可发布的帮助中心文档。
  7. content 必须参考现有帮助中心文档的标题层级、结构、语气和写作风格。
  8. content 必须使用标准 Markdown 标题和正文，不要包裹在代码块里，便于前端复制为富文本。
  9. content 如涉及界面操作，必须使用图片占位符，不要使用真实图片 URL。

  图片理解规则：
    1. 如果用户上传了功能截图，请结合图片中的界面文字、按钮、字段和流程，提炼该板块的功能描述、配置步骤、注意事项。
    2. 当文本描述与截图信息互补时，以用户文本为目标，以截图补充入口、字段名和操作顺序。
    3. 无法从截图确认的信息不要编造，可用较保守的表述。`;

  const userPrompt = `以下是从当前帮助中心 ${allDocuments.length} 篇文档中预检索出的 ${searchableCandidateDocuments.length} 篇中文候选文档：

  ${docSummaries || "无中文候选文档"}

  ---

  以下是上述中文候选文档已关联的英文文档。只有当对应中文文档需要修改时，才同步分析这些英文文档：

  ${linkedEnglishDocSummaries || "无关联英文文档"}

  ---

  现在有一个新功能需要上线，功能描述如下：

  ${featureText || "用户未输入文字描述，请根据上传截图理解功能设置内容并撰写功能描述与操作步骤。"}

  上传的功能截图：${analyzeImages.length > 0 ? analyzeImages.map((image, index) => `${index + 1}. ${image.name}（${image.type}）`).join("；") : "无"}

  视觉模型识别出的截图内容：
  ${imageDescriptions || "无"}

  请只基于上述中文候选文档和截图识别内容判断需要修改或新增的中文帮助中心文档；如果相关中文文档存在关联英文文档，请同步给出英文文档修改内容。请按指定 JSON 格式返回可渲染的文档修改建议。`;

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              retrieval: {
                totalDocuments: retrievalResult.totalDocuments,
                candidateDocuments: searchableCandidateDocuments.length,
                candidateLimit: retrievalResult.candidateLimit,
                searchTerms: retrievalResult.searchTerms,
              },
            })}\n\n`
          )
        );

        const llmStream = streamDeepSeekChatCompletion({
          messages,
          model: selectedModel,
          temperature: 0.3,
          responseFormat: "text",
        });

        for await (const text of llmStream) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ content: text })}\n\n`)
          );
        }

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`)
        );
        controller.close();
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "分析过程出错";
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: errorMessage })}\n\n`
          )
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
