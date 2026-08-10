// Scopes granted by each employee at Google sign-in: personal Calendar and
// Gmail access. Shared Drive/client-IP operations use the server-only service
// account in google-drive-service.ts. The founder-only Meet document scope is
// requested incrementally and never added to an employee's ordinary login.
export const GOOGLE_USER_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/gmail.readonly",
] as const;

export const GOOGLE_MEETING_NOTE_SCOPE =
  "https://www.googleapis.com/auth/drive.meet.readonly";

// Supabase/Google sign-in can add these identity grants to the provider access
// token. They do not authorize Gmail, Calendar or Drive data access and are
// the only additions accepted beyond NAIA's explicitly requested scopes.
export const GOOGLE_IDENTITY_SCOPES = [
  "email",
  "openid",
  "profile",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
] as const;

export type GoogleOAuthIntent = "meeting-notes" | "user";

export type GoogleScopeAttestation = {
  missing: string[];
  ok: boolean;
  scopes: string[];
  unexpected: string[];
};

const GOOGLE_DRIVE_SCOPE_PREFIX = "https://www.googleapis.com/auth/drive";

export function normalizeGoogleScopes(
  scopes: readonly string[] | null | undefined,
) {
  return [
    ...new Set(
      (scopes ?? []).map((scope) => scope.trim()).filter((scope) => scope),
    ),
  ].sort();
}

/**
 * Exact provider attestation boundary. Missing requested grants and every
 * addition outside the small identity allowlist fail closed. This rejects
 * broad Gmail/Calendar grants as well as Drive grants; Drive-prefix checks are
 * retained only for legacy UI messaging, never as the authorization test.
 */
export function attestGoogleScopes(
  scopes: readonly string[] | null | undefined,
  intent: GoogleOAuthIntent,
): GoogleScopeAttestation {
  const normalized = normalizeGoogleScopes(scopes);
  const required = normalizeGoogleScopes(
    intent === "meeting-notes"
      ? [...GOOGLE_USER_SCOPES, GOOGLE_MEETING_NOTE_SCOPE]
      : GOOGLE_USER_SCOPES,
  );
  const allowed = new Set<string>([...required, ...GOOGLE_IDENTITY_SCOPES]);
  const missing = required.filter((scope) => !normalized.includes(scope));
  const unexpected = normalized.filter((scope) => !allowed.has(scope));

  return {
    missing,
    ok: missing.length === 0 && unexpected.length === 0,
    scopes: normalized,
    unexpected,
  };
}

export function googleScopeSetsEqual(
  first: readonly string[] | null | undefined,
  second: readonly string[] | null | undefined,
) {
  const normalizedFirst = normalizeGoogleScopes(first);
  const normalizedSecond = normalizeGoogleScopes(second);
  return (
    normalizedFirst.length === normalizedSecond.length &&
    normalizedFirst.every((scope, index) => scope === normalizedSecond[index])
  );
}

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
  return attestGoogleScopes(scopes, "meeting-notes").ok;
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
