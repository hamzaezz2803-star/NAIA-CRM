import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumedInsert: vi.fn(),
  consumedPurge: vi.fn(),
  createLeadAction: vi.fn(),
  createServiceRoleSupabaseClient: vi.fn(),
  extractLeadFromNaturalTextAction: vi.fn(),
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
  listGmailMessages: mocks.listGmailMessages,
  listGoogleCalendarEvents: mocks.listGoogleCalendarEvents,
}));

vi.mock("@/platform/auth/supabase-server", () => ({
  createServiceRoleSupabaseClient: mocks.createServiceRoleSupabaseClient,
}));

import type { NaiaActionDraft } from "@/features/naia/orchestrator";
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
  leads = [],
}: {
  leads?: unknown[];
} = {}) {
  return {
    from: vi.fn((table: string) => {
      if (table === "crm_leads") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: vi.fn().mockResolvedValue({ data: leads, error: null }),
              }),
            }),
          }),
        };
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
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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
      "je viens d'avoir le contact d'un nouveau lead: Youssef Zaidi Directeur d'exploitation de Winxo 0661420960 - Yzaidi@winxo.com, je lui ai parlé au tel il me demander lui envoyer une présentation avant de se rencontrer - crée un meeting demain matin pour me rappeler de lui envoyer la présentation",
    );

    expect(plan.agentName).toBe("Salma");
    expect(plan.response).toContain("Salma");
    expect(plan.response).not.toContain("Maya");
    expect(plan.actions).toHaveLength(1);
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
    expect(plan.actions).toHaveLength(1);
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
});
