import { after } from "next/server";

import {
  fetchSlackUserProfile,
  postSlackMessage,
  verifySlackSignature,
} from "@/platform/integrations/slack";
import {
  planBridgeCommand,
  resolveBridgeUser,
  type NaiaBridgePlan,
} from "@/platform/naia/bridge";
import { encodeSlackApprovalValue } from "@/platform/naia/slack-approval";

// Slack Events API endpoint: DMs to the NAIA bot (message.im) and @mentions
// (app_mention). Slack requires an ack in under 3 seconds, so the handler
// verifies the signature, acknowledges immediately, and schedules the real
// work with after(); the answer is then posted through chat.postMessage with
// Block Kit approval buttons. Executions stay behind the human click.

type SlackEvent = {
  bot_id?: string;
  channel?: string;
  channel_type?: string;
  subtype?: string;
  text?: string;
  thread_ts?: string;
  ts?: string;
  type?: string;
  user?: string;
};

type SlackEventEnvelope = {
  challenge?: string;
  event?: SlackEvent;
  type?: string;
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

  let payload: SlackEventEnvelope;
  try {
    payload = JSON.parse(body) as SlackEventEnvelope;
  } catch {
    return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (payload.type === "url_verification") {
    return Response.json({ challenge: payload.challenge ?? "" });
  }

  // Slack retries a delivery it considers slow (http_timeout): the first
  // delivery already scheduled the work, so those are acknowledged without
  // reprocessing. Other retry reasons (connection failures, 5xx) mean the
  // first delivery was never processed, so they go through.
  if (
    request.headers.get("x-slack-retry-num") &&
    request.headers.get("x-slack-retry-reason") === "http_timeout"
  ) {
    return Response.json({ ignored: "retry", ok: true });
  }

  const event = payload.event;
  if (payload.type !== "event_callback" || !isActionableEvent(event)) {
    return Response.json({ ok: true });
  }

  const command = stripSlackMentions(event.text ?? "");
  if (!command) {
    return Response.json({ ok: true });
  }

  const channel = event.channel as string;
  const slackUserId = event.user as string;
  // Mentions answer in a thread to keep channels readable; DMs answer inline.
  const threadTs =
    event.type === "app_mention"
      ? (event.thread_ts ?? event.ts)
      : event.thread_ts;

  after(async () => {
    await handleSlackCommand({ channel, command, slackUserId, threadTs });
  });

  return Response.json({ ok: true });
}

function isActionableEvent(event: SlackEvent | undefined): event is SlackEvent {
  if (!event || !event.user || !event.channel) return false;
  // Never react to bots (including NAIA itself) or to message edits/joins.
  if (event.bot_id || event.subtype) return false;

  return (
    event.type === "app_mention" ||
    (event.type === "message" && event.channel_type === "im")
  );
}

function stripSlackMentions(text: string) {
  return text
    .replace(/<@[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}

async function handleSlackCommand({
  channel,
  command,
  slackUserId,
  threadTs,
}: {
  channel: string;
  command: string;
  slackUserId: string;
  threadTs?: string;
}) {
  try {
    const profile = await fetchSlackUserProfile(slackUserId);
    if (profile?.isBot) return;

    const user = profile?.email ? await resolveBridgeUser(profile.email) : null;

    if (!user) {
      await postSlackMessage({
        channel,
        text: "Compte non reconnu : ton email Slack ne correspond à aucun profil Qarizmi OS. Connecte-toi d'abord sur https://os.qarizmi.com avec ton compte Google Qarizmi.",
        threadTs,
      });
      return;
    }

    const plan = await planBridgeCommand(user, command);
    await postSlackMessage({
      blocks: buildPlanBlocks(plan),
      channel,
      text: plan.response,
      threadTs,
    });
  } catch (error) {
    console.error("Slack NAIA event processing failed:", error);
    try {
      await postSlackMessage({
        channel,
        text: "NAIA n'a pas pu traiter cette commande. Réessaie dans un instant.",
        threadTs,
      });
    } catch {
      // The error is already logged; nothing else can be reported to Slack.
    }
  }
}

function buildPlanBlocks(plan: NaiaBridgePlan) {
  const blocks: unknown[] = [
    {
      block_id: "naia_response",
      text: { text: plan.response, type: "mrkdwn" },
      type: "section",
    },
  ];

  for (const action of plan.actions) {
    // The approval token embeds the full signed action; the button value only
    // carries {actionId, approvalToken, command} (see slack-approval.ts).
    const value = encodeSlackApprovalValue({
      actionId: action.id,
      approvalToken: action.approvalToken,
      command: plan.command,
    });

    blocks.push({
      block_id: `naia_action_desc:${action.id}`,
      text: {
        text: `*${action.label}*\n${action.description}`,
        type: "mrkdwn",
      },
      type: "section",
    });

    if (!value) {
      // The draft exceeds Slack's 2000-character button value limit even
      // after command truncation: degrade gracefully instead of posting a
      // broken button.
      blocks.push({
        block_id: `naia_action_buttons:${action.id}`,
        elements: [
          {
            text: "⚠️ Brouillon trop volumineux pour une validation Slack. Valide cette action depuis https://os.qarizmi.com/naia",
            type: "mrkdwn",
          },
        ],
        type: "context",
      });
      continue;
    }

    blocks.push({
      block_id: `naia_action_buttons:${action.id}`,
      elements: [
        {
          action_id: `naia_approve:${action.id}`,
          style: "primary",
          text: { emoji: true, text: "✅ Valider", type: "plain_text" },
          type: "button",
          value,
        },
        {
          action_id: `naia_dismiss:${action.id}`,
          text: { emoji: true, text: "❌ Ignorer", type: "plain_text" },
          type: "button",
          value: JSON.stringify({ actionId: action.id }),
        },
      ],
      type: "actions",
    });
  }

  return blocks;
}
