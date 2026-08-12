import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  afterRegistrationError: undefined as Error | undefined,
  afterTasks: [] as Array<() => Promise<void> | void>,
  claimPendingAction: vi.fn(),
  drainWhatsAppInboundQueue: vi.fn(),
  enqueueWhatsAppInboundMessages: vi.fn(),
  executeBridgeAction: vi.fn(),
  fetchWhatsAppHistory: vi.fn(),
  planBridgeCommand: vi.fn(),
  resolveOwnerBridgeUserByEmail: vi.fn(),
  resolveScopedBridgeUser: vi.fn(),
  sendWhatsAppButtons: vi.fn(),
  sendWhatsAppText: vi.fn(),
  storePendingAction: vi.fn(),
  storeWhatsAppMessage: vi.fn(),
  transcribeWhatsAppAudio: vi.fn(),
}));

vi.mock("next/server", () => ({
  after: (task: () => Promise<void>) => {
    if (mocks.afterRegistrationError) throw mocks.afterRegistrationError;
    mocks.afterTasks.push(task);
  },
}));

vi.mock("@/platform/naia/bridge", () => ({
  executeBridgeAction: mocks.executeBridgeAction,
  planBridgeCommand: mocks.planBridgeCommand,
}));

vi.mock("@/platform/naia/scoped-bridge-user", () => ({
  resolveOwnerBridgeUserByEmail: mocks.resolveOwnerBridgeUserByEmail,
  resolveScopedBridgeUser: mocks.resolveScopedBridgeUser,
}));

vi.mock("@/platform/naia/pending-actions", () => ({
  claimPendingAction: mocks.claimPendingAction,
  storePendingAction: mocks.storePendingAction,
}));

vi.mock("@/platform/naia/whatsapp-inbox", () => ({
  drainWhatsAppInboundQueue: mocks.drainWhatsAppInboundQueue,
  enqueueWhatsAppInboundMessages: mocks.enqueueWhatsAppInboundMessages,
}));

vi.mock("@/platform/naia/whatsapp-memory", () => ({
  fetchWhatsAppHistory: mocks.fetchWhatsAppHistory,
  storeWhatsAppMessage: mocks.storeWhatsAppMessage,
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
    transcribeWhatsAppAudio: mocks.transcribeWhatsAppAudio,
  };
});

import { GET, POST } from "./route";

const APP_SECRET = "test-app-secret";
const VERIFY_TOKEN = "verify-token-123";
const USER_MAP = "212661234567:ali@qarizmi.com, +33612345678:nabil@qarizmi.com";
const KNOWN_PHONE = "212661234567";
const PHONE_NUMBER_ID = "1234567890";
const BUSINESS_ACCOUNT_ID = "waba-1";
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

const crmLeadAction = {
  agentId: "crm",
  approvalRequired: true,
  description: "Salma préparera le lead HPS avant validation.",
  id: "crm-create-hps",
  kind: "crm.createLead",
  label: "Créer le lead CRM",
  payload: {
    companyName: "HPS",
    contactEmail: "abdeslam@hps-worldwide.com",
    contactJobTitle: "Directeur innovation",
    contactLinkedinUrl: "https://linkedin.com/in/abdeslam",
    contactName: "Abdeslam Alaoui Ismaili",
    contactPhone: "+212600000000",
    leadDate: "2026-07-17T11:00:00+01:00",
    nextAction: "Préparer le meeting et confirmer l'invitation",
    notes: "Échange sur le LLM local et les cas d'usage IA.",
    source: "WhatsApp",
    status: "meeting-booked",
    topic: "Meeting HPS - LLM local",
    tags: ["IA", "HPS"],
  },
  risk: "medium",
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
  phoneNumberId = PHONE_NUMBER_ID,
  businessAccountId = BUSINESS_ACCOUNT_ID,
  object = "whatsapp_business_account",
) {
  return JSON.stringify({
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              messages,
              metadata: {
                display_phone_number: "+33123456789",
                phone_number_id: phoneNumberId,
              },
              ...value,
            },
          },
        ],
        id: businessAccountId,
      },
    ],
    object,
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

function audioMessage(id = "media-audio-1", from = KNOWN_PHONE) {
  return {
    audio: { id, mime_type: "audio/ogg; codecs=opus" },
    from,
    id: "wamid.audio",
    type: "audio",
  };
}

async function flushAfterTasks() {
  const tasks = mocks.afterTasks.splice(0);
  await Promise.all(tasks.map((task) => task()));
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
    vi.stubEnv("WHATSAPP_BUSINESS_ACCOUNT_ID", BUSINESS_ACCOUNT_ID);
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", PHONE_NUMBER_ID);
    vi.stubEnv("WHATSAPP_USER_MAP", USER_MAP);
    mocks.afterRegistrationError = undefined;
    mocks.afterTasks = [];
    mocks.enqueueWhatsAppInboundMessages.mockResolvedValue(true);
    mocks.drainWhatsAppInboundQueue.mockImplementation(
      async ({ processMessage }) => {
        const messages =
          mocks.enqueueWhatsAppInboundMessages.mock.calls.at(-1)?.[0];
        for (const message of messages ?? []) await processMessage(message);
        return {
          claimed: messages?.length ?? 0,
          completed: messages?.length ?? 0,
          failed: 0,
        };
      },
    );
    mocks.resolveOwnerBridgeUserByEmail.mockResolvedValue(bridgeUser);
    mocks.resolveScopedBridgeUser.mockResolvedValue(bridgeUser);
    mocks.fetchWhatsAppHistory.mockResolvedValue([]);
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
    mocks.storeWhatsAppMessage.mockResolvedValue(undefined);
    mocks.transcribeWhatsAppAudio.mockResolvedValue(
      "crée un lead pour HPS avec Abdelslam",
    );
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

  it("acks only after durable storage and before provider or LLM work", async () => {
    const response = await POST(
      webhookRequest(inboundPayload([textMessage("lis mes emails")])),
    );

    expect(response.status).toBe(200);
    expect(mocks.afterTasks).toHaveLength(1);
    expect(mocks.resolveOwnerBridgeUserByEmail).toHaveBeenCalledWith(
      "ali@qarizmi.com",
    );
    expect(mocks.enqueueWhatsAppInboundMessages).toHaveBeenCalledOnce();
    expect(mocks.planBridgeCommand).not.toHaveBeenCalled();

    await flushAfterTasks();
    expect(mocks.planBridgeCommand).toHaveBeenCalledOnce();
  });

  it("processes a Meta message batch in one ordered background task", async () => {
    const first = {
      ...textMessage("crée un lead pour HPS"),
      id: "wamid.batch-1",
    };
    const followUp = {
      ...textMessage("Abdeslam est le contact"),
      id: "wamid.batch-2",
    };

    const response = await POST(
      webhookRequest(inboundPayload([first, followUp])),
    );

    expect(response.status).toBe(200);
    expect(mocks.afterTasks).toHaveLength(1);

    await flushAfterTasks();

    expect(mocks.planBridgeCommand).toHaveBeenCalledTimes(2);
    expect(mocks.planBridgeCommand.mock.calls.map((call) => call[1])).toEqual([
      "crée un lead pour HPS",
      "Abdeslam est le contact",
    ]);
    expect(mocks.sendWhatsAppText).toHaveBeenCalledTimes(2);
  });

  it("acks durable messages even when background work cannot be registered", async () => {
    mocks.afterRegistrationError = new Error("after unavailable");

    const response = await POST(
      webhookRequest(inboundPayload([textMessage("lis mes emails")])),
    );

    expect(response.status).toBe(200);
    expect(mocks.enqueueWhatsAppInboundMessages).toHaveBeenCalledOnce();
    expect(mocks.resolveOwnerBridgeUserByEmail).toHaveBeenCalledWith(
      "ali@qarizmi.com",
    );
  });

  it("asks Meta to retry when the durable inbox insert fails", async () => {
    mocks.enqueueWhatsAppInboundMessages.mockResolvedValue(false);

    const response = await POST(
      webhookRequest(inboundPayload([textMessage("lis mes emails")])),
    );

    expect(response.status).toBe(503);
    expect(mocks.afterTasks).toHaveLength(0);
    expect(mocks.resolveOwnerBridgeUserByEmail).toHaveBeenCalledWith(
      "ali@qarizmi.com",
    );
  });

  it("asks Meta to retry when owner authorization has a transient failure", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.resolveOwnerBridgeUserByEmail.mockRejectedValue(
      new Error("database unavailable"),
    );

    const response = await POST(
      webhookRequest(inboundPayload([textMessage("lis mes emails")])),
    );

    expect(response.status).toBe(503);
    expect(mocks.enqueueWhatsAppInboundMessages).not.toHaveBeenCalled();
    expect(mocks.afterTasks).toHaveLength(0);
    errorSpy.mockRestore();
  });

  it("plans a text command and sends the response plus approval buttons", async () => {
    const body = inboundPayload([textMessage("lis mes  emails gmail non lus")]);
    const response = await POST(webhookRequest(body));

    expect(response.status).toBe(200);

    await flushAfterTasks();

    expect(mocks.resolveOwnerBridgeUserByEmail).toHaveBeenCalledWith(
      "ali@qarizmi.com",
    );
    expect(mocks.planBridgeCommand).toHaveBeenCalledWith(
      bridgeUser,
      "lis mes emails gmail non lus",
      2000,
      [],
    );

    expect(mocks.storeWhatsAppMessage).toHaveBeenCalledOnce();
    expect(mocks.storeWhatsAppMessage).toHaveBeenCalledWith({
      content: "lis mes emails gmail non lus",
      messageId: "wamid.text",
      organizationId: "org-1",
      profileId: "profile-ali",
      role: "user",
    });
    expect(mocks.fetchWhatsAppHistory).toHaveBeenCalledWith({
      excludeMessageId: "wamid.text",
      organizationId: "org-1",
      profileId: "profile-ali",
    });

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

  it("rethrows a processing failure after notifying the founder", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.planBridgeCommand.mockRejectedValueOnce(
      new Error("provider temporarily unavailable"),
    );

    const response = await POST(
      webhookRequest(inboundPayload([textMessage("analyse mes CFs")])),
    );

    expect(response.status).toBe(200);
    await expect(flushAfterTasks()).rejects.toThrow(
      "whatsapp_processing_failed",
    );
    expect(mocks.sendWhatsAppText).toHaveBeenCalledWith({
      body: "NAIA n'a pas pu traiter ce message. Réessaie dans un instant.",
      to: KNOWN_PHONE,
    });
    errorSpy.mockRestore();
  });

  it("passes the founder's private history to the orchestrator", async () => {
    const history = [
      { content: "Crée un lead pour HPS.", role: "user" },
      { content: "Abdeslam est le contact.", role: "user" },
    ];
    mocks.fetchWhatsAppHistory.mockResolvedValue(history);

    const body = inboundPayload([textMessage("Abdeslam Alaoui Ismaili")]);
    await POST(webhookRequest(body));
    await flushAfterTasks();

    expect(mocks.fetchWhatsAppHistory).toHaveBeenCalledWith({
      excludeMessageId: "wamid.text",
      organizationId: "org-1",
      profileId: "profile-ali",
    });
    expect(mocks.planBridgeCommand).toHaveBeenCalledWith(
      bridgeUser,
      "Abdeslam Alaoui Ismaili",
      2000,
      history,
    );
  });

  it("shows the complete CRM lead draft before approval", async () => {
    mocks.planBridgeCommand.mockResolvedValue({
      actions: [{ ...crmLeadAction, approvalToken: "payload.signature" }],
      agentName: "Salma",
      command: "crée le lead HPS avec Abdeslam et un meeting vendredi à 11h",
      response: "Salma a préparé la fiche lead pour validation.",
    });

    const body = inboundPayload([
      textMessage(
        "crée le lead HPS avec Abdeslam et un meeting vendredi à 11h",
      ),
    ]);
    await POST(webhookRequest(body));
    await flushAfterTasks();

    const approvalMessage = mocks.sendWhatsAppButtons.mock.calls[0][0];
    expect(approvalMessage.bodyText).toContain(
      "Projet: Meeting HPS - LLM local",
    );
    expect(approvalMessage.bodyText).toContain("Entreprise: HPS");
    expect(approvalMessage.bodyText).toContain(
      "Contact: Abdeslam Alaoui Ismaili",
    );
    expect(approvalMessage.bodyText).toContain("Poste: Directeur innovation");
    expect(approvalMessage.bodyText).toContain(
      "Email: abdeslam@hps-worldwide.com",
    );
    expect(approvalMessage.bodyText).toContain("Téléphone: +212600000000");
    expect(approvalMessage.bodyText).toContain(
      "LinkedIn: https://linkedin.com/in/abdeslam",
    );
    expect(approvalMessage.bodyText).toContain("Statut: meeting-booked");
    expect(approvalMessage.bodyText).toContain(
      "Date: 2026-07-17T11:00:00+01:00",
    );
    expect(approvalMessage.bodyText).toContain("Source: WhatsApp");
    expect(approvalMessage.bodyText).toContain(
      "Action suivante: Préparer le meeting et confirmer l'invitation",
    );
    expect(approvalMessage.bodyText).toContain("Tags: IA, HPS");
    expect(approvalMessage.bodyText).toContain(
      "Notes: Échange sur le LLM local et les cas d'usage IA.",
    );
    expect(approvalMessage.buttons).toEqual([
      { id: `naia_approve:${DRAFT_ID}`, title: "✅ Valider" },
      { id: `naia_dismiss:${DRAFT_ID}`, title: "❌ Ignorer" },
    ]);
  });

  it("shows a long CRM draft in full before sending a short approval prompt", async () => {
    const notes = "Contexte confidentiel complet. ".repeat(45).trim();
    mocks.planBridgeCommand.mockResolvedValue({
      actions: [
        {
          ...crmLeadAction,
          approvalToken: "payload.signature",
          payload: { ...crmLeadAction.payload, notes },
        },
      ],
      agentName: "Salma",
      command: "crée le lead HPS avec toutes les notes",
      response: "Salma a préparé la fiche lead pour validation.",
    });

    await POST(
      webhookRequest(
        inboundPayload([textMessage("crée le lead HPS avec toutes les notes")]),
      ),
    );
    await flushAfterTasks();

    const fullReview = mocks.sendWhatsAppText.mock.calls.find(([message]) =>
      message.body.includes("Notes: Contexte confidentiel complet"),
    )?.[0];
    expect(fullReview?.body).toContain(notes);
    expect(fullReview?.body.length).toBeGreaterThan(1024);

    const approvalMessage = mocks.sendWhatsAppButtons.mock.calls[0][0];
    expect(approvalMessage.bodyText).toContain("affichée ci-dessus");
    expect(approvalMessage.bodyText.length).toBeLessThanOrEqual(1024);
    expect(mocks.storePendingAction).toHaveBeenCalledOnce();
  });

  it("refuses an action that cannot be displayed completely", async () => {
    mocks.planBridgeCommand.mockResolvedValue({
      actions: [
        {
          ...gmailAction,
          approvalToken: "payload.signature",
          description: "x".repeat(5000),
        },
      ],
      agentName: "Lina",
      command: "prépare une action très longue",
      response: "Lina a préparé une action.",
    });

    await POST(
      webhookRequest(
        inboundPayload([textMessage("prépare une action très longue")]),
      ),
    );
    await flushAfterTasks();

    expect(mocks.storePendingAction).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppButtons).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppText).toHaveBeenCalledWith({
      body: expect.stringContaining("trop détaillée"),
      to: KNOWN_PHONE,
    });
  });

  it("persists Meta redeliveries through the idempotent durable inbox", async () => {
    const body = inboundPayload([textMessage("lis mes emails gmail non lus")]);
    await POST(webhookRequest(body));
    await flushAfterTasks();
    await POST(webhookRequest(body));
    await flushAfterTasks();

    expect(mocks.enqueueWhatsAppInboundMessages).toHaveBeenCalledTimes(2);
  });

  it("keeps long commands untruncated on the WhatsApp channel", async () => {
    const longCommand = "cree un lead ".repeat(100).trim().slice(0, 1200);
    expect(longCommand).toHaveLength(1200);

    const body = inboundPayload([textMessage(longCommand)]);
    await POST(webhookRequest(body));
    await flushAfterTasks();

    // The full 1200-character command reaches the planner along with the
    // WhatsApp budget (2000), not Slack's 500-character constraint.
    expect(mocks.planBridgeCommand).toHaveBeenCalledWith(
      bridgeUser,
      longCommand,
      2000,
      [],
    );
  });

  it("still delivers the next action when one approval message fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const secondAction = {
      ...gmailAction,
      approvalToken: "payload.signature2",
      id: "calendar-list-def",
      label: "Lire Calendar",
    };
    mocks.planBridgeCommand.mockResolvedValue({
      actions: [
        { ...gmailAction, approvalToken: "payload.signature" },
        secondAction,
      ],
      agentName: "Lina",
      command: "lis mes emails gmail non lus",
      response: "Lina prend le relais integrations.",
    });
    mocks.sendWhatsAppButtons
      .mockRejectedValueOnce(new Error("Graph API down"))
      .mockResolvedValueOnce(undefined);

    const body = inboundPayload([textMessage("lis mes emails gmail non lus")]);
    await POST(webhookRequest(body));
    await flushAfterTasks();

    // Both actions were attempted despite the first send failing.
    expect(mocks.storePendingAction).toHaveBeenCalledTimes(2);
    expect(mocks.sendWhatsAppButtons).toHaveBeenCalledTimes(2);
    expect(mocks.sendWhatsAppButtons.mock.calls[1][0].bodyText).toContain(
      "Lire Calendar",
    );
    // The failure was reported to the user without aborting the loop.
    expect(mocks.sendWhatsAppText).toHaveBeenCalledWith({
      body: expect.stringContaining("Impossible d'afficher les boutons"),
      to: KNOWN_PHONE,
    });

    errorSpy.mockRestore();
  });

  it("silently ignores unknown Airbnb guests before any processing", async () => {
    const body = inboundPayload([
      textMessage("lis mes emails", "999999999999"),
    ]);
    await POST(webhookRequest(body));
    await flushAfterTasks();

    expect(mocks.enqueueWhatsAppInboundMessages).not.toHaveBeenCalled();
    expect(mocks.resolveOwnerBridgeUserByEmail).not.toHaveBeenCalled();
    expect(mocks.planBridgeCommand).not.toHaveBeenCalled();
    expect(mocks.storePendingAction).not.toHaveBeenCalled();
    expect(mocks.storeWhatsAppMessage).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("ignores messages delivered to another business phone number id", async () => {
    const body = inboundPayload(
      [textMessage("lis mes emails")],
      {},
      "different-phone-number-id",
    );
    await POST(webhookRequest(body));
    await flushAfterTasks();

    expect(mocks.enqueueWhatsAppInboundMessages).not.toHaveBeenCalled();
    expect(mocks.resolveOwnerBridgeUserByEmail).not.toHaveBeenCalled();
    expect(mocks.planBridgeCommand).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("ignores payloads from another WABA or object type", async () => {
    const wrongWabaBody = inboundPayload(
      [textMessage("lis mes emails")],
      {},
      PHONE_NUMBER_ID,
      "different-waba",
    );
    await POST(webhookRequest(wrongWabaBody));

    const wrongObjectBody = inboundPayload(
      [textMessage("lis mes emails")],
      {},
      PHONE_NUMBER_ID,
      BUSINESS_ACCOUNT_ID,
      "page",
    );
    await POST(webhookRequest(wrongObjectBody));
    await flushAfterTasks();

    expect(mocks.resolveOwnerBridgeUserByEmail).not.toHaveBeenCalled();
    expect(mocks.enqueueWhatsAppInboundMessages).not.toHaveBeenCalled();
    expect(mocks.planBridgeCommand).not.toHaveBeenCalled();
  });

  it("ignores messages without a Meta message id", async () => {
    const message = textMessage("lis mes emails");
    delete (message as { id?: string }).id;

    await POST(webhookRequest(inboundPayload([message])));
    await flushAfterTasks();

    expect(mocks.resolveOwnerBridgeUserByEmail).not.toHaveBeenCalled();
    expect(mocks.enqueueWhatsAppInboundMessages).not.toHaveBeenCalled();
    expect(mocks.planBridgeCommand).not.toHaveBeenCalled();
  });

  it("transcribes an authorized voice note and plans it as a command", async () => {
    const body = inboundPayload([audioMessage()]);
    await POST(webhookRequest(body));
    await flushAfterTasks();

    expect(mocks.transcribeWhatsAppAudio).toHaveBeenCalledWith("media-audio-1");
    expect(mocks.planBridgeCommand).toHaveBeenCalledWith(
      bridgeUser,
      "crée un lead pour HPS avec Abdelslam",
      2000,
      [],
    );
  });

  it("silently ignores mapped numbers without a Qarizmi profile", async () => {
    mocks.resolveOwnerBridgeUserByEmail.mockResolvedValue(null);

    const body = inboundPayload([textMessage("lis mes emails")]);
    await POST(webhookRequest(body));
    await flushAfterTasks();

    expect(mocks.planBridgeCommand).not.toHaveBeenCalled();
    expect(mocks.enqueueWhatsAppInboundMessages).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("silently ignores an unauthorized user without an org membership", async () => {
    mocks.resolveOwnerBridgeUserByEmail.mockResolvedValue(null);

    await POST(webhookRequest(inboundPayload([textMessage("lis mes emails")])));
    await flushAfterTasks();

    expect(mocks.enqueueWhatsAppInboundMessages).not.toHaveBeenCalled();
    expect(mocks.fetchWhatsAppHistory).not.toHaveBeenCalled();
    expect(mocks.planBridgeCommand).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("silently ignores a mapped non-owner before claiming the message", async () => {
    mocks.resolveOwnerBridgeUserByEmail.mockResolvedValue({
      ...bridgeUser,
      role: "member",
    });

    await POST(webhookRequest(inboundPayload([textMessage("lis mes emails")])));
    await flushAfterTasks();

    expect(mocks.enqueueWhatsAppInboundMessages).not.toHaveBeenCalled();
    expect(mocks.planBridgeCommand).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("honors an owner-role revocation between enqueue and processing", async () => {
    mocks.resolveScopedBridgeUser.mockResolvedValue({
      ...bridgeUser,
      role: "member",
    });

    const response = await POST(
      webhookRequest(inboundPayload([textMessage("lis mes emails")])),
    );
    expect(response.status).toBe(200);
    expect(mocks.enqueueWhatsAppInboundMessages).toHaveBeenCalledOnce();

    await flushAfterTasks();

    expect(mocks.planBridgeCommand).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("honors a phone-map revocation after enqueue and before processing", async () => {
    const response = await POST(
      webhookRequest(inboundPayload([textMessage("lis mes emails")])),
    );
    expect(response.status).toBe(200);
    expect(mocks.enqueueWhatsAppInboundMessages).toHaveBeenCalledOnce();

    vi.stubEnv(
      "WHATSAPP_USER_MAP",
      "212661234567:nabil@qarizmi.com,33612345678:nabil@qarizmi.com",
    );
    await flushAfterTasks();

    expect(mocks.resolveScopedBridgeUser).not.toHaveBeenCalled();
    expect(mocks.planBridgeCommand).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
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
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
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
