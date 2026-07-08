import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import type { NaiaActionDraft } from "@/features/naia/orchestrator";

// Shared HMAC approval tokens for NAIA actions. The web orchestrate route and
// the Slack bridge sign and verify with the same secret so an action drafted
// on one channel can never be executed with a forged or expired approval.

export const NAIA_ACTION_APPROVAL_TTL_MS = 5 * 60 * 1000;

export type SignedNaiaAction = NaiaActionDraft & {
  approvalToken: string;
};

export function signAction(
  action: NaiaActionDraft,
  command: string,
): SignedNaiaAction {
  const expiresAt = Date.now() + NAIA_ACTION_APPROVAL_TTL_MS;
  const payload = {
    actionHash: actionHash(action),
    actionId: action.id,
    commandHash: hashValue(command),
    expiresAt,
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
  action: NaiaActionDraft,
  command: string,
) {
  const [encodedPayload, signature] = approvalToken.split(".");
  if (!encodedPayload || !signature) return false;

  const expected = hmac(encodedPayload);
  if (!safeEqual(signature, expected)) return false;

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as {
      actionHash?: string;
      actionId?: string;
      commandHash?: string;
      expiresAt?: number;
    };

    return (
      payload.actionId === action.id &&
      payload.commandHash === hashValue(command) &&
      payload.actionHash === actionHash(action) &&
      typeof payload.expiresAt === "number" &&
      payload.expiresAt >= Date.now()
    );
  } catch {
    return false;
  }
}

function actionHash(action: NaiaActionDraft) {
  if (action.kind === "crm.createLead") {
    return hashValue(
      JSON.stringify({
        agentId: action.agentId,
        id: action.id,
        kind: action.kind,
      }),
    );
  }

  return hashValue(JSON.stringify(action));
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
