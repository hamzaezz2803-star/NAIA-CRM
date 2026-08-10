import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  afterTasks: [] as Promise<unknown>[],
  executeBridgeAction: vi.fn(),
  executeEditedBridgeLeadAction: vi.fn(),
  fetchSlackMessageSnapshot: vi.fn(),
  fetchSlackUserProfile: vi.fn(),
  openSlackModal: vi.fn(),
  resolveBridgeUser: vi.fn(),
  respondToSlackInteraction: vi.fn(),
  updateSlackMessage: vi.fn(),
}));

vi.mock("next/server", () => ({
  after: (task: () => Promise<void>) => {
    mocks.afterTasks.push(Promise.resolve().then(task));
  },
}));

vi.mock("@/platform/naia/bridge", () => ({
  executeBridgeAction: mocks.executeBridgeAction,
  executeEditedBridgeLeadAction: mocks.executeEditedBridgeLeadAction,
  resolveBridgeUser: mocks.resolveBridgeUser,
}));

vi.mock("@/platform/integrations/slack", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/platform/integrations/slack")>();

  return {
    ...actual,
    fetchSlackMessageSnapshot: mocks.fetchSlackMessageSnapshot,
    fetchSlackUserProfile: mocks.fetchSlackUserProfile,
    openSlackModal: mocks.openSlackModal,
    respondToSlackInteraction: mocks.respondToSlackInteraction,
    updateSlackMessage: mocks.updateSlackMessage,
  };
});

import type { NaiaActionDraft } from "@/features/naia/orchestrator";
import { signAction } from "@/platform/naia/action-tokens";

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
    container: {
      channel_id: "D0123456789",
      message_ts: "1234.5678",
    },
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
    trigger_id: "1234.5678.trigger",
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
    vi.stubEnv("NAIA_ACTION_APPROVAL_SECRET", "test-approval-secret");
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
    mocks.executeEditedBridgeLeadAction.mockResolvedValue({
      message: 'Lead CRM créé: "Présentation pour Winxo".',
      success: true,
    });
    mocks.fetchSlackMessageSnapshot.mockResolvedValue(null);
    mocks.respondToSlackInteraction.mockResolvedValue(undefined);
    mocks.openSlackModal.mockResolvedValue(undefined);
    mocks.updateSlackMessage.mockResolvedValue(undefined);
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
    const action: NaiaActionDraft = {
      agentId: "integrations",
      approvalRequired: true,
      description: "Lire Gmail",
      id: draftActionId,
      kind: "google.gmail.listMessages",
      label: "Lire Gmail",
      payload: { maxResults: 10, unreadOnly: true },
      risk: "low",
    };
    const signed = signAction(action, approvalDraft.command, {
      actorProfileId: bridgeUser.profileId,
      organizationId: bridgeUser.organizationId,
    });
    const response = await POST(
      interactionRequest(
        buildInteractionPayload({
          actionId: `naia_dismiss:${draftActionId}`,
          value: JSON.stringify({
            d: {
              actionId: draftActionId,
              approvalToken: signed.approvalToken,
              command: approvalDraft.command,
            },
            v: 2,
          }),
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

  it("opens a prefilled lead modal from the Slack draft card", async () => {
    const command = "crée le lead Winxo";
    const action: NaiaActionDraft = {
      agentId: "crm",
      approvalRequired: true,
      description: "Brouillon CRM",
      id: "crm-create-winxo",
      kind: "crm.createLead",
      label: "Créer le lead CRM",
      payload: {
        companyName: "Winxo",
        contactEmail: "Yzaidi@winxo.com",
        contactJobTitle: "Directeur d'exploitation",
        contactName: "Youssef Zaidi",
        contactPhone: "0661420960",
        nextAction: "Envoyer la présentation",
        source: "Appel téléphonique",
        status: "contacted",
        topic: "Présentation pour Winxo",
      },
      risk: "medium",
    };
    const signed = signAction(action, command, {
      actorProfileId: bridgeUser.profileId,
      organizationId: bridgeUser.organizationId,
    });
    const value = JSON.stringify({
      d: {
        actionId: signed.id,
        approvalToken: signed.approvalToken,
        command,
      },
      v: 2,
    });

    await POST(
      interactionRequest(
        buildInteractionPayload({
          actionId: `naia_edit_lead:${action.id}`,
          value,
        }),
      ),
    );
    await flushAfterTasks();

    expect(mocks.executeBridgeAction).not.toHaveBeenCalled();
    expect(mocks.openSlackModal).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerId: "1234.5678.trigger",
        view: expect.objectContaining({
          callback_id: "naia_edit_lead",
          type: "modal",
        }),
      }),
    );
    const view = mocks.openSlackModal.mock.calls[0][0].view;
    expect(JSON.stringify(view)).toContain("Présentation pour Winxo");
    expect(JSON.stringify(view)).toContain("Yzaidi@winxo.com");
  });

  it("executes the exact lead values submitted from the edit modal", async () => {
    const command = "crée le lead Winxo";
    const action: NaiaActionDraft = {
      agentId: "crm",
      approvalRequired: true,
      description: "Brouillon CRM",
      id: "crm-create-winxo",
      kind: "crm.createLead",
      label: "Créer le lead CRM",
      payload: {
        nextAction: "Qualifier le besoin",
        source: "NAIA",
        status: "lead-to-contact",
        topic: "Winxo",
      },
      risk: "medium",
    };
    const signed = signAction(action, command, {
      actorProfileId: bridgeUser.profileId,
      organizationId: bridgeUser.organizationId,
    });
    const privateMetadata = JSON.stringify({
      approvalDraft: {
        actionId: signed.id,
        approvalToken: signed.approvalToken,
        command,
      },
      channelId: "D0123456789",
      messageTs: "1234.5678",
      threadTs: "1111.2222",
    });
    mocks.fetchSlackMessageSnapshot.mockResolvedValue({
      blocks: [
        {
          block_id: "naia_response",
          text: {
            text: "Salma et Adam ont préparé deux actions.",
            type: "mrkdwn",
          },
          type: "section",
        },
        {
          block_id: `naia_action_buttons:${action.id}`,
          elements: [],
          type: "actions",
        },
        {
          block_id: "naia_action_buttons:calendar-reminder-winxo",
          elements: [],
          type: "actions",
        },
      ],
      text: "Salma et Adam ont préparé deux actions.",
    });
    const field = (value: string) => ({ value: { value } });
    const payload = {
      type: "view_submission",
      user: { id: "U0123456789" },
      view: {
        callback_id: "naia_edit_lead",
        private_metadata: privateMetadata,
        state: {
          values: {
            lead_company: field("Winxo"),
            lead_contact: field("Youssef Zaidi"),
            lead_date: field(""),
            lead_email: field("yzaidi@winxo.com"),
            lead_job_title: field("Directeur d'exploitation"),
            lead_linkedin: field(""),
            lead_next_action: field("Envoyer la présentation"),
            lead_notes: field("Demande confirmée par téléphone"),
            lead_phone: field("0661420960"),
            lead_source: field("Appel téléphonique"),
            lead_status: {
              selected: { selected_option: { value: "contacted" } },
            },
            lead_topic: field("Présentation pour Winxo"),
          },
        },
      },
    };

    const response = await POST(interactionRequest(payload));
    expect(await response.json()).toEqual({ response_action: "clear" });
    await flushAfterTasks();

    expect(mocks.executeBridgeAction).not.toHaveBeenCalled();
    expect(mocks.executeEditedBridgeLeadAction).toHaveBeenCalledWith(
      bridgeUser,
      {
        actionId: signed.id,
        approvalToken: signed.approvalToken,
        command,
      },
      expect.objectContaining({
        companyName: "Winxo",
        contactEmail: "yzaidi@winxo.com",
        contactJobTitle: "Directeur d'exploitation",
        contactName: "Youssef Zaidi",
        contactPhone: "0661420960",
        status: "contacted",
        topic: "Présentation pour Winxo",
      }),
    );
    expect(mocks.updateSlackMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "D0123456789",
        ts: "1234.5678",
      }),
    );
    expect(mocks.fetchSlackMessageSnapshot).toHaveBeenCalledWith({
      channel: "D0123456789",
      messageTs: "1234.5678",
      threadTs: "1111.2222",
    });
    const updatedBlocks = mocks.updateSlackMessage.mock.calls[0][0].blocks;
    expect(updatedBlocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          block_id: `naia_action_result:${action.id}`,
        }),
        expect.objectContaining({
          block_id: "naia_action_buttons:calendar-reminder-winxo",
        }),
      ]),
    );
    expect(updatedBlocks).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          block_id: `naia_action_buttons:${action.id}`,
        }),
      ]),
    );
  });
});
