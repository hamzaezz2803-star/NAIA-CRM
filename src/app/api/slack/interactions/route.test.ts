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

const draftActionId = "gmail-list-abc";

const approvalDraft = {
  actionId: draftActionId,
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
  actionId = `naia_approve:${draftActionId}`,
  value = JSON.stringify({ d: approvalDraft, v: 2 }),
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
          block_id: `naia_action_buttons:${draftActionId}`,
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

  it("shows a pending state, executes, and updates the shared message with the status only", async () => {
    const response = await POST(interactionRequest(buildInteractionPayload()));

    expect(response.status).toBe(200);

    await flushAfterTasks();

    expect(mocks.fetchSlackUserProfile).toHaveBeenCalledWith("U0123456789");
    expect(mocks.resolveBridgeUser).toHaveBeenCalledWith("ali@qarizmi.com");
    expect(mocks.executeBridgeAction).toHaveBeenCalledWith(
      bridgeUser,
      approvalDraft,
    );

    expect(mocks.respondToSlackInteraction).toHaveBeenCalledTimes(3);

    const [pendingUrl, pendingUpdate] =
      mocks.respondToSlackInteraction.mock.calls[0];
    expect(pendingUrl).toBe("https://hooks.slack.com/actions/T000/response");
    expect(pendingUpdate.replace_original).toBe(true);
    expect(pendingUpdate.text).toContain("Validation en cours");

    const [, finalUpdate] = mocks.respondToSlackInteraction.mock.calls[1];
    expect(finalUpdate.replace_original).toBe(true);
    expect(finalUpdate.text).toContain("Validée par Ali");
    expect(finalUpdate.text).toContain("Lina a lu 1 message(s)");
    // Confidentiality: result details never land in the shared message.
    expect(finalUpdate.text).not.toContain("Demo client");
    expect(JSON.stringify(finalUpdate.blocks)).not.toContain("Demo client");

    const resultBlock = finalUpdate.blocks.find(
      (block: { block_id?: string }) =>
        block.block_id === `naia_action_result:${draftActionId}`,
    );
    expect(resultBlock).toBeDefined();

    const [, ephemeral] = mocks.respondToSlackInteraction.mock.calls[2];
    expect(ephemeral.replace_original).toBe(false);
    expect(ephemeral.response_type).toBe("ephemeral");
    expect(ephemeral.text).toContain("Demo client");
  });

  it("never executes for an unrecognized Slack account", async () => {
    mocks.resolveBridgeUser.mockResolvedValue(null);

    const response = await POST(interactionRequest(buildInteractionPayload()));

    expect(response.status).toBe(200);

    await flushAfterTasks();

    expect(mocks.executeBridgeAction).not.toHaveBeenCalled();
    expect(mocks.respondToSlackInteraction).toHaveBeenCalledTimes(1);
    expect(mocks.respondToSlackInteraction).toHaveBeenCalledWith(
      "https://hooks.slack.com/actions/T000/response",
      expect.objectContaining({
        response_type: "ephemeral",
        text: expect.stringContaining("Compte non reconnu"),
      }),
    );
  });

  it("reports an already-consumed token without duplicating side effects", async () => {
    mocks.executeBridgeAction.mockResolvedValue({
      message: "Cette action a déjà été validée.",
      success: false,
    });

    await POST(interactionRequest(buildInteractionPayload()));
    await flushAfterTasks();

    const [, finalUpdate] = mocks.respondToSlackInteraction.mock.calls[1];
    expect(finalUpdate.text).toContain("Cette action a déjà été validée.");
    // No details: no ephemeral follow-up beyond pending + final updates.
    expect(mocks.respondToSlackInteraction).toHaveBeenCalledTimes(2);
  });

  it("marks a dismissed action without executing anything", async () => {
    const response = await POST(
      interactionRequest(
        buildInteractionPayload({
          actionId: `naia_dismiss:${draftActionId}`,
          value: JSON.stringify({ actionId: draftActionId }),
        }),
      ),
    );

    expect(response.status).toBe(200);

    await flushAfterTasks();

    expect(mocks.executeBridgeAction).not.toHaveBeenCalled();
    expect(mocks.respondToSlackInteraction).toHaveBeenCalledTimes(1);

    const [, update] = mocks.respondToSlackInteraction.mock.calls[0];
    expect(update.replace_original).toBe(true);
    expect(update.text).toContain("Action ignorée");
  });
});
