import { NextRequest } from "next/server";
import { LLMClient, Config, HeaderUtils } from "coze-coding-dev-sdk";
import { helpDocuments, type HelpDocument } from "@/lib/documents";

export const maxDuration = 60;

const CANDIDATE_DOCUMENT_LIMIT = 30;
const MAX_MATCHED_TERMS = 8;

interface AnalyzeRequestBody {
  feature?: unknown;
  documents?: unknown;
}

interface DocumentPayload {
  id?: unknown;
  title?: unknown;
  category?: unknown;
  lastUpdated?: unknown;
  last_updated?: unknown;
  content?: unknown;
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
    return {
      ...(doc as HelpDocument),
      lastUpdated,
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
  const { feature, documents } = (await request.json()) as AnalyzeRequestBody;

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

  const searchableDocuments = customDocuments.length > 0 ? customDocuments : helpDocuments;
  const retrievalResult = selectCandidateDocuments(searchableDocuments, feature.trim());
  const searchableCandidateDocuments = retrievalResult.candidateDocuments;

  const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
  const config = new Config();
  const client = new LLMClient(config, customHeaders);

  // 第一阶段先做轻量关键词召回，只把最相关候选文档交给 LLM，降低 300+ 文档场景下的 token 消耗。
  const docSummaries = retrievalResult.rankedDocuments
    .map((item, index) => {
      const doc = item.doc;
      const matchedTerms = item.matchedTerms.length > 0 ? item.matchedTerms.join("、") : "无明确关键词命中";
      return `【候选序号: ${index + 1}】【预检索分数: ${item.score.toFixed(1)}】【命中词: ${matchedTerms}】\n【文档ID: ${doc.id}】【标题: ${doc.title}】【分类: ${doc.category}】【更新时间: ${doc.lastUpdated}】\n内容:\n${doc.content}`;
    })
    .join("\n\n---\n\n");

  const systemPrompt = `你是一个帮助中心文档维护专家。你的任务是根据用户输入的新功能描述，只在系统预检索出来的候选帮助中心文档中判断哪些文档需要更新，并给出具体的修改建议。

系统已先从 ${retrievalResult.totalDocuments} 篇帮助文档中完成轻量关键词预检索，本次只提供最相关的 ${searchableCandidateDocuments.length} 篇候选文档给你分析。不要引用候选文档之外的任何文档。

你必须严格按照以下JSON格式返回结果，不要包含任何其他文字说明：

{
  "affectedDocs": [
    {
      "docId": "文档ID",
      "docName": "文档标题",
      "reason": "为什么需要修改这个文档",
      "changes": [
        {
          "type": "delete",
          "originalText": "需要删除的原文内容（必须是文档中的原文片段）",
          "reason": "删除原因"
        },
        {
          "type": "add",
          "newContent": "需要新增的内容",
          "position": "after|before|replace",
          "referenceText": "在哪个位置添加（某段原文的引用）",
          "reason": "新增原因"
        }
      ]
    }
  ]
}

注意事项：
1. originalText 必须是候选文档中的原文片段，便于定位
2. type 只能是 "delete" 或 "add"
3. position 只能是 "after"、"before" 或 "replace"
4. referenceText 用于定位新增内容的位置
5. 如果某个候选文档不需要修改，不要包含在结果中
6. 请仔细分析每个候选文档，确保修改建议合理且必要
7. 新增内容应该与原文档风格保持一致
8. docId 和 docName 必须来自本次提供的候选帮助中心文档，不要编造文档
9. 如果候选文档都不需要修改，请返回 {"affectedDocs": []}`;

  const userPrompt = `以下是从当前帮助中心 ${retrievalResult.totalDocuments} 篇文档中预检索出的 ${searchableCandidateDocuments.length} 篇候选文档：

${docSummaries}

---

现在有一个新功能需要上线，功能描述如下：

${feature}

请只基于上述候选帮助中心文档分析哪些文档需要更新，并给出具体的修改建议。只返回需要修改的文档，以JSON格式返回。`;

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

        const llmStream = client.stream(messages, {
          model: "doubao-seed-2-0-pro-260215",
          temperature: 0.3,
        });

        for await (const chunk of llmStream) {
          if (chunk.content) {
            const text = chunk.content.toString();
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ content: text })}\n\n`)
            );
          }
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
