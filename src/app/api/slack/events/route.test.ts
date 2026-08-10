import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  afterTasks: [] as Promise<unknown>[],
  claimSlackEvent: vi.fn(),
  createServiceRoleSupabaseClient: vi.fn(),
  fetchSlackConversationHistory: vi.fn(),
  fetchSlackUserProfile: vi.fn(),
  planBridgeCommand: vi.fn(),
  postSlackMessage: vi.fn(),
  resolveBridgeUser: vi.fn(),
}));

vi.mock("@/platform/auth/supabase-server", () => ({
  createServiceRoleSupabaseClient: mocks.createServiceRoleSupabaseClient,
}));

vi.mock("next/server", () => ({
  after: (task: () => Promise<void>) => {
    mocks.afterTasks.push(Promise.resolve().then(task));
  },
}));

vi.mock("@/platform/naia/bridge", () => ({
  planBridgeCommand: mocks.planBridgeCommand,
  resolveBridgeUser: mocks.resolveBridgeUser,
}));

vi.mock("@/platform/integrations/slack", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/platform/integrations/slack")>();

  return {
    ...actual,
    fetchSlackConversationHistory: mocks.fetchSlackConversationHistory,
    fetchSlackUserProfile: mocks.fetchSlackUserProfile,
    postSlackMessage: mocks.postSlackMessage,
  };
});

import { decodeSlackApprovalValue } from "@/platform/naia/slack-approval";

import { POST } from "./route";

const SIGNING_SECRET = "test-signing-secret";

function slackRequest(
  body: string,
  {
    retryNum,
    retryReason,
    timestamp = String(Math.floor(Date.now() / 1000)),
    signature,
  }: {
    retryNum?: string;
    retryReason?: string;
    signature?: string;
    timestamp?: string;
  } = {},
) {
  return new Request("http://localhost/api/slack/events", {
    body,
    headers: {
      "content-type": "application/json",
      ...(retryNum ? { "x-slack-retry-num": retryNum } : {}),
      ...(retryReason ? { "x-slack-retry-reason": retryReason } : {}),
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature":
        signature ??
        `v0=${createHmac("sha256", SIGNING_SECRET)
          .update(`v0:${timestamp}:${body}`)
          .digest("hex")}`,
    },
    method: "POST",
  });
}

const bridgeUser = {
  email: "ali@qarizmi.com",
  fullName: "Ali",
  organizationId: "org-1",
  profileId: "profile-ali",
  role: "owner",
};

const gmailAction = {
  agentId: "integrations",
  approvalRequired: true,
  description: "Lina lira les derniers messages Gmail autorises.",
  id: "gmail-list-abc",
  kind: "google.gmail.listMessages",
  label: "Lire Gmail",
  payload: { maxResults: 10, unreadOnly: true },
  risk: "low",
};

function messageImEvent(text: string) {
  return JSON.stringify({
    event: {
      channel: "D0123456789",
      channel_type: "im",
      text,
      ts: "1234.5678",
      type: "message",
      user: "U0123456789",
    },
    event_id: "Ev0123456789",
    type: "event_callback",
  });
}

async function flushAfterTasks() {
  await Promise.all(mocks.afterTasks);
}

describe("Slack events route", () => {
  beforeEach(() => {
    vi.stubEnv("SLACK_SIGNING_SECRET", SIGNING_SECRET);
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-test");
    mocks.afterTasks = [];
    mocks.claimSlackEvent.mockResolvedValue({ data: true, error: null });
    mocks.createServiceRoleSupabaseClient.mockReturnValue({
      rpc: mocks.claimSlackEvent,
    });
    mocks.fetchSlackUserProfile.mockResolvedValue({
      displayName: "Ali",
      email: "ali@qarizmi.com",
      isBot: false,
    });
    mocks.fetchSlackConversationHistory.mockResolvedValue([]);
    mocks.resolveBridgeUser.mockResolvedValue(bridgeUser);
    mocks.planBridgeCommand.mockResolvedValue({
      actions: [{ ...gmailAction, approvalToken: "payload.signature" }],
      agentName: "Lina",
      command: "lis mes emails gmail non lus",
      response: "Lina prend le relais integrations.",
    });
    mocks.postSlackMessage.mockResolvedValue({ channel: "D0123456789" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("answers the url_verification challenge", async () => {
    const body = JSON.stringify({
      challenge: "challenge-token-123",
      type: "url_verification",
    });
    const response = await POST(slackRequest(body));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ challenge: "challenge-token-123" });
  });

  it("rejects an invalid signature", async () => {
    const body = messageImEvent("lis mes emails gmail non lus");
    const response = await POST(
      slackRequest(body, { signature: "v0=deadbeef" }),
    );

    await flushAfterTasks();

    expect(response.status).toBe(401);
    expect(mocks.planBridgeCommand).not.toHaveBeenCalled();
    expect(mocks.postSlackMessage).not.toHaveBeenCalled();
  });

  it("rejects a stale timestamp", async () => {
    const body = messageImEvent("lis mes emails gmail non lus");
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 6 * 60);
    const response = await POST(
      slackRequest(body, { timestamp: staleTimestamp }),
    );

    expect(response.status).toBe(401);
    expect(mocks.planBridgeCommand).not.toHaveBeenCalled();
  });

  it("acknowledges http_timeout retries without reprocessing", async () => {
    const body = messageImEvent("lis mes emails gmail non lus");
    const response = await POST(
      slackRequest(body, { retryNum: "1", retryReason: "http_timeout" }),
    );

    await flushAfterTasks();

    expect(response.status).toBe(200);
    expect(mocks.planBridgeCommand).not.toHaveBeenCalled();
  });

  it("processes retries whose reason is not http_timeout", async () => {
    const body = messageImEvent("lis mes emails gmail non lus");
    const response = await POST(
      slackRequest(body, { retryNum: "1", retryReason: "connection_failed" }),
    );

    await flushAfterTasks();

    expect(response.status).toBe(200);
    // The first delivery was never processed on Slack's side, so this retry
    // must go through the full pipeline.
    expect(mocks.planBridgeCommand).toHaveBeenCalledWith(
      bridgeUser,
      "lis mes emails gmail non lus",
      undefined,
      [],
      { allowPersonalData: true },
    );
  });

  it("claims event_id durably and never republishes a replay", async () => {
    mocks.claimSlackEvent
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    const body = messageImEvent("lis mes emails gmail non lus");

    const first = await POST(slackRequest(body));
    const replay = await POST(slackRequest(body));
    await flushAfterTasks();

    expect(first.status).toBe(200);
    expect(await replay.json()).toEqual({ ignored: "duplicate", ok: true });
    expect(mocks.claimSlackEvent).toHaveBeenCalledTimes(2);
    expect(mocks.planBridgeCommand).toHaveBeenCalledTimes(1);
    expect(mocks.postSlackMessage).toHaveBeenCalledTimes(1);
  });

  it("ignores bot messages", async () => {
    const body = JSON.stringify({
      event: {
        bot_id: "B0123",
        channel: "D0123456789",
        channel_type: "im",
        text: "echo",
        type: "message",
        user: "U0123456789",
      },
      event_id: "EvMentionStatus123",
      type: "event_callback",
    });
    const response = await POST(slackRequest(body));

    await flushAfterTasks();

    expect(response.status).toBe(200);
    expect(mocks.planBridgeCommand).not.toHaveBeenCalled();
  });

  it("plans a DM command and posts approval buttons", async () => {
    const body = messageImEvent("lis mes emails gmail non lus");
    const response = await POST(slackRequest(body));

    expect(response.status).toBe(200);

    await flushAfterTasks();

    expect(mocks.fetchSlackUserProfile).toHaveBeenCalledWith("U0123456789");
    expect(mocks.resolveBridgeUser).toHaveBeenCalledWith("ali@qarizmi.com");
    expect(mocks.planBridgeCommand).toHaveBeenCalledWith(
      bridgeUser,
      "lis mes emails gmail non lus",
      undefined,
      [],
      { allowPersonalData: true },
    );

    const message = mocks.postSlackMessage.mock.calls[0][0];
    expect(message.channel).toBe("D0123456789");
    expect(message.text).toBe("Lina prend le relais integrations.");

    const approveButton = message.blocks
      .filter((block: { type: string }) => block.type === "actions")
      .flatMap(
        (block: { elements: Array<{ action_id: string }> }) => block.elements,
      )
      .find((element: { action_id: string }) =>
        element.action_id.startsWith("naia_approve:"),
      );

    expect(approveButton).toBeDefined();
    expect(approveButton.style).toBe("primary");

    const draft = decodeSlackApprovalValue(approveButton.value);
    expect(draft).not.toBeNull();
    expect(draft?.actionId).toBe("gmail-list-abc");
    expect(draft?.approvalToken).toBe("payload.signature");
    expect(draft?.command).toBe("lis mes emails gmail non lus");
  });

  it("forwards recent Slack context without duplicating the current command", async () => {
    mocks.fetchSlackConversationHistory.mockResolvedValue([
      { content: "Combien de leads avons-nous ?", role: "user" },
      { content: "Il y en a 14.", role: "assistant" },
      { content: "Et lesquels sont à relancer ?", role: "user" },
    ]);

    await POST(slackRequest(messageImEvent("Et lesquels sont à relancer ?")));
    await flushAfterTasks();

    expect(mocks.planBridgeCommand).toHaveBeenCalledWith(
      bridgeUser,
      "Et lesquels sont à relancer ?",
      undefined,
      [
        { content: "Combien de leads avons-nous ?", role: "user" },
        { content: "Il y en a 14.", role: "assistant" },
      ],
      { allowPersonalData: true },
    );
  });

  it("shows the complete lead draft and an edit control before approval", async () => {
    mocks.planBridgeCommand.mockResolvedValue({
      actions: [
        {
          agentId: "crm",
          approvalRequired: true,
          approvalToken: "payload.signature",
          description: "Brouillon CRM à vérifier",
          id: "crm-create-winxo",
          kind: "crm.createLead",
          label: "Créer le lead CRM",
          payload: {
            companyName: "Winxo",
            contactEmail: "Yzaidi@winxo.com",
            contactJobTitle: "Directeur d'exploitation",
            contactName: "Youssef Zaidi",
            contactPhone: "0661420960",
            nextAction: "Envoyer la présentation avant le rendez-vous",
            notes: "Demande de présentation avant rencontre",
            source: "Appel téléphonique",
            status: "contacted",
            topic: "Présentation pour Winxo",
          },
          risk: "medium",
        },
      ],
      agentName: "Salma",
      command: "crée le lead Winxo",
      mode: "local-orchestrated",
      response: "Salma a préparé une fiche lead à vérifier.",
      responseType: "action",
    });

    await POST(slackRequest(messageImEvent("crée le lead Winxo")));
    await flushAfterTasks();

    const message = mocks.postSlackMessage.mock.calls[0][0];
    const serializedBlocks = JSON.stringify(message.blocks);

    expect(serializedBlocks).toContain("Présentation pour Winxo");
    expect(serializedBlocks).toContain("Winxo");
    expect(serializedBlocks).toContain("Youssef Zaidi");
    expect(serializedBlocks).toContain("Directeur d'exploitation");
    expect(serializedBlocks).toContain("Yzaidi@winxo.com");
    expect(serializedBlocks).toContain("0661420960");
    expect(serializedBlocks).toContain(
      "Envoyer la présentation avant le rendez-vous",
    );

    const editButton = message.blocks
      .filter((block: { type: string }) => block.type === "actions")
      .flatMap(
        (block: { elements: Array<{ action_id: string }> }) => block.elements,
      )
      .find(
        (element: { action_id: string }) =>
          element.action_id === "naia_edit_lead:crm-create-winxo",
      );
    expect(editButton).toBeDefined();
  });

  it("strips the bot mention before planning an app_mention command", async () => {
    const body = JSON.stringify({
      event: {
        channel: "C0123456789",
        text: "<@U0BOT> passe le lead HPS en meeting booked",
        ts: "1234.5678",
        type: "app_mention",
        user: "U0123456789",
      },
      event_id: "EvMentionPrivate123",
      type: "event_callback",
    });
    const response = await POST(slackRequest(body));

    expect(response.status).toBe(200);

    await flushAfterTasks();

    expect(mocks.planBridgeCommand).toHaveBeenCalledWith(
      bridgeUser,
      "passe le lead HPS en meeting booked",
      undefined,
      [],
      { allowPersonalData: false },
    );
    expect(mocks.postSlackMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C0123456789",
        threadTs: "1234.5678",
      }),
    );
  });

  it("marks channel mentions as unsafe for personal data", async () => {
    const body = JSON.stringify({
      event: {
        channel: "C0123456789",
        text: "<@U0BOT> quels sont mes mails urgents ?",
        ts: "1234.5678",
        type: "app_mention",
        user: "U0123456789",
      },
      event_id: "EvMentionPrivate456",
      type: "event_callback",
    });

    await POST(slackRequest(body));
    await flushAfterTasks();

    expect(mocks.planBridgeCommand).toHaveBeenCalledWith(
      bridgeUser,
      "quels sont mes mails urgents ?",
      undefined,
      [],
      { allowPersonalData: false },
    );
  });

  it("answers unknown accounts without planning anything", async () => {
    mocks.resolveBridgeUser.mockResolvedValue(null);

    const body = messageImEvent("lis mes emails gmail non lus");
    await POST(slackRequest(body));
    await flushAfterTasks();

    expect(mocks.planBridgeCommand).not.toHaveBeenCalled();
    expect(mocks.postSlackMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Compte non reconnu"),
      }),
    );
  });
});
