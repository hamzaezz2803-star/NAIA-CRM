import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createLeadAction: vi.fn(),
  createTagAction: vi.fn(),
  extractLeadFromNaturalTextAction: vi.fn(),
  fetchLeadsAction: vi.fn(),
  fetchTagsAction: vi.fn(),
  generateMayaPitchDraftForLeadAction: vi.fn(),
  listGmailMessages: vi.fn(),
  listGoogleCalendarEvents: vi.fn(),
  updateLeadStatusAction: vi.fn(),
}));

vi.mock("@/features/crm/actions", () => ({
  createLeadAction: mocks.createLeadAction,
  createTagAction: mocks.createTagAction,
  extractLeadFromNaturalTextAction: mocks.extractLeadFromNaturalTextAction,
  fetchLeadsAction: mocks.fetchLeadsAction,
  fetchTagsAction: mocks.fetchTagsAction,
  updateLeadStatusAction: mocks.updateLeadStatusAction,
}));

vi.mock("@/platform/auth/supabase-server", () => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock("@/features/maya/actions", () => ({
  generateMayaPitchDraftForLeadAction:
    mocks.generateMayaPitchDraftForLeadAction,
}));

vi.mock("@/platform/integrations/google-workspace", () => ({
  listGmailMessages: mocks.listGmailMessages,
  listGoogleCalendarEvents: mocks.listGoogleCalendarEvents,
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
    mocks.fetchTagsAction.mockResolvedValue([
      { color: "teal", id: "tag-crm", name: "CRM", organizationId: "org" },
    ]);
    mocks.generateMayaPitchDraftForLeadAction.mockResolvedValue({
      draftFileName:
        "20260708_Qarizmi_Introduction_Service as a software_HPS_vDraft.pptx",
      draftFilePath:
        "/tmp/HPS/Pitch/20260708_Qarizmi_Introduction_Service as a software_HPS_vDraft.pptx",
      manifestPath: "/tmp/HPS/Pitch/maya-generation-manifest.json",
      success: true,
    });
    mocks.createTagAction.mockImplementation(async (name: string) => ({
      success: true,
      tag: { color: "blue", id: `tag-${name.toLowerCase()}`, name },
    }));
    mocks.listGmailMessages.mockResolvedValue([
      {
        from: "nabil@qarizmi.com",
        id: "gmail-1",
        subject: "Demo client",
      },
    ]);
    mocks.listGoogleCalendarEvents.mockResolvedValue([
      {
        id: "event-1",
        start: "2026-07-07T09:00:00.000Z",
        title: "Point client",
      },
    ]);
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

  it("keeps NAIA in charge for capability questions even when Groq is configured", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/naia/orchestrate", {
        body: JSON.stringify({
          command: "que sais tu faire ?",
        }),
        method: "POST",
      }),
    );
    const body = await response.json();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(body.agent.id).toBe("naia");
    expect(body.actions).toHaveLength(0);
    expect(body.response).toContain("Je peux");
    expect(body.response).not.toContain("Salma");
  });

  it("sends operating context to Groq and allows general non-action answers", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                agentId: "naia",
                confidence: 0.84,
                response:
                  "Un LLM est un modele de langage capable de comprendre et generer du texte.",
              }),
            },
          },
        ],
      }),
      ok: true,
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/naia/orchestrate", {
        body: JSON.stringify({
          command: "c'est quoi un LLM ?",
        }),
        method: "POST",
      }),
    );
    const body = await response.json();
    const groqRequest = JSON.parse(fetchMock.mock.calls[0][1].body);
    const systemPrompt = groqRequest.messages[0].content;
    const userPrompt = JSON.parse(groqRequest.messages[1].content);

    expect(body.agent.id).toBe("naia");
    expect(body.actions).toHaveLength(0);
    expect(body.response).toContain("modele de langage");
    expect(systemPrompt).toContain("question generale");
    expect(systemPrompt).toContain("sans pretendre avoir execute");
    expect(systemPrompt).toContain("realGoogleCalendar");
    expect(systemPrompt).toContain("priment");
    expect(userPrompt.operatingContext.cashFlow).toContain("Oct.");
    expect(userPrompt.operatingContext.pipeline).toContain("Atlas Process");
    expect(userPrompt.operatingContext.projects).toContain("Sahara Logistics");
    expect(userPrompt.operatingContext.staffing).toContain(
      "Full-stack Next.js",
    );
    expect(userPrompt.operatingContext.followUps).toContain("Medina Health");
    expect(mocks.listGoogleCalendarEvents).toHaveBeenCalledWith({
      daysAhead: 7,
      maxResults: 15,
    });
    expect(userPrompt.realGoogleCalendar).toContain(
      "Agenda Google réel de l'utilisateur",
    );
    expect(userPrompt.realGoogleCalendar).toContain("Point client");
  });

  it("keeps Groq orchestration working when the user has no Google connection", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    mocks.listGoogleCalendarEvents.mockRejectedValue(
      new Error("Google Workspace is not connected for this user."),
    );
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                agentId: "naia",
                confidence: 0.8,
                response: "Reponse generale sans agenda.",
              }),
            },
          },
        ],
      }),
      ok: true,
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/naia/orchestrate", {
        body: JSON.stringify({
          command: "c'est quoi un LLM ?",
        }),
        method: "POST",
      }),
    );
    const body = await response.json();
    const userPrompt = JSON.parse(
      JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content,
    );

    expect(body.mode).toBe("groq-orchestrated");
    expect(body.agent.id).toBe("naia");
    expect(userPrompt.realGoogleCalendar).toBeUndefined();
  });

  it("degrades to CRM-only context when the Google Calendar fetch stalls", async () => {
    vi.useFakeTimers();
    try {
      vi.stubEnv("GROQ_API_KEY", "test-groq-key");
      mocks.listGoogleCalendarEvents.mockReturnValue(new Promise(() => {}));
      const fetchMock = vi.fn().mockResolvedValue({
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  agentId: "naia",
                  confidence: 0.8,
                  response: "Reponse generale sans agenda.",
                }),
              },
            },
          ],
        }),
        ok: true,
      });
      vi.stubGlobal("fetch", fetchMock);

      const responsePromise = POST(
        new Request("http://localhost/api/naia/orchestrate", {
          body: JSON.stringify({
            command: "c'est quoi un LLM ?",
          }),
          method: "POST",
        }),
      );
      await vi.advanceTimersByTimeAsync(2500);
      const body = await (await responsePromise).json();
      const userPrompt = JSON.parse(
        JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content,
      );

      expect(body.mode).toBe("groq-orchestrated");
      expect(userPrompt.realGoogleCalendar).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
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

  it("normalizes client-provided tag strings before creating a lead", async () => {
    vi.stubEnv("NODE_ENV", "development");
    mocks.createLeadAction.mockResolvedValue({
      lead: { id: "lead-tags" },
      success: true,
    });

    const draftResponse = await POST(
      new Request("http://localhost/api/naia/orchestrate", {
        body: JSON.stringify({
          command: "Ajoute un lead CRM pour Atlas autour de l'IA.",
        }),
        method: "POST",
      }),
    );
    const draftBody = await draftResponse.json();
    const createLeadAction = draftBody.actions.find(
      (action: { kind: string }) => action.kind === "crm.createLead",
    );

    await POST(
      new Request("http://localhost/api/naia/orchestrate", {
        body: JSON.stringify({
          actionId: createLeadAction.id,
          approvalToken: createLeadAction.approvalToken,
          command: "Ajoute un lead CRM pour Atlas autour de l'IA.",
          execute: true,
          leadInput: {
            ...createLeadAction.payload,
            tags: "CRM, IA, CRM",
          },
        }),
        method: "POST",
      }),
    );

    expect(mocks.createLeadAction).toHaveBeenCalledWith(
      expect.objectContaining({
        tagIds: ["tag-crm", "tag-ia"],
      }),
    );
  });

  it("executes an approved Gmail read action", async () => {
    const command = "NAIA lis mes emails Gmail non lus";
    const draftResponse = await POST(
      new Request("http://localhost/api/naia/orchestrate", {
        body: JSON.stringify({ command }),
        method: "POST",
      }),
    );
    const draftBody = await draftResponse.json();
    const gmailAction = draftBody.actions.find(
      (action: { kind: string }) => action.kind === "google.gmail.listMessages",
    );

    const executeResponse = await POST(
      new Request("http://localhost/api/naia/orchestrate", {
        body: JSON.stringify({
          actionId: gmailAction.id,
          approvalToken: gmailAction.approvalToken,
          command,
          execute: true,
        }),
        method: "POST",
      }),
    );
    const executeBody = await executeResponse.json();

    expect(mocks.listGmailMessages).toHaveBeenCalledWith({
      maxResults: 10,
      unreadOnly: true,
    });
    expect(executeBody.execution).toBe("applied");
    expect(executeBody.providerResult.messages).toHaveLength(1);
  });

  it("executes an approved Calendar read action", async () => {
    const command = "NAIA check mon agenda demain matin";
    const draftResponse = await POST(
      new Request("http://localhost/api/naia/orchestrate", {
        body: JSON.stringify({ command }),
        method: "POST",
      }),
    );
    const draftBody = await draftResponse.json();
    const calendarAction = draftBody.actions.find(
      (action: { kind: string }) =>
        action.kind === "google.calendar.listEvents",
    );

    const executeResponse = await POST(
      new Request("http://localhost/api/naia/orchestrate", {
        body: JSON.stringify({
          actionId: calendarAction.id,
          approvalToken: calendarAction.approvalToken,
          command,
          execute: true,
        }),
        method: "POST",
      }),
    );
    const executeBody = await executeResponse.json();

    expect(mocks.listGoogleCalendarEvents).toHaveBeenCalledWith({
      daysAhead: 1,
      maxResults: 10,
    });
    expect(executeBody.execution).toBe("applied");
    expect(executeBody.providerResult.events).toHaveLength(1);
  });

  it("executes an approved Maya pitch draft action", async () => {
    mocks.fetchLeadsAction.mockResolvedValue([
      {
        companyName: "HPS",
        contactName: "Abdeslam El-Alawi",
        createdAt: "2026-07-02T10:00:00.000Z",
        id: "lead-hps",
        notes: "Besoin IA autour du LLM de Mistral.",
        organizationId: "org-1",
        status: "meeting-booked",
        topic: "HPS - LLM local",
        updatedAt: "2026-07-02T10:00:00.000Z",
      },
    ]);
    const command = "Maya prépare le pitch pour HPS";
    const draftResponse = await POST(
      new Request("http://localhost/api/naia/orchestrate", {
        body: JSON.stringify({ command }),
        method: "POST",
      }),
    );
    const draftBody = await draftResponse.json();
    const pitchAction = draftBody.actions.find(
      (action: { kind: string }) => action.kind === "pitch.generateDraft",
    );

    const executeResponse = await POST(
      new Request("http://localhost/api/naia/orchestrate", {
        body: JSON.stringify({
          actionId: pitchAction.id,
          approvalToken: pitchAction.approvalToken,
          command,
          execute: true,
        }),
        method: "POST",
      }),
    );
    const executeBody = await executeResponse.json();

    expect(mocks.generateMayaPitchDraftForLeadAction).toHaveBeenCalledWith(
      "lead-hps",
    );
    expect(executeBody.execution).toBe("applied");
    expect(executeBody.message).toContain("Pitch Maya généré");
    expect(executeBody.providerResult.draftFileName).toContain("HPS");
  });
});
