import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import type { NaiaActionDraft } from "@/features/naia/orchestrator";

// Shared HMAC approval tokens for NAIA actions. The web orchestrate route and
// the Slack bridge sign and verify with the same secret. The token is the
// source of truth: it embeds the exact action (kind + payload + id) the user
// approved plus the command hash and a TTL, so the execute phase runs the
// decoded action as-is after signature verification without re-deriving the
// action list, even when the CRM state or the AI extraction changed between
// plan and execute.

export const NAIA_ACTION_APPROVAL_TTL_MS = 5 * 60 * 1000;

export type SignedNaiaAction = NaiaActionDraft & {
  approvalToken: string;
};

export function signAction(
  action: NaiaActionDraft,
  command: string,
): SignedNaiaAction {
  const payload = {
    action,
    commandHash: hashValue(command),
    expiresAt: Date.now() + NAIA_ACTION_APPROVAL_TTL_MS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signature = hmac(encodedPayload);

  return {
    ...action,
    approvalToken: `${encodedPayload}.${signature}`,
  };
}

export function verifyApprovalToken(
  approvalToken: string,
  actionId: string,
  command: string,
): NaiaActionDraft | null {
  const [encodedPayload, signature] = approvalToken.split(".");
  if (!encodedPayload || !signature) return null;

  const expected = hmac(encodedPayload);
  if (!safeEqual(signature, expected)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as {
      action?: NaiaActionDraft;
      commandHash?: string;
      expiresAt?: number;
    };
    const action = payload.action;

    if (
      !action ||
      typeof action !== "object" ||
      typeof action.id !== "string" ||
      typeof action.kind !== "string" ||
      typeof action.payload !== "object" ||
      action.payload === null ||
      action.id !== actionId ||
      payload.commandHash !== hashValue(command) ||
      typeof payload.expiresAt !== "number" ||
      payload.expiresAt < Date.now()
    ) {
      return null;
    }

    return action;
  } catch {
    return null;
  }
}

function hashValue(value: string) {
  return createHmac("sha256", getApprovalSecret()).update(value).digest("hex");
}

function hmac(value: string) {
  return createHmac("sha256", getApprovalSecret()).update(value).digest("hex");
}

function getApprovalSecret() {
  const secret =
    process.env.NAIA_ACTION_APPROVAL_SECRET ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (secret) return secret;

  if (process.env.NODE_ENV === "development") {
    return "naia-local-approval-secret";
  }

  throw new Error("NAIA_ACTION_APPROVAL_SECRET is required");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
