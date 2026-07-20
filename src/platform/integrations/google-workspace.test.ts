import { describe, expect, it } from "vitest";

import {
  googleCalendarIdempotencyId,
  inferGoogleWorkspaceReadCapabilities,
} from "./google-workspace";

describe("Google Workspace read capabilities", () => {
  it("recognizes the configured read scopes", () => {
    expect(
      inferGoogleWorkspaceReadCapabilities([
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/gmail.readonly",
      ]),
    ).toEqual({ calendar: true, gmail: true });
  });

  it("does not treat send-only and freebusy scopes as read access", () => {
    expect(
      inferGoogleWorkspaceReadCapabilities([
        "https://www.googleapis.com/auth/calendar.freebusy",
        "https://www.googleapis.com/auth/gmail.send",
      ]),
    ).toEqual({ calendar: false, gmail: false });
  });
});

describe("Google Calendar idempotency", () => {
  it("derives a stable Google-compatible event id", () => {
    const first = googleCalendarIdempotencyId("meeting-action-123");
    const second = googleCalendarIdempotencyId("meeting-action-123");

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-v]{5,1024}$/);
  });
});
