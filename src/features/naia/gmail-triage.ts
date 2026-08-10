import type { CrmLeadSummary } from "@/features/crm/contracts";
import type {
  GmailThreadMessageMetadata,
  GmailThreadMetadata,
} from "@/platform/integrations/google-workspace";

export const GMAIL_TRIAGE_CRM_STATUSES = [
  "contacted",
  "lead-to-contact",
  "meeting-booked",
  "proposal-sent",
  "to-follow-up",
  "won",
] as const;
const ACTIVE_CRM_STATUSES = new Set<string>(GMAIL_TRIAGE_CRM_STATUSES);

const AUTOMATED_LOCAL_PART =
  /(?:^|[._+\-])(alerts?|bounces?|dependabot|do[._+\-]?not[._+\-]?reply|donotreply|mailer[._+\-]?daemon|no[._+\-]?reply|noreply|notifications?|postmaster|updates?)(?:$|[._+\-])/iu;
const AUTOMATED_DISPLAY_NAME =
  /(?:\[bot\]|dependabot|github notifications?|mailer daemon|automated message)/iu;
const AUTOMATED_DOMAINS = new Set([
  "dependabot.com",
  "notifications.github.com",
]);
const AUTOMATED_LABELS = new Set([
  "CATEGORY_FORUMS",
  "CATEGORY_PROMOTIONS",
  "CATEGORY_SOCIAL",
]);
const STRONG_URGENCY =
  /\b(asap|bloquant|bloquante|blocking|critique|critical|deadline|echeance|imm[eé]diat(?:e)?|overdue|retard|urgent)\b|\baujourd[’']?hui\b|\btoday\b|\bavant\s+(?:ce soir|demain|\d{1,2})\b/iu;
const ACTION_REQUEST =
  /\?|\b(can you|could you|follow[ -]?up|need your|please|waiting for|action required|next step|peux[ -]?tu|pouvez[ -]?vous|merci de|besoin de|dans l.attente|prochaine [eé]tape|[àa] valider|validation|signature)\b/iu;

export const GMAIL_TRIAGE_QUERY =
  "newer_than:30d -in:sent -in:drafts -in:spam -in:trash -category:promotions -category:social -category:forums -from:notifications@github.com -from:noreply -from:no-reply -from:donotreply -from:do-not-reply -from:dependabot";

export type GmailTriagePriority = "urgent" | "important" | "reply";

export type GmailTriageReason =
  | "action-requested"
  | "crm-contact"
  | "direct-recipient"
  | "gmail-important"
  | "gmail-starred"
  | "human-follow-up"
  | "overdue-crm-action"
  | "read-without-reply"
  | "unanswered-24h"
  | "unanswered-72h"
  | "unread"
  | "urgent-language";

export type GmailTriageLeadContext = Pick<
  CrmLeadSummary,
  "companyName" | "contactEmail" | "id" | "nextAction" | "status" | "topic"
> & {
  nextActionDate?: string;
};

export type GmailTriageItem = {
  crm?: {
    companyName?: string;
    id: string;
    nextAction?: string;
    status: string;
    topic: string;
  };
  date?: string;
  from: string;
  messageId: string;
  priority: GmailTriagePriority;
  reasons: GmailTriageReason[];
  score: number;
  senderEmail: string;
  snippet?: string;
  subject: string;
  threadId: string;
  unread: boolean;
};

export function triageGmailThreads({
  accountEmail,
  crmLeads,
  maxResults = 10,
  now = new Date(),
  threads,
}: {
  accountEmail?: string;
  crmLeads: GmailTriageLeadContext[];
  maxResults?: number;
  now?: Date;
  threads: GmailThreadMetadata[];
}): GmailTriageItem[] {
  const crmByEmail = indexCrmLeads(crmLeads);
  const normalizedAccountEmail = normalizeEmail(accountEmail);

  const candidates = threads
    .map((thread) =>
      triageThread({
        accountEmail: normalizedAccountEmail,
        crmByEmail,
        now,
        thread,
      }),
    )
    .filter((item): item is GmailTriageItem => Boolean(item));

  const unique = new Map<string, GmailTriageItem>();
  for (const item of candidates) {
    const key = `${item.senderEmail}\u0000${normalizeSubject(item.subject)}`;
    const existing = unique.get(key);
    if (!existing || timestamp(item.date) > timestamp(existing.date)) {
      unique.set(key, item);
    }
  }

  return [...unique.values()]
    .sort(
      (left, right) =>
        right.score - left.score ||
        timestamp(right.date) - timestamp(left.date) ||
        left.threadId.localeCompare(right.threadId),
    )
    .slice(0, Math.max(1, Math.min(maxResults, 25)));
}

export function formatGmailTriageReason(reason: GmailTriageReason) {
  const labels: Record<GmailTriageReason, string> = {
    "action-requested": "question ou action demandée",
    "crm-contact": "contact client dans le CRM",
    "direct-recipient": "adressé directement",
    "gmail-important": "marqué important dans Gmail",
    "gmail-starred": "suivi dans Gmail",
    "human-follow-up": "relance humaine répétée",
    "overdue-crm-action": "relance CRM arrivée à échéance",
    "read-without-reply": "lu sans réponse",
    "unanswered-24h": "sans réponse depuis plus de 24 h",
    "unanswered-72h": "sans réponse depuis plus de 72 h",
    unread: "non lu",
    "urgent-language": "échéance ou urgence explicite",
  };
  return labels[reason];
}

function triageThread({
  accountEmail,
  crmByEmail,
  now,
  thread,
}: {
  accountEmail?: string;
  crmByEmail: Map<string, GmailTriageLeadContext>;
  now: Date;
  thread: GmailThreadMetadata;
}): GmailTriageItem | null {
  const messages = [...thread.messages].sort(
    (left, right) => messageTimestamp(left) - messageTimestamp(right),
  );
  if (messages.length === 0) return null;

  const latestIncoming = [...messages]
    .reverse()
    .find((message) => isInboundMessage(message));
  if (!latestIncoming) return null;

  const latestIncomingAt = messageTimestamp(latestIncoming);
  if (latestIncomingAt <= 0) return null;
  if (
    messages.some(
      (message) =>
        hasLabel(message, "SENT") &&
        messageTimestamp(message) > latestIncomingAt,
    )
  ) {
    return null;
  }

  const from = header(latestIncoming, "from");
  const senderEmail = extractEmailAddress(from);
  if (!senderEmail || isAutomatedMessage(latestIncoming, from, senderEmail)) {
    return null;
  }

  const subject = header(latestIncoming, "subject") || "Sans objet";
  const snippet = latestIncoming.snippet?.trim() || undefined;
  const combinedText = `${subject}\n${snippet ?? ""}`;
  const unread = hasLabel(latestIncoming, "UNREAD");
  const reasons: GmailTriageReason[] = [];
  let score = 20;

  if (unread) {
    score += 5;
    reasons.push("unread");
  } else {
    score += 12;
    reasons.push("read-without-reply");
  }

  const crmLead = crmByEmail.get(senderEmail);
  if (crmLead) {
    score += 30;
    reasons.push("crm-contact");
  }

  if (STRONG_URGENCY.test(combinedText)) {
    score += 25;
    reasons.push("urgent-language");
  }
  if (ACTION_REQUEST.test(combinedText)) {
    score += 12;
    reasons.push("action-requested");
  }

  const lastSentAt = Math.max(
    0,
    ...messages
      .filter((message) => hasLabel(message, "SENT"))
      .map(messageTimestamp),
  );
  const unansweredHumanMessages = messages.filter(
    (message) =>
      isInboundMessage(message) &&
      messageTimestamp(message) > lastSentAt &&
      isHumanIncoming(message),
  );
  if (unansweredHumanMessages.length >= 2) {
    score += 10;
    reasons.push("human-follow-up");
  }

  const ageHours = Math.max(0, (now.getTime() - latestIncomingAt) / 3_600_000);
  if (ageHours >= 72) {
    score += 12;
    reasons.push("unanswered-72h");
  } else if (ageHours >= 24) {
    score += 6;
    reasons.push("unanswered-24h");
  }

  const toRecipients = extractEmailAddresses(header(latestIncoming, "to"));
  const ccRecipients = extractEmailAddresses(header(latestIncoming, "cc"));
  if (accountEmail && toRecipients.has(accountEmail)) {
    score += 5;
    reasons.push("direct-recipient");
  } else if (accountEmail && ccRecipients.has(accountEmail)) {
    score -= 8;
  }

  if (hasLabel(latestIncoming, "IMPORTANT")) {
    score += 5;
    reasons.push("gmail-important");
  }
  if (hasLabel(latestIncoming, "STARRED")) {
    score += 8;
    reasons.push("gmail-starred");
  }

  if (crmLead?.nextActionDate && crmLead.nextActionDate <= dateKey(now)) {
    score += 10;
    reasons.push("overdue-crm-action");
  }

  const hasTrustEvidence = Boolean(
    crmLead ||
    hasLabel(latestIncoming, "STARRED") ||
    messages.some((message) => hasLabel(message, "SENT")),
  );
  const boundedScore = Math.max(
    0,
    Math.min(hasTrustEvidence ? 100 : 69, score),
  );
  return {
    crm: crmLead
      ? {
          companyName: crmLead.companyName,
          id: crmLead.id,
          nextAction: crmLead.nextAction,
          status: crmLead.status,
          topic: crmLead.topic,
        }
      : undefined,
    date: messageDate(latestIncoming),
    from: from || senderEmail,
    messageId: latestIncoming.id,
    priority:
      boundedScore >= 70
        ? "urgent"
        : boundedScore >= 50
          ? "important"
          : "reply",
    reasons: [...new Set(reasons)],
    score: boundedScore,
    senderEmail,
    snippet,
    subject,
    threadId: thread.id,
    unread,
  };
}

function indexCrmLeads(crmLeads: GmailTriageLeadContext[]) {
  const index = new Map<string, GmailTriageLeadContext>();
  for (const lead of crmLeads) {
    const email = normalizeEmail(lead.contactEmail);
    if (!email || !ACTIVE_CRM_STATUSES.has(lead.status)) continue;
    if (!index.has(email)) index.set(email, lead);
  }
  return index;
}

function isHumanIncoming(message: GmailThreadMessageMetadata) {
  const from = header(message, "from");
  const email = extractEmailAddress(from);
  return Boolean(email && !isAutomatedMessage(message, from, email));
}

function isInboundMessage(message: GmailThreadMessageMetadata) {
  return !hasLabel(message, "SENT") && !hasLabel(message, "DRAFT");
}

function isAutomatedMessage(
  message: GmailThreadMessageMetadata,
  from: string,
  senderEmail: string,
) {
  if (message.labelIds.some((label) => AUTOMATED_LABELS.has(label))) {
    return true;
  }

  const [localPart = "", domain = ""] = senderEmail.split("@");
  if (
    AUTOMATED_LOCAL_PART.test(localPart) ||
    AUTOMATED_DISPLAY_NAME.test(from) ||
    AUTOMATED_DOMAINS.has(domain) ||
    domain.split(".").includes("noreply") ||
    domain.endsWith(".notifications.github.com")
  ) {
    return true;
  }

  const autoSubmitted = header(message, "auto-submitted").toLowerCase();
  const precedence = header(message, "precedence").toLowerCase();
  return Boolean(
    header(message, "list-id") ||
    header(message, "list-unsubscribe") ||
    header(message, "feedback-id") ||
    (autoSubmitted && autoSubmitted !== "no") ||
    /^(bulk|junk|list)$/u.test(precedence) ||
    header(message, "x-auto-response-suppress"),
  );
}

function header(message: GmailThreadMessageMetadata, name: string) {
  return message.headers[name.toLowerCase()]?.trim() ?? "";
}

function hasLabel(message: GmailThreadMessageMetadata, label: string) {
  return message.labelIds.includes(label);
}

function messageTimestamp(message: GmailThreadMessageMetadata) {
  const internalDate = Number(message.internalDate);
  if (Number.isFinite(internalDate) && internalDate > 0) return internalDate;
  return timestamp(header(message, "date"));
}

function messageDate(message: GmailThreadMessageMetadata) {
  const value = messageTimestamp(message);
  return value > 0 ? new Date(value).toISOString() : undefined;
}

function timestamp(value: string | undefined) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractEmailAddress(value: string) {
  const bracketed = value.match(/<\s*([^<>\s]+@[^<>\s]+)\s*>/u)?.[1];
  const plain =
    bracketed ??
    value.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu)?.[0];
  return normalizeEmail(plain);
}

function extractEmailAddresses(value: string) {
  return new Set(
    [
      ...value.matchAll(
        /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu,
      ),
    ]
      .map((match) => normalizeEmail(match[0]))
      .filter((email): email is string => Boolean(email)),
  );
}

function normalizeEmail(value: string | null | undefined) {
  const email = value?.trim().toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ? email : undefined;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function normalizeSubject(value: string) {
  return value
    .replace(/^\s*(?:(?:fwd?|re)\s*:\s*)+/giu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("fr-FR");
}
