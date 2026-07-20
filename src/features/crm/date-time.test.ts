import { describe, expect, it } from "vitest";
import {
  formatCrmDateTimeForInput,
  normalizeCrmDateTimeForStorage,
} from "./date-time";

describe("CRM date-time form round trips", () => {
  it("shows UTC instants in Casablanca local time", () => {
    expect(formatCrmDateTimeForInput("2026-07-17T10:00:00.000Z")).toBe(
      "2026-07-17T11:00",
    );
  });

  it("stores Casablanca form values as UTC instants", () => {
    expect(normalizeCrmDateTimeForStorage("2026-07-17T11:00")).toBe(
      "2026-07-17T10:00:00.000Z",
    );
  });

  it("round-trips a planned Casablanca meeting without shifting the hour", () => {
    const stored = normalizeCrmDateTimeForStorage("2026-07-17T11:00");
    expect(stored).toBeDefined();
    expect(formatCrmDateTimeForInput(stored!)).toBe("2026-07-17T11:00");
  });

  it("preserves explicitly zoned instants and rejects invalid inputs", () => {
    expect(normalizeCrmDateTimeForStorage("2026-07-17T11:00:00+01:00")).toBe(
      "2026-07-17T10:00:00.000Z",
    );
    expect(normalizeCrmDateTimeForStorage("2026-02-31T11:00")).toBeUndefined();
  });
});
