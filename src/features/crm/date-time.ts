export const CRM_TIME_ZONE = "Africa/Casablanca";

type LocalDateTime = {
  day: number;
  hour: number;
  minute: number;
  month: number;
  year: number;
};

export function formatCrmDateTimeForInput(
  value: string,
  timeZone = CRM_TIME_ZONE,
) {
  const clean = value.trim();
  if (!clean) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return `${clean}T12:00`;

  const local = clean.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d{1,3})?)?$/,
  );
  if (local) {
    return `${local[1]}-${local[2]}-${local[3]}T${local[4]}:${local[5]}`;
  }

  const date = new Date(clean);
  if (Number.isNaN(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

export function normalizeCrmDateTimeForStorage(
  value: string,
  timeZone = CRM_TIME_ZONE,
) {
  const clean = value.trim();
  if (!clean) return undefined;

  const dateOnly = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const localDate = getValidLocalDateTime(dateOnly, 0, 0);
    return localDate
      ? new Date(
          Date.UTC(localDate.year, localDate.month - 1, localDate.day),
        ).toISOString()
      : undefined;
  }

  const local = clean.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/,
  );
  if (local) {
    const localDateTime = getValidLocalDateTime(
      local,
      Number(local[4]),
      Number(local[5]),
      local[6] ? Number(local[6]) : 0,
    );
    return localDateTime
      ? zonedLocalTimeToUtc(localDateTime, timeZone).toISOString()
      : undefined;
  }

  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(clean)) return undefined;
  const date = new Date(clean);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function getValidLocalDateTime(
  match: RegExpMatchArray,
  hour: number,
  minute: number,
  second = 0,
): LocalDateTime | undefined {
  const value = {
    day: Number(match[3]),
    hour,
    minute,
    month: Number(match[2]),
    year: Number(match[1]),
  };
  const candidate = new Date(Date.UTC(value.year, value.month - 1, value.day));

  if (
    candidate.getUTCFullYear() !== value.year ||
    candidate.getUTCMonth() + 1 !== value.month ||
    candidate.getUTCDate() !== value.day ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return undefined;
  }

  return value;
}

export function zonedLocalTimeToUtc(
  value: LocalDateTime,
  timeZone = CRM_TIME_ZONE,
) {
  const target = Date.UTC(
    value.year,
    value.month - 1,
    value.day,
    value.hour,
    value.minute,
  );
  let guess = target;

  for (let index = 0; index < 3; index += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      month: "2-digit",
      second: "2-digit",
      timeZone,
      year: "numeric",
    }).formatToParts(new Date(guess));
    const values = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );
    const represented = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second),
    );
    guess += target - represented;
  }

  return new Date(guess);
}
