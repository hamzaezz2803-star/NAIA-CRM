import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  inspectGoogleWorkspaceCapabilities: vi.fn(),
  listGmailMessages: vi.fn(),
  listGoogleCalendarEvents: vi.fn(),
  loadNaiaPrivateKnowledge: vi.fn(),
}));

vi.mock("@/platform/integrations/google-workspace", () => ({
  inspectGoogleWorkspaceCapabilities: mocks.inspectGoogleWorkspaceCapabilities,
  listGmailMessages: mocks.listGmailMessages,
  listGoogleCalendarEvents: mocks.listGoogleCalendarEvents,
}));

vi.mock("@/platform/naia/private-knowledge", () => ({
  loadNaiaPrivateKnowledge: mocks.loadNaiaPrivateKnowledge,
}));

import type { CrmLeadSummary } from "@/features/crm/contracts";
import type { GoogleWorkspaceContext } from "@/platform/integrations/google-workspace";

import { planNaiaAssistant } from "./assistant";

const actor = {
  email: "ali@qarizmi.com",
  name: "Ali EL ABBASSY",
  organizationName: "Qarizmi",
  role: "owner" as const,
};

const googleContext = {
  organizationId: "org-1",
  profileId: "profile-ali",
  supabase: {} as GoogleWorkspaceContext["supabase"],
};

const crmLeads: CrmLeadSummary[] = [
  {
    companyName: "HPS",
    contactName: "Abdeslam",
    createdAt: "2026-07-01T10:00:00.000Z",
    id: "lead-hps",
    notes:
      "[Google Calendar Event ID: evt-crm]\n[Google Calendar Event Link: https://calendar.google.com/event?eid=crm]",
    organizationId: "org-1",
    status: "meeting-booked",
    topic: "HPS - LLM local",
    updatedAt: "2026-07-01T10:00:00.000Z",
  },
];

describe("NAIA personal context answers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GROQ_API_KEY", "");
    mocks.loadNaiaPrivateKnowledge.mockResolvedValue(undefined);
    mocks.inspectGoogleWorkspaceCapabilities.mockResolvedValue({
      accountLabel: "ali@qarizmi.com",
      calendar: true,
      connected: true,
      gmail: true,
    });
    mocks.listGoogleCalendarEvents.mockResolvedValue([
      {
        htmlLink: "https://calendar.google.com/event?eid=crm",
        id: "evt-crm",
        start: "2026-07-13T11:00:00+01:00",
        title: "Meeting HPS",
      },
      {
        htmlLink: "https://calendar.google.com/event?eid=internal",
        id: "evt-internal",
        start: "2026-07-14T09:00:00+01:00",
        title: "Weekly Qarizmi",
      },
    ]);
    mocks.listGmailMessages.mockResolvedValue([
      {
        date: "2026-07-10T09:00:00.000Z",
        from: "client@example.com",
        id: "mail-1",
        subject: "Urgent - validation contrat",
      },
    ]);
  });

  it("answers who the Slack user is from the resolved Qarizmi profile", async () => {
    const { result } = await planNaiaAssistant({
      actor,
      command: "qui suis-je ?",
      crmLeads,
      googleContext,
    });

    expect(result.actions).toHaveLength(0);
    expect(result.agent.id).toBe("naia");
    expect(result.response).toContain("Ali EL ABBASSY");
    expect(result.response).toContain("ali@qarizmi.com");
    expect(result.response).toContain("propriétaire");
  });

  it("enriches the authenticated cofounder's identity from the private deck", async () => {
    mocks.loadNaiaPrivateKnowledge.mockResolvedValue({
      actorProfile:
        "Ali El Abbassy — Co-founder, Head of Technology. École Polytechnique, HEC Paris, Roland Berger et Artefact.",
      snippets: [],
      sourceFileName: "Qarizmi_Generic.pptx",
      sourceModifiedAt: "2026-07-13T10:00:00.000Z",
    });

    const { result } = await planNaiaAssistant({
      actor,
      command: "que sais-tu sur moi ?",
      crmLeads,
      googleContext,
    });

    expect(mocks.loadNaiaPrivateKnowledge).toHaveBeenCalledWith({
      actor,
      allowPersonalData: true,
      command: "que sais-tu sur moi ?",
    });
    expect(result.response).toContain("Head of Technology");
    expect(result.response).toContain("dernier deck générique Qarizmi");
  });

  it("explains who NAIA is without exposing actor details", async () => {
    const { result } = await planNaiaAssistant({
      actor,
      command: "qui es-tu ?",
      crmLeads,
      googleContext,
    });

    expect(result.response).toContain("Je suis NAIA");
    expect(result.response).not.toContain(actor.email);
  });

  it("reads the real Google Calendar for the coming week", async () => {
    const { result } = await planNaiaAssistant({
      actor,
      command: "quels sont mes meetings de la semaine ?",
      crmLeads,
      googleContext,
    });

    expect(mocks.listGoogleCalendarEvents).toHaveBeenCalledWith(
      { daysAhead: 7, maxResults: 20 },
      googleContext,
    );
    expect(result.actions).toHaveLength(0);
    expect(result.agent.id).toBe("meetings");
    expect(result.response).toContain("Meeting HPS");
    expect(result.response).toContain("Weekly Qarizmi");
  });

  it("queries the complete Casablanca day for tomorrow", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));

    try {
      const { result } = await planNaiaAssistant({
        actor,
        command: "quels sont mes meetings demain ?",
        crmLeads,
        googleContext,
      });

      expect(mocks.listGoogleCalendarEvents).toHaveBeenCalledWith(
        {
          daysAhead: 1,
          maxResults: 20,
          timeMax: "2026-07-11T23:00:00.000Z",
          timeMin: "2026-07-10T23:00:00.000Z",
        },
        googleContext,
      );
      expect(result.response).toContain("demain");
    } finally {
      vi.useRealTimers();
    }
  });

  it("excludes Calendar events already linked to CRM when requested", async () => {
    const { result } = await planNaiaAssistant({
      actor,
      command: "et les meetings de mon calendar hors CRM ?",
      crmLeads,
      googleContext,
    });

    expect(result.response).not.toContain("Meeting HPS");
    expect(result.response).toContain("Weekly Qarizmi");
    expect(result.response).toContain("hors événements déjà reliés au CRM");
  });

  it("keeps a contextual Calendar follow-up on the previous source", async () => {
    const { result } = await planNaiaAssistant({
      actor,
      command: "et ceux hors CRM ?",
      crmLeads,
      googleContext,
      history: [
        {
          content: "quels sont mes meetings de la semaine ?",
          role: "user",
        },
        { content: "Deux événements.", role: "assistant" },
      ],
    });

    expect(result.response).not.toContain("Meeting HPS");
    expect(result.response).toContain("Weekly Qarizmi");
  });

  it("moves a hors-CRM follow-up from CRM to Google Calendar", async () => {
    const { result } = await planNaiaAssistant({
      actor,
      command: "et ceux hors CRM ?",
      crmLeads,
      googleContext,
      history: [
        { content: "quels sont mes meetings CRM ?", role: "user" },
        { content: "Un meeting CRM.", role: "assistant" },
      ],
    });

    expect(mocks.listGoogleCalendarEvents).toHaveBeenCalled();
    expect(result.agent.id).toBe("meetings");
    expect(result.response).not.toContain("Meeting HPS");
    expect(result.response).toContain("Weekly Qarizmi");
  });

  it("answers CRM meeting questions from CRM without reading Calendar", async () => {
    const { result } = await planNaiaAssistant({
      actor,
      command: "quels sont mes meetings CRM ?",
      crmLeads,
      googleContext,
    });

    expect(mocks.listGoogleCalendarEvents).not.toHaveBeenCalled();
    expect(result.agent.id).toBe("crm");
    expect(result.response).toContain("HPS");
    expect(result.response).toContain("1 lead est au statut Meeting fixé");
  });

  it.each(["as-tu accès à mes mails ?", "peux-tu consulter mon gmail ?"])(
    "answers Gmail connection status for %s",
    async (command) => {
      const { result } = await planNaiaAssistant({
        actor,
        command,
        crmLeads,
        googleContext,
      });

      expect(mocks.inspectGoogleWorkspaceCapabilities).toHaveBeenCalledWith(
        googleContext,
      );
      expect(mocks.listGmailMessages).not.toHaveBeenCalled();
      expect(result.actions).toHaveLength(0);
      expect(result.agent.id).toBe("integrations");
      expect(result.response).toContain("Gmail en lecture");
    },
  );

  it("reads urgent Gmail messages directly from the connected account", async () => {
    const { result } = await planNaiaAssistant({
      actor,
      command: "quels sont mes mails urgents ?",
      crmLeads,
      googleContext,
    });

    expect(mocks.listGmailMessages).toHaveBeenCalledWith(
      {
        maxResults: 10,
        query:
          "is:unread newer_than:14d {label:important subject:urgent subject:important}",
        unreadOnly: true,
      },
      googleContext,
    );
    expect(result.actions).toHaveLength(0);
    expect(result.agent.id).toBe("integrations");
    expect(result.response).toContain("Urgent - validation contrat");
    expect(result.response).toContain("client@example.com");
  });

  it("returns an actionable reconnect answer when Google is unavailable", async () => {
    mocks.inspectGoogleWorkspaceCapabilities.mockResolvedValue({
      calendar: false,
      connected: false,
      error: "Google Workspace token needs reconnecting.",
      gmail: false,
    });

    const { result } = await planNaiaAssistant({
      actor,
      command: "as-tu accès à mes mails ?",
      crmLeads,
      googleContext,
    });

    expect(result.response).toContain("n'est pas utilisable");
    expect(result.response).toContain("/integrations");
  });

  it("does not read or expose personal data in a shared channel", async () => {
    const { result } = await planNaiaAssistant({
      actor,
      allowPersonalData: false,
      command: "quels sont mes mails urgents ?",
      crmLeads,
      googleContext,
    });

    expect(mocks.listGmailMessages).not.toHaveBeenCalled();
    expect(mocks.inspectGoogleWorkspaceCapabilities).not.toHaveBeenCalled();
    expect(mocks.loadNaiaPrivateKnowledge).not.toHaveBeenCalled();
    expect(result.response).toContain("message privé");
    expect(result.response).not.toContain(actor.email);
  });

  it("does not expose CRM lead details in a shared channel", async () => {
    const { result } = await planNaiaAssistant({
      actor,
      allowPersonalData: false,
      command: "combien de leads sont en meeting booked ?",
      crmLeads,
      googleContext,
    });

    expect(result.actions).toHaveLength(0);
    expect(result.response).toContain("message privé");
    expect(result.response).not.toContain("HPS");
    expect(result.response).not.toContain("Abdeslam");
  });

  it("does not send CRM or Calendar context to Groq from a shared channel", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                agentId: "naia",
                confidence: 0.9,
                response: "Un LLM traite et génère du langage.",
              }),
            },
          },
        ],
      }),
      ok: true,
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      await planNaiaAssistant({
        actor,
        allowPersonalData: false,
        command: "Explique simplement ce qu'est un LLM",
        crmLeads,
        googleContext,
        history: [{ content: "Le meeting HPS est demain.", role: "assistant" }],
        privateKnowledge: {
          actorProfile: "CONTEXTE PRIVE",
          snippets: [],
          sourceFileName: "Qarizmi_Generic.pptx",
          sourceModifiedAt: "2026-07-13T10:00:00.000Z",
        },
      });

      const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      const userContext = JSON.parse(requestBody.messages[1].content);
      expect(userContext.conversationHistory).toEqual([]);
      expect(userContext.crmSnapshot).toEqual([]);
      expect(userContext.contextSources.crm).toBe(
        "not loaded on shared surfaces",
      );
      expect(userContext.contextSources.qarizmiKnowledge).toBe("not loaded");
      expect(userContext.privateKnowledge).toBeUndefined();
      expect(userContext.realGoogleCalendar).toBeUndefined();
      expect(mocks.listGoogleCalendarEvents).not.toHaveBeenCalled();
      expect(mocks.loadNaiaPrivateKnowledge).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not load the private deck for an unrelated general question", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                agentId: "naia",
                confidence: 0.9,
                response: "Paris est la capitale de la France.",
              }),
            },
          },
        ],
      }),
      ok: true,
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      await planNaiaAssistant({
        actor,
        command: "Quelle est la capitale de la France ?",
        crmLeads,
        googleContext,
      });

      expect(mocks.loadNaiaPrivateKnowledge).not.toHaveBeenCalled();
      const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      const userContext = JSON.parse(requestBody.messages[1].content);
      expect(userContext.privateKnowledge).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not load company knowledge when Groq is unavailable", async () => {
    await planNaiaAssistant({
      actor,
      command: "Que sais-tu sur Qarizmi ?",
      crmLeads,
      googleContext,
    });

    expect(mocks.loadNaiaPrivateKnowledge).not.toHaveBeenCalled();
  });

  it("sends only bounded private-deck snippets to Groq in an owner DM", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    const privateKnowledge = {
      snippets: [
        {
          section: "presentation",
          slideNumber: 6,
          text: "Qarizmi combine stratégie, exécution et pilotage ROI.",
        },
      ],
      sourceFileName: "Qarizmi_Generic.pptx",
      sourceModifiedAt: "2026-07-13T10:00:00.000Z",
    };
    mocks.loadNaiaPrivateKnowledge.mockResolvedValue(privateKnowledge);
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                agentId: "naia",
                confidence: 0.95,
                response: "Qarizmi combine stratégie et exécution.",
              }),
            },
          },
        ],
      }),
      ok: true,
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const { result } = await planNaiaAssistant({
        actor,
        command: "Que sais-tu sur Qarizmi ?",
        crmLeads,
        googleContext,
      });

      expect(mocks.loadNaiaPrivateKnowledge).toHaveBeenCalledWith({
        actor,
        allowPersonalData: true,
        command: "Que sais-tu sur Qarizmi ?",
      });
      const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      const userContext = JSON.parse(requestBody.messages[1].content);
      expect(userContext.privateKnowledge).toEqual(privateKnowledge);
      expect(userContext.contextSources.qarizmiKnowledge).toContain(
        "Qarizmi_Generic.pptx",
      );
      expect(result.response).toContain("stratégie et exécution");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
