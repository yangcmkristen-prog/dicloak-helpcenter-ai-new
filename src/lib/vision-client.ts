type ChatRole = "system" | "user" | "assistant";

interface VisionImagePayload {
  name: string;
  type: string;
  dataUrl: string;
}

interface VisionTextContent {
  type: "text";
  text: string;
}

interface VisionImageContent {
  type: "image_url";
  image_url: {
    url: string;
  };
}

interface VisionMessage {
  role: ChatRole;
  content: string | Array<VisionTextContent | VisionImageContent>;
}

interface VisionChatChoice {
  message?: {
    content?: string;
  };
}

interface VisionChatResponse {
  choices?: VisionChatChoice[];
  error?: {
    message?: string;
  };
}

const DEFAULT_VISION_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_VISION_MODEL = "gpt-4o-mini";

function getVisionApiKey() {
  const apiKey = process.env.VISION_API_KEY;

  if (!apiKey) {
    throw new Error(
      "当前 DeepSeek 接口只支持 text 消息，不能直接识别图片。请配置支持图片输入的 OpenAI-compatible 视觉模型：VISION_API_KEY、VISION_BASE_URL、VISION_MODEL。"
    );
  }

  return apiKey;
}

function getVisionBaseUrl() {
  return (process.env.VISION_BASE_URL || DEFAULT_VISION_BASE_URL).replace(/\/$/, "");
}

function getVisionModel() {
  return process.env.VISION_MODEL || DEFAULT_VISION_MODEL;
}

function buildVisionPrompt(images: VisionImagePayload[]) {
  return `请阅读用户上传的功能截图，提取后续帮助中心文档分析需要用到的信息。

请按图片逐张输出，重点描述：
1. 页面/弹窗/模块名称；
2. 可见按钮、菜单、入口、字段、开关、表格列；
3. 操作流程或配置步骤；
4. 明确可见的状态、限制、提示语；
5. 不确定的信息请标注“截图中无法确认”，不要编造。

上传图片：${images.map((image, index) => `${index + 1}. ${image.name}（${image.type}）`).join("；")}`;
}

function parseVisionResponse(responseJson: VisionChatResponse) {
  if (responseJson.error?.message) {
    throw new Error(responseJson.error.message);
  }

  const content = responseJson.choices?.map((choice) => choice.message?.content ?? "").join("\n").trim();
  if (!content) {
    throw new Error("视觉模型未返回图片识别结果");
  }

  return content;
}

export async function describeImagesWithVisionModel(images: VisionImagePayload[]) {
  if (images.length === 0) return "";

  const messages: VisionMessage[] = [
    {
      role: "system",
      content: "你是产品帮助文档截图理解助手。只基于截图中可见内容提取客观信息，不要编造。",
    },
    {
      role: "user",
      content: [
        { type: "text", text: buildVisionPrompt(images) },
        ...images.map((image) => ({
          type: "image_url" as const,
          image_url: { url: image.dataUrl },
        })),
      ],
    },
  ];

  const response = await fetch(`${getVisionBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getVisionApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getVisionModel(),
      messages,
      temperature: 0.1,
      stream: false,
    }),
  });

  const responseText = await response.text();
  let responseJson: VisionChatResponse;

  try {
    responseJson = responseText ? (JSON.parse(responseText) as VisionChatResponse) : {};
  } catch {
    throw new Error(`视觉模型返回非 JSON 内容：${responseText.slice(0, 200) || response.statusText}`);
  }

  if (!response.ok) {
    const errorMessage = responseJson.error?.message || responseText || response.statusText;
    throw new Error(`视觉模型请求失败 (${response.status}): ${errorMessage}`);
  }

  return parseVisionResponse(responseJson);
}