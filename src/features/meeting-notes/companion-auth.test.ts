import { afterEach, describe, expect, it } from "vitest";

import { verifyMeetingNotesCompanionRequest } from "./companion-auth";

const previousToken = process.env.MEETING_NOTES_COMPANION_TOKEN;

afterEach(() => {
  if (previousToken === undefined) {
    delete process.env.MEETING_NOTES_COMPANION_TOKEN;
  } else {
    process.env.MEETING_NOTES_COMPANION_TOKEN = previousToken;
  }
});

describe("verifyMeetingNotesCompanionRequest", () => {
  it("fails closed when the server token is missing", () => {
    delete process.env.MEETING_NOTES_COMPANION_TOKEN;
    expect(
      verifyMeetingNotesCompanionRequest(
        new Request("https://os.qarizmi.com/api/meeting-notes/worker/claim", {
          headers: { authorization: "Bearer worker-secret" },
        }),
      ),
    ).toBe(false);
  });

  it("accepts only the exact bearer token", () => {
    process.env.MEETING_NOTES_COMPANION_TOKEN = "worker-secret";
    const request = (authorization: string) =>
      new Request("https://os.qarizmi.com/api/meeting-notes/worker/claim", {
        headers: { authorization },
      });

    expect(
      verifyMeetingNotesCompanionRequest(request("Bearer worker-secret")),
    ).toBe(true);
    expect(
      verifyMeetingNotesCompanionRequest(request("Bearer worker-secrex")),
    ).toBe(false);
    expect(verifyMeetingNotesCompanionRequest(request("Bearer short"))).toBe(
      false,
    );
  });
});
