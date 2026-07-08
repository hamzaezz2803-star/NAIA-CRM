import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  afterTasks: [] as Promise<unknown>[],
  claimPendingAction: vi.fn(),
  executeBridgeAction: vi.fn(),
  planBridgeCommand: vi.fn(),
  resolveBridgeUser: vi.fn(),
  sendWhatsAppButtons: vi.fn(),
  sendWhatsAppText: vi.fn(),
  storePendingAction: vi.fn(),
}));

vi.mock("next/server", () => ({
  after: (task: () => Promise<void>) => {
    mocks.afterTasks.push(Promise.resolve().then(task));
  },
}));

vi.mock("@/platform/naia/bridge", () => ({
  executeBridgeAction: mocks.executeBridgeAction,
  planBridgeCommand: mocks.planBridgeCommand,
  resolveBridgeUser: mocks.resolveBridgeUser,
}));

vi.mock("@/platform/naia/pending-actions", () => ({
  claimPendingAction: mocks.claimPendingAction,
  storePendingAction: mocks.storePendingAction,
}));

// Signature verification and the phone→email map stay real; only the
// outbound Cloud API senders are mocked.
vi.mock("@/platform/naia/whatsapp", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/platform/naia/whatsapp")>();

  return {
    ...actual,
    sendWhatsAppButtons: mocks.sendWhatsAppButtons,
    sendWhatsAppText: mocks.sendWhatsAppText,
  };
});

import { GET, POST } from "./route";

const APP_SECRET = "test-app-secret";
const VERIFY_TOKEN = "verify-token-123";
const USER_MAP = "212661234567:ali@qarizmi.com, +33612345678:nabil@qarizmi.com";
const KNOWN_PHONE = "212661234567";
const DRAFT_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

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

// The HMAC approval token embeds the approved action; the stored draft only
// carries the reference plus a label for confirmation messages.
const pendingDraft = {
  actionId: gmailAction.id,
  actionLabel: gmailAction.label,
  approvalToken: "payload.signature",
  command: "lis mes emails gmail non lus",
};

function verificationRequest(params: Record<string, string>) {
  const url = new URL("http://localhost/api/whatsapp/webhook");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return new Request(url, { method: "GET" });
}

function webhookRequest(
  body: string,
  { signature }: { signature?: string } = {},
) {
  return new Request("http://localhost/api/whatsapp/webhook", {
    body,
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256":
        signature ??
        `sha256=${createHmac("sha256", APP_SECRET).update(body, "utf8").digest("hex")}`,
    },
    method: "POST",
  });
}

function inboundPayload(
  messages: unknown[],
  value: Record<string, unknown> = {},
) {
  return JSON.stringify({
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: { messages, ...value },
          },
        ],
        id: "waba-1",
      },
    ],
    object: "whatsapp_business_account",
  });
}

function textMessage(body: string, from = KNOWN_PHONE) {
  return { from, id: "wamid.text", text: { body }, type: "text" };
}

function buttonReply(id: string, from = KNOWN_PHONE) {
  return {
    from,
    id: "wamid.button",
    interactive: {
      button_reply: { id, title: "✅ Valider" },
      type: "button_reply",
    },
    type: "interactive",
  };
}

async function flushAfterTasks() {
  await Promise.all(mocks.afterTasks);
}

describe("WhatsApp webhook verification (GET)", () => {
  beforeEach(() => {
    vi.stubEnv("WHATSAPP_VERIFY_TOKEN", VERIFY_TOKEN);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("echoes hub.challenge as plain text for a matching verify token", async () => {
    const response = GET(
      verificationRequest({
        "hub.challenge": "challenge-4242",
        "hub.mode": "subscribe",
        "hub.verify_token": VERIFY_TOKEN,
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toBe("challenge-4242");
  });

  it("refuses a wrong verify token", async () => {
    const response = GET(
      verificationRequest({
        "hub.challenge": "challenge-4242",
        "hub.mode": "subscribe",
        "hub.verify_token": "wrong-token",
      }),
    );

    expect(response.status).toBe(403);
  });

  it("refuses when the mode is not subscribe or the env token is unset", () => {
    expect(
      GET(
        verificationRequest({
          "hub.challenge": "x",
          "hub.mode": "unsubscribe",
          "hub.verify_token": VERIFY_TOKEN,
        }),
      ).status,
    ).toBe(403);

    vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "");
    expect(
      GET(
        verificationRequest({
          "hub.challenge": "x",
          "hub.mode": "subscribe",
          "hub.verify_token": "",
        }),
      ).status,
    ).toBe(403);
  });
});

describe("WhatsApp webhook (POST)", () => {
  beforeEach(() => {
    vi.stubEnv("WHATSAPP_APP_SECRET", APP_SECRET);
    vi.stubEnv("WHATSAPP_USER_MAP", USER_MAP);
    mocks.afterTasks = [];
    mocks.resolveBridgeUser.mockResolvedValue(bridgeUser);
    mocks.planBridgeCommand.mockResolvedValue({
      actions: [{ ...gmailAction, approvalToken: "payload.signature" }],
      agentName: "Lina",
      command: "lis mes emails gmail non lus",
      response: "Lina prend le relais integrations.",
    });
    mocks.storePendingAction.mockResolvedValue(DRAFT_ID);
    mocks.claimPendingAction.mockResolvedValue(pendingDraft);
    mocks.executeBridgeAction.mockResolvedValue({
      details: ["• nabil@qarizmi.com — Demo client"],
      message: "Lina a lu 1 message(s) Gmail autorise(s).",
      success: true,
    });
    mocks.sendWhatsAppText.mockResolvedValue(undefined);
    mocks.sendWhatsAppButtons.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("rejects an invalid signature before any processing", async () => {
    const body = inboundPayload([textMessage("lis mes emails")]);
    const response = await POST(
      webhookRequest(body, { signature: "sha256=deadbeef" }),
    );

    await flushAfterTasks();

    expect(response.status).toBe(401);
    expect(mocks.planBridgeCommand).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("rejects a missing signature header", async () => {
    const body = inboundPayload([textMessage("lis mes emails")]);
    const request = new Request("http://localhost/api/whatsapp/webhook", {
      body,
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(mocks.planBridgeCommand).not.toHaveBeenCalled();
  });

  it("acks delivery statuses without processing", async () => {
    const body = inboundPayload([], {
      statuses: [{ id: "wamid.1", status: "delivered" }],
    });
    const response = await POST(webhookRequest(body));

    await flushAfterTasks();

    expect(response.status).toBe(200);
    expect(mocks.planBridgeCommand).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("plans a text command and sends the response plus approval buttons", async () => {
    const body = inboundPayload([textMessage("lis mes  emails gmail non lus")]);
    const response = await POST(webhookRequest(body));

    expect(response.status).toBe(200);

    await flushAfterTasks();

    expect(mocks.resolveBridgeUser).toHaveBeenCalledWith("ali@qarizmi.com");
    expect(mocks.planBridgeCommand).toHaveBeenCalledWith(
      bridgeUser,
      "lis mes emails gmail non lus",
    );

    expect(mocks.sendWhatsAppText).toHaveBeenCalledWith({
      body: "Lina prend le relais integrations.",
      to: KNOWN_PHONE,
    });

    expect(mocks.storePendingAction).toHaveBeenCalledWith({
      draft: pendingDraft,
      organizationId: "org-1",
      profileId: "profile-ali",
    });

    const buttonsMessage = mocks.sendWhatsAppButtons.mock.calls[0][0];
    expect(buttonsMessage.to).toBe(KNOWN_PHONE);
    expect(buttonsMessage.bodyText).toContain("Lire Gmail");
    expect(buttonsMessage.buttons).toEqual([
      { id: `naia_approve:${DRAFT_ID}`, title: "✅ Valider" },
      { id: `naia_dismiss:${DRAFT_ID}`, title: "❌ Ignorer" },
    ]);
  });

  it("answers unknown numbers without planning or storing anything", async () => {
    const body = inboundPayload([
      textMessage("lis mes emails", "999999999999"),
    ]);
    await POST(webhookRequest(body));
    await flushAfterTasks();

    expect(mocks.resolveBridgeUser).not.toHaveBeenCalled();
    expect(mocks.planBridgeCommand).not.toHaveBeenCalled();
    expect(mocks.storePendingAction).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppText).toHaveBeenCalledWith({
      body: expect.stringContaining("Numéro non reconnu"),
      to: "999999999999",
    });
  });

  it("answers mapped numbers without a Qarizmi profile and never plans", async () => {
    mocks.resolveBridgeUser.mockResolvedValue(null);

    const body = inboundPayload([textMessage("lis mes emails")]);
    await POST(webhookRequest(body));
    await flushAfterTasks();

    expect(mocks.planBridgeCommand).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppText).toHaveBeenCalledWith({
      body: expect.stringContaining("Compte non reconnu"),
      to: KNOWN_PHONE,
    });
  });

  it("executes an approved action from a button reply and sends the result", async () => {
    const body = inboundPayload([buttonReply(`naia_approve:${DRAFT_ID}`)]);
    const response = await POST(webhookRequest(body));

    expect(response.status).toBe(200);

    await flushAfterTasks();

    expect(mocks.claimPendingAction).toHaveBeenCalledWith({
      id: DRAFT_ID,
      profileId: "profile-ali",
    });
    expect(mocks.executeBridgeAction).toHaveBeenCalledWith(bridgeUser, {
      actionId: gmailAction.id,
      approvalToken: "payload.signature",
      command: "lis mes emails gmail non lus",
    });

    const resultMessage = mocks.sendWhatsAppText.mock.calls[0][0];
    expect(resultMessage.to).toBe(KNOWN_PHONE);
    expect(resultMessage.body).toContain("Lina a lu 1 message(s)");
    expect(resultMessage.body).toContain("Demo client");
  });

  it("refuses an expired, missing, or foreign draft without executing", async () => {
    mocks.claimPendingAction.mockResolvedValue(null);

    const body = inboundPayload([buttonReply(`naia_approve:${DRAFT_ID}`)]);
    await POST(webhookRequest(body));
    await flushAfterTasks();

    expect(mocks.executeBridgeAction).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppText).toHaveBeenCalledWith({
      body: expect.stringContaining("introuvable, expiré ou non autorisé"),
      to: KNOWN_PHONE,
    });
  });

  it("never executes a button reply from an unknown number", async () => {
    const body = inboundPayload([
      buttonReply(`naia_approve:${DRAFT_ID}`, "999999999999"),
    ]);
    await POST(webhookRequest(body));
    await flushAfterTasks();

    expect(mocks.claimPendingAction).not.toHaveBeenCalled();
    expect(mocks.executeBridgeAction).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppText).toHaveBeenCalledWith({
      body: expect.stringContaining("Numéro non reconnu"),
      to: "999999999999",
    });
  });

  it("deletes the draft and confirms when the user dismisses", async () => {
    const body = inboundPayload([buttonReply(`naia_dismiss:${DRAFT_ID}`)]);
    await POST(webhookRequest(body));
    await flushAfterTasks();

    expect(mocks.claimPendingAction).toHaveBeenCalledWith({
      id: DRAFT_ID,
      profileId: "profile-ali",
    });
    expect(mocks.executeBridgeAction).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppText).toHaveBeenCalledWith({
      body: expect.stringContaining("ignorée"),
      to: KNOWN_PHONE,
    });
  });

  it("reports execution failures in plain text", async () => {
    mocks.executeBridgeAction.mockResolvedValue({
      message: "Ton rôle (viewer) ne permet pas cette action CRM.",
      success: false,
    });

    const body = inboundPayload([buttonReply(`naia_approve:${DRAFT_ID}`)]);
    await POST(webhookRequest(body));
    await flushAfterTasks();

    expect(mocks.sendWhatsAppText).toHaveBeenCalledWith({
      body: expect.stringContaining("⚠️ Ton rôle (viewer)"),
      to: KNOWN_PHONE,
    });
  });

  it("rejects invalid JSON with a 400", async () => {
    const response = await POST(webhookRequest("not-json"));

    expect(response.status).toBe(400);
    expect(mocks.planBridgeCommand).not.toHaveBeenCalled();
  });
});
