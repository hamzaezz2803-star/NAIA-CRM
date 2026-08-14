import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  completeGroqJson,
  completeGroqText,
  defaultGroqModels,
  getGroqApiKey,
  getGroqModelConfiguration,
} from "./groq";

const answerSchema = z.object({ answer: z.string().min(1) });
const answerJsonSchema = {
  additionalProperties: false,
  properties: { answer: { type: "string" } },
  required: ["answer"],
  type: "object",
};

function groqResponse(content: string, ok = true) {
  return {
    json: async () => ({ choices: [{ message: { content } }] }),
    ok,
  };
}

describe("Groq model router", () => {
  beforeEach(() => {
    vi.stubEnv("GROQ_API_KEY", "test-key");
    vi.stubEnv("GROQ_MODEL", "");
    vi.stubEnv("GROQ_ORCHESTRATOR_MODEL", "");
    vi.stubEnv("GROQ_STRUCTURED_FALLBACK_MODEL", "");
    vi.stubEnv("GROQ_FAST_MODEL", "");
    vi.stubEnv("GROQ_RESEARCH_MODEL", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses Qwen 3.6 without reasoning for orchestration", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(groqResponse('{"answer":"Compris"}'));
    vi.stubGlobal("fetch", fetchMock);

    const completion = await completeGroqJson({
      jsonSchema: answerJsonSchema,
      maxTokens: 100,
      messages: [{ content: "Réponds en JSON", role: "user" }],
      schema: answerSchema,
      schemaName: "test_answer",
      temperature: 0.1,
    });

    expect(completion).toEqual({
      data: { answer: "Compris" },
      model: defaultGroqModels.orchestrator,
      usedFallback: false,
    });
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request).toMatchObject({
      model: "qwen/qwen3.6-27b",
      reasoning_effort: "none",
      response_format: { type: "json_object" },
    });
  });

  it("falls back to GPT-OSS 120B strict schema after invalid Qwen JSON", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(groqResponse('{"wrong":"shape"}'))
      .mockResolvedValueOnce(groqResponse('{"answer":"Fallback fiable"}'));
    vi.stubGlobal("fetch", fetchMock);

    const completion = await completeGroqJson({
      jsonSchema: answerJsonSchema,
      maxTokens: 100,
      messages: [{ content: "Réponds en JSON", role: "user" }],
      schema: answerSchema,
      schemaName: "test_answer",
      temperature: 0.1,
    });

    expect(completion).toEqual({
      data: { answer: "Fallback fiable" },
      model: defaultGroqModels.structuredFallback,
      usedFallback: true,
    });
    const fallbackRequest = JSON.parse(
      fetchMock.mock.calls[1][1].body as string,
    );
    expect(fallbackRequest).toMatchObject({
      model: "openai/gpt-oss-120b",
      reasoning_effort: "low",
      response_format: {
        json_schema: {
          name: "test_answer",
          schema: answerJsonSchema,
          strict: true,
        },
        type: "json_schema",
      },
    });
  });

  it("uses GPT-OSS 20B strict schema for low-risk fast work", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(groqResponse('{"answer":"Relance prête"}'));
    vi.stubGlobal("fetch", fetchMock);

    await completeGroqJson({
      jsonSchema: answerJsonSchema,
      maxTokens: 100,
      messages: [{ content: "Réponds en JSON", role: "user" }],
      schema: answerSchema,
      schemaName: "test_answer",
      temperature: 0.2,
      workload: "fast",
    });

    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request).toMatchObject({
      model: "openai/gpt-oss-20b",
      reasoning_effort: "low",
      response_format: { type: "json_schema" },
    });
  });

  it("ignores retiring legacy models and selects Qwen by default", () => {
    expect(
      getGroqModelConfiguration({
        GROQ_MODEL: "llama-3.3-70b-versatile",
      }),
    ).toMatchObject({
      orchestrator: "qwen/qwen3.6-27b",
      structuredFallback: "openai/gpt-oss-120b",
    });
  });

  it("falls back for plain-text completions when the primary request fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(groqResponse("", false))
      .mockResolvedValueOnce(groqResponse("Réponse de secours"));
    vi.stubGlobal("fetch", fetchMock);

    const completion = await completeGroqText({
      maxTokens: 100,
      messages: [{ content: "Réponds", role: "user" }],
      temperature: 0.2,
    });

    expect(completion).toMatchObject({
      data: "Réponse de secours",
      model: "openai/gpt-oss-120b",
      usedFallback: true,
    });
  });

  it("does not call Groq without a server-side API key", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("GROQ_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const completion = await completeGroqText({
      maxTokens: 100,
      messages: [{ content: "Réponds", role: "user" }],
      temperature: 0.2,
    });

    expect(completion).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enables production callers when EXTERNAL_AI_GROQ_ENABLED is true", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EXTERNAL_AI_GROQ_ENABLED", "true");

    expect(getGroqApiKey()).toBe("test-key");
    expect(getGroqApiKey("founder-route")).toBe("test-key");

    vi.stubEnv("EXTERNAL_AI_GROQ_ENABLED", "false");
    expect(getGroqApiKey()).toBeUndefined();
  });

  it.each([
    ["oversized message", 100, "x".repeat(16_001)],
    ["oversized token budget", 1_201, "Réponds"],
  ])(
    "rejects a %s before any provider call",
    async (_label, maxTokens, content) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const completion = await completeGroqText({
        maxTokens,
        messages: [{ content, role: "user" }],
        temperature: 0.2,
      });

      expect(completion).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("uses the legacy Groq key when the primary variable is blank", () => {
    vi.stubEnv("GROQ_API_KEY", "   ");
    vi.stubEnv("GROQ_KEY", " legacy-key ");

    expect(getGroqApiKey()).toBe("legacy-key");
  });
});
