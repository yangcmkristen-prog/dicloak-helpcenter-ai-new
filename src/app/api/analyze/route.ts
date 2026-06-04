import { NextRequest } from "next/server";
import { LLMClient, Config, HeaderUtils } from "coze-coding-dev-sdk";
import { helpDocuments, type HelpDocument } from "@/lib/documents";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const { feature, documents } = await request.json();

  if (!feature || typeof feature !== "string" || feature.trim().length === 0) {
    return new Response(JSON.stringify({ error: "请输入新功能描述" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const customDocuments = Array.isArray(documents)
    ? documents.filter((doc): doc is HelpDocument => {
        return (
          doc &&
          typeof doc.id === "string" &&
          typeof doc.title === "string" &&
          typeof doc.category === "string" &&
          typeof doc.lastUpdated === "string" &&
          typeof doc.content === "string" &&
          doc.content.trim().length > 0
        );
      })
    : [];

  const searchableDocuments = customDocuments.length > 0 ? customDocuments : helpDocuments;

  const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
  const config = new Config();
  const client = new LLMClient(config, customHeaders);

  // 构建文档摘要，让 LLM 只在当前帮助中心文档集合中检索
  const docSummaries = searchableDocuments
    .map((doc) => `​:codex-terminal-citation[codex-terminal-citation]{line_range_start=5 line_range_end=8 terminal_chunk_id=文档ID: ${doc.id}】【标题: ${doc.title}】【分类: ${doc.category}】【更新时间: ${doc.lastUpdated}】\n内容:\n${doc.content}`)
    .join("\n\n---\n\n");

  const systemPrompt = `你是一个帮助中心文档维护专家。你的任务是根据用户输入的新功能描述，只在用户当前提供的帮助中心文档集合中检索哪些文档需要更新，并给出具体的修改建议。

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
1. originalText 必须是文档中的原文片段，便于定位
2. type 只能是 "delete" 或 "add"
3. position 只能是 "after"、"before" 或 "replace"
4. referenceText 用于定位新增内容的位置
5. 如果某个文档不需要修改，不要包含在结果中
6. 请仔细分析每个文档，确保修改建议合理且必要
7. 新增内容应该与原文档风格保持一致
8. docId 和 docName 必须来自上方提供的帮助中心文档，不要编造文档`;

  const userPrompt = `以下是当前帮助中心内可检索的所有文档：

${docSummaries}

---

现在有一个新功能需要上线，功能描述如下：

${feature}

请只基于上述帮助中心文档分析哪些文档需要更新，并给出具体的修改建议。只返回需要修改的文档，以JSON格式返回。`;

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userPrompt },
  ];

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
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