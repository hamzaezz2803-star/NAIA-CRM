import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifySlackSignature } from "./slack";

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
