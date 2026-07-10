import { describe, expect, it } from "vitest";

import { inferGoogleWorkspaceReadCapabilities } from "./google-workspace";

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
