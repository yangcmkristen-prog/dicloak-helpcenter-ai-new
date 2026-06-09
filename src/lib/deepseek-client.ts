type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

interface DeepSeekStreamOptions {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  responseFormat?: "text" | "json_object";
}

interface DeepSeekStreamDelta {
  content?: string;
}

interface DeepSeekStreamChoice {
  delta?: DeepSeekStreamDelta;
}

interface DeepSeekStreamChunk {
  choices?: DeepSeekStreamChoice[];
  error?: {
    message?: string;
  };
}

const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";

function getDeepSeekApiKey() {
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is not set");
  }

  return apiKey;
}

function getDeepSeekBaseUrl() {
  return (process.env.DEEPSEEK_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL).replace(/\/$/, "");
}

function getDeepSeekModel(model?: string) {
  return model || process.env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL;
}

function parseDeepSeekChunk(line: string) {
  const trimmedLine = line.trim();
  if (!trimmedLine.startsWith("data:")) return null;

  const payload = trimmedLine.slice(5).trim();
  if (!payload || payload === "[DONE]") return null;

  const chunk = JSON.parse(payload) as DeepSeekStreamChunk;
  if (chunk.error?.message) {
    throw new Error(chunk.error.message);
  }

  return chunk.choices?.map((choice) => choice.delta?.content ?? "").join("") ?? "";
}

export async function* streamDeepSeekChatCompletion({
  messages,
  model,
  temperature = 0.3,
  responseFormat = "text",
}: DeepSeekStreamOptions): AsyncGenerator<string> {
  const response = await fetch(`${getDeepSeekBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getDeepSeekApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getDeepSeekModel(model),
      messages,
      temperature,
      stream: true,
      response_format: { type: responseFormat },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek 请求失败 (${response.status}): ${errorText || response.statusText}`);
  }

  if (!response.body) {
    throw new Error("DeepSeek 响应不包含可读取的流");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const content = parseDeepSeekChunk(line);
      if (content) {
        yield content;
      }
    }
  }

  buffer += decoder.decode();
  for (const line of buffer.split("\n")) {
    const content = parseDeepSeekChunk(line);
    if (content) {
      yield content;
    }
  }
}