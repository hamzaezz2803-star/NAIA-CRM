// Scopes granted by each employee at Google sign-in: personal Calendar and
// Gmail access only. Shared Drive/client-IP operations use the server-only
// service account in google-drive-service.ts.
export const GOOGLE_USER_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
] as const;

export const GOOGLE_USER_SCOPE = GOOGLE_USER_SCOPES.join(" ");

// Legacy aliases for code that predates the per-user rename.
export const GOOGLE_WORKSPACE_SCOPES = GOOGLE_USER_SCOPES;
export const GOOGLE_WORKSPACE_SCOPE = GOOGLE_USER_SCOPE;
