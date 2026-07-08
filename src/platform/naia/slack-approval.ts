import "server-only";

import { randomUUID } from "node:crypto";

import type { NaiaActionDraft } from "@/features/naia/orchestrator";

// Strategy for the Slack button `value` (hard Slack limit: 2000 characters).
//
// Primary mode: the draft (action + command + HMAC approval token) is
// serialized inline in the button value. That mode is fully stateless, so it
// works across serverless instances and deploys; tampering is useless because
// executeBridgeAction re-verifies the HMAC token against the action and
// command before doing anything.
//
// Fallback mode: when the serialized draft exceeds the Slack limit (very long
// commands or CRM drafts), the draft is parked in a module-level Map with a
// short TTL and the button only carries an opaque reference. This fallback is
// best-effort on serverless platforms (another instance may not hold the
// entry); the user is then asked to resend the command, and the 5 minute
// token TTL bounds the exposure anyway.

export type SlackApprovalDraft = {
  action: NaiaActionDraft;
  approvalToken: string;
  command: string;
};

const SLACK_BUTTON_VALUE_LIMIT = 2000;
const OVERSIZED_DRAFT_TTL_MS = 10 * 60 * 1000;

const oversizedDrafts = new Map<
  string,
  { draft: SlackApprovalDraft; expiresAt: number }
>();

export function encodeSlackApprovalValue(draft: SlackApprovalDraft): string {
  const inline = JSON.stringify({ d: draft, v: 1 });
  if (inline.length <= SLACK_BUTTON_VALUE_LIMIT) {
    return inline;
  }

  pruneOversizedDrafts();
  const reference = randomUUID();
  oversizedDrafts.set(reference, {
    draft,
    expiresAt: Date.now() + OVERSIZED_DRAFT_TTL_MS,
  });

  return JSON.stringify({ r: reference, v: 1 });
}

export function decodeSlackApprovalValue(
  value: string,
): SlackApprovalDraft | null {
  let parsed: { d?: SlackApprovalDraft; r?: string; v?: number };
  try {
    parsed = JSON.parse(value) as { d?: SlackApprovalDraft; r?: string };
  } catch {
    return null;
  }

  if (
    parsed.d &&
    typeof parsed.d === "object" &&
    parsed.d.action &&
    typeof parsed.d.approvalToken === "string" &&
    typeof parsed.d.command === "string"
  ) {
    return parsed.d;
  }

  if (typeof parsed.r === "string") {
    pruneOversizedDrafts();
    return oversizedDrafts.get(parsed.r)?.draft ?? null;
  }

  return null;
}

function pruneOversizedDrafts() {
  const now = Date.now();
  for (const [reference, entry] of oversizedDrafts) {
    if (entry.expiresAt <= now) {
      oversizedDrafts.delete(reference);
    }
  }
}
