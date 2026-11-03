import { describe, expect, it } from "vitest";

import { canUseMeetingNotesEmail } from "./access-policy";

describe("canUseMeetingNotesEmail", () => {
  it("accepts any signed-in organization member", () => {
    expect(canUseMeetingNotesEmail("Ali@qarizmi.com")).toBe(true);
    expect(canUseMeetingNotesEmail(" hamza@qarizmi.com ")).toBe(true);
    expect(canUseMeetingNotesEmail("hamzaezz2803@gmail.com")).toBe(true);
  });

  it("fails closed without an email", () => {
    expect(canUseMeetingNotesEmail(undefined)).toBe(false);
    expect(canUseMeetingNotesEmail(null)).toBe(false);
    expect(canUseMeetingNotesEmail("   ")).toBe(false);
  });
});
