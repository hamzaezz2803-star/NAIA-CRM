/**
 * Helper functions for CRM reminder composite keys.
 * Kept in a separate module without "use server" so Next.js doesn't fail Server Action checks.
 */

export function buildCrmReminderNotificationId(
  leadId: string,
  dueDate: string,
): string {
  const cleanDate = dueDate.slice(0, 10);
  return cleanDate
    ? `lead-reminder-${leadId}:${cleanDate}`
    : `lead-reminder-${leadId}`;
}

export function parseCrmReminderNotificationId(notificationId: string): {
  leadId: string;
  dueDate?: string;
  compositeKey: string;
} {
  const rawKey = notificationId.replace(/^lead-reminder-/, "");
  const parts = rawKey.split(":");
  const leadId = parts[0];
  const dueDate = parts[1] || undefined;
  const compositeKey = dueDate ? `${leadId}:${dueDate}` : leadId;
  return { leadId, dueDate, compositeKey };
}
