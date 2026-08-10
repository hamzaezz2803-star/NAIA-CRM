import "server-only";

import type { ZodType } from "zod";

const GROQ_CHAT_COMPLETIONS_URL =
  "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_REQUEST_TIMEOUT_MS = 12_000;
export const GROQ_REQUEST_LIMITS = {
  maxMessageCharacters: 16_000,
  maxMessages: 24,
  maxRequestCharacters: 32_000,
  maxTokens: 1_200,
} as const;

export const defaultGroqModels = {
  fast: "openai/gpt-oss-20b",
  orchestrator: "qwen/qwen3.6-27b",
  research: "groq/compound-mini",
  structuredFallback: "openai/gpt-oss-120b",
} as const;

const retiringGroqModels = new Set([
  "llama-3.1-8b-instant",
  "llama-3.3-70b-versatile",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "qwen/qwen3-32b",
]);

export type GroqMessage = {
  content: string;
  role: "assistant" | "system" | "user";
};

export type GroqWorkload = "fast" | "orchestrator";

export type GroqCompletion<T> = {
  data: T;
  model: string;
  usedFallback: boolean;
};

type GroqEnvironment = Partial<
  Record<
    | "GROQ_FAST_MODEL"
    | "GROQ_MODEL"
    | "GROQ_ORCHESTRATOR_MODEL"
    | "GROQ_RESEARCH_MODEL"
    | "GROQ_STRUCTURED_FALLBACK_MODEL",
    string
  >
>;

type JsonSchema = Record<string, unknown>;

type GroqBaseRequest = {
  maxTokens: number;
  messages: GroqMessage[];
  temperature: number;
  workload?: GroqWorkload;
};

type GroqJsonRequest<T> = GroqBaseRequest & {
  jsonSchema: JsonSchema;
  schema: ZodType<T>;
  schemaName: string;
};

type GroqTextRequest = GroqBaseRequest;

type GroqApiPayload = {
  choices?: Array<{ message?: { content?: unknown } }>;
};

type GroqRequestBody = {
  max_tokens: number;
  messages: GroqMessage[];
  model: string;
  reasoning_effort?: "low" | "none";
  response_format?:
    | { type: "json_object" }
    | {
        json_schema: {
          name: string;
          schema: JsonSchema;
          strict: true;
        };
        type: "json_schema";
      };
  temperature: number;
};

export function getGroqApiKey() {
  return (
    process.env.GROQ_API_KEY?.trim() ||
    process.env.GROQ_KEY?.trim() ||
    undefined
  );
}

export function getGroqModelConfiguration(env?: GroqEnvironment) {
  const configured = env ?? readGroqEnvironment();
  const legacyModel = activeModel(configured.GROQ_MODEL);

  return {
    fast: activeModel(configured.GROQ_FAST_MODEL) ?? defaultGroqModels.fast,
    orchestrator:
      activeModel(configured.GROQ_ORCHESTRATOR_MODEL) ??
      legacyModel ??
      defaultGroqModels.orchestrator,
    research:
      activeModel(configured.GROQ_RESEARCH_MODEL) ?? defaultGroqModels.research,
    structuredFallback:
      activeModel(configured.GROQ_STRUCTURED_FALLBACK_MODEL) ??
      defaultGroqModels.structuredFallback,
  };
}

export async function completeGroqJson<T>({
  jsonSchema,
  maxTokens,
  messages,
  schema,
  schemaName,
  temperature,
  workload = "orchestrator",
}: GroqJsonRequest<T>): Promise<GroqCompletion<T> | null> {
  if (!isBoundedGroqRequest({ maxTokens, messages })) return null;
  const apiKey = getGroqApiKey();
  if (!apiKey) return null;

  const models = getRequestModels(workload);

  for (const [index, model] of models.entries()) {
    const content = await requestGroq({
      apiKey,
      body: {
        max_tokens: maxTokens,
        messages,
        model,
        ...reasoningOptions(model),
        response_format: supportsStrictJsonSchema(model)
          ? {
              json_schema: {
                name: schemaName,
                schema: jsonSchema,
                strict: true,
              },
              type: "json_schema",
            }
          : { type: "json_object" },
        temperature,
      },
    });
    if (!content) continue;

    const parsed = parseJsonContent(content);
    if (!parsed) continue;

    const validated = schema.safeParse(parsed);
    if (!validated.success) continue;

    return {
      data: validated.data,
      model,
      usedFallback: index > 0,
    };
  }

  return null;
}

export async function completeGroqText({
  maxTokens,
  messages,
  temperature,
  workload = "orchestrator",
}: GroqTextRequest): Promise<GroqCompletion<string> | null> {
  if (!isBoundedGroqRequest({ maxTokens, messages })) return null;
  const apiKey = getGroqApiKey();
  if (!apiKey) return null;

  const models = getRequestModels(workload);

  for (const [index, model] of models.entries()) {
    const content = await requestGroq({
      apiKey,
      body: {
        max_tokens: maxTokens,
        messages,
        model,
        ...reasoningOptions(model),
        temperature,
      },
    });
    if (!content?.trim()) continue;

    return {
      data: content.trim(),
      model,
      usedFallback: index > 0,
    };
  }

  return null;
}

function activeModel(value: string | undefined) {
  const model = value?.trim();
  if (!model || retiringGroqModels.has(model)) return undefined;
  return model;
}

function isBoundedGroqRequest({
  maxTokens,
  messages,
}: Pick<GroqBaseRequest, "maxTokens" | "messages">) {
  if (
    !Number.isInteger(maxTokens) ||
    maxTokens < 1 ||
    maxTokens > GROQ_REQUEST_LIMITS.maxTokens ||
    messages.length < 1 ||
    messages.length > GROQ_REQUEST_LIMITS.maxMessages
  ) {
    return false;
  }

  let totalCharacters = 0;
  for (const message of messages) {
    if (
      !message.content ||
      message.content.length > GROQ_REQUEST_LIMITS.maxMessageCharacters
    ) {
      return false;
    }
    totalCharacters += message.content.length;
    if (totalCharacters > GROQ_REQUEST_LIMITS.maxRequestCharacters) {
      return false;
    }
  }
  return true;
}

function readGroqEnvironment(): GroqEnvironment {
  return {
    GROQ_FAST_MODEL: process.env.GROQ_FAST_MODEL,
    GROQ_MODEL: process.env.GROQ_MODEL,
    GROQ_ORCHESTRATOR_MODEL: process.env.GROQ_ORCHESTRATOR_MODEL,
    GROQ_RESEARCH_MODEL: process.env.GROQ_RESEARCH_MODEL,
    GROQ_STRUCTURED_FALLBACK_MODEL: process.env.GROQ_STRUCTURED_FALLBACK_MODEL,
  };
}

function getRequestModels(workload: GroqWorkload) {
  const models = getGroqModelConfiguration();
  return [...new Set([models[workload], models.structuredFallback])];
}

function reasoningOptions(model: string) {
  if (model === "qwen/qwen3.6-27b") {
    return { reasoning_effort: "none" as const };
  }
  if (model.startsWith("openai/gpt-oss-")) {
    return { reasoning_effort: "low" as const };
  }
  return {};
}

function supportsStrictJsonSchema(model: string) {
  return model === "openai/gpt-oss-20b" || model === "openai/gpt-oss-120b";
}

async function requestGroq({
  apiKey,
  body,
}: {
  apiKey: string;
  body: GroqRequestBody;
}) {
  try {
    const response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as GroqApiPayload;
    const content = payload.choices?.[0]?.message?.content;
    return typeof content === "string" ? content : null;
  } catch {
    return null;
  }
}

function parseJsonContent(content: string): unknown | null {
  const trimmed = content.trim();

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace < 0 || lastBrace <= firstBrace) return null;

    try {
      return JSON.parse(
        sanitizeJsonControlCharacters(trimmed.slice(firstBrace, lastBrace + 1)),
      ) as unknown;
    } catch {
      return null;
    }
  }
}

function sanitizeJsonControlCharacters(value: string) {
  let inString = false;
  let escaped = false;
  let result = "";

  for (const character of value) {
    if (escaped) {
      escaped = false;
      result += character;
      continue;
    }
    if (character === "\\" && inString) {
      escaped = true;
      result += character;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      result += character;
      continue;
    }
    if (inString && character === "\n") {
      result += "\\n";
      continue;
    }
    if (inString && character === "\r") {
      result += "\\r";
      continue;
    }
    if (inString && character === "\t") {
      result += "\\t";
      continue;
    }
    result += character;
  }

  return result;
}
