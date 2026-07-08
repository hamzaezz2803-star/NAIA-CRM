import { createHmac, timingSafeEqual } from "node:crypto";

export type SlackPreparedMessage = {
  blocks?: unknown[];
  channel?: string;
  text: string;
  threadTs?: string;
};

// Slack signs every request with `v0=HMAC_SHA256(secret, "v0:{ts}:{body}")`.
// Requests older than five minutes are rejected to block replay attacks.
const SLACK_SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;

export function verifySlackSignature({
  body,
  nowMs = Date.now(),
  signature,
  signingSecret = process.env.SLACK_SIGNING_SECRET,
  timestamp,
}: {
  body: string;
  nowMs?: number;
  signature: string | null;
  signingSecret?: string;
  timestamp: string | null;
}): boolean {
  if (!signingSecret || !signature || !timestamp) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  if (
    Math.abs(nowMs - timestampSeconds * 1000) > SLACK_SIGNATURE_TOLERANCE_MS
  ) {
    return false;
  }

  const expected = `v0=${createHmac("sha256", signingSecret)
    .update(`v0:${timestamp}:${body}`)
    .digest("hex")}`;
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  return (
    signatureBuffer.length === expectedBuffer.length &&
    timingSafeEqual(signatureBuffer, expectedBuffer)
  );
}

export type SlackUserProfile = {
  displayName?: string;
  email?: string;
  isBot: boolean;
};

export async function fetchSlackUserProfile(
  userId: string,
): Promise<SlackUserProfile | null> {
  const token = getSlackBotToken();
  const response = await fetch(
    `https://slack.com/api/users.info?user=${encodeURIComponent(userId)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  const payload = (await response.json()) as {
    error?: string;
    ok?: boolean;
    user?: {
      is_bot?: boolean;
      profile?: { display_name?: string; email?: string };
      real_name?: string;
    };
  };

  if (!response.ok || !payload.ok || !payload.user) {
    // Fail closed (callers treat null as "unknown user"), but leave a trace:
    // this usually means a revoked token or a missing users:read scope.
    console.error(
      `Slack users.info failed for ${userId}:`,
      payload.error ?? `HTTP ${response.status}`,
    );
    return null;
  }

  const profile: SlackUserProfile = {
    displayName:
      payload.user.profile?.display_name || payload.user.real_name || undefined,
    email: payload.user.profile?.email,
    isBot: Boolean(payload.user.is_bot),
  };

  if (!profile.isBot && !profile.email) {
    // Without an email the bridge cannot map the Slack user to a Qarizmi OS
    // profile: access stays denied (fail closed). The most common cause is a
    // Slack app installed without the users:read.email scope.
    console.warn(
      `Slack users.info returned no email for non-bot user ${userId}; check the users:read.email scope on the Slack app.`,
    );
  }

  return profile;
}

export async function postSlackMessage({
  blocks,
  channel,
  text,
  threadTs,
}: SlackPreparedMessage) {
  const token = getSlackBotToken();

  if (!channel) {
    throw new Error("A Slack channel is required before sending.");
  }

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    body: JSON.stringify({
      channel,
      text,
      ...(blocks && blocks.length > 0 ? { blocks } : {}),
      ...(threadTs ? { thread_ts: threadTs } : {}),
    }),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  const payload = (await response.json()) as {
    channel?: string;
    error?: string;
    ok?: boolean;
    ts?: string;
  };

  if (!response.ok || !payload.ok) {
    throw new Error(
      `Slack rejected the message: ${payload.error ?? "unknown error"}`,
    );
  }

  return {
    channel: payload.channel,
    ts: payload.ts,
  };
}

// Interactive components ship a short-lived response_url that can update the
// original message (replace_original) or reply to the click.
export async function respondToSlackInteraction(
  responseUrl: string,
  payload: {
    blocks?: unknown[];
    replace_original?: boolean;
    response_type?: "ephemeral" | "in_channel";
    text: string;
  },
) {
  const response = await fetch(responseUrl, {
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(
      `Slack interaction response failed (${response.status}): ${(await response.text()).slice(0, 300)}`,
    );
  }
}

function getSlackBotToken() {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error("SLACK_BOT_TOKEN is missing.");
  }

  return token;
}
