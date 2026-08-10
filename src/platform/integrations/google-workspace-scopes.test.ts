import { describe, expect, it } from "vitest";

import {
  GOOGLE_MEETING_NOTE_SCOPE,
  canReadGoogleMeetingDocuments,
  hasForbiddenGoogleDriveScope,
} from "./google-workspace-scopes";

describe("Google user Drive scope boundary", () => {
  it.each([
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
  ])("rejects the legacy broad scope %s", (scope) => {
    expect(hasForbiddenGoogleDriveScope([scope])).toBe(true);
    expect(canReadGoogleMeetingDocuments([scope])).toBe(false);
  });

  it("accepts only the narrow Meet document scope", () => {
    expect(hasForbiddenGoogleDriveScope([GOOGLE_MEETING_NOTE_SCOPE])).toBe(
      false,
    );
    expect(canReadGoogleMeetingDocuments([GOOGLE_MEETING_NOTE_SCOPE])).toBe(
      true,
    );
  });

  it("fails document access when a narrow grant is mixed with a broad legacy grant", () => {
    const scopes = [
      GOOGLE_MEETING_NOTE_SCOPE,
      "https://www.googleapis.com/auth/drive.file",
    ];

    expect(hasForbiddenGoogleDriveScope(scopes)).toBe(true);
    expect(canReadGoogleMeetingDocuments(scopes)).toBe(false);
  });
});
