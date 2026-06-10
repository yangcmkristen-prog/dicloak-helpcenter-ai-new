import { NextRequest } from "next/server";
import { streamDeepSeekChatCompletion } from "@/lib/deepseek-client";
import { helpDocuments, type HelpDocument } from "@/lib/documents";

export const maxDuration = 60;

const CANDIDATE_DOCUMENT_LIMIT = 12;
const MAX_MATCHED_TERMS = 8;

interface AnalyzeRequestBody {
  feature?: unknown;
  documents?: unknown;
  includeFinalContent?: unknown;
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
  linked_doc_id?: unknown;
}

interface RankedDocument {
  doc: HelpDocument;
  score: number;
  matchedTerms: string[];
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
    const linkedDocId =
      typeof doc.linkedDocId === "string"
        ? doc.linkedDocId
        : typeof doc.linked_doc_id === "string"
          ? doc.linked_doc_id
          : undefined;

    return {
      ...(doc as HelpDocument),
      lastUpdated,
      language: typeof doc.language === "string" ? doc.language : "unknown",
      linkedDocId,
    };
  }

  return null;
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

export async function POST(request: NextRequest) {
  const { feature, documents, includeFinalContent } = (await request.json()) as AnalyzeRequestBody;
  const shouldGenerateFinalContent = includeFinalContent === true;

  if (!feature || typeof feature !== "string" || feature.trim().length === 0) {
    return new Response(JSON.stringify({ error: "请输入新功能描述" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const customDocuments = Array.isArray(documents)
    ? documents
        .map((doc) => normalizeDocumentPayload(doc as DocumentPayload))
        .filter((doc): doc is HelpDocument => Boolean(doc))
    : [];

  const allDocuments = customDocuments.length > 0 ? customDocuments : helpDocuments;
  const zhDocuments = allDocuments.filter((doc) => getDocumentLanguage(doc) === "zh");
  const searchableDocuments = zhDocuments.length > 0 ? zhDocuments : allDocuments;
  const retrievalResult = selectCandidateDocuments(searchableDocuments, feature.trim());
  const searchableCandidateDocuments = retrievalResult.candidateDocuments;

  const documentById = new Map(allDocuments.map((doc) => [doc.id, doc]));

  const relatedEnglishDocuments = searchableCandidateDocuments
    .map((doc) => {
      const linkedDocId =
        "linkedDocId" in doc && typeof doc.linkedDocId === "string"
          ? doc.linkedDocId
          : "linked_doc_id" in doc && typeof doc.linked_doc_id === "string"
            ? doc.linked_doc_id
            : undefined;

      if (!linkedDocId) return null;

      const linkedDoc = documentById.get(linkedDocId);
      if (!linkedDoc || getDocumentLanguage(linkedDoc) !== "en") return null;

      return {
        zhDocId: doc.id,
        zhDocTitle: doc.title,
        enDoc: linkedDoc,
      };
    })
    .filter((item): item is { zhDocId: string; zhDocTitle: string; enDoc: HelpDocument } => Boolean(item));

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
      return `
  内容:
  ${doc.content}`;
    })
    .join("\n\n---\n\n");

  const finalContentInstruction = shouldGenerateFinalContent
    ? `## 最终文档内容

  必须输出可直接发布的最终文档内容。
  中文文档和英文文档分开输出。
  如果涉及新建文档，也在这里输出完整文档。`
    : `## 最终文档内容

  本次不生成完整最终稿，以节省 token。仅输出影响分析、建议删除内容、建议新增内容、建议插入位置和 diff。
  如果需要完整最终稿，请重新发起分析并选择“生成最终文档内容”。`;

  const systemPrompt = `你是 DICloak 帮助中心文档维护专家。

  任务：根据功能更新内容，分析帮助中心文档是否需要修改或新增，并输出帮助中心文档维护建议。

  范围约束：
  1. 用户会用中文描述新功能。
  2. 你必须优先且只基于系统提供的中文候选文档判断哪些中文文档需要修改。
  3. 不要主动分析未提供的英文文档。
  4. 只有当中文候选文档存在关联英文文档时，才需要同步输出对应英文文档的修改内容。
  5. 如果中文文档需要修改，但没有提供关联英文文档，则只输出中文文档修改内容，不要编造英文文档。
  6. 如果新功能与现有中文候选文档主题强相关，则修改现有文档。
  7. 如果新功能属于独立功能模块、单独入口或内容较多，不适合插入现有文档，则建议新建中文文档。
  8. 不允许为了复用文档而强行添加到不相关文档中。

  文档风格要求：
  1. 严格参考帮助中心已有文档的标题层级、结构、语气和写作风格。
  2. 保持与同分类文档一致的章节命名方式。
  3. 使用简洁、客观、说明性的表达，不使用营销语言。
  4. 不编造不存在的功能、步骤或限制。
  5. 优先复用现有文档中的术语和命名。

  文档修改要求：
  1. 保留原有文档结构。
  2. 仅修改受影响部分。
  3. 明确输出：
    * 修改文档名称
    * 修改原因
    * 建议删除内容
    * 建议新增内容
  4. 新增内容应标明建议插入位置。
  5. 呈现为 diff 格式。
  6. 中文文档和对应英文关联文档要分别呈现，不要混在一起。

  新建文档要求：
  1. 给出建议标题。
  2. 按帮助中心标准结构生成完整文档。
  3. 包含：
    * 使用场景（如适用）
    * 操作步骤
    * FAQ（如适用）

  图片要求：
  1. 涉及界面操作时必须预留截图位置。
  2. 使用格式：
  [图片占位符：配置页面]

  输出要求：
  你必须严格按照以下 Markdown 结构返回，不要返回 JSON，不要包裹代码块：

  # 文档影响分析

  ## 需要修改的文档

  逐个列出需要修改的中文文档，以及每篇中文文档关联的英文文档。

  每篇文档必须包含：
  - 修改文档名称
  - 修改原因
  - 建议删除内容
  - 建议新增内容
  - 建议插入位置
  - diff

  ## 建议新增的文档

  如果不需要新增文档，写“暂无”。

  ${finalContentInstruction}`;

  const userPrompt = `以下是从当前帮助中心 ${allDocuments.length} 篇文档中预检索出的 ${searchableCandidateDocuments.length} 篇中文候选文档：

  ${docSummaries || "无中文候选文档"}

  ---

  以下是上述中文候选文档已关联的英文文档。只有当对应中文文档需要修改时，才同步分析这些英文文档：

  ${linkedEnglishDocSummaries || "无关联英文文档"}

  ---

  现在有一个新功能需要上线，功能描述如下：

  ${feature}

  请只基于上述中文候选文档判断需要修改或新增的中文帮助中心文档；如果相关中文文档存在关联英文文档，请同步给出英文文档修改内容。输出必须使用指定 Markdown 结构。`;

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userPrompt },
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
