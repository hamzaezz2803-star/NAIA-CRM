import type { CrmLeadSummary } from "./contracts";
import { CRM_TIME_ZONE } from "./date-time";

export type CrmPipelineDateState =
  "done" | "today" | "overdue" | "this-week" | "later";

export type CrmPipelineLeadIdentity = {
  companyName: string;
  contactName: string;
};

export type CrmPipelineActionPartition = {
  overdue: CrmLeadSummary[];
  thisWeek: CrmLeadSummary[];
};

type DateStateOptions = {
  now?: Date;
  timeZone?: string;
};

type IdentityLead = Pick<
  CrmLeadSummary,
  "companyName" | "contactName" | "notes" | "topic"
>;

type DatedLead = Pick<
  CrmLeadSummary,
  "leadDate" | "nextActionCompletedAt" | "nextActionState" | "status"
>;

const terminalStatuses = new Set(["won", "dead-end"]);
const localDatePattern =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/;

function legacyNoteValue(notes: string | undefined, label: string) {
  const normalizedLabel = label.toLowerCase();

  for (const rawLine of (notes ?? "").split(/\r?\n/)) {
    const separatorIndex = rawLine.indexOf(":");
    if (separatorIndex < 0) continue;

    const currentLabel = rawLine.slice(0, separatorIndex).trim().toLowerCase();
    if (currentLabel !== normalizedLabel) continue;

    const value = rawLine.slice(separatorIndex + 1).trim();
    if (value) return value;
  }

  return "";
}

export function getCrmPipelineLeadIdentity(
  lead: IdentityLead,
): CrmPipelineLeadIdentity {
  const companyName =
    lead.companyName?.trim() ||
    legacyNoteValue(lead.notes, "entreprise") ||
    lead.topic.trim() ||
    "Sans entreprise";
  const contactName =
    lead.contactName?.trim() ||
    legacyNoteValue(lead.notes, "contact") ||
    "Contact à qualifier";

  return { companyName, contactName };
}

function isValidDateParts(year: number, month: number, day: number) {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() + 1 === month &&
    candidate.getUTCDate() === day
  );
}

function localDateKey(value: string) {
  const match = value.match(localDatePattern);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidDateParts(year, month, day)) return undefined;

  return match[1] + "-" + match[2] + "-" + match[3];
}

function instantDateKey(value: Date, timeZone: string) {
  if (Number.isNaN(value.getTime())) return undefined;

  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(value);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  const key = values.year + "-" + values.month + "-" + values.day;

  return localDateKey(key);
}

function leadDateKey(value: string | undefined, timeZone: string) {
  const clean = value?.trim();
  if (!clean) return undefined;

  if (localDatePattern.test(clean)) return localDateKey(clean);

  const instant = new Date(clean);
  return instantDateKey(instant, timeZone);
}

function dateOrdinal(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function isCompletedLeadAction(lead: DatedLead) {
  return (
    terminalStatuses.has(lead.status.trim().toLowerCase()) ||
    lead.nextActionState === "done" ||
    Boolean(lead.nextActionCompletedAt)
  );
}

export function getCrmPipelineDateState(
  lead: DatedLead,
  options: DateStateOptions = {},
): CrmPipelineDateState {
  if (isCompletedLeadAction(lead)) return "done";

  const timeZone = options.timeZone ?? CRM_TIME_ZONE;
  const todayKey = instantDateKey(options.now ?? new Date(), timeZone);
  if (!todayKey) throw new TypeError("A valid current date is required");

  const dueKey = leadDateKey(lead.leadDate, timeZone);
  if (!dueKey) return "later";

  const todayOrdinal = dateOrdinal(todayKey);
  const dueOrdinal = dateOrdinal(dueKey);
  if (dueOrdinal < todayOrdinal) return "overdue";
  if (dueOrdinal === todayOrdinal) return "today";

  const [year, month, day] = todayKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const daysUntilSunday = weekday === 0 ? 0 : 7 - weekday;

  return dueOrdinal <= todayOrdinal + daysUntilSunday ? "this-week" : "later";
}

function comparePartitionEntries(
  left: { dueKey: string; lead: CrmLeadSummary },
  right: { dueKey: string; lead: CrmLeadSummary },
) {
  const dateComparison = left.dueKey.localeCompare(right.dueKey);
  if (dateComparison !== 0) return dateComparison;

  const leftPosition = Number.isFinite(left.lead.pipelinePosition)
    ? (left.lead.pipelinePosition ?? Number.MAX_SAFE_INTEGER)
    : Number.MAX_SAFE_INTEGER;
  const rightPosition = Number.isFinite(right.lead.pipelinePosition)
    ? (right.lead.pipelinePosition ?? Number.MAX_SAFE_INTEGER)
    : Number.MAX_SAFE_INTEGER;
  if (leftPosition !== rightPosition) return leftPosition - rightPosition;

  const createdAtComparison = left.lead.createdAt.localeCompare(
    right.lead.createdAt,
  );
  return createdAtComparison || left.lead.id.localeCompare(right.lead.id);
}

export function partitionCrmPipelineActionLeads(
  leads: readonly CrmLeadSummary[],
  options: DateStateOptions = {},
): CrmPipelineActionPartition {
  const normalizedOptions = {
    ...options,
    now: options.now ?? new Date(),
  };
  const timeZone = normalizedOptions.timeZone ?? CRM_TIME_ZONE;
  const overdue: Array<{ dueKey: string; lead: CrmLeadSummary }> = [];
  const thisWeek: Array<{ dueKey: string; lead: CrmLeadSummary }> = [];

  for (const lead of leads) {
    if (!lead.nextAction?.trim()) continue;

    const state = getCrmPipelineDateState(lead, normalizedOptions);
    const dueKey = leadDateKey(lead.leadDate, timeZone);
    if (!dueKey) continue;

    if (state === "overdue") overdue.push({ dueKey, lead });
    if (state === "today" || state === "this-week") {
      thisWeek.push({ dueKey, lead });
    }
  }

  return {
    overdue: overdue.sort(comparePartitionEntries).map(({ lead }) => lead),
    thisWeek: thisWeek.sort(comparePartitionEntries).map(({ lead }) => lead),
  };
}
