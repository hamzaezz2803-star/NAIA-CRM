import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createLeadAction: vi.fn(),
  extractLeadFromNaturalTextAction: vi.fn(),
  fetchLeadsAction: vi.fn(),
  updateLeadStatusAction: vi.fn(),
}));

vi.mock("@/features/crm/actions", () => ({
  createLeadAction: mocks.createLeadAction,
  extractLeadFromNaturalTextAction: mocks.extractLeadFromNaturalTextAction,
  fetchLeadsAction: mocks.fetchLeadsAction,
  updateLeadStatusAction: mocks.updateLeadStatusAction,
}));

vi.mock("@/platform/auth/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));

import { POST } from "./route";

describe("NAIA orchestrate route", () => {
  beforeEach(() => {
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("NAIA_ACTION_APPROVAL_SECRET", "test-secret");
    mocks.fetchLeadsAction.mockResolvedValue([]);
    mocks.extractLeadFromNaturalTextAction.mockResolvedValue({
      extracted: {
        companyName: "HPS",
        contactName: "Abdeslam El-Alawi",
        nextAction: "Qualifier le besoin et confirmer le prochain rendez-vous",
        notes:
          "Discussions déjà entamées avec Mistral et demande d'aide sur un LLM local.",
        source: "NAIA",
        status: "lead-to-contact",
        topic: "IA on Mistral",
      },
      success: true,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("keeps spoken contact intent over a generic extracted lead status", async () => {
    const response = await POST(
      new Request("http://localhost/api/naia/orchestrate", {
        body: JSON.stringify({
          command:
            "J'ai parlé à Abdeslam El-Alawi de HPS. Il veut développer des solutions IA sur le LLM de Mistral.",
        }),
        method: "POST",
      }),
    );
    const body = await response.json();
    const createLeadAction = body.actions.find(
      (action: { kind: string }) => action.kind === "crm.createLead",
    );

    expect(createLeadAction.payload.status).toBe("contacted");
    expect(body.response).toContain("pré-rempli");
    expect(body.response).toContain("Valider et créer le lead");
  });

  it("returns accented French wording after validating a CRM lead", async () => {
    vi.stubEnv("NODE_ENV", "development");
    mocks.createLeadAction.mockResolvedValue({
      calendarSynced: false,
      lead: { id: "lead-hps" },
      success: true,
    });

    const draftResponse = await POST(
      new Request("http://localhost/api/naia/orchestrate", {
        body: JSON.stringify({
          command:
            "J'ai contacté Abdeslam El-Alawi de HPS. Il veut développer des solutions IA sur le LLM de Mistral.",
        }),
        method: "POST",
      }),
    );
    const draftBody = await draftResponse.json();
    const createLeadAction = draftBody.actions.find(
      (action: { kind: string }) => action.kind === "crm.createLead",
    );

    const executeResponse = await POST(
      new Request("http://localhost/api/naia/orchestrate", {
        body: JSON.stringify({
          actionId: createLeadAction.id,
          approvalToken: createLeadAction.approvalToken,
          command:
            "J'ai contacté Abdeslam El-Alawi de HPS. Il veut développer des solutions IA sur le LLM de Mistral.",
          execute: true,
          leadInput: createLeadAction.payload,
        }),
        method: "POST",
      }),
    );
    const executeBody = await executeResponse.json();

    expect(executeBody.message).toBe("Lead CRM créé.");
  });
});
