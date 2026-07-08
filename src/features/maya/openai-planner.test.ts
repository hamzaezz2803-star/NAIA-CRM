import { describe, expect, it, vi } from "vitest";

import type { MayaDeckPlan, MayaIndexedDeck } from "./contracts";
import { enhanceMayaDeckPlanWithOpenAI } from "./openai-planner";

describe("Maya OpenAI planner", () => {
  it("enriches the deterministic deck plan with a structured OpenAI response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        output_text: JSON.stringify({
          credentialSlideNumbers: [20, 999, 16],
          diagnosticOutline: [
            "Cartographier les flux paiement et les dépendances LLM local.",
            "Prioriser les cas d'usage à fort impact opérationnel chez HPS.",
          ],
          followUpQuestions: ["Quel est le site web exact à utiliser ?"],
          rationale:
            "Le contexte HPS mentionne paiement, monétique et Mistral, donc finance + LLM local.",
          useCaseBullets: [
            "Agent RAG connecté au LLM local pour les opérations HPS.",
            "Détection d'anomalies sur les flux de paiement.",
          ],
        }),
      }),
      ok: true,
    });

    const result = await enhanceMayaDeckPlanWithOpenAI({
      basePlan: makeBasePlan(),
      env: {
        MAYA_OPENAI_API_KEY: "test-key",
        MAYA_OPENAI_MODEL: "gpt-test",
        MAYA_OPENAI_REASONING_EFFORT: "low",
      },
      fetchImpl: fetchMock,
      genericDeck: makeGenericDeck(),
      learningEvents: [],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
        }),
        method: "POST",
      }),
    );
    expect(result.usedOpenAI).toBe(true);
    expect(result.plan.credentialSlideNumbers).toEqual([20, 16]);
    expect(result.plan.omittedSlideNumbers).toEqual([17]);
    expect(result.plan.diagnosticOutline[0]).toContain("flux paiement");
    expect(result.plan.useCaseBullets).toEqual([
      "Agent RAG connecté au LLM local pour les opérations HPS.",
      "Détection d'anomalies sur les flux de paiement.",
    ]);
    expect(result.plan.brief.missingQuestions).toContain(
      "Quel est le site web exact à utiliser ?",
    );
    expect(result.plan.planner).toMatchObject({
      model: "gpt-test",
      provider: "openai",
      rationale:
        "Le contexte HPS mentionne paiement, monétique et Mistral, donc finance + LLM local.",
    });
  });

  it("keeps the deterministic plan when the OpenAI key is not configured", async () => {
    const fetchMock = vi.fn();
    const basePlan = makeBasePlan();

    const result = await enhanceMayaDeckPlanWithOpenAI({
      basePlan,
      env: {},
      fetchImpl: fetchMock,
      genericDeck: makeGenericDeck(),
      learningEvents: [],
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.usedOpenAI).toBe(false);
    expect(result.plan).toBe(basePlan);
  });

  it("falls back to the deterministic plan when OpenAI returns invalid JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ output_text: "not-json" }),
      ok: true,
    });
    const basePlan = makeBasePlan();

    const result = await enhanceMayaDeckPlanWithOpenAI({
      basePlan,
      env: { MAYA_OPENAI_API_KEY: "test-key" },
      fetchImpl: fetchMock,
      genericDeck: makeGenericDeck(),
      learningEvents: [],
    });

    expect(result.usedOpenAI).toBe(false);
    expect(result.plan).toBe(basePlan);
    expect(result.warning).toContain("invalid");
  });
});

function makeBasePlan(): MayaDeckPlan {
  return {
    brief: {
      clientName: "HPS",
      clientType: "single-company",
      crmContext: "Paiements, switch monétique, LLM local avec Mistral.",
      missingQuestions: ["Quel est le site web exact du client ?"],
      status: "ready",
    },
    closingSlideNumbers: [44],
    credentialSlideNumbers: [16],
    diagnosticOutline: ["Plan déterministe"],
    genericDeckFileName: "Qarizmi_Generic.pptx",
    omittedSlideNumbers: [17, 20],
    presentationSlideNumbers: [1, 2, 3],
    residueWarnings: [],
  };
}

function makeGenericDeck(): MayaIndexedDeck {
  return {
    fileName: "Qarizmi_Generic.pptx",
    filePath: "/tmp/Qarizmi_Generic.pptx",
    kind: "generic",
    modifiedAt: new Date("2026-07-08T00:00:00.000Z"),
    residueWarnings: [],
    sizeBytes: 1_000_000,
    slides: [
      {
        section: "presentation",
        slideNumber: 1,
        sourceHash: "presentation",
        text: "Présentation Qarizmi",
        title: "Présentation",
      },
      {
        section: "credentials",
        slideNumber: 16,
        sourceHash: "healthcare",
        text: "Healthcare",
        title: "Healthcare",
      },
      {
        section: "credentials",
        slideNumber: 17,
        sourceHash: "retail",
        text: "Retail",
        title: "Retail",
      },
      {
        section: "credentials",
        slideNumber: 20,
        sourceHash: "finance",
        text: "Financial Services paiement scoring",
        title: "Financial Services",
      },
      {
        section: "closing",
        slideNumber: 44,
        sourceHash: "closing",
        text: "Next steps",
        title: "Next steps",
      },
    ],
  };
}
