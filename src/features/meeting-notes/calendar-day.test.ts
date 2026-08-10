import { describe, expect, it } from "vitest";

import { getMeetingDayBounds, isMeetingOnDay } from "./calendar-day";

describe("meeting calendar day", () => {
  it("returns the full Casablanca day, including meetings that already started", () => {
    expect(getMeetingDayBounds(new Date("2026-08-10T08:30:00.000Z"))).toEqual({
      dateKey: "2026-08-10",
      timeMax: "2026-08-10T23:00:00.000Z",
      timeMin: "2026-08-09T23:00:00.000Z",
    });
  });

  it("recognizes timed and all-day events in Casablanca", () => {
    const now = new Date("2026-08-10T08:30:00.000Z");

    expect(isMeetingOnDay("2026-08-10", now)).toBe(true);
    expect(isMeetingOnDay("2026-08-09T23:15:00.000Z", now)).toBe(true);
    expect(isMeetingOnDay("2026-08-10T23:15:00.000Z", now)).toBe(false);
  });
});
