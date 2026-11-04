const ORGANIZATION_ROLES = new Set(["owner", "admin", "member", "viewer"]);

/**
 * Docs Generator (Maya) is open to every organization role. The email is still
 * required so anonymous or broken sessions fail closed; organization
 * membership is enforced by requireMayaPitchGeneratorAccess and by RLS.
 */
export function canUseMayaPitchGeneratorEmail(email?: string | null) {
  return Boolean(email?.trim());
}

/**
 * Pitch cloning writes into the client Drive, so it always stays an explicit
 * human action, never automatic on a lead status change. Any organization
 * role may trigger it. The faithful-clone V1 does not call an AI provider.
 */
export function canTriggerMayaPitchGenerationRole(role?: string | null) {
  return Boolean(role && ORGANIZATION_ROLES.has(role));
}
