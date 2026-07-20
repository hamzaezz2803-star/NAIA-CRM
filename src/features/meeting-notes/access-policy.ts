export const MEETING_NOTES_COFUNDER_EMAILS = [
  "ali@qarizmi.com",
  "nabil@qarizmi.com",
] as const;

export function canUseMeetingNotesEmail(email?: string | null) {
  if (!email) return false;
  const normalized = email.trim().toLocaleLowerCase("fr-FR");
  return (MEETING_NOTES_COFUNDER_EMAILS as readonly string[]).includes(
    normalized,
  );
}
