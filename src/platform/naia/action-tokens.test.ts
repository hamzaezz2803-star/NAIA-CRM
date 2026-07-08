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

  it("signs an action and verifies it for the same command", () => {
    const command = "NAIA lis mes emails non lus";
    const signed = signAction(gmailAction, command);

    expect(signed.approvalToken).toContain(".");
    expect(
      verifyApprovalToken(signed.approvalToken, gmailAction, command),
    ).toBe(true);
  });

  it("survives a JSON round trip of the action (Slack button value)", () => {
    const command = "NAIA lis mes emails non lus";
    const signed = signAction(gmailAction, command);
    const roundTripped = JSON.parse(
      JSON.stringify(gmailAction),
    ) as NaiaActionDraft;

    expect(
      verifyApprovalToken(signed.approvalToken, roundTripped, command),
    ).toBe(true);
  });

  it("rejects the token for a different command", () => {
    const signed = signAction(gmailAction, "commande originale");

    expect(
      verifyApprovalToken(signed.approvalToken, gmailAction, "autre commande"),
    ).toBe(false);
  });

  it("rejects the token for a tampered action payload", () => {
    const command = "NAIA lis mes emails non lus";
    const signed = signAction(gmailAction, command);
    const tampered = {
      ...gmailAction,
      payload: { maxResults: 500, unreadOnly: false },
    } as NaiaActionDraft;

    expect(verifyApprovalToken(signed.approvalToken, tampered, command)).toBe(
      false,
    );
  });

  it("rejects an expired token", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-08T10:00:00.000Z"));

    const command = "NAIA lis mes emails non lus";
    const signed = signAction(gmailAction, command);

    vi.setSystemTime(new Date("2026-07-08T10:06:00.000Z"));

    expect(
      verifyApprovalToken(signed.approvalToken, gmailAction, command),
    ).toBe(false);
  });
});
