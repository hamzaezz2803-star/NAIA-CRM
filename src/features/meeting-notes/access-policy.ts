/**
 * Meeting Intelligence is open to every organization role. The email is still
 * required so anonymous or broken sessions fail closed; organization
 * membership is enforced by requireMeetingNotesAccess and by RLS.
 */
export function canUseMeetingNotesEmail(email?: string | null) {
  return Boolean(email?.trim());
}
