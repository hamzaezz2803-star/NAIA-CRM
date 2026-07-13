import { after } from "next/server";

import {
  executeBridgeAction,
  planBridgeCommand,
  resolveBridgeUser,
  type NaiaBridgePlan,
  type NaiaBridgeUser,
} from "@/platform/naia/bridge";
import {
  claimInboundMessage,
  claimPendingAction,
  storePendingAction,
} from "@/platform/naia/pending-actions";
import {
  fetchWhatsAppHistory,
  storeWhatsAppMessage,
} from "@/platform/naia/whatsapp-memory";
import {
  resolveWhatsAppEmail,
  sendWhatsAppButtons,
  sendWhatsAppText,
  transcribeWhatsAppAudio,
  verifyWhatsAppSignature,
  WHATSAPP_INTERACTIVE_BODY_LIMIT,
  WHATSAPP_TEXT_BODY_LIMIT,
} from "@/platform/naia/whatsapp";

// WhatsApp Business Cloud API webhook for the NAIA bridge. Same contract as
// the Slack routes: verify the transport signature, ack fast, do the real
// work with after(), and keep every execution behind a human button tap.
// Identity comes from the admin-controlled WHATSAPP_USER_MAP phone→email map
// plus resolveBridgeUser. The destination phone-number id and sender allowlist
// are checked before after() is scheduled: unknown Airbnb guests are silently
// ignored without a reply, database write, provider read, or LLM call.

const APPROVE_PREFIX = "naia_approve:";
const DISMISS_PREFIX = "naia_dismiss:";

// WhatsApp drafts live in the database (not in button values), so commands
// keep the full web-cockpit budget instead of Slack's 500-character limit.
const WHATSAPP_COMMAND_MAX_LENGTH = 2000;

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

type AuthorizedWhatsAppInboundMessage = WhatsAppInboundMessage & {
  authorizedEmail: string;
  from: string;
  id: string;
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

  after(async () => {
    for (const message of messages) {
      await handleInboundMessage(message);
    }
  });

  return Response.json({ ok: true });
}

function extractInboundMessages(
  payload: WhatsAppWebhookPayload,
): AuthorizedWhatsAppInboundMessage[] {
  const messages: AuthorizedWhatsAppInboundMessage[] = [];
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
    if (entry.id !== expectedBusinessAccountId) continue;

    for (const change of entry.changes ?? []) {
      if (
        change.field !== "messages" ||
        change.value?.metadata?.phone_number_id !== expectedPhoneNumberId
      ) {
        continue;
      }

      for (const message of change.value?.messages ?? []) {
        if (!message.id || !message.from) continue;

        const authorizedEmail = resolveWhatsAppEmail(message.from);
        if (!authorizedEmail) continue;

        const isText = message.type === "text" && Boolean(message.text?.body);
        const isAudio = message.type === "audio" && Boolean(message.audio?.id);
        const isButtonReply =
          message.type === "interactive" &&
          message.interactive?.type === "button_reply" &&
          Boolean(message.interactive.button_reply?.id);

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

async function handleInboundMessage(message: AuthorizedWhatsAppInboundMessage) {
  const from = message.from;

  try {
    const user = await resolveBridgeUser(message.authorizedEmail);
    if (!user || user.role !== "owner") {
      return;
    }

    // Meta delivers webhooks at least once: skip redeliveries of an already
    // processed wamid so a command is never planned (or executed) twice.
    if (!(await claimInboundMessage(message.id))) {
      return;
    }

    if (message.type === "text") {
      await handleTextCommand(user, from, message.text?.body ?? "");
      return;
    }

    if (message.type === "audio") {
      const transcript = await transcribeWhatsAppAudio(message.audio?.id ?? "");
      await handleTextCommand(user, from, transcript);
      return;
    }

    await handleButtonReply(
      user,
      from,
      message.interactive?.button_reply?.id ?? "",
    );
  } catch (error) {
    console.error("WhatsApp NAIA processing failed:", error);
    try {
      await sendWhatsAppText({
        body: "NAIA n'a pas pu traiter ce message. Réessaie dans un instant.",
        to: from,
      });
    } catch {
      // The error is already logged; nothing else can be reported to WhatsApp.
    }
  }
}

async function handleTextCommand(
  user: NaiaBridgeUser,
  to: string,
  text: string,
) {
  const command = text
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, WHATSAPP_COMMAND_MAX_LENGTH);
  if (!command) return;

  const history = await fetchWhatsAppHistory({
    organizationId: user.organizationId,
    profileId: user.profileId,
  });
  await storeWhatsAppMessage({
    content: command,
    organizationId: user.organizationId,
    profileId: user.profileId,
    role: "user",
  });

  const plan = await planBridgeCommand(
    user,
    command,
    WHATSAPP_COMMAND_MAX_LENGTH,
    history,
  );
  await sendWhatsAppText({ body: plan.response, to });

  for (const action of plan.actions) {
    // Each action is delivered independently: a failure on one approval
    // message must not swallow the remaining actions of the plan.
    try {
      const reviewText = formatWhatsAppAction(action);
      if (reviewText.length > WHATSAPP_TEXT_BODY_LIMIT) {
        await sendWhatsAppText({
          body: `L'action "${action.label}" est trop détaillée pour être affichée intégralement dans WhatsApp. Ouvre NAIA dans Qarizmi OS pour la vérifier sans contenu masqué.`,
          to,
        });
        continue;
      }

      // The HMAC token embeds the full approved action; the stored draft only
      // needs the reference {actionId, approvalToken, command} plus a label
      // for the confirmation messages.
      const draftId = await storePendingAction({
        draft: {
          actionId: action.id,
          actionLabel: action.label,
          approvalToken: action.approvalToken,
          command: plan.command,
        },
        organizationId: user.organizationId,
        profileId: user.profileId,
      });

      if (!draftId) {
        await sendWhatsAppText({
          body: `Impossible de préparer l'approbation pour "${action.label}". Réessaie dans un instant.`,
          to,
        });
        continue;
      }

      const buttons = [
        { id: `${APPROVE_PREFIX}${draftId}`, title: "✅ Valider" },
        { id: `${DISMISS_PREFIX}${draftId}`, title: "❌ Ignorer" },
      ];

      if (reviewText.length > WHATSAPP_INTERACTIVE_BODY_LIMIT) {
        await sendWhatsAppText({ body: reviewText, to });
      }

      await sendWhatsAppButtons({
        bodyText:
          reviewText.length > WHATSAPP_INTERACTIVE_BODY_LIMIT
            ? `Valider l'action « ${action.label} » affichée ci-dessus ?`
            : reviewText,
        buttons,
        to,
      });
    } catch (error) {
      console.error("WhatsApp approval message failed:", error);
      try {
        await sendWhatsAppText({
          body: `Impossible d'afficher les boutons pour "${action.label}". Renvoie ta commande à NAIA.`,
          to,
        });
      } catch {
        // Already logged; keep delivering the remaining actions.
      }
    }
  }
}

async function handleButtonReply(
  user: NaiaBridgeUser,
  to: string,
  buttonId: string,
) {
  if (buttonId.startsWith(DISMISS_PREFIX)) {
    const draft = await claimPendingAction({
      id: buttonId.slice(DISMISS_PREFIX.length),
      profileId: user.profileId,
    });

    await sendWhatsAppText({
      body: draft
        ? `❌ Action "${draft.actionLabel}" ignorée.`
        : "Cette action a déjà été traitée ou a expiré.",
      to,
    });
    return;
  }

  if (!buttonId.startsWith(APPROVE_PREFIX)) return;

  // The claim deletes the row (single-use tap), checks the draft belongs to
  // the profile resolved from this phone number, and rejects expired drafts.
  const draft = await claimPendingAction({
    id: buttonId.slice(APPROVE_PREFIX.length),
    profileId: user.profileId,
  });

  if (!draft) {
    await sendWhatsAppText({
      body: "⚠️ Brouillon d'action introuvable, expiré ou non autorisé pour ce numéro. Renvoie ta commande à NAIA.",
      to,
    });
    return;
  }

  // executeBridgeAction verifies the HMAC token (which embeds the approved
  // action), claims it single-use in naia_consumed_action_tokens before any
  // side effect, and runs the decoded action.
  const result = await executeBridgeAction(user, {
    actionId: draft.actionId,
    approvalToken: draft.approvalToken,
    command: draft.command,
  });
  const lines = [
    result.success ? `✅ ${result.message}` : `⚠️ ${result.message}`,
    ...(result.details ?? []),
  ];

  // sendWhatsAppText applies the surrogate-safe 4096-character truncation.
  await sendWhatsAppText({
    body: lines.join("\n"),
    to,
  });
}

function formatWhatsAppAction(action: NaiaBridgePlan["actions"][number]) {
  if (action.kind !== "crm.createLead") {
    return `${action.label}\n${action.description}`;
  }

  const draft = action.payload;
  const lines = [
    action.label,
    `Projet: ${draft.topic || "À compléter"}`,
    `Entreprise: ${draft.companyName || "À compléter"}`,
    `Contact: ${draft.contactName || "À compléter"}`,
    draft.contactJobTitle ? `Poste: ${draft.contactJobTitle}` : "",
    draft.contactEmail ? `Email: ${draft.contactEmail}` : "",
    draft.contactPhone ? `Téléphone: ${draft.contactPhone}` : "",
    draft.contactLinkedinUrl ? `LinkedIn: ${draft.contactLinkedinUrl}` : "",
    `Statut: ${draft.status || "À contacter"}`,
    draft.leadDate ? `Date: ${draft.leadDate}` : "",
    draft.source ? `Source: ${draft.source}` : "",
    draft.nextAction ? `Action suivante: ${draft.nextAction}` : "",
    draft.tags?.length ? `Tags: ${draft.tags.join(", ")}` : "",
    draft.notes ? `Notes: ${draft.notes}` : "",
  ].filter(Boolean);

  return lines.join("\n");
}
