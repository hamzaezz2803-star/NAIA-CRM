import "server-only";

import { timingSafeEqual } from "node:crypto";

export function verifyMeetingNotesCompanionRequest(request: Request) {
  const configuredToken = process.env.MEETING_NOTES_COMPANION_TOKEN?.trim();
  const authorization = request.headers.get("authorization")?.trim();

  if (!configuredToken || !authorization?.startsWith("Bearer ")) {
    return false;
  }

  const receivedToken = authorization.slice("Bearer ".length).trim();
  const configured = Buffer.from(configuredToken);
  const received = Buffer.from(receivedToken);

  return (
    configured.length === received.length &&
    timingSafeEqual(configured, received)
  );
}
