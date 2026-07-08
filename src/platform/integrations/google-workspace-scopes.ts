// Scopes granted by each employee at Google sign-in: personal Calendar and
// Gmail access, plus the Drive read scopes Maya still consumes through the
// user's token today. Once Maya switches to the organization service account
// (google-drive-service.ts), the Drive scopes can be dropped from login.
export const GOOGLE_USER_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
] as const;

export const GOOGLE_USER_SCOPE = GOOGLE_USER_SCOPES.join(" ");

// Legacy aliases for code that predates the per-user rename.
export const GOOGLE_WORKSPACE_SCOPES = GOOGLE_USER_SCOPES;
export const GOOGLE_WORKSPACE_SCOPE = GOOGLE_USER_SCOPE;
