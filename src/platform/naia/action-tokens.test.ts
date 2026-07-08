import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NaiaActionDraft } from "@/features/naia/orchestrator";

import { signAction, verifyApprovalToken } from "./action-tokens";

const gmailAction: NaiaActionDraft = {
  agentId: "integrations",
  approvalRequired: true,
  description: "Lecture Gmail limitee",
  id: "gmail-list-abc123",
  kind: "google.gmail.listMessages",
  label: "Lire Gmail",
  payload: {
    maxResults: 10,
    unreadOnly: true,
  },
  risk: "low",
};

describe("NAIA action approval tokens", () => {
  beforeEach(() => {
    vi.stubEnv("NAIA_ACTION_APPROVAL_SECRET", "test-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("signs an action and returns the embedded action on verification", () => {
    const command = "NAIA lis mes emails non lus";
    const signed = signAction(gmailAction, command);

    expect(signed.approvalToken).toContain(".");

    const decoded = verifyApprovalToken(
      signed.approvalToken,
      gmailAction.id,
      command,
    );

    expect(decoded).toEqual(gmailAction);
  });

  it("rejects the token for a different action id", () => {
    const command = "NAIA lis mes emails non lus";
    const signed = signAction(gmailAction, command);

    expect(
      verifyApprovalToken(signed.approvalToken, "another-action-id", command),
    ).toBeNull();
  });

  it("rejects the token for a different command", () => {
    const signed = signAction(gmailAction, "commande originale");

    expect(
      verifyApprovalToken(
        signed.approvalToken,
        gmailAction.id,
        "autre commande",
      ),
    ).toBeNull();
  });

  it("rejects a token whose payload was tampered with", () => {
    const command = "NAIA lis mes emails non lus";
    const signed = signAction(gmailAction, command);
    const [encodedPayload, signature] = signed.approvalToken.split(".");
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as { action: NaiaActionDraft; expiresAt: number };

    payload.action = {
      ...payload.action,
      payload: { maxResults: 500, unreadOnly: false },
    } as NaiaActionDraft;

    const forgedToken = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`;

    expect(
      verifyApprovalToken(forgedToken, gmailAction.id, command),
    ).toBeNull();
  });

  it("rejects an expired token", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-08T10:00:00.000Z"));

    const command = "NAIA lis mes emails non lus";
    const signed = signAction(gmailAction, command);

    vi.setSystemTime(new Date("2026-07-08T10:06:00.000Z"));

    expect(
      verifyApprovalToken(signed.approvalToken, gmailAction.id, command),
    ).toBeNull();
  });
});
