import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumedInsert: vi.fn(),
  consumedPurge: vi.fn(),
  createGoogleCalendarReminder: vi.fn(),
  createLeadAction: vi.fn(),
  createServiceRoleSupabaseClient: vi.fn(),
  extractLeadFromNaturalTextAction: vi.fn(),
  inspectGoogleWorkspaceCapabilities: vi.fn(),
  listGmailMessages: vi.fn(),
  listGoogleCalendarEvents: vi.fn(),
  updateLeadStatusAction: vi.fn(),
}));

vi.mock("@/features/crm/actions", () => ({
  createLeadAction: mocks.createLeadAction,
  extractLeadFromNaturalTextAction: mocks.extractLeadFromNaturalTextAction,
  updateLeadStatusAction: mocks.updateLeadStatusAction,
}));

vi.mock("@/platform/integrations/google-workspace", () => ({
  createGoogleCalendarReminder: mocks.createGoogleCalendarReminder,
  inspectGoogleWorkspaceCapabilities: mocks.inspectGoogleWorkspaceCapabilities,
  listGmailMessages: mocks.listGmailMessages,
  listGoogleCalendarEvents: mocks.listGoogleCalendarEvents,
}));

vi.mock("@/platform/auth/supabase-server", () => ({
  createServiceRoleSupabaseClient: mocks.createServiceRoleSupabaseClient,
}));

import type { NaiaActionDraft } from "@/features/naia/orchestrator";
import type { CrmLeadDraft } from "@/features/crm/contracts";
import { signAction } from "@/platform/naia/action-tokens";

import {
  executeBridgeAction,
  planBridgeCommand,
  type NaiaBridgeUser,
} from "./bridge";

const bridgeUser: NaiaBridgeUser = {
  email: "ali@qarizmi.com",
  fullName: "Ali",
  organizationId: "org-1",
  profileId: "profile-ali",
  role: "owner",
};

const gmailAction: NaiaActionDraft = {
  agentId: "integrations",
  approvalRequired: true,
  description: "Lecture Gmail limitee",
  id: "gmail-list-abc123",
  kind: "google.gmail.listMessages",
  label: "Lire Gmail",
  payload: {
    maxResults: 10,
    unreadOnly: true,
  },
  risk: "low",
};

const sparseCrmCreateAction: NaiaActionDraft = {
  agentId: "crm",
  approvalRequired: true,
  description: "Salma creera un lead avec le texte de la commande.",
  id: "crm-create-hps",
  kind: "crm.createLead",
  label: "Creer le lead CRM",
  payload: {
    nextAction: "Preparer le meeting et confirmer le contexte avec le contact",
    notes:
      "`@NAIA crée un lead pour HPS avec Abdeslam, meeting vendredi à 11h`",
    source: "NAIA",
    status: "meeting-booked",
    topic:
      "`@NAIA crée un lead pour HPS avec Abdeslam, meeting vendredi à 11h`",
  },
  risk: "medium",
};

const hydratedCrmCreateAction: NaiaActionDraft = {
  ...sparseCrmCreateAction,
  payload: {
    companyName: "HPS",
    contactName: "Abdeslam",
    leadDate: "2026-07-10T11:00:00",
    nextAction: "Préparer le meeting avec Abdeslam",
    notes:
      "Meeting demandé vendredi à 11h.\nCommande NAIA: crée un lead pour HPS avec Abdeslam, meeting vendredi à 11h",
    source: "Slack",
    status: "meeting-booked",
    topic: "Meeting HPS",
  },
};

function fakeServiceRoleClient({
  cofounderError = null,
  isCofounder = true,
  leads = [],
}: {
  cofounderError?: unknown;
  isCofounder?: boolean;
  leads?: unknown[];
} = {}) {
  const crmEq = vi.fn(() => crmQuery);
  const crmQuery = {
    eq: crmEq,
    is: () => crmQuery,
    limit: vi.fn().mockResolvedValue({ data: leads, error: null }),
    order: () => crmQuery,
    select: () => crmQuery,
  };

  return {
    crmEq,
    rpc: vi
      .fn()
      .mockResolvedValue({ data: isCofounder, error: cofounderError }),
    from: vi.fn((table: string) => {
      if (table === "crm_leads") {
        return crmQuery;
      }

      if (table === "naia_consumed_action_tokens") {
        return {
          delete: () => ({ lt: mocks.consumedPurge }),
          insert: mocks.consumedInsert,
        };
      }

      throw new Error(`Unexpected table in test: ${table}`);
    }),
  };
}

describe("executeBridgeAction single-use approval tokens", () => {
  beforeEach(() => {
    vi.stubEnv("NAIA_ACTION_APPROVAL_SECRET", "test-secret");
    mocks.consumedPurge.mockResolvedValue({ error: null });
    mocks.consumedInsert.mockResolvedValue({ error: null });
    mocks.createServiceRoleSupabaseClient.mockReturnValue(
      fakeServiceRoleClient(),
    );
    mocks.listGmailMessages.mockResolvedValue([
      { from: "nabil@qarizmi.com", id: "gmail-1", subject: "Demo client" },
    ]);
    mocks.listGoogleCalendarEvents.mockResolvedValue([
      {
        id: "event-weekly",
        start: "2026-07-14T09:00:00+01:00",
        title: "Weekly Qarizmi",
      },
    ]);
    mocks.inspectGoogleWorkspaceCapabilities.mockResolvedValue({
      accountLabel: "ali@qarizmi.com",
      calendar: true,
      connected: true,
      gmail: true,
    });
    mocks.createGoogleCalendarReminder.mockResolvedValue({
      htmlLink: "https://calendar.google.com/reminder",
      id: "reminder-1",
      start: "2026-07-11T09:00:00",
      title: "Envoyer la présentation",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("executes once, then rejects the second claim of the same token", async () => {
    const command = "NAIA lis mes emails gmail non lus";
    const signed = signAction(gmailAction, command);
    const draft = {
      actionId: gmailAction.id,
      approvalToken: signed.approvalToken,
      command,
    };

    const first = await executeBridgeAction(bridgeUser, draft);

    expect(first.success).toBe(true);
    expect(mocks.consumedInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: "org-1",
        token_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
    expect(mocks.listGmailMessages).toHaveBeenCalledTimes(1);

    // The second claim hits the primary key: no side effect may run.
    mocks.consumedInsert.mockResolvedValue({ error: { code: "23505" } });

    const second = await executeBridgeAction(bridgeUser, draft);

    expect(second.success).toBe(false);
    expect(second.message).toBe("Cette action a déjà été validée.");
    expect(mocks.listGmailMessages).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the claim cannot be registered", async () => {
    mocks.consumedInsert.mockResolvedValue({
      error: { code: "42P01", message: "missing table" },
    });

    const command = "NAIA lis mes emails gmail non lus";
    const signed = signAction(gmailAction, command);

    const result = await executeBridgeAction(bridgeUser, {
      actionId: gmailAction.id,
      approvalToken: signed.approvalToken,
      command,
    });

    expect(result.success).toBe(false);
    expect(mocks.listGmailMessages).not.toHaveBeenCalled();
  });

  it("rejects an invalid token before touching the claims table", async () => {
    const result = await executeBridgeAction(bridgeUser, {
      actionId: gmailAction.id,
      approvalToken: "forged.token",
      command: "NAIA lis mes emails gmail non lus",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("invalide ou expiré");
    expect(mocks.consumedInsert).not.toHaveBeenCalled();
    expect(mocks.listGmailMessages).not.toHaveBeenCalled();
  });

  it("hydrates sparse Slack CRM lead drafts before signing approval tokens", async () => {
    mocks.extractLeadFromNaturalTextAction.mockResolvedValue({
      extracted: {
        companyName: "HPS",
        contactName: "Abdeslam",
        leadDate: "2026-07-10T11:00:00",
        nextAction: "Préparer le meeting avec Abdeslam",
        notes: "Meeting demandé vendredi à 11h.",
        source: "Slack",
        status: "meeting-booked",
        topic: "Meeting HPS",
      },
      success: true,
    });

    const plan = await planBridgeCommand(
      bridgeUser,
      "`@NAIA crée un lead pour HPS avec Abdeslam, meeting vendredi à 11h`",
    );

    expect(plan.command).toBe(
      "crée un lead pour HPS avec Abdeslam, meeting vendredi à 11h",
    );
    expect(mocks.extractLeadFromNaturalTextAction).toHaveBeenCalledWith(
      "crée un lead pour HPS avec Abdeslam, meeting vendredi à 11h",
    );
    expect(plan.actions).toHaveLength(1);
    expect(plan.response).toContain("Adam");
    expect(plan.actions[0]).toMatchObject({
      kind: "crm.createLead",
      payload: {
        companyName: "HPS",
        contactName: "Abdeslam",
        leadDate: "2026-07-10T11:00:00",
        nextAction: "Préparer le meeting avec Abdeslam",
        source: "Slack",
        status: "meeting-booked",
        topic: "Meeting HPS",
      },
    });
    expect(plan.actions[0].approvalToken).toEqual(expect.any(String));
  });

  it("uses the shared assistant for open questions on Slack", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                agentId: "naia",
                confidence: 0.92,
                response:
                  "Un LLM est un modèle de langage capable de comprendre et générer du texte.",
              }),
            },
          },
        ],
      }),
      ok: true,
    });
    vi.stubGlobal("fetch", fetchMock);

    const plan = await planBridgeCommand(
      bridgeUser,
      "Peux-tu m'expliquer simplement ce qu'est un LLM ?",
    );

    expect(plan.mode).toBe("groq-orchestrated");
    expect(plan.responseType).toBe("answer");
    expect(plan.actions).toHaveLength(0);
    expect(plan.response).toContain("modèle de langage");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("answers identity questions from the resolved Slack user", async () => {
    const plan = await planBridgeCommand(bridgeUser, "qui suis-je ?");

    expect(plan.actions).toHaveLength(0);
    expect(plan.agentName).toBe("NAIA");
    expect(plan.response).toContain("Ali");
    expect(plan.response).toContain("ali@qarizmi.com");
    expect(plan.response).toContain("propriétaire");
  });

  it("fails closed before a service-role CRM read when founder validation errors", async () => {
    const client = fakeServiceRoleClient({
      cofounderError: { message: "RPC unavailable" },
    });
    mocks.createServiceRoleSupabaseClient.mockReturnValue(client);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await planBridgeCommand(bridgeUser, "qui suis-je ?");

    expect(client.rpc).toHaveBeenCalledWith(
      "crm_bridge_actor_is_cofounder",
      expect.objectContaining({
        target_organization_id: bridgeUser.organizationId,
        target_profile_id: bridgeUser.profileId,
      }),
    );
    expect(client.from).not.toHaveBeenCalledWith("crm_leads");
    consoleError.mockRestore();
  });

  it("restricts non-cofounder service-role reads to organization rows", async () => {
    const client = fakeServiceRoleClient({ isCofounder: false });
    mocks.createServiceRoleSupabaseClient.mockReturnValue(client);

    await planBridgeCommand(
      {
        ...bridgeUser,
        email: "member@example.test",
        profileId: "profile-member",
        role: "member",
      },
      "qui suis-je ?",
    );

    expect(client.crmEq).toHaveBeenCalledWith("access_scope", "organization");
  });

  it("reads the acting user's Calendar directly from Slack", async () => {
    const plan = await planBridgeCommand(
      bridgeUser,
      "quels sont mes meetings de la semaine ?",
    );

    expect(mocks.listGoogleCalendarEvents).toHaveBeenCalledWith(
      { daysAhead: 7, maxResults: 20 },
      expect.objectContaining({
        organizationId: "org-1",
        profileId: "profile-ali",
      }),
    );
    expect(plan.actions).toHaveLength(0);
    expect(plan.agentName).toBe("Adam");
    expect(plan.response).toContain("Weekly Qarizmi");
  });

  it("answers Gmail capability and urgent-mail questions from Slack", async () => {
    const capability = await planBridgeCommand(
      bridgeUser,
      "as-tu accès à mes mails ?",
    );
    const urgent = await planBridgeCommand(
      bridgeUser,
      "quels sont mes mails urgents ?",
    );

    expect(capability.actions).toHaveLength(0);
    expect(capability.response).toContain("Gmail en lecture");
    expect(urgent.actions).toHaveLength(0);
    expect(urgent.response).toContain("Demo client");
    expect(mocks.listGmailMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        query:
          "is:unread newer_than:14d {label:important subject:urgent subject:important}",
        unreadOnly: true,
      }),
      expect.objectContaining({
        organizationId: "org-1",
        profileId: "profile-ali",
      }),
    );
  });

  it("does not read personal providers for a shared Slack channel", async () => {
    const plan = await planBridgeCommand(
      bridgeUser,
      "quels sont mes mails urgents ?",
      undefined,
      [],
      { allowPersonalData: false },
    );

    expect(mocks.listGmailMessages).not.toHaveBeenCalled();
    expect(mocks.inspectGoogleWorkspaceCapabilities).not.toHaveBeenCalled();
    expect(plan.actions).toHaveLength(0);
    expect(plan.response).toContain("message privé");
    expect(plan.response).not.toContain("Demo client");
    expect(plan.response).not.toContain(bridgeUser.email);
  });

  it("keeps new lead contact capture in CRM even when a presentation is mentioned", async () => {
    mocks.extractLeadFromNaturalTextAction.mockResolvedValue({
      extracted: {
        companyName: "Winxo",
        contactEmail: "Yzaidi@winxo.com",
        contactName: "Youssef Zaidi",
        contactPhone: "0661420960",
        leadDate: "2026-07-10T09:00:00",
        nextAction: "Envoyer la présentation avant le rendez-vous",
        notes:
          "Contact obtenu par téléphone. Envoyer une présentation avant de se rencontrer.",
        source: "Slack",
        status: "meeting-booked",
        topic: "Winxo - nouveau lead",
      },
      success: true,
    });

    const plan = await planBridgeCommand(
      bridgeUser,
      "nouveau lead: Youssef Zaidi Directeur d'exploitation de Winxo 0661420960 - Yzaidi@winxo.com, crée un meeting demain matin pour me rappeler de lui envoyer la présentation",
    );

    expect(plan.agentName).toBe("Salma");
    expect(plan.response).toContain("Salma");
    expect(plan.response).not.toContain("Maya");
    expect(plan.actions).toHaveLength(2);
    expect(plan.actions[0]).toMatchObject({
      kind: "crm.createLead",
      payload: {
        companyName: "Winxo",
        contactEmail: "Yzaidi@winxo.com",
        contactName: "Youssef Zaidi",
        contactPhone: "0661420960",
        leadDate: undefined,
        nextAction: "Envoyer la présentation avant le rendez-vous",
        status: "contacted",
        topic: "Winxo - nouveau lead",
      },
    });
    expect(plan.actions[1]).toMatchObject({
      kind: "calendar.createReminder",
      payload: {
        scheduledAt: expect.stringMatching(/T09:00:00$/),
      },
    });
  });

  it("keeps a useful CRM draft for contact capture when Groq extraction fails", async () => {
    mocks.extractLeadFromNaturalTextAction.mockResolvedValue({
      error: "temporary unavailable",
      success: false,
    });

    const plan = await planBridgeCommand(
      bridgeUser,
      "je viens d'avoir le contact d'un nouveau lead: Youssef Zaidi Directeur d'exploitation de Winxo 0661420960 - Yzaidi@winxo.com, je lui ai parlé au tel il me demander lui envoyer une présentation avant de se rencontrer - crée un meeting demain matin pour me rappeler de lui envoyer la présentation",
    );

    expect(plan.agentName).toBe("Salma");
    expect(plan.actions).toHaveLength(2);
    expect(plan.actions[0]).toMatchObject({
      kind: "crm.createLead",
      payload: {
        companyName: "Winxo",
        contactEmail: "Yzaidi@winxo.com",
        contactName: "Youssef Zaidi",
        contactPhone: "0661420960",
        nextAction: "Envoyer la présentation avant le rendez-vous",
        status: "contacted",
        topic: "Winxo - nouveau lead",
      },
    });
    expect(plan.actions[1]).toMatchObject({
      kind: "calendar.createReminder",
      payload: {
        scheduledAt: expect.stringMatching(/T09:00:00$/),
        title: "Envoyer la présentation",
      },
    });
  });

  it("preserves contact details from Slack mailto markup when Groq returns a partial lead", async () => {
    mocks.extractLeadFromNaturalTextAction.mockResolvedValue({
      extracted: {
        nextAction: "Envoyer la présentation avant le rendez-vous",
        notes: "Demande de présentation avant rencontre",
        source: "Appel téléphonique",
        status: "contacted",
        topic: "Présentation pour Winxo",
      },
      success: true,
    });

    const plan = await planBridgeCommand(
      bridgeUser,
      "je viens d'avoir le contact d'un nouveau lead: Youssef Zaidi Directeur d'exploitation de Winxo <mailto:0661420960Yzaidi@winxo.com|0661420960 - Yzaidi@winxo.com>, je lui ai parlé au tel et il me demande de lui envoyer une présentation",
    );

    expect(mocks.extractLeadFromNaturalTextAction).toHaveBeenCalledWith(
      expect.stringContaining("0661420960 - Yzaidi@winxo.com"),
    );
    expect(plan.actions[0]).toMatchObject({
      kind: "crm.createLead",
      payload: {
        companyName: "Winxo",
        contactEmail: "Yzaidi@winxo.com",
        contactJobTitle: "Directeur d'exploitation",
        contactName: "Youssef Zaidi",
        contactPhone: "0661420960",
      },
    });
    expect((plan.actions[0].payload as CrmLeadDraft).notes).not.toContain(
      "<mailto:",
    );
  });

  it("creates Calendar events from signed hydrated CRM lead drafts", async () => {
    mocks.createLeadAction.mockResolvedValue({
      calendarLink: "https://calendar.google.com/event?eid=hps",
      calendarSynced: true,
      lead: { id: "lead-hps" },
      success: true,
    });

    const command =
      "crée un lead pour HPS avec Abdeslam, meeting vendredi à 11h";
    const signed = signAction(hydratedCrmCreateAction, command);

    const result = await executeBridgeAction(bridgeUser, {
      actionId: hydratedCrmCreateAction.id,
      approvalToken: signed.approvalToken,
      command,
    });

    expect(result.success).toBe(true);
    expect(mocks.createLeadAction).toHaveBeenCalledWith(
      expect.objectContaining({
        companyName: "HPS",
        contactName: "Abdeslam",
        leadDate: "2026-07-10T11:00:00",
        nextAction: "Préparer le meeting avec Abdeslam",
        notes: expect.stringContaining("Commande NAIA:"),
        source: "Slack",
        status: "meeting-booked",
        topic: "Meeting HPS",
      }),
      expect.objectContaining({
        actorProfileId: "profile-ali",
        organizationId: "org-1",
      }),
    );
    expect(result.message).toContain("Adam a créé l'événement Calendar");
  });

  it("creates a transparent Google Calendar reminder after approval", async () => {
    const command = "rappelle-moi demain matin d'envoyer la présentation";
    const action: NaiaActionDraft = {
      agentId: "meetings",
      approvalRequired: true,
      description: "Adam créera un rappel personnel.",
      id: "calendar-reminder-winxo",
      kind: "calendar.createReminder",
      label: "Créer le rappel Calendar",
      payload: {
        notes: command,
        scheduledAt: "2026-07-11T09:00:00",
        timeWasInferred: true,
        timeZone: "Africa/Casablanca",
        title: "Envoyer la présentation",
      },
      risk: "medium",
    };
    const signed = signAction(action, command);

    const result = await executeBridgeAction(bridgeUser, {
      actionId: signed.id,
      approvalToken: signed.approvalToken,
      command,
    });

    expect(result.success).toBe(true);
    expect(mocks.createGoogleCalendarReminder).toHaveBeenCalledWith(
      {
        scheduledAt: "2026-07-11T09:00:00",
        timeZone: "Africa/Casablanca",
        title: "Envoyer la présentation",
      },
      expect.objectContaining({
        organizationId: "org-1",
        profileId: "profile-ali",
      }),
    );
    expect(result.message).toContain("rappel Google Calendar");
  });
});
