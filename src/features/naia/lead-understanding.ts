import type { CrmLeadDraft } from "@/features/crm/contracts";

type LeadIdentity = Pick<
  CrmLeadDraft,
  | "companyName"
  | "contactEmail"
  | "contactJobTitle"
  | "contactName"
  | "contactPhone"
>;

export function canonicalizeConversationText(value: string) {
  let clean = value.trim();

  if (clean.startsWith("`") && clean.endsWith("`")) {
    clean = clean.slice(1, -1).trim();
  }

  return clean
    .replace(/<@[^>]+>/g, " ")
    .replace(/<mailto:([^|>]+)\|([^>]+)>/gi, (_, address, label) =>
      preferSlackLabel(label, address),
    )
    .replace(/<mailto:([^>]+)>/gi, "$1")
    .replace(/<tel:([^|>]+)\|([^>]+)>/gi, (_, number, label) =>
      preferSlackLabel(label, number),
    )
    .replace(/<tel:([^>]+)>/gi, "$1")
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/gi, "$2 ($1)")
    .replace(/<(https?:\/\/[^>]+)>/gi, "$1")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractLeadIdentity(value: string): LeadIdentity {
  const clean = canonicalizeConversationText(value);
  const contactEmail = extractEmail(clean);
  const contactPhone = extractPhone(clean);
  const businessCardMatch = clean.match(
    /\b(?:lead|prospect)\s*:?\s*(.+?)\s+((?:directeur|directrice|ceo|cto|cfo|coo|dg|fondateur|fondatrice|founder|responsable|manager|head)\b[^,.;\d]*?)\s+(?:de|chez)\s+([^,.;\d-]+?)(?=\s+(?:\+?\d|0\d)|\s*[-,;.]|$)/iu,
  );

  if (businessCardMatch) {
    return compactIdentity({
      companyName: businessCardMatch[3],
      contactEmail,
      contactJobTitle: businessCardMatch[2],
      contactName: businessCardMatch[1],
      contactPhone,
    });
  }

  const contextualMatch =
    clean.match(
      /\b(?:parle|parlé|contacte|contacté|appele|appelé|echange|échangé|discute|discuté)\s+(?:(?:a|à|avec)\s+)?(.+?)\s+(?:de|chez)\s+([^,.;]+?)(?=\s+(?:et|qui|il|elle|pour|afin|and|with)\b|[,.;]|$)/i,
    ) ??
    clean.match(
      /\b(?:talked|spoke|contacted|called|discussed|exchanged|met)\s+(?:to|with)?\s*(.+?)\s+(?:from|at|with)\s+([^,.;]+?)(?=\s+(?:and|who|they|he|she|to|for|with|would|will|have|has)\b|[,.;]|$)/i,
    );

  return compactIdentity({
    companyName: contextualMatch?.[2],
    contactEmail,
    contactName: contextualMatch?.[1],
    contactPhone,
  });
}

export function inferReminderDate(
  value: string,
  now = new Date(),
  timeZone = "Africa/Casablanca",
) {
  const clean = canonicalizeConversationText(value);
  if (!/\b(demain|tomorrow)\b/i.test(clean)) return undefined;

  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(now);
  const dateParts = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  const localToday = new Date(
    Date.UTC(
      Number(dateParts.year),
      Number(dateParts.month) - 1,
      Number(dateParts.day),
    ),
  );
  localToday.setUTCDate(localToday.getUTCDate() + 1);

  const explicitTime = clean.match(/\b([01]?\d|2[0-3])\s*(?:h|:)([0-5]\d)?\b/i);
  const hour = explicitTime
    ? Number(explicitTime[1])
    : /\b(apres[- ]midi|après[- ]midi|afternoon)\b/i.test(clean)
      ? 14
      : 9;
  const minute = explicitTime?.[2] ? Number(explicitTime[2]) : 0;

  return `${localToday.toISOString().slice(0, 10)}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

function preferSlackLabel(label: string, fallback: string) {
  const cleanLabel = label.trim();
  return cleanLabel || fallback.trim();
}

function compactIdentity(identity: LeadIdentity): LeadIdentity {
  return Object.fromEntries(
    Object.entries(identity).flatMap(([key, value]) => {
      if (typeof value !== "string" || !value.trim()) return [];
      return [
        [
          key,
          value
            .trim()
            .replace(/[,:;.-]+$/g, "")
            .slice(0, 160),
        ],
      ];
    }),
  ) as LeadIdentity;
}

function extractEmail(value: string) {
  return value.match(
    /[\p{Letter}\p{Number}.+_-]+@[\p{Letter}\p{Number}.-]+\.[a-z]{2,}/iu,
  )?.[0];
}

function extractPhone(value: string) {
  const match = value.match(/(?:\+\d{1,3}[\s.-]?)?(?:0\d|\d)[\d\s.-]{7,}\d/);
  if (!match) return undefined;

  const compact = match[0].replace(/(?!^)\+/g, "").replace(/[^\d+]/g, "");
  const digitCount = compact.replace(/\D/g, "").length;
  return digitCount >= 9 && digitCount <= 15 ? compact : undefined;
}
