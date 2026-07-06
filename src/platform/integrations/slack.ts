export type SlackPreparedMessage = {
  channel?: string;
  text: string;
};

export async function postSlackMessage({
  channel,
  text,
}: SlackPreparedMessage) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error("SLACK_BOT_TOKEN is missing.");
  }

  if (!channel) {
    throw new Error("A Slack channel is required before sending.");
  }

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    body: JSON.stringify({ channel, text }),
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
