export const MAYA_COFUNDER_EMAILS = [
  "ali@qarizmi.com",
  "nabil@qarizmi.com",
] as const;

export function canUseMayaPitchGeneratorEmail(email?: string | null) {
  if (!email) return false;
  const normalized = email.trim().toLocaleLowerCase("fr-FR");
  return (MAYA_COFUNDER_EMAILS as readonly string[]).includes(normalized);
}
