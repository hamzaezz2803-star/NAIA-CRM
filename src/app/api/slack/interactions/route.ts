import { after } from "next/server";

import {
  fetchSlackUserProfile,
  respondToSlackInteraction,
  verifySlackSignature,
} from "@/platform/integrations/slack";
import { executeBridgeAction, resolveBridgeUser } from "@/platform/naia/bridge";
import { decodeSlackApprovalValue } from "@/platform/naia/slack-approval";

// Slack interactivity endpoint: handles the "✅ Valider" / "❌ Ignorer"
// buttons posted by /api/slack/events. Every click re-verifies the Slack
// signature, re-resolves the Slack user by email (an unresolved user never
// executes anything), then executeBridgeAction re-verifies the HMAC approval
// token (which embeds the approved action) and claims it as single-use before
// running. The original message is updated via response_url with the status
// line only; sensitive result details (emails, agenda) are sent as an
// ephemeral reply visible only to the clicking user.

type SlackBlock = {
  block_id?: string;
  [key: string]: unknown;
};

type SlackInteractionPayload = {
  actions?: Array<{
    action_id?: string;
    value?: string;
  }>;
  message?: {
    blocks?: SlackBlock[];
  };
  response_url?: string;
  type?: string;
  user?: {
    id?: string;
    username?: string;
  };
};

export async function POST(request: Request) {
  const body = await request.text();

  if (
    !verifySlackSignature({
      body,
      signature: request.headers.get("x-slack-signature"),
      timestamp: request.headers.get("x-slack-request-timestamp"),
    })
  ) {
    return Response.json({ error: "Invalid Slack signature" }, { status: 401 });
  }

  const rawPayload = new URLSearchParams(body).get("payload");
  if (!rawPayload) {
    return Response.json({ error: "Missing payload" }, { status: 400 });
  }

  let payload: SlackInteractionPayload;
  try {
    payload = JSON.parse(rawPayload) as SlackInteractionPayload;
  } catch {
    return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (payload.type !== "block_actions") {
    return new Response(null, { status: 200 });
  }

  const interaction = payload.actions?.[0];
  const responseUrl = payload.response_url;
  const slackUserId = payload.user?.id;

  if (!interaction?.action_id || !responseUrl || !slackUserId) {
    return new Response(null, { status: 200 });
  }

  // Ack the click within Slack's 3 second budget, then process.
  after(async () => {
    await handleInteraction({ interaction, payload, responseUrl, slackUserId });
  });

  return new Response(null, { status: 200 });
}

async function handleInteraction({
  interaction,
  payload,
  responseUrl,
  slackUserId,
}: {
  interaction: { action_id?: string; value?: string };
  payload: SlackInteractionPayload;
  responseUrl: string;
  slackUserId: string;
}) {
  try {
    const actionId = interaction.action_id ?? "";

    if (actionId.startsWith("naia_dismiss:")) {
      const draftActionId = actionId.slice("naia_dismiss:".length);
      await updateOriginalMessage({
        draftActionId,
        payload,
        responseUrl,
        statusText: "❌ Action ignorée.",
      });
      return;
    }

    if (!actionId.startsWith("naia_approve:")) {
      return;
    }

    const draftActionId = actionId.slice("naia_approve:".length);
    const draft = interaction.value
      ? decodeSlackApprovalValue(interaction.value)
      : null;

    if (!draft) {
      await updateOriginalMessage({
        draftActionId,
        payload,
        responseUrl,
        statusText:
          "⚠️ Brouillon d'action introuvable ou expiré. Renvoie ta commande à NAIA.",
      });
      return;
    }

    // Re-resolve the clicking user on every click: the approver may differ
    // from the author, and an unrecognized account must never execute.
    const profile = await fetchSlackUserProfile(slackUserId);
    const user = profile?.email ? await resolveBridgeUser(profile.email) : null;

    if (!user) {
      await respondToSlackInteraction(responseUrl, {
        replace_original: false,
        response_type: "ephemeral",
        text: "Compte non reconnu : action refusée. Connecte-toi d'abord sur https://os.qarizmi.com avec ton compte Google Qarizmi.",
      });
      return;
    }

    // Immediate feedback in the shared message before the (possibly slow)
    // execution; the single-use token claim still guards double submits.
    await updateOriginalMessage({
      draftActionId,
      payload,
      responseUrl,
      statusText: "⏳ Validation en cours…",
    });

    const result = await executeBridgeAction(user, draft);
    const approverLabel = profile?.displayName || user.email;
    const statusText = result.success
      ? `✅ Validée par ${approverLabel} — ${result.message}`
      : `⚠️ ${result.message}`;

    // The shared message only carries the status line; details (emails,
    // agenda entries) stay private to the clicking user.
    await updateOriginalMessage({
      draftActionId,
      payload,
      responseUrl,
      statusText,
    });

    if (result.details && result.details.length > 0) {
      await respondToSlackInteraction(responseUrl, {
        replace_original: false,
        response_type: "ephemeral",
        text: result.details.join("\n").slice(0, 2900),
      });
    }
  } catch (error) {
    console.error("Slack NAIA interaction processing failed:", error);
    try {
      await respondToSlackInteraction(responseUrl, {
        replace_original: false,
        response_type: "ephemeral",
        text: "NAIA n'a pas pu exécuter cette action. Réessaie dans un instant.",
      });
    } catch {
      // The error is already logged; nothing else can be reported to Slack.
    }
  }
}

// Rebuilds the original message from the blocks Slack sent with the click:
// the clicked action's buttons are replaced by a status line. Details are
// deliberately never injected into the shared message.
async function updateOriginalMessage({
  draftActionId,
  payload,
  responseUrl,
  statusText,
}: {
  draftActionId: string;
  payload: SlackInteractionPayload;
  responseUrl: string;
  statusText: string;
}) {
  const originalBlocks = payload.message?.blocks;

  if (!originalBlocks || originalBlocks.length === 0) {
    await respondToSlackInteraction(responseUrl, {
      replace_original: false,
      text: statusText,
    });
    return;
  }

  const blocks: unknown[] = originalBlocks.map((block) =>
    block.block_id === `naia_action_buttons:${draftActionId}` ||
    block.block_id === `naia_action_result:${draftActionId}`
      ? {
          block_id: `naia_action_result:${draftActionId}`,
          elements: [{ text: statusText, type: "mrkdwn" }],
          type: "context",
        }
      : block,
  );

  await respondToSlackInteraction(responseUrl, {
    blocks,
    replace_original: true,
    text: statusText,
  });
}
