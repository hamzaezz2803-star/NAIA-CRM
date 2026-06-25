import type { CrmLeadStatus } from "./contracts";

const statusAliases: Record<string, CrmLeadStatus> = {
  "lead-to-contact": "lead-to-contact",
  "a contacter": "lead-to-contact",
  "à contacter": "lead-to-contact",
  nouveau: "lead-to-contact",
  new: "lead-to-contact",

  contacted: "contacted",
  contacte: "contacted",
  contacté: "contacted",

  "to-follow-up": "to-follow-up",
  followup: "to-follow-up",
  "follow-up": "to-follow-up",
  "a relancer": "to-follow-up",
  "à relancer": "to-follow-up",
  relance: "to-follow-up",
  relancer: "to-follow-up",
  rappel: "to-follow-up",

  "meeting-booked": "meeting-booked",
  "meeting booked": "meeting-booked",
  "meeting fixe": "meeting-booked",
  "meeting fixé": "meeting-booked",
  "rdv fixe": "meeting-booked",
  "rdv fixé": "meeting-booked",
  "rendez vous fixe": "meeting-booked",
  "rendez vous fixé": "meeting-booked",
  "rendez-vous fixe": "meeting-booked",
  "rendez-vous fixé": "meeting-booked",

  "proposal-sent": "proposal-sent",
  "proposition envoyee": "proposal-sent",
  "proposition envoyée": "proposal-sent",
  "propale envoyee": "proposal-sent",
  "propale envoyée": "proposal-sent",

  won: "won",
  gagne: "won",
  gagné: "won",
  signe: "won",
  signé: "won",

  "dead-end": "dead-end",
  dead: "dead-end",
  perdu: "dead-end",
  refuse: "dead-end",
  refusé: "dead-end",
};

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeCrmLeadStatus(
  value: unknown,
): CrmLeadStatus | undefined {
  if (typeof value !== "string") return undefined;

  const rawValue = value.trim();
  if (rawValue in statusAliases) return statusAliases[rawValue];

  return statusAliases[normalizeText(rawValue)];
}

export function inferLeadStatusFromNaturalText(input: {
  text?: string;
  topic?: string;
  notes?: string;
  nextAction?: string;
  leadDate?: string | null;
  status?: unknown;
}): CrmLeadStatus | undefined {
  const explicitStatus = normalizeCrmLeadStatus(input.status);
  if (explicitStatus) return explicitStatus;

  const content = normalizeText(
    [
      input.text,
      input.topic,
      input.notes,
      input.nextAction,
      input.leadDate ? "has planned date" : "",
    ]
      .filter(Boolean)
      .join(" "),
  );

  if (!content) return undefined;

  if (
    /\b(meeting|rdv|rendez vous|rendez-vous|demo|démo|call|appel|visio|reunion|réunion)\b/.test(
      content,
    ) &&
    /\b(booke|booked|fixe|planifie|prevu|programme|cale|confirme|pris)\b/.test(
      content,
    )
  ) {
    return "meeting-booked";
  }

  if (/\b(propale|proposition|devis|offre)\b/.test(content)) {
    if (/\b(envoye|partage|transmis|soumis)\b/.test(content)) {
      return "proposal-sent";
    }
  }

  if (/\b(gagne|signe|valide|accepte|clos)\b/.test(content)) {
    return "won";
  }

  if (/\b(perdu|refuse|decline|dead end|pas interesse)\b/.test(content)) {
    return "dead-end";
  }

  if (/\b(relance|relancer|rappel|rappeler|follow up)\b/.test(content)) {
    return "to-follow-up";
  }

  if (/\b(parle|contacte|appele|echange|discute)\b/.test(content)) {
    return "contacted";
  }

  return undefined;
}
