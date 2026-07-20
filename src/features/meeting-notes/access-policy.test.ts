import { describe, expect, it } from "vitest";

import { canUseMeetingNotesEmail } from "./access-policy";

describe("canUseMeetingNotesEmail", () => {
  it("accepts both cofounders case-insensitively", () => {
    expect(canUseMeetingNotesEmail("Ali@qarizmi.com")).toBe(true);
    expect(canUseMeetingNotesEmail(" nabil@qarizmi.com ")).toBe(true);
  });

  it("fails closed for other Qarizmi members", () => {
    expect(canUseMeetingNotesEmail("hamza@qarizmi.com")).toBe(false);
    expect(canUseMeetingNotesEmail(undefined)).toBe(false);
  });
});
