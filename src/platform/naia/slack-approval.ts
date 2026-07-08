import "server-only";

// Strategy for the Slack button `value` (hard Slack limit: 2000 characters).
//
// The HMAC approval token embeds the full approved action (kind + payload +
// id), so the button only needs to carry {actionId, approvalToken, command}:
// the command is required to re-verify the token's commandHash, and the
// action is decoded from the token itself at execution time. This inline
// encoding is fully stateless, so it works across serverless instances and
// deploys — there is deliberately no in-memory fallback.
//
// To keep the inline value under the Slack limit, planBridgeCommand truncates
// Slack commands to 500 characters (see SLACK_COMMAND_MAX_LENGTH): the token
// hash is computed on the same truncated string, so verification stays
// consistent. Pathologically large drafts (long dictated notes expanding the
// signed payload) make encodeSlackApprovalValue return null and the events
// route degrades gracefully by pointing to the web cockpit instead of
// rendering a broken button.

export type SlackApprovalDraft = {
  actionId: string;
  approvalToken: string;
  command: string;
};

const SLACK_BUTTON_VALUE_LIMIT = 2000;

export function encodeSlackApprovalValue(
  draft: SlackApprovalDraft,
): string | null {
  const inline = JSON.stringify({ d: draft, v: 2 });

  return inline.length <= SLACK_BUTTON_VALUE_LIMIT ? inline : null;
}

export function decodeSlackApprovalValue(
  value: string,
): SlackApprovalDraft | null {
  let parsed: { d?: SlackApprovalDraft };
  try {
    parsed = JSON.parse(value) as { d?: SlackApprovalDraft };
  } catch {
    return null;
  }

  if (
    parsed.d &&
    typeof parsed.d === "object" &&
    typeof parsed.d.actionId === "string" &&
    typeof parsed.d.approvalToken === "string" &&
    typeof parsed.d.command === "string"
  ) {
    return {
      actionId: parsed.d.actionId,
      approvalToken: parsed.d.approvalToken,
      command: parsed.d.command,
    };
  }

  return null;
}
