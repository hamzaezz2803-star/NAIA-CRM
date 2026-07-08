import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumedInsert: vi.fn(),
  consumedPurge: vi.fn(),
  createLeadAction: vi.fn(),
  createServiceRoleSupabaseClient: vi.fn(),
  listGmailMessages: vi.fn(),
  listGoogleCalendarEvents: vi.fn(),
  updateLeadStatusAction: vi.fn(),
}));

vi.mock("@/features/crm/actions", () => ({
  createLeadAction: mocks.createLeadAction,
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

import { executeBridgeAction, type NaiaBridgeUser } from "./bridge";

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

function fakeServiceRoleClient() {
  return {
    from: vi.fn((table: string) => {
      if (table !== "naia_consumed_action_tokens") {
        throw new Error(`Unexpected table in test: ${table}`);
      }

      return {
        delete: () => ({ lt: mocks.consumedPurge }),
        insert: mocks.consumedInsert,
      };
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
});
