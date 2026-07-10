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

export type SlackConversationMessage = {
  content: string;
  role: "assistant" | "user";
};

export type SlackMessageSnapshot = {
  blocks?: unknown[];
  text?: string;
};

export async function fetchSlackConversationHistory({
  channel,
  limit = 10,
  threadTs,
}: {
  channel: string;
  limit?: number;
  threadTs?: string;
}): Promise<SlackConversationMessage[]> {
  const url = new URL(
    threadTs
      ? "https://slack.com/api/conversations.replies"
      : "https://slack.com/api/conversations.history",
  );
  url.searchParams.set("channel", channel);
  url.searchParams.set("limit", String(Math.max(1, Math.min(limit, 20))));
  if (threadTs) url.searchParams.set("ts", threadTs);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${getSlackBotToken()}` },
  });
  const payload = (await response.json()) as {
    messages?: Array<{ bot_id?: string; text?: string }>;
    ok?: boolean;
  };
  if (!response.ok || !payload.ok) return [];

  const messages = (payload.messages ?? []).flatMap((message) => {
    const content = message.text?.trim();
    return content
      ? [{ content, role: message.bot_id ? "assistant" : "user" } as const]
      : [];
  });
  return threadTs ? messages.slice(-limit) : messages.reverse().slice(-limit);
}

export async function fetchSlackMessageSnapshot({
  channel,
  messageTs,
  threadTs,
}: {
  channel: string;
  messageTs: string;
  threadTs?: string;
}): Promise<SlackMessageSnapshot | null> {
  try {
    const url = new URL("https://slack.com/api/conversations.replies");
    url.searchParams.set("channel", channel);
    url.searchParams.set("limit", "100");
    url.searchParams.set("ts", threadTs ?? messageTs);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${getSlackBotToken()}` },
    });
    const payload = (await response.json()) as {
      messages?: Array<{ blocks?: unknown[]; text?: string; ts?: string }>;
      ok?: boolean;
    };
    if (!response.ok || !payload.ok) return null;

    const message = payload.messages?.find(
      (candidate) => candidate.ts === messageTs,
    );
    return message
      ? {
          blocks: message.blocks,
          text: message.text,
        }
      : null;
  } catch {
    return null;
  }
}

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

export async function openSlackModal({
  triggerId,
  view,
}: {
  triggerId: string;
  view: Record<string, unknown>;
}) {
  const response = await fetch("https://slack.com/api/views.open", {
    body: JSON.stringify({ trigger_id: triggerId, view }),
    headers: {
      Authorization: `Bearer ${getSlackBotToken()}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = (await response.json()) as {
    error?: string;
    ok?: boolean;
  };

  if (!response.ok || !payload.ok) {
    throw new Error(
      `Slack rejected the modal: ${payload.error ?? "unknown error"}`,
    );
  }
}

export async function updateSlackMessage({
  blocks,
  channel,
  text,
  ts,
}: {
  blocks?: unknown[];
  channel: string;
  text: string;
  ts: string;
}) {
  const response = await fetch("https://slack.com/api/chat.update", {
    body: JSON.stringify({
      channel,
      text,
      ts,
      ...(blocks ? { blocks } : {}),
    }),
    headers: {
      Authorization: `Bearer ${getSlackBotToken()}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = (await response.json()) as {
    error?: string;
    ok?: boolean;
  };

  if (!response.ok || !payload.ok) {
    throw new Error(
      `Slack rejected the message update: ${payload.error ?? "unknown error"}`,
    );
  }
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
