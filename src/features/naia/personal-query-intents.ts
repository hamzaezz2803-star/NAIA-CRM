export function normalizePersonalQuery(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isIdentityQuery(command: string) {
  const normalized = normalizePersonalQuery(command);
  return includesAny(normalized, [
    "qui suis je",
    "quel est mon profil",
    "quelle est mon identite",
    "quel est mon role",
    "who am i",
    "what is my profile",
    "what is my role",
  ]);
}

export function isAssistantIdentityQuery(command: string) {
  const normalized = normalizePersonalQuery(command);
  return includesAny(normalized, [
    "qui es tu",
    "presente toi",
    "what are you",
    "who are you",
  ]);
}

export function isPersonalGmailQuery(command: string) {
  const normalized = normalizePersonalQuery(command);
  return includesAny(normalized, [
    "gmail",
    "mes emails",
    "mes email",
    "mes mails",
    "mes mail",
    "ma boite mail",
    "boite mail",
    "ma messagerie",
    "mon email",
    "mon mail",
    "mon inbox",
    "my email",
    "my emails",
    "my gmail",
    "my inbox",
  ]);
}

export function isPersonalCalendarQuery(command: string) {
  const normalized = normalizePersonalQuery(command);
  const explicitlyNamesCalendar = includesAny(normalized, [
    "agenda",
    "calendar",
    "calendrier",
    "my calendar",
    "my schedule",
  ]);

  // "Mes meetings CRM" is a pipeline question. Only an explicit Calendar
  // reference (including "Calendar hors CRM") should cross into Google.
  if (normalized.includes("crm") && !explicitlyNamesCalendar) return false;

  return includesAny(normalized, [
    "agenda",
    "calendar",
    "calendrier",
    "mes meetings",
    "mes reunions",
    "mes rdv",
    "mes rendez vous",
    "mes disponibilites",
    "mes dispos",
    "ma disponibilite",
    "mon creneau",
    "mes creneaux",
    "mon planning",
    "my calendar",
    "my meetings",
    "my availability",
    "my schedule",
  ]);
}

export function isCrmMeetingReadQuery(command: string) {
  const normalized = normalizePersonalQuery(command);
  if (
    includesAny(normalized, [
      "agenda",
      "calendar",
      "calendrier",
      "my calendar",
      "my schedule",
    ])
  ) {
    return false;
  }
  const asksForMeetings = includesAny(normalized, [
    "meeting",
    "meetings",
    "rdv",
    "rendez vous",
    "reunion",
    "reunions",
  ]);
  const asksToRead = includesAny(normalized, [
    "combien",
    "quels",
    "quelles",
    "liste",
    "montre",
    "affiche",
    "which",
    "list",
    "show",
  ]);

  return normalized.includes("crm") && asksForMeetings && asksToRead;
}

export function isGoogleAccessQuery(command: string) {
  if (!isPersonalGmailQuery(command) && !isPersonalCalendarQuery(command)) {
    return false;
  }

  const normalized = normalizePersonalQuery(command);
  return includesAny(normalized, [
    "as tu acces",
    "ai je acces",
    "est ce que tu as acces",
    "peux tu consulter",
    "peux tu acceder",
    "es tu connecte",
    "est il connecte",
    "can you access",
    "do you have access",
    "are you connected",
  ]);
}

export function isGmailReadQuery(command: string) {
  if (!isPersonalGmailQuery(command) || isGoogleAccessQuery(command)) {
    return false;
  }

  const normalized = normalizePersonalQuery(command);
  return includesAny(normalized, [
    "quels",
    "quelles",
    "liste",
    "lis",
    "lire",
    "montre",
    "affiche",
    "consulte",
    "check",
    "verifie",
    "resume",
    "recap",
    "analyse",
    "priorise",
    "urgent",
    "non lu",
    "unread",
    "recent",
    "dernier",
    "cherche",
    "trouve",
    "which",
    "list",
    "show",
    "read",
    "summarize",
  ]);
}

export function isCalendarReadQuery(command: string) {
  if (!isPersonalCalendarQuery(command) || isGoogleAccessQuery(command)) {
    return false;
  }

  const normalized = normalizePersonalQuery(command);
  const asksRead = includesAny(normalized, [
    "quels",
    "quelles",
    "liste",
    "lis",
    "lire",
    "montre",
    "affiche",
    "consulte",
    "check",
    "verifie",
    "regarde",
    "quoi de prevu",
    "semaine",
    "aujourd hui",
    "demain",
    "prochain",
    "hors crm",
    "outside crm",
    "which",
    "what",
    "list",
    "show",
    "read",
  ]);
  const asksWrite = includesAny(normalized, [
    "cree",
    "creer",
    "ajoute",
    "ajouter",
    "planifie",
    "booke",
    "schedule",
    "create",
    "add",
  ]);

  return asksRead && !asksWrite;
}

export function isUrgentGmailQuery(command: string) {
  const normalized = normalizePersonalQuery(command);
  return includesAny(normalized, [
    "urgent",
    "prioritaire",
    "priorite",
    "important",
    "critique",
  ]);
}

export function wantsCalendarOutsideCrm(command: string) {
  const normalized = normalizePersonalQuery(command);
  return includesAny(normalized, [
    "hors crm",
    "en dehors du crm",
    "pas dans le crm",
    "non crm",
    "outside crm",
  ]);
}

export function inferPersonalCalendarDays(command: string) {
  const normalized = normalizePersonalQuery(command);
  const explicitDays = normalized.match(/\b(\d{1,2})\s+jours?\b/)?.[1];
  if (explicitDays) return Math.max(1, Math.min(Number(explicitDays), 31));
  if (normalized.includes("demain")) return 1;
  if (normalized.includes("aujourd hui")) return 1;
  if (normalized.includes("semaine") || normalized.includes("week")) return 7;
  if (normalized.includes("mois") || normalized.includes("month")) return 31;
  return 7;
}

function includesAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle));
}
