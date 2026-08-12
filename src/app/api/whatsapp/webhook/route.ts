import { after } from "next/server";

import { processWhatsAppInboundMessage } from "@/platform/naia/whatsapp-inbound";
import {
  drainWhatsAppInboundQueue,
  enqueueWhatsAppInboundMessages,
  type AuthorizedWhatsAppInboundMessage,
} from "@/platform/naia/whatsapp-inbox";
import {
  resolveWhatsAppEmail,
  verifyWhatsAppSignature,
} from "@/platform/naia/whatsapp";
import { resolveOwnerBridgeUserByEmail } from "@/platform/naia/scoped-bridge-user";

// WhatsApp Business Cloud API webhook for the NAIA bridge. Same contract as
// the Slack routes: verify the transport signature, persist authorized work,
// ack fast, and keep every execution behind a human button tap.
// Identity comes from the admin-controlled WHATSAPP_USER_MAP phone→email map
// plus resolveBridgeUser. The destination phone-number id and sender allowlist
// are checked before the durable insert: unknown Airbnb guests are silently
// ignored without a reply, database write, provider read, or LLM call.

export const maxDuration = 60;

type WhatsAppInboundMessage = {
  audio?: { id?: string; mime_type?: string };
  from?: string;
  id?: string;
  interactive?: {
    button_reply?: { id?: string; title?: string };
    type?: string;
  };
  text?: { body?: string };
  type?: string;
};

type MappedWhatsAppInboundMessage = WhatsAppInboundMessage & {
  authorizedEmail: string;
  from: string;
  id: string;
};

type WhatsAppWebhookPayload = {
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: {
          display_phone_number?: string;
          phone_number_id?: string;
        };
        messages?: WhatsAppInboundMessage[];
        statuses?: unknown[];
      };
    }>;
  }>;
  object?: string;
};

// Meta webhook verification handshake: echo hub.challenge as plain text when
// the verify token matches, 403 otherwise.
export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (
    params.get("hub.mode") === "subscribe" &&
    verifyToken &&
    params.get("hub.verify_token") === verifyToken
  ) {
    return new Response(params.get("hub.challenge") ?? "", {
      headers: { "content-type": "text/plain" },
      status: 200,
    });
  }

  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  // The signature covers the RAW body, so it must be read as text and
  // verified before any JSON.parse.
  const body = await request.text();

  if (
    !verifyWhatsAppSignature({
      body,
      signature: request.headers.get("x-hub-signature-256"),
    })
  ) {
    return Response.json(
      { error: "Invalid WhatsApp signature" },
      { status: 401 },
    );
  }

  let payload: WhatsAppWebhookPayload;
  try {
    payload = JSON.parse(body) as WhatsAppWebhookPayload;
  } catch {
    return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  // Delivery/read receipts (value.statuses) are acked without processing;
  // only user messages are actionable.
  const messages = extractInboundMessages(payload);
  if (messages.length === 0) {
    return Response.json({ ok: true });
  }

  let authorizedMessages: AuthorizedWhatsAppInboundMessage[];
  try {
    authorizedMessages = await filterCurrentOwners(messages);
  } catch (error) {
    console.error("WhatsApp owner authorization failed:", error);
    return Response.json(
      { error: "WhatsApp authorization is temporarily unavailable" },
      { status: 503 },
    );
  }
  if (authorizedMessages.length === 0) {
    return Response.json({ ok: true });
  }

  // The durable insert finishes before HTTP 200. Meta may now stop retrying:
  // an interrupted after() callback is recovered by the inbox cron.
  if (!(await enqueueWhatsAppInboundMessages(authorizedMessages))) {
    return Response.json(
      { error: "WhatsApp messages could not be persisted" },
      { status: 503 },
    );
  }

  try {
    after(async () => {
      await drainWhatsAppInboundQueue({
        maxMessages: 4,
        processMessage: processWhatsAppInboundMessage,
      });
    });
  } catch {
    // Persistence already succeeded. The protected recovery cron will drain
    // the queue, so a 200 avoids a redundant Meta redelivery.
  }

  return Response.json({ ok: true });
}

async function filterCurrentOwners(
  messages: MappedWhatsAppInboundMessage[],
): Promise<AuthorizedWhatsAppInboundMessage[]> {
  const userByEmail = new Map<
    string,
    Awaited<ReturnType<typeof resolveOwnerBridgeUserByEmail>>
  >();
  const authorized: AuthorizedWhatsAppInboundMessage[] = [];

  for (const message of messages) {
    if (!userByEmail.has(message.authorizedEmail)) {
      const user = await resolveOwnerBridgeUserByEmail(message.authorizedEmail);
      userByEmail.set(message.authorizedEmail, user);
    }

    const user = userByEmail.get(message.authorizedEmail);
    if (!user || user.role !== "owner") continue;

    authorized.push({
      ...message,
      organizationId: user.organizationId,
      profileId: user.profileId,
    });
  }

  return authorized;
}

function extractInboundMessages(
  payload: WhatsAppWebhookPayload,
): MappedWhatsAppInboundMessage[] {
  const messages: MappedWhatsAppInboundMessage[] = [];
  const expectedPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const expectedBusinessAccountId =
    process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim();
  if (
    payload.object !== "whatsapp_business_account" ||
    !expectedPhoneNumberId ||
    !expectedBusinessAccountId
  ) {
    return messages;
  }

  for (const entry of payload.entry ?? []) {
    if (entry.id && String(entry.id).trim() !== expectedBusinessAccountId)
      continue;

    for (const change of entry.changes ?? []) {
      if (
        change.field !== "messages" ||
        (change.value?.metadata?.phone_number_id &&
          String(change.value.metadata.phone_number_id).trim() !==
            expectedPhoneNumberId)
      ) {
        continue;
      }

      for (const message of change.value?.messages ?? []) {
        if (!message.id || !message.from) continue;

        const authorizedEmail = resolveWhatsAppEmail(message.from);
        if (!authorizedEmail) continue;

        const isText =
          message.type === "text" && Boolean(message.text?.body?.trim());
        const isAudio =
          message.type === "audio" && Boolean(message.audio?.id?.trim());
        const isButtonReply =
          message.type === "interactive" &&
          message.interactive?.type === "button_reply" &&
          Boolean(message.interactive.button_reply?.id?.trim());

        if (isText || isAudio || isButtonReply) {
          messages.push({
            ...message,
            authorizedEmail,
            from: message.from,
            id: message.id,
          });
        }
      }
    }
  }

  return messages;
}
