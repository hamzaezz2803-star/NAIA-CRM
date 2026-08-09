// Scopes granted by each employee at Google sign-in: personal Calendar and
// Gmail access plus read-only access to the exact Meet/Gemini note documents
// linked from the user's own inbox. Shared Drive/client-IP operations use the server-only
// service account in google-drive-service.ts.
export const GOOGLE_USER_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/drive.readonly",
] as const;

// Drive is deliberately optional for existing connections: Calendar and Gmail
// must keep working before Ali or Nabil has had a chance to grant the new
// read-only scope. A later reconnect enriches Gemini imports with the linked
// document body, while the email notes remain available in the meantime.
export const GOOGLE_USER_REQUIRED_SCOPES = GOOGLE_USER_SCOPES.filter(
  (scope) => scope !== "https://www.googleapis.com/auth/drive.readonly",
);

export const GOOGLE_USER_SCOPE = GOOGLE_USER_SCOPES.join(" ");

// Legacy aliases for code that predates the per-user rename.
export const GOOGLE_WORKSPACE_SCOPES = GOOGLE_USER_SCOPES;
export const GOOGLE_WORKSPACE_SCOPE = GOOGLE_USER_SCOPE;
