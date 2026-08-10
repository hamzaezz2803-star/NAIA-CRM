import { describe, expect, it } from "vitest";

import {
  attestGoogleScopes,
  GOOGLE_IDENTITY_SCOPES,
  GOOGLE_MEETING_NOTE_SCOPE,
  GOOGLE_USER_SCOPES,
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
    expect(
      canReadGoogleMeetingDocuments([
        ...GOOGLE_USER_SCOPES,
        GOOGLE_MEETING_NOTE_SCOPE,
      ]),
    ).toBe(true);
  });

  it("fails document access when a narrow grant is mixed with a broad legacy grant", () => {
    const scopes = [
      GOOGLE_MEETING_NOTE_SCOPE,
      "https://www.googleapis.com/auth/drive.file",
    ];

    expect(hasForbiddenGoogleDriveScope(scopes)).toBe(true);
    expect(canReadGoogleMeetingDocuments(scopes)).toBe(false);
  });

  it("accepts only the exact ordinary scope set plus documented identity grants", () => {
    expect(
      attestGoogleScopes(
        [...GOOGLE_USER_SCOPES, ...GOOGLE_IDENTITY_SCOPES],
        "user",
      ),
    ).toMatchObject({ missing: [], ok: true, unexpected: [] });
  });

  it.each([
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/drive.metadata.readonly",
  ])("rejects every unrequested Google data grant: %s", (scope) => {
    expect(
      attestGoogleScopes([...GOOGLE_USER_SCOPES, scope], "user"),
    ).toMatchObject({ ok: false, unexpected: [scope] });
  });

  it("requires the Meet grant only in the founder meeting intent", () => {
    expect(
      attestGoogleScopes(
        [...GOOGLE_USER_SCOPES, GOOGLE_MEETING_NOTE_SCOPE],
        "meeting-notes",
      ).ok,
    ).toBe(true);
    expect(
      attestGoogleScopes(
        [...GOOGLE_USER_SCOPES, GOOGLE_MEETING_NOTE_SCOPE],
        "user",
      ).ok,
    ).toBe(false);
    expect(attestGoogleScopes(GOOGLE_USER_SCOPES, "meeting-notes").ok).toBe(
      false,
    );
  });
});
