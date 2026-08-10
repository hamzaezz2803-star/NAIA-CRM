import { after } from "next/server";

import { crmLeadStatuses, type CrmLeadDraft } from "@/features/crm/contracts";
import {
  fetchSlackMessageSnapshot,
  fetchSlackUserProfile,
  openSlackModal,
  respondToSlackInteraction,
  updateSlackMessage,
  verifySlackSignature,
} from "@/platform/integrations/slack";
import {
  executeBridgeAction,
  executeEditedBridgeLeadAction,
  resolveBridgeUser,
} from "@/platform/naia/bridge";
import { verifyApprovalToken } from "@/platform/naia/action-tokens";
import {
  decodeSlackApprovalValue,
  type SlackApprovalDraft,
} from "@/platform/naia/slack-approval";

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
    thread_ts?: string;
    ts?: string;
  };
  container?: {
    channel_id?: string;
    message_ts?: string;
  };
  response_url?: string;
  trigger_id?: string;
  type?: string;
  user?: {
    id?: string;
    username?: string;
  };
  view?: {
    callback_id?: string;
    private_metadata?: string;
    state?: {
      values?: Record<
        string,
        Record<string, { selected_option?: { value?: string }; value?: string }>
      >;
    };
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

  if (
    payload.type === "view_submission" &&
    payload.view?.callback_id === "naia_edit_lead"
  ) {
    const submission = parseLeadModalSubmission(payload);
    if (!submission.ok) {
      return Response.json({
        errors: submission.errors,
        response_action: "errors",
      });
    }

    after(async () => {
      await handleLeadModalSubmission({ payload, submission });
    });
    return Response.json({ response_action: "clear" });
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

    if (actionId.startsWith("naia_edit_lead:")) {
      const draft = interaction.value
        ? decodeSlackApprovalValue(interaction.value)
        : null;
      const profile = await fetchSlackUserProfile(slackUserId);
      const user = profile?.email
        ? await resolveBridgeUser(profile.email)
        : null;
      const action = draft
        ? user &&
          verifyApprovalToken(
            draft.approvalToken,
            draft.actionId,
            draft.command,
            {
              actorProfileId: user.profileId,
              organizationId: user.organizationId,
            },
          )
        : null;

      if (!user) {
        await respondToSlackInteraction(responseUrl, {
          replace_original: false,
          response_type: "ephemeral",
          text: "Compte non reconnu : brouillon refusé.",
        });
        return;
      }

      if (!draft || action?.kind !== "crm.createLead" || !payload.trigger_id) {
        await respondToSlackInteraction(responseUrl, {
          replace_original: false,
          response_type: "ephemeral",
          text: "Brouillon de lead introuvable ou expiré. Renvoie ta commande à NAIA.",
        });
        return;
      }

      const privateMetadata = JSON.stringify({
        approvalDraft: draft,
        channelId: payload.container?.channel_id,
        messageTs: payload.container?.message_ts ?? payload.message?.ts,
        threadTs: payload.message?.thread_ts,
      } satisfies LeadModalMetadata);

      await openSlackModal({
        triggerId: payload.trigger_id,
        view: buildLeadEditModal(action.payload, privateMetadata),
      });
      return;
    }

    if (actionId.startsWith("naia_dismiss:")) {
      const draftActionId = actionId.slice("naia_dismiss:".length);
      const draft = interaction.value
        ? decodeSlackApprovalValue(interaction.value)
        : null;
      const profile = await fetchSlackUserProfile(slackUserId);
      const user = profile?.email
        ? await resolveBridgeUser(profile.email)
        : null;
      const boundAction =
        draft && user
          ? verifyApprovalToken(
              draft.approvalToken,
              draft.actionId,
              draft.command,
              {
                actorProfileId: user.profileId,
                organizationId: user.organizationId,
              },
            )
          : null;

      if (!draft || draft.actionId !== draftActionId || !boundAction) {
        await respondToSlackInteraction(responseUrl, {
          replace_original: false,
          response_type: "ephemeral",
          text: "Action ignorée refusée : ce brouillon appartient à un autre compte ou a expiré.",
        });
        return;
      }

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

type LeadModalMetadata = {
  approvalDraft: SlackApprovalDraft;
  channelId?: string;
  messageTs?: string;
  threadTs?: string;
};

type LeadModalSubmission = {
  draft: CrmLeadDraft;
  metadata: LeadModalMetadata;
  ok: true;
};

async function handleLeadModalSubmission({
  payload,
  submission,
}: {
  payload: SlackInteractionPayload;
  submission: LeadModalSubmission;
}) {
  const slackUserId = payload.user?.id;
  if (!slackUserId) return;

  try {
    const profile = await fetchSlackUserProfile(slackUserId);
    const user = profile?.email ? await resolveBridgeUser(profile.email) : null;
    if (!user) return;

    const { approvalDraft } = submission.metadata;
    const result = await executeEditedBridgeLeadAction(
      user,
      approvalDraft,
      submission.draft,
    );
    const approverLabel = profile?.displayName || user.email;
    const text = result.success
      ? `✅ Validée par ${approverLabel} — ${result.message}`
      : `⚠️ ${result.message}`;

    if (submission.metadata.channelId && submission.metadata.messageTs) {
      const snapshot = await fetchSlackMessageSnapshot({
        channel: submission.metadata.channelId,
        messageTs: submission.metadata.messageTs,
        threadTs: submission.metadata.threadTs,
      });
      const fallbackBlocks: SlackBlock[] = [
        {
          block_id: `naia_action_result:${approvalDraft.actionId}`,
          text: { text, type: "mrkdwn" },
          type: "section",
        },
      ];
      await updateSlackMessage({
        blocks:
          replaceActionBlocks(snapshot?.blocks, approvalDraft.actionId, text) ??
          fallbackBlocks,
        channel: submission.metadata.channelId,
        text,
        ts: submission.metadata.messageTs,
      });
    }
  } catch (error) {
    console.error("Slack NAIA lead modal submission failed:", error);
  }
}

function parseLeadModalSubmission(
  payload: SlackInteractionPayload,
): LeadModalSubmission | { errors: Record<string, string>; ok: false } {
  const metadata = parseLeadModalMetadata(payload.view?.private_metadata);
  if (!metadata) {
    return {
      errors: {
        lead_topic: "Ce brouillon a expiré. Ferme la fenêtre et recommence.",
      },
      ok: false,
    };
  }

  const topic = readModalValue(payload, "lead_topic", "value");
  const contactEmail = readModalValue(payload, "lead_email", "value");
  const errors: Record<string, string> = {};
  if (topic.trim().length < 3) {
    errors.lead_topic = "Indique un projet ou une opportunité.";
  }
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    errors.lead_email = "L'adresse email n'est pas valide.";
  }
  if (Object.keys(errors).length > 0) return { errors, ok: false };

  const status = readModalValue(payload, "lead_status", "selected");
  return {
    draft: {
      companyName: optionalModalValue(payload, "lead_company"),
      contactEmail: contactEmail || undefined,
      contactJobTitle: optionalModalValue(payload, "lead_job_title"),
      contactLinkedinUrl: optionalModalValue(payload, "lead_linkedin"),
      contactName: optionalModalValue(payload, "lead_contact"),
      contactPhone: optionalModalValue(payload, "lead_phone"),
      leadDate: optionalModalValue(payload, "lead_date"),
      nextAction: optionalModalValue(payload, "lead_next_action"),
      notes: optionalModalValue(payload, "lead_notes"),
      source: optionalModalValue(payload, "lead_source"),
      status: (crmLeadStatuses as readonly string[]).includes(status)
        ? status
        : "lead-to-contact",
      topic: topic.trim().slice(0, 160),
    },
    metadata,
    ok: true,
  };
}

function parseLeadModalMetadata(value: string | undefined) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as LeadModalMetadata;
    return parsed.approvalDraft?.actionId &&
      parsed.approvalDraft?.approvalToken &&
      parsed.approvalDraft?.command
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function optionalModalValue(payload: SlackInteractionPayload, blockId: string) {
  return readModalValue(payload, blockId, "value") || undefined;
}

function readModalValue(
  payload: SlackInteractionPayload,
  blockId: string,
  kind: "selected" | "value",
) {
  const values = payload.view?.state?.values?.[blockId];
  const input = values ? Object.values(values)[0] : undefined;
  const value =
    kind === "selected" ? input?.selected_option?.value : input?.value;
  return typeof value === "string" ? value.trim() : "";
}

function buildLeadEditModal(
  draft: CrmLeadDraft,
  privateMetadata: string,
): Record<string, unknown> {
  return {
    blocks: [
      leadTextInput("lead_topic", "Projet / opportunité", draft.topic, false),
      leadTextInput("lead_company", "Entreprise", draft.companyName),
      leadTextInput("lead_contact", "Contact", draft.contactName),
      leadTextInput(
        "lead_job_title",
        "Fonction / poste",
        draft.contactJobTitle,
      ),
      leadTextInput("lead_email", "Email", draft.contactEmail),
      leadTextInput("lead_phone", "Téléphone", draft.contactPhone),
      leadTextInput("lead_linkedin", "LinkedIn", draft.contactLinkedinUrl),
      leadTextInput("lead_source", "Source", draft.source),
      leadStatusInput(draft.status),
      leadTextInput("lead_date", "Date planifiée (ISO)", draft.leadDate),
      leadTextInput("lead_next_action", "Action suivante", draft.nextAction),
      leadTextInput("lead_notes", "Notes & contexte", draft.notes, true, true),
    ],
    callback_id: "naia_edit_lead",
    close: { text: "Annuler", type: "plain_text" },
    private_metadata: privateMetadata.slice(0, 3000),
    submit: { text: "Valider et créer", type: "plain_text" },
    title: { text: "Vérifier le lead", type: "plain_text" },
    type: "modal",
  };
}

function leadTextInput(
  blockId: string,
  label: string,
  value?: string,
  optional = true,
  multiline = false,
) {
  return {
    block_id: blockId,
    element: {
      action_id: "value",
      ...(value ? { initial_value: value.slice(0, 2800) } : {}),
      multiline,
      type: "plain_text_input",
    },
    label: { text: label, type: "plain_text" },
    optional,
    type: "input",
  };
}

function leadStatusInput(status: string) {
  const labels: Record<string, string> = {
    contacted: "Contacté",
    "dead-end": "Dead end",
    "lead-to-contact": "À contacter",
    "meeting-booked": "Meeting fixé",
    "proposal-sent": "Proposition envoyée",
    "to-follow-up": "À relancer",
    won: "Gagné",
  };
  const options = crmLeadStatuses.map((value) => ({
    text: { text: labels[value] ?? value, type: "plain_text" },
    value,
  }));
  const initialOption = options.find((option) => option.value === status);

  return {
    block_id: "lead_status",
    element: {
      action_id: "selected",
      ...(initialOption ? { initial_option: initialOption } : {}),
      options,
      type: "static_select",
    },
    label: { text: "Statut initial", type: "plain_text" },
    type: "input",
  };
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

  const blocks = replaceActionBlocks(originalBlocks, draftActionId, statusText);

  await respondToSlackInteraction(responseUrl, {
    blocks,
    replace_original: true,
    text: statusText,
  });
}

function replaceActionBlocks(
  originalBlocks: unknown[] | undefined,
  draftActionId: string,
  statusText: string,
) {
  if (!originalBlocks) return undefined;

  return originalBlocks.map((rawBlock) => {
    const block = rawBlock as SlackBlock;
    return block.block_id === `naia_action_buttons:${draftActionId}` ||
      block.block_id === `naia_action_result:${draftActionId}`
      ? {
          block_id: `naia_action_result:${draftActionId}`,
          elements: [{ text: statusText, type: "mrkdwn" }],
          type: "context",
        }
      : rawBlock;
  });
}
