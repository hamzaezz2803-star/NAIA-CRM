import type {
  MayaDeckPlan,
  MayaIndexedDeck,
  MayaLearningEvent,
} from "./contracts";

type MayaOpenAIEnv = Record<string, string | undefined>;

type FetchLike = (
  input: string,
  init: {
    body: string;
    headers: Record<string, string>;
    method: "POST";
  },
) => Promise<{
  json: () => Promise<unknown>;
  ok: boolean;
  text?: () => Promise<string>;
}>;

type MayaOpenAIPlanOutput = {
  credentialSlideNumbers: number[];
  diagnosticOutline: string[];
  followUpQuestions: string[];
  rationale: string;
  useCaseBullets: string[];
};

export type MayaOpenAIPlanResult = {
  plan: MayaDeckPlan;
  usedOpenAI: boolean;
  warning?: string;
};

export async function enhanceMayaDeckPlanWithOpenAI({
  basePlan,
  env = process.env,
  fetchImpl = fetch as FetchLike,
  genericDeck,
  learningEvents,
}: {
  basePlan: MayaDeckPlan;
  env?: MayaOpenAIEnv;
  fetchImpl?: FetchLike;
  genericDeck: MayaIndexedDeck;
  learningEvents: MayaLearningEvent[];
}): Promise<MayaOpenAIPlanResult> {
  const apiKey = env.MAYA_OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return { plan: basePlan, usedOpenAI: false };
  }

  const model = env.MAYA_OPENAI_MODEL?.trim() || "gpt-5.5";

  try {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      body: JSON.stringify(
        buildMayaOpenAIRequestBody({
          basePlan,
          genericDeck,
          learningEvents,
          model,
          reasoningEffort: sanitizeReasoningEffort(
            env.MAYA_OPENAI_REASONING_EFFORT,
          ),
        }),
      ),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      return {
        plan: basePlan,
        usedOpenAI: false,
        warning: await readProviderError(response),
      };
    }

    const payload = await response.json();
    const output = parseMayaOpenAIPlanOutput(payload);

    return {
      plan: mergeMayaOpenAIPlan({
        basePlan,
        genericDeck,
        model,
        output,
      }),
      usedOpenAI: true,
    };
  } catch (error) {
    return {
      plan: basePlan,
      usedOpenAI: false,
      warning:
        error instanceof Error
          ? `OpenAI planning skipped: ${error.message}`
          : "OpenAI planning skipped: unknown error.",
    };
  }
}

function buildMayaOpenAIRequestBody({
  basePlan,
  genericDeck,
  learningEvents,
  model,
  reasoningEffort,
}: {
  basePlan: MayaDeckPlan;
  genericDeck: MayaIndexedDeck;
  learningEvents: MayaLearningEvent[];
  model: string;
  reasoningEffort?: string;
}) {
  return {
    input: [
      {
        content:
          "Tu es Maya, l'agent Qarizmi qui prépare des pitchs B2B high-end. Réponds en français, de façon concise, business et actionnable. Tu dois respecter le schema JSON et ne jamais inventer de numéros de slides hors de la bibliothèque fournie.",
        role: "system",
      },
      {
        content: JSON.stringify(
          {
            basePlan,
            credentialSlides: genericDeck.slides
              .filter((slide) => slide.section === "credentials")
              .map((slide) => ({
                slideNumber: slide.slideNumber,
                text: slide.text.slice(0, 900),
                title: slide.title,
              })),
            learningEvents: learningEvents.slice(0, 8),
          },
          null,
          2,
        ),
        role: "user",
      },
    ],
    max_output_tokens: 2400,
    model,
    ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
    text: {
      format: {
        name: "maya_pitch_plan",
        schema: mayaOpenAIPlanJsonSchema,
        strict: true,
        type: "json_schema",
      },
    },
  };
}

const mayaOpenAIPlanJsonSchema = {
  additionalProperties: false,
  properties: {
    credentialSlideNumbers: {
      description:
        "Credential slide numbers to keep from the provided library only.",
      items: { type: "number" },
      type: "array",
    },
    diagnosticOutline: {
      description:
        "Part 4 diagnostic bullets tailored to the client value chain.",
      items: { type: "string" },
      type: "array",
    },
    followUpQuestions: {
      description:
        "Smart questions Maya should ask before finalizing the pitch.",
      items: { type: "string" },
      type: "array",
    },
    rationale: {
      description: "Short explanation of the planning choices.",
      type: "string",
    },
    useCaseBullets: {
      description: "Specific use cases to add to the draft deck.",
      items: { type: "string" },
      type: "array",
    },
  },
  required: [
    "credentialSlideNumbers",
    "diagnosticOutline",
    "followUpQuestions",
    "rationale",
    "useCaseBullets",
  ],
  type: "object",
} as const;

function parseMayaOpenAIPlanOutput(payload: unknown): MayaOpenAIPlanOutput {
  const text = extractOpenAIOutputText(payload);
  if (!text) {
    throw new Error("invalid OpenAI response: missing output text");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("invalid OpenAI response: output text is not JSON");
  }

  if (!isMayaOpenAIPlanOutput(parsed)) {
    throw new Error("invalid OpenAI response: schema mismatch");
  }

  return parsed;
}

function extractOpenAIOutputText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text;

  if (!Array.isArray(record.output)) return null;
  for (const item of record.output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as Record<string, unknown>).text;
      if (typeof text === "string") return text;
    }
  }

  return null;
}

function isMayaOpenAIPlanOutput(value: unknown): value is MayaOpenAIPlanOutput {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;

  return (
    isNumberArray(record.credentialSlideNumbers) &&
    isStringArray(record.diagnosticOutline) &&
    isStringArray(record.followUpQuestions) &&
    isStringArray(record.useCaseBullets) &&
    typeof record.rationale === "string"
  );
}

function mergeMayaOpenAIPlan({
  basePlan,
  genericDeck,
  model,
  output,
}: {
  basePlan: MayaDeckPlan;
  genericDeck: MayaIndexedDeck;
  model: string;
  output: MayaOpenAIPlanOutput;
}): MayaDeckPlan {
  const availableCredentialSlideNumbers = genericDeck.slides
    .filter((slide) => slide.section === "credentials")
    .map((slide) => slide.slideNumber);
  const availableCredentialSet = new Set(availableCredentialSlideNumbers);
  const credentialSlideNumbers = uniqueNumbers(output.credentialSlideNumbers)
    .filter((slideNumber) => availableCredentialSet.has(slideNumber))
    .slice(0, 6);
  const selectedCredentialSlideNumbers = credentialSlideNumbers.length
    ? credentialSlideNumbers
    : basePlan.credentialSlideNumbers;
  const selectedCredentialSet = new Set(selectedCredentialSlideNumbers);
  const omittedSlideNumbers = availableCredentialSlideNumbers.filter(
    (slideNumber) => !selectedCredentialSet.has(slideNumber),
  );
  const diagnosticOutline =
    sanitizeStringList(output.diagnosticOutline, 7) ||
    basePlan.diagnosticOutline;
  const useCaseBullets = sanitizeStringList(output.useCaseBullets, 7);
  const followUpQuestions = sanitizeStringList(output.followUpQuestions, 6);

  return {
    ...basePlan,
    brief: {
      ...basePlan.brief,
      missingQuestions: uniqueStrings([
        ...basePlan.brief.missingQuestions,
        ...(followUpQuestions ?? []),
      ]),
    },
    credentialSlideNumbers: selectedCredentialSlideNumbers,
    diagnosticOutline,
    omittedSlideNumbers,
    planner: {
      generatedAt: new Date().toISOString(),
      model,
      provider: "openai",
      rationale: output.rationale.trim(),
    },
    ...(useCaseBullets ? { useCaseBullets } : {}),
  };
}

function sanitizeStringList(values: string[], maxItems: number) {
  const cleaned = values
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return cleaned.length ? uniqueStrings(cleaned).slice(0, maxItems) : null;
}

function uniqueNumbers(values: number[]) {
  return [...new Set(values.filter(Number.isFinite))];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isNumberArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "number")
  );
}

function sanitizeReasoningEffort(value?: string) {
  const normalized = value?.trim().toLowerCase();
  return normalized && ["minimal", "low", "medium", "high"].includes(normalized)
    ? normalized
    : undefined;
}

async function readProviderError(response: { text?: () => Promise<string> }) {
  const message = response.text ? await response.text() : "";
  return message
    ? `OpenAI planning skipped: ${message.slice(0, 500)}`
    : "OpenAI planning skipped: provider returned an error.";
}
