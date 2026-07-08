export const MAYA_COFUNDER_EMAILS = [
  "ali@qarizmi.com",
  "nabil@qarizmi.com",
] as const;

export function canUseMayaPitchGeneratorEmail(email?: string | null) {
  if (!email) return false;
  const normalized = email.trim().toLocaleLowerCase("fr-FR");
  return (MAYA_COFUNDER_EMAILS as readonly string[]).includes(normalized);
}

/**
 * Pitch generation spends OpenAI tokens and writes into the client Drive, so
 * only organization owners may trigger it — always through an explicit human
 * action, never automatically on a lead status change.
 */
export function canTriggerMayaPitchGenerationRole(role?: string | null) {
  return role === "owner";
}
