import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchSlackMessageSnapshot,
  findSlackUserByEmail,
  postSlackMessage,
  SlackMessageRejectedError,
  verifySlackSignature,
} from "./slack";

const SIGNING_SECRET = "test-signing-secret";

function signSlackRequest(
  body: string,
  timestamp: string,
  secret = SIGNING_SECRET,
) {
  return `v0=${createHmac("sha256", secret)
    .update(`v0:${timestamp}:${body}`)
    .digest("hex")}`;
}

describe("verifySlackSignature", () => {
  const body = JSON.stringify({ type: "event_callback" });
  const nowMs = 1_780_000_000_000;
  const freshTimestamp = String(Math.floor(nowMs / 1000));

  it("accepts a valid v0 signature within the tolerance window", () => {
    expect(
      verifySlackSignature({
        body,
        nowMs,
        signature: signSlackRequest(body, freshTimestamp),
        signingSecret: SIGNING_SECRET,
        timestamp: freshTimestamp,
      }),
    ).toBe(true);
  });

  it("rejects a signature computed with another secret", () => {
    expect(
      verifySlackSignature({
        body,
        nowMs,
        signature: signSlackRequest(body, freshTimestamp, "wrong-secret"),
        signingSecret: SIGNING_SECRET,
        timestamp: freshTimestamp,
      }),
    ).toBe(false);
  });

  it("rejects a signature for a different body", () => {
    expect(
      verifySlackSignature({
        body: JSON.stringify({ type: "tampered" }),
        nowMs,
        signature: signSlackRequest(body, freshTimestamp),
        signingSecret: SIGNING_SECRET,
        timestamp: freshTimestamp,
      }),
    ).toBe(false);
  });

  it("rejects a stale timestamp (replay protection)", () => {
    const staleTimestamp = String(Math.floor(nowMs / 1000) - 6 * 60);

    expect(
      verifySlackSignature({
        body,
        nowMs,
        signature: signSlackRequest(body, staleTimestamp),
        signingSecret: SIGNING_SECRET,
        timestamp: staleTimestamp,
      }),
    ).toBe(false);
  });

  it("rejects missing signature, timestamp, or secret", () => {
    expect(
      verifySlackSignature({
        body,
        nowMs,
        signature: null,
        signingSecret: SIGNING_SECRET,
        timestamp: freshTimestamp,
      }),
    ).toBe(false);
    expect(
      verifySlackSignature({
        body,
        nowMs,
        signature: signSlackRequest(body, freshTimestamp),
        signingSecret: SIGNING_SECRET,
        timestamp: null,
      }),
    ).toBe(false);
    expect(
      verifySlackSignature({
        body,
        nowMs,
        signature: signSlackRequest(body, freshTimestamp),
        signingSecret: undefined,
        timestamp: freshTimestamp,
      }),
    ).toBe(false);
  });
});

describe("fetchSlackMessageSnapshot", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns the exact bot message from a thread", async () => {
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-test");
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        messages: [
          { text: "Question", ts: "1111.2222" },
          {
            blocks: [{ block_id: "naia_action_buttons:crm-create-winxo" }],
            text: "Réponse NAIA",
            ts: "1234.5678",
          },
        ],
        ok: true,
      }),
      ok: true,
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchSlackMessageSnapshot({
        channel: "C0123456789",
        messageTs: "1234.5678",
        threadTs: "1111.2222",
      }),
    ).resolves.toEqual({
      blocks: [{ block_id: "naia_action_buttons:crm-create-winxo" }],
      text: "Réponse NAIA",
    });
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.pathname).toBe("/api/conversations.replies");
    expect(url.searchParams.get("channel")).toBe("C0123456789");
    expect(url.searchParams.get("ts")).toBe("1111.2222");
  });
});

describe("findSlackUserByEmail", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("resolves the DM recipient without exposing the bot token", async () => {
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-test");
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        ok: true,
        user: {
          id: "U123",
          profile: { display_name: "Ali", email: "ali@qarizmi.com" },
        },
      }),
      ok: true,
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(findSlackUserByEmail(" Ali@Qarizmi.com ")).resolves.toEqual({
      displayName: "Ali",
      email: "ali@qarizmi.com",
      id: "U123",
    });

    const [url, options] = fetchMock.mock.calls[0] as [
      URL,
      { headers: { Authorization: string } },
    ];
    expect(url.searchParams.get("email")).toBe("ali@qarizmi.com");
    expect(options.headers.Authorization).toBe("Bearer xoxb-test");
  });

  it("fails closed when Slack cannot find the recipient", async () => {
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({ error: "users_not_found", ok: false }),
        ok: true,
      }),
    );

    await expect(
      findSlackUserByEmail("nobody@qarizmi.com"),
    ).resolves.toBeNull();
  });
});

describe("postSlackMessage delivery classification", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("classifies a missing bot token as a pre-delivery retryable failure", async () => {
    vi.stubEnv("SLACK_BOT_TOKEN", "");

    await expect(
      postSlackMessage({ channel: "U123", text: "Brief test" }),
    ).rejects.toBeInstanceOf(SlackMessageRejectedError);
  });

  it("classifies an explicit Slack API rejection as safe to retry", async () => {
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({ error: "channel_not_found", ok: false }),
        ok: true,
        status: 200,
      }),
    );

    await expect(
      postSlackMessage({ channel: "U123", text: "Brief test" }),
    ).rejects.toBeInstanceOf(SlackMessageRejectedError);
  });

  it("keeps non-2xx transport outcomes ambiguous", async () => {
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({ error: "internal_error", ok: false }),
        ok: false,
        status: 503,
      }),
    );

    await expect(
      postSlackMessage({ channel: "U123", text: "Brief test" }),
    ).rejects.not.toBeInstanceOf(SlackMessageRejectedError);
  });
});
