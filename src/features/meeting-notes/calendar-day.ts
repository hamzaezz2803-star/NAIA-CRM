import { CRM_TIME_ZONE, zonedLocalTimeToUtc } from "@/features/crm/date-time";

export const MEETING_TIME_ZONE = CRM_TIME_ZONE;

export function getMeetingDayBounds(now = new Date()) {
  const current = getZonedDateParts(now);
  const nextDate = new Date(
    Date.UTC(current.year, current.month - 1, current.day + 1),
  );

  return {
    dateKey: formatDateKey(current),
    timeMax: zonedLocalTimeToUtc(
      {
        day: nextDate.getUTCDate(),
        hour: 0,
        minute: 0,
        month: nextDate.getUTCMonth() + 1,
        year: nextDate.getUTCFullYear(),
      },
      MEETING_TIME_ZONE,
    ).toISOString(),
    timeMin: zonedLocalTimeToUtc(
      { ...current, hour: 0, minute: 0 },
      MEETING_TIME_ZONE,
    ).toISOString(),
  };
}

export function isMeetingOnDay(value: string | undefined, now = new Date()) {
  if (!value) return false;
  const targetDateKey = getMeetingDayBounds(now).dateKey;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value === targetDateKey;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return formatDateKey(getZonedDateParts(date)) === targetDateKey;
}

function getZonedDateParts(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: MEETING_TIME_ZONE,
    year: "numeric",
  }).formatToParts(value);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return {
    day: Number(values.day),
    month: Number(values.month),
    year: Number(values.year),
  };
}

function formatDateKey(value: { day: number; month: number; year: number }) {
  return `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
}
