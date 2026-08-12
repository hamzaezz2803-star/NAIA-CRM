import "server-only";

import {
  executeBridgeAction,
  planBridgeCommand,
  type NaiaBridgePlan,
  type NaiaBridgeUser,
} from "@/platform/naia/bridge";
import {
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
  WHATSAPP_INTERACTIVE_BODY_LIMIT,
  WHATSAPP_TEXT_BODY_LIMIT,
} from "@/platform/naia/whatsapp";
import type { AuthorizedWhatsAppInboundMessage } from "@/platform/naia/whatsapp-inbox";
import { resolveScopedBridgeUser } from "@/platform/naia/scoped-bridge-user";

const APPROVE_PREFIX = "naia_approve:";
const DISMISS_PREFIX = "naia_dismiss:";
const WHATSAPP_COMMAND_MAX_LENGTH = 2000;

export async function processWhatsAppInboundMessage(
  message: AuthorizedWhatsAppInboundMessage,
) {
  const from = message.from;

  try {
    const currentMappedEmail = resolveWhatsAppEmail(from);
    if (currentMappedEmail !== message.authorizedEmail) return;

    const user = await resolveScopedBridgeUser({
      email: message.authorizedEmail,
      organizationId: message.organizationId,
      profileId: message.profileId,
    });
    if (!user || user.role !== "owner") return;

    if (message.type === "text") {
      await handleTextCommand(user, from, message.text?.body ?? "", message.id);
      return;
    }

    if (message.type === "audio") {
      const transcript = await transcribeWhatsAppAudio(message.audio?.id ?? "");
      await handleTextCommand(user, from, transcript, message.id);
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
    } catch (notificationError) {
      throw new Error("whatsapp_processing_and_notification_failed", {
        cause: notificationError,
      });
    }

    throw new Error("whatsapp_processing_failed", { cause: error });
  }
}

async function handleTextCommand(
  user: NaiaBridgeUser,
  to: string,
  text: string,
  messageId: string,
) {
  const command = text
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, WHATSAPP_COMMAND_MAX_LENGTH);
  if (!command) return;

  const history = await fetchWhatsAppHistory({
    excludeMessageId: messageId,
    organizationId: user.organizationId,
    profileId: user.profileId,
  });
  await storeWhatsAppMessage({
    content: command,
    messageId,
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

  const latencyMs = Math.min(
    1800,
    Math.max(500, Math.round(plan.response.length * 3)),
  );
  await new Promise((resolve) => setTimeout(resolve, latencyMs));

  await sendWhatsAppText({ body: plan.response, to });

  for (const action of plan.actions) {
    try {
      const reviewText = formatWhatsAppAction(action);
      if (reviewText.length > WHATSAPP_TEXT_BODY_LIMIT) {
        await sendWhatsAppText({
          body: `L'action "${action.label}" est trop détaillée pour être affichée intégralement dans WhatsApp. Ouvre NAIA dans Qarizmi OS pour la vérifier sans contenu masqué.`,
          to,
        });
        continue;
      }

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
        // Keep delivering any remaining independently prepared actions.
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

  const result = await executeBridgeAction(user, {
    actionId: draft.actionId,
    approvalToken: draft.approvalToken,
    command: draft.command,
  });
  const lines = [
    result.success ? `✅ ${result.message}` : `⚠️ ${result.message}`,
    ...(result.details ?? []),
  ];

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
