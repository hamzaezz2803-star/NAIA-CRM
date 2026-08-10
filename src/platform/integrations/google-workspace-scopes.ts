// Scopes granted by each employee at Google sign-in: personal Calendar and
// Gmail access. Shared Drive/client-IP operations use the server-only service
// account in google-drive-service.ts. The founder-only Meet document scope is
// requested incrementally and never added to an employee's ordinary login.
export const GOOGLE_USER_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
] as const;

export const GOOGLE_MEETING_NOTE_SCOPE =
  "https://www.googleapis.com/auth/drive.meet.readonly";

const GOOGLE_DRIVE_SCOPE_PREFIX = "https://www.googleapis.com/auth/drive";

/**
 * Legacy user connections may predate the service-account boundary and carry
 * broad Drive grants. Those credentials must be reconnected instead of being
 * loaded: only the Meet-generated document scope is accepted client-side.
 */
export function hasForbiddenGoogleDriveScope(
  scopes: readonly string[] | null | undefined,
) {
  return (scopes ?? []).some(
    (scope) =>
      scope.startsWith(GOOGLE_DRIVE_SCOPE_PREFIX) &&
      scope !== GOOGLE_MEETING_NOTE_SCOPE,
  );
}

export function canReadGoogleMeetingDocuments(
  scopes: readonly string[] | null | undefined,
) {
  return (
    !hasForbiddenGoogleDriveScope(scopes) &&
    (scopes ?? []).includes(GOOGLE_MEETING_NOTE_SCOPE)
  );
}

export const GOOGLE_MEETING_NOTE_SCOPES = [
  ...GOOGLE_USER_SCOPES,
  GOOGLE_MEETING_NOTE_SCOPE,
] as const;

export const GOOGLE_USER_REQUIRED_SCOPES = GOOGLE_USER_SCOPES;

export const GOOGLE_USER_SCOPE = GOOGLE_USER_SCOPES.join(" ");

// Legacy aliases for code that predates the per-user rename.
export const GOOGLE_WORKSPACE_SCOPES = GOOGLE_USER_SCOPES;
export const GOOGLE_WORKSPACE_SCOPE = GOOGLE_USER_SCOPE;
