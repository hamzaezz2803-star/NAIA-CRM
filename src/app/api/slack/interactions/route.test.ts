import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  afterTasks: [] as Promise<unknown>[],
  executeBridgeAction: vi.fn(),
  fetchSlackUserProfile: vi.fn(),
  resolveBridgeUser: vi.fn(),
  respondToSlackInteraction: vi.fn(),
}));

vi.mock("next/server", () => ({
  after: (task: () => Promise<void>) => {
    mocks.afterTasks.push(Promise.resolve().then(task));
  },
}));

vi.mock("@/platform/naia/bridge", () => ({
  executeBridgeAction: mocks.executeBridgeAction,
  resolveBridgeUser: mocks.resolveBridgeUser,
}));

vi.mock("@/platform/integrations/slack", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/platform/integrations/slack")>();

  return {
    ...actual,
    fetchSlackUserProfile: mocks.fetchSlackUserProfile,
    respondToSlackInteraction: mocks.respondToSlackInteraction,
  };
});

import { POST } from "./route";

const SIGNING_SECRET = "test-signing-secret";

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

const approvalDraft = {
  action: gmailAction,
  approvalToken: "payload.signature",
  command: "lis mes emails gmail non lus",
};

const bridgeUser = {
  email: "ali@qarizmi.com",
  fullName: "Ali",
  organizationId: "org-1",
  profileId: "profile-ali",
  role: "owner",
};

function buildInteractionPayload({
  actionId = `naia_approve:${gmailAction.id}`,
  value = JSON.stringify({ d: approvalDraft, v: 1 }),
}: { actionId?: string; value?: string } = {}) {
  return {
    actions: [{ action_id: actionId, value }],
    message: {
      blocks: [
        {
          block_id: "naia_response",
          text: { text: "Lina prend le relais.", type: "mrkdwn" },
          type: "section",
        },
        {
          block_id: `naia_action_buttons:${gmailAction.id}`,
          elements: [],
          type: "actions",
        },
      ],
    },
    response_url: "https://hooks.slack.com/actions/T000/response",
    type: "block_actions",
    user: { id: "U0123456789", username: "ali" },
  };
}

function interactionRequest(
  payload: unknown,
  { signature }: { signature?: string } = {},
) {
  const body = new URLSearchParams({
    payload: JSON.stringify(payload),
  }).toString();
  const timestamp = String(Math.floor(Date.now() / 1000));

  return new Request("http://localhost/api/slack/interactions", {
    body,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
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

async function flushAfterTasks() {
  await Promise.all(mocks.afterTasks);
}

describe("Slack interactions route", () => {
  beforeEach(() => {
    vi.stubEnv("SLACK_SIGNING_SECRET", SIGNING_SECRET);
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-test");
    mocks.afterTasks = [];
    mocks.fetchSlackUserProfile.mockResolvedValue({
      displayName: "Ali",
      email: "ali@qarizmi.com",
      isBot: false,
    });
    mocks.resolveBridgeUser.mockResolvedValue(bridgeUser);
    mocks.executeBridgeAction.mockResolvedValue({
      details: ["• nabil@qarizmi.com — Demo client"],
      message: "Lina a lu 1 message(s) Gmail autorise(s).",
      success: true,
    });
    mocks.respondToSlackInteraction.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("rejects an invalid signature", async () => {
    const response = await POST(
      interactionRequest(buildInteractionPayload(), {
        signature: "v0=deadbeef",
      }),
    );

    await flushAfterTasks();

    expect(response.status).toBe(401);
    expect(mocks.executeBridgeAction).not.toHaveBeenCalled();
  });

  it("executes an approved action and updates the original message", async () => {
    const response = await POST(interactionRequest(buildInteractionPayload()));

    expect(response.status).toBe(200);

    await flushAfterTasks();

    expect(mocks.fetchSlackUserProfile).toHaveBeenCalledWith("U0123456789");
    expect(mocks.resolveBridgeUser).toHaveBeenCalledWith("ali@qarizmi.com");
    expect(mocks.executeBridgeAction).toHaveBeenCalledWith(
      bridgeUser,
      approvalDraft,
    );

    const [responseUrl, update] = mocks.respondToSlackInteraction.mock.calls[0];
    expect(responseUrl).toBe("https://hooks.slack.com/actions/T000/response");
    expect(update.replace_original).toBe(true);
    expect(update.text).toContain("Validée par Ali");
    expect(update.text).toContain("Lina a lu 1 message(s)");

    const resultBlock = update.blocks.find(
      (block: { block_id?: string }) =>
        block.block_id === `naia_action_result:${gmailAction.id}`,
    );
    expect(resultBlock).toBeDefined();
    const detailsBlock = update.blocks.find(
      (block: { block_id?: string }) =>
        block.block_id === `naia_action_details:${gmailAction.id}`,
    );
    expect(detailsBlock.text.text).toContain("Demo client");
  });

  it("never executes for an unrecognized Slack account", async () => {
    mocks.resolveBridgeUser.mockResolvedValue(null);

    const response = await POST(interactionRequest(buildInteractionPayload()));

    expect(response.status).toBe(200);

    await flushAfterTasks();

    expect(mocks.executeBridgeAction).not.toHaveBeenCalled();
    expect(mocks.respondToSlackInteraction).toHaveBeenCalledWith(
      "https://hooks.slack.com/actions/T000/response",
      expect.objectContaining({
        response_type: "ephemeral",
        text: expect.stringContaining("Compte non reconnu"),
      }),
    );
  });

  it("marks a dismissed action without executing anything", async () => {
    const response = await POST(
      interactionRequest(
        buildInteractionPayload({
          actionId: `naia_dismiss:${gmailAction.id}`,
          value: JSON.stringify({ actionId: gmailAction.id }),
        }),
      ),
    );

    expect(response.status).toBe(200);

    await flushAfterTasks();

    expect(mocks.executeBridgeAction).not.toHaveBeenCalled();

    const [, update] = mocks.respondToSlackInteraction.mock.calls[0];
    expect(update.replace_original).toBe(true);
    expect(update.text).toContain("Action ignorée");
  });
});
