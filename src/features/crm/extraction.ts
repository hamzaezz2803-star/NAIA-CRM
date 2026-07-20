import type { CrmLeadStatus } from "./contracts";
import { zonedLocalTimeToUtc } from "./date-time";

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

  const content = normalizeText(
    [input.text, input.topic, input.notes, input.nextAction]
      .filter(Boolean)
      .join(" "),
  );

  if (!content) return explicitStatus;

  if (
    /\b(perdu|refuse|decline|dead end|pas interesse|lost|rejected|not interested)\b/.test(
      content,
    )
  ) {
    return "dead-end";
  }

  const hasStrongWonSignal =
    /\b(gagne|signe|won|signed)\b/.test(content) ||
    /\b(?:contrat|deal|projet|mission|offre|proposition)\b.{0,48}\b(?:valide|accepte|clos|closed)\b/.test(
      content,
    ) ||
    /\b(?:valide|accepte|clos|closed)\b.{0,48}\b(?:contrat|deal|projet|mission|offre|proposition)\b/.test(
      content,
    );
  if (hasStrongWonSignal) return "won";

  const hasProposalIntent =
    /\b(propale|proposition|devis|offre|proposal|quote)\b/.test(content);
  const proposalActionPattern =
    /\b(envoie|envoyer|prepare|preparer|partage|partager|transmets|transmettre|soumets|soumettre|send|prepare|share|submit)\b/g;
  const proposalActionCuePattern =
    /^(?:envoie|envoyer|prepare|preparer|partage|partager|transmets|transmettre|soumets|soumettre|send|prepare|share|submit)\b/;
  const hasProposalActionSignal = hasUnsuppressedCue(
    content,
    proposalActionPattern,
  );
  const hasSentProposalSignal = hasUnsuppressedCue(
    content,
    /\b(envoye(?:e|es|s)?|partage(?:e|es|s)?|transmis(?:e|es)?|soumis(?:e|es)?|sent|shared|submitted)\b/g,
  );
  if (hasProposalIntent && hasSentProposalSignal) return "proposal-sent";

  const isPersonalReminder =
    /\b(pour me rappeler|me rappeler de|me rappeler d|rappelle moi|reminder|remind me)\b/.test(
      content,
    );
  if (isPersonalReminder) {
    return /\b(parle|contacte|appele|echange|discute|rencontre|spoke|talked|called|met|discussed|exchanged)\b/.test(
      content,
    )
      ? "contacted"
      : "to-follow-up";
  }

  const hasMeetingIntent =
    /\b(meeting|rdv|rendez vous|demo|demonstration|call|appel|visio|video call|reunion|teleconf|appointment)\b/.test(
      content,
    );
  const hasMeetingBookedSignal =
    /\b(booke|booked|fixe|planifie|prevu|programme|cale|confirme|pris|valide|accepte|scheduled|planned|confirmed|set)\b/.test(
      content,
    );
  const hasFollowUpIntent = hasUnsuppressedCue(
    content,
    /\b(relance|relancer|rappel|rappeler|follow up|followup)\b/g,
  );

  const schedulingIntent = classifySchedulingIntent({
    hasDateSignal: Boolean(input.leadDate),
    normalized: content,
  });
  const scheduledCue =
    schedulingIntent.kind === "planned"
      ? content.slice(schedulingIntent.cueIndex)
      : "";
  const isScheduledProposalAction =
    Boolean(input.leadDate) && proposalActionCuePattern.test(scheduledCue);
  const meetingReferences = [
    ...content.matchAll(
      /\b(meeting|rdv|rendez vous|demo|demonstration|call|appel|visio|video call|reunion|teleconf|appointment)\b/g,
    ),
  ];
  const hasOnlyHistoricalMeetingReferences =
    meetingReferences.length > 0 &&
    meetingReferences.every((reference) =>
      isHistoricalMeetingReference(content, reference.index ?? 0),
    );

  if (
    hasProposalIntent &&
    hasProposalActionSignal &&
    isScheduledProposalAction &&
    hasOnlyHistoricalMeetingReferences
  ) {
    return "proposal-sent";
  }

  if (
    hasOnlyHistoricalMeetingReferences &&
    schedulingIntent.kind !== "planned"
  ) {
    return "contacted";
  }

  if (hasMeetingIntent && (hasMeetingBookedSignal || input.leadDate)) {
    if (!hasMeetingBookedSignal && hasFollowUpIntent) {
      return "to-follow-up";
    }
    return "meeting-booked";
  }

  if (/\b(valide|accepte|clos|accepted|closed)\b/.test(content)) {
    return "won";
  }

  if (hasProposalIntent) {
    if (hasSentProposalSignal || hasProposalActionSignal) {
      return "proposal-sent";
    }
  }

  if (hasFollowUpIntent) {
    return "to-follow-up";
  }

  if (
    /\b(parle|contacte|appele|echange|discute|rencontre|spoke|talked|called|met|discussed|exchanged)\b/.test(
      content,
    )
  ) {
    return "contacted";
  }

  return explicitStatus;
}

export function resolveLeadDateFromNaturalText({
  modelValue,
  now = new Date(),
  text,
  timeZone = "Africa/Casablanca",
}: {
  modelValue?: unknown;
  now?: Date;
  text: string;
  timeZone?: string;
}) {
  const analysis = analyzeLeadDateText(text, now, timeZone);
  const deterministicDate = inferDeterministicLeadDate(
    text,
    timeZone,
    analysis,
  );
  if (deterministicDate) return deterministicDate;
  if (!analysis.hasDateSignal || analysis.intent.kind !== "planned") {
    return undefined;
  }
  if (!isModelDateSupportedByIntent(analysis)) return undefined;

  return normalizeModelLeadDate(modelValue, timeZone);
}

function analyzeLeadDateText(text: string, now: Date, timeZone: string) {
  const normalized = normalizeText(text);
  const localToday = getLocalDateParts(now, timeZone);
  const relativeDates = parseRelativeDateCandidates(normalized, localToday);
  const explicitDates = parseExplicitDateCandidates(text, localToday);
  const dateSignal = hasDateSignal(text, now, timeZone);
  const intent = classifySchedulingIntent({
    hasDateSignal: dateSignal,
    normalized,
  });

  return {
    explicitDates,
    hasDateSignal: dateSignal,
    intent,
    normalized,
    relativeDate: selectRelativeDate(relativeDates, normalized, intent),
    relativeDates,
  };
}

type LeadDateAnalysis = ReturnType<typeof analyzeLeadDateText>;

function inferDeterministicLeadDate(
  text: string,
  timeZone: string,
  analysis: LeadDateAnalysis,
) {
  const { explicitDates, intent, normalized, relativeDate } = analysis;
  if (!relativeDate && explicitDates.length !== 1) return undefined;
  if (intent.kind !== "planned") return undefined;
  const explicitDate = explicitDates[0];
  if (
    !relativeDate &&
    explicitDate &&
    !isDateAttachedToCue(normalized, explicitDate.index, intent.cueIndex)
  ) {
    return undefined;
  }

  const absoluteDateTime = parseAbsoluteDateTime(text);
  if (!relativeDate && absoluteDateTime) return absoluteDateTime;

  const resolvedDate = relativeDate?.date ?? explicitDate;
  if (!resolvedDate) return undefined;

  const dateIndex =
    relativeDate?.index ?? explicitDate?.index ?? intent.cueIndex;
  const timeStartIndex = Math.min(dateIndex, intent.cueIndex);
  const timeAnchorEnd = Math.max(dateIndex, intent.cueIndex);
  const time = parseTime(
    sliceScheduledClause(normalized, timeStartIndex, timeAnchorEnd),
  );
  if (!time) return formatDate(resolvedDate);

  return zonedLocalTimeToUtc(
    { ...resolvedDate, hour: time.hour, minute: time.minute },
    timeZone,
  ).toISOString();
}

function isModelDateSupportedByIntent(analysis: LeadDateAnalysis) {
  if (analysis.intent.kind !== "planned") return false;
  if (analysis.relativeDate) return true;
  if (
    hasModelResolvedDateSignalAttachedToCue(
      analysis.normalized,
      analysis.intent.cueIndex,
    )
  ) {
    return true;
  }
  if (analysis.relativeDates.length > 0) return false;
  if (analysis.explicitDates.length === 0) return true;
  const cueIndex = analysis.intent.cueIndex;

  return analysis.explicitDates.some((candidate) =>
    isDateAttachedToCue(analysis.normalized, candidate.index, cueIndex),
  );
}

function selectRelativeDate(
  candidates: ParsedRelativeDate[],
  normalized: string,
  intent: SchedulingIntent,
) {
  if (intent.kind !== "planned") return undefined;

  const attached = candidates.filter(
    (candidate) =>
      candidate.kind !== "historical" &&
      isDateAttachedToCue(normalized, candidate.index, intent.cueIndex),
  );
  const afterCue = attached.find(
    (candidate) => candidate.index >= intent.cueIndex,
  );
  if (afterCue) return afterCue;

  return [...attached]
    .reverse()
    .find((candidate) => candidate.index < intent.cueIndex);
}

function isDateAttachedToCue(
  normalized: string,
  dateIndex: number,
  cueIndex: number,
) {
  if (dateIndex < cueIndex) {
    const beforeDate = normalized.slice(0, dateIndex);
    const clauseStart = Math.max(
      beforeDate.lastIndexOf(";"),
      beforeDate.lastIndexOf("."),
      beforeDate.lastIndexOf("!"),
      beforeDate.lastIndexOf("?"),
    );
    const datePrefix = beforeDate.slice(clauseStart + 1).trim();
    const dateToCue = normalized.slice(dateIndex, cueIndex);
    const allowedDatePrefix = /^(?:le|la|ce|cet|cette|pour|for|on|at)?$/;

    if (dateToCue.includes(",") && !allowedDatePrefix.test(datePrefix)) {
      return false;
    }
  }

  const contextStart =
    dateIndex < cueIndex ? Math.max(0, dateIndex - 120) : cueIndex;
  const contextEnd = dateIndex < cueIndex ? cueIndex : dateIndex;
  const context = normalized.slice(contextStart, contextEnd);

  if (hasInterveningContextClause(context)) return false;
  return !hasHistoricalActionContext(context);
}

function hasModelResolvedDateSignalAttachedToCue(
  normalized: string,
  cueIndex: number,
) {
  return [
    ...normalized.matchAll(
      /\b(semaine prochaine|next week|fin du mois|end of month)\b/g,
    ),
  ].some((signal) =>
    isDateAttachedToCue(normalized, signal.index ?? 0, cueIndex),
  );
}

function hasInterveningContextClause(context: string) {
  const subject =
    "(?:j|je|tu|il|elle|on|nous|vous|ils|elles|i|you|he|she|we|they)";

  return (
    /[;.!?]\s*\S/.test(context) ||
    new RegExp(`(?:^|,)\\s*${subject}\\s+\\w+`).test(context) ||
    new RegExp(
      `\\b(?:car|parce que|puisque|mais|alors que|because|but|while|when)\\s+${subject}\\s+\\w+`,
    ).test(context)
  );
}

type SchedulingIntent =
  { kind: "historical" | "none" } | { cueIndex: number; kind: "planned" };

function classifySchedulingIntent({
  hasDateSignal: dateSignal,
  normalized,
}: {
  hasDateSignal: boolean;
  normalized: string;
}): SchedulingIntent {
  for (const directAction of normalized.matchAll(
    /\b(relance|relancer|rappel|rappelle|rappeler|envoie|envoyer|prepare|preparer|partage|partager|transmets|transmettre|soumets|soumettre|contacte|contacter|appelle|appeler|verifie|verifier|cree|creer|organise|organiser|planifie|planifier|programme|programmer|book|booker|schedule|send|share|submit|contact|remind|follow up)\b/g,
  )) {
    const actionIndex = directAction.index ?? 0;
    if (
      !isLabelStyleSchedulingCue(
        normalized,
        actionIndex,
        directAction[0].length,
      ) &&
      !hasPastAuxiliaryBefore(normalized, actionIndex) &&
      !isSchedulingCueSuppressed(
        normalized,
        actionIndex,
        directAction[0].length,
      )
    ) {
      return { cueIndex: actionIndex, kind: "planned" };
    }
  }

  if (/\b(annule|annulee|cancelled|canceled)\b/.test(normalized)) {
    return { kind: "none" };
  }

  const meetingIntent = normalized.match(
    /\b(meeting|rdv|rendez vous|demo|demonstration|call|appel|visio|reunion|appointment)\b/,
  );
  if (!meetingIntent) return { kind: "none" };

  const meetingIndex = meetingIntent.index ?? 0;
  if (
    isSchedulingCueSuppressed(normalized, meetingIndex, meetingIntent[0].length)
  ) {
    return { kind: "none" };
  }
  if (isHistoricalMeetingReference(normalized, meetingIndex)) {
    return { kind: "historical" };
  }

  const bookedSignal = normalized.match(
    /\b(booke|booked|fixe|planifie|prevu|programme|cale|confirme|scheduled|planned|confirmed|set)\b/,
  );
  if (!bookedSignal && !dateSignal) return { kind: "none" };

  return {
    cueIndex: Math.min(meetingIndex, bookedSignal?.index ?? meetingIndex),
    kind: "planned",
  };
}

function isLabelStyleSchedulingCue(
  normalized: string,
  cueIndex: number,
  cueLength: number,
) {
  const cue = normalized.slice(cueIndex, cueIndex + cueLength);
  const prefix = normalized.slice(Math.max(0, cueIndex - 48), cueIndex);
  const suffix = normalized.slice(
    cueIndex + cueLength,
    cueIndex + cueLength + 64,
  );

  if (/^[^,;.!?]{0,32}:/.test(suffix)) return true;

  return (
    (cue === "contact" || cue === "contacter") &&
    /\ba\s*$/.test(prefix) &&
    /^\s*(?:[.:;!?]|$)/.test(suffix)
  );
}

function isSchedulingCueSuppressed(
  normalized: string,
  cueIndex: number,
  cueLength: number,
) {
  const prefix = normalized.slice(Math.max(0, cueIndex - 96), cueIndex);
  const localPrefix =
    prefix.split(/[;.!?]|\b(?:puis|ensuite|mais|then|but)\b/).at(-1) ?? prefix;
  const suffix = normalized
    .slice(cueIndex + cueLength, cueIndex + cueLength + 48)
    .split(/[;.!?]/, 1)[0];

  if (
    /\b(?:annule|annuler|annulation|cancel|canceled|cancelled)\b/.test(
      localPrefix,
    )
  ) {
    return true;
  }
  if (
    /\b(?:ne(?:\s+(?:pas|jamais|plus))?|sans|pas(?:\s+encore|\s+de)?|aucun|aucune|non|do not|don t|not(?:\s+yet)?|never|without|no)\s*$/.test(
      localPrefix,
    )
  ) {
    return true;
  }
  if (
    /\b(?:ne|n)\b.{0,48}\b(?:pas|jamais|plus)\b/.test(localPrefix) ||
    /\b(?:do not|don t|never|without)\b/.test(localPrefix)
  ) {
    return true;
  }

  return /^\s+(?:pas|jamais|plus|non|not|never)\b/.test(suffix);
}

function hasUnsuppressedCue(normalized: string, pattern: RegExp) {
  return [...normalized.matchAll(pattern)].some(
    (cue) =>
      !isSchedulingCueSuppressed(normalized, cue.index ?? 0, cue[0].length),
  );
}

function isHistoricalMeetingReference(
  normalized: string,
  meetingIndex: number,
) {
  const prefix = normalized.slice(Math.max(0, meetingIndex - 96), meetingIndex);
  const suffix = normalized
    .slice(meetingIndex, meetingIndex + 96)
    .split(/[;.!?]/, 1)[0];

  if (
    /\b(?:compte rendu|resume|notes?|retour|historique)(?:\s+(?:du|de la|de|sur|apres|from the|from))?\s*$/.test(
      prefix,
    )
  ) {
    return true;
  }
  if (
    /\b(?:apres(?:\s+(?:le|la|un|une))?|suite (?:au|a(?: la| un| une)?)|lors (?:du|de la|d un|d une)|pendant (?:le|la|un|une)|after (?:the|a|an)|following (?:the|a|an)|during (?:the|a|an))\s*$/.test(
      prefix,
    ) ||
    /^(?:meeting|rdv|rendez vous|demo|demonstration|call|appel|visio|video call|reunion|teleconf|appointment)\s+du\s+\d{1,2}(?:[/-]|\s+)/.test(
      suffix,
    ) ||
    /^\S+(?:\s+\S+){0,5}\s+\b(?:hier|avant hier|la semaine derniere|le mois dernier|yesterday|last week|last month)\b/.test(
      suffix,
    )
  ) {
    return true;
  }

  const frenchPastMeeting =
    /\b(?:j ai|tu as|il a|elle a|on a|nous avons|vous avez|ils ont|elles ont)\s+(?:eu|fait|tenu|passe)\s+(?:un|une|le|la|ce|cet|cette)?\s*$/.test(
      prefix,
    );
  const frenchPastPossession =
    /\b(?:j avais|tu avais|il avait|elle avait|on avait|nous avions|vous aviez|ils avaient|elles avaient)\s+(?:(?:booke|fixe|organise|planifie|programme)\s+)?(?:un|une|le|la|ce|cet|cette)?\s*$/.test(
      prefix,
    );
  const englishPastMeeting =
    /\b(?:i|you|he|she|we|they)\s+(?:had|held|attended|had booked|had planned|had scheduled|had set up)\s+(?:a|the)?\s*$/.test(
      prefix,
    );

  return frenchPastMeeting || frenchPastPossession || englishPastMeeting;
}

function hasPastAuxiliaryBefore(normalized: string, actionIndex: number) {
  const prefix = normalized.slice(Math.max(0, actionIndex - 96), actionIndex);
  const frenchSubjectAuxiliary =
    /\b(?:j|je|tu|il|elle|on|nous|vous|ils|elles)\s+(?:ne\s+)?(?:(?:l|le|la|les|lui|leur|me|m|te|t|se|s|nous|vous|y|en)\s+){0,2}(?:ai|as|a|avons|avez|ont|avais|avait|avions|aviez|avaient|suis|es|est|sommes|etes|sont|etais|etait|etions|etiez|etaient)(?:\s+(?:deja|bien|finalement|juste|recemment|pas|jamais|plus|ete))*\s*$/;
  const frenchRecentPast =
    /\b(?:j|je|tu|il|elle|on|nous|vous|ils|elles)\s+(?:viens|vient|venons|venez|viennent)\s+de\s+(?:(?:l|le|la|les|lui|leur|me|m|te|t|se|s|nous|vous|y|en)\s+){0,2}$/;
  const englishSubjectAuxiliary =
    /\b(?:i|you|he|she|we|they)\s+(?:have|has|had|was|were)(?:\s+(?:already|just|recently|been))*\s*$/;
  const standalonePastAuxiliary =
    /\b(?:avoir|avait|avaient|etait|etaient|has|had|was|were)(?:\s+(?:deja|bien|finalement|juste|recemment|already|just|recently|ete|been))*\s*$/;

  return (
    frenchSubjectAuxiliary.test(prefix) ||
    frenchRecentPast.test(prefix) ||
    englishSubjectAuxiliary.test(prefix) ||
    standalonePastAuxiliary.test(prefix)
  );
}

function hasHistoricalActionContext(context: string) {
  const englishSimplePast = new Set([
    "called",
    "contacted",
    "discussed",
    "had",
    "held",
    "met",
    "planned",
    "prepared",
    "scheduled",
    "sent",
    "spoke",
    "talked",
  ]);

  for (const action of context.matchAll(
    /\b(appele|booke|contacte|discute|echange|envoye(?:e|es|s)?|eu|fait|parle|prepare|programme|planifie|rencontre|tenu|called|contacted|discussed|had|held|met|planned|prepared|scheduled|sent|spoke|talked)\b/g,
  )) {
    const actionIndex = action.index ?? 0;
    if (hasPastAuxiliaryBefore(context, actionIndex)) return true;
    if (!englishSimplePast.has(action[1])) continue;

    const prefix = context.slice(Math.max(0, actionIndex - 48), actionIndex);
    if (
      /\b(?:i|you|he|she|we|they)\s+(?:(?:already|just|recently)\s+)*$/.test(
        prefix,
      )
    ) {
      return true;
    }
  }

  return false;
}

function parseExplicitDateCandidates(text: string, today: LocalDate) {
  const candidates: ExplicitDateCandidate[] = [];
  const addCandidate = (
    candidate: LocalDate | undefined,
    index: number | undefined,
  ) => {
    if (candidate) candidates.push({ ...candidate, index: index ?? 0 });
  };

  for (const isoDate of text.matchAll(
    /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g,
  )) {
    addCandidate(
      normalizeExplicitDate({
        day: Number(isoDate[3]),
        month: Number(isoDate[2]),
        today,
        year: Number(isoDate[1]),
      }),
      isoDate.index,
    );
  }

  for (const numericWithYear of text.matchAll(
    /(?<![\d./-])([0-3]?\d)([/.-])([01]?\d)\2(\d{2}|\d{4})(?![\d./-])/g,
  )) {
    addCandidate(
      normalizeExplicitDate({
        day: Number(numericWithYear[1]),
        month: Number(numericWithYear[3]),
        today,
        year: normalizeYear(Number(numericWithYear[4])),
      }),
      numericWithYear.index,
    );
  }

  for (const numericWithoutYear of text.matchAll(
    /(?<![\d./-])([0-3]?\d)([/-])([01]?\d)(?![\d./-])/g,
  )) {
    addCandidate(
      normalizeExplicitDate({
        day: Number(numericWithoutYear[1]),
        month: Number(numericWithoutYear[3]),
        today,
      }),
      numericWithoutYear.index,
    );
  }

  const normalized = normalizeText(text);
  const monthNames: Record<string, number> = {
    apr: 4,
    april: 4,
    avril: 4,
    aug: 8,
    august: 8,
    aout: 8,
    dec: 12,
    december: 12,
    decembre: 12,
    feb: 2,
    february: 2,
    fevrier: 2,
    jan: 1,
    january: 1,
    janvier: 1,
    juillet: 7,
    jul: 7,
    july: 7,
    juin: 6,
    jun: 6,
    june: 6,
    mai: 5,
    mar: 3,
    march: 3,
    mars: 3,
    may: 5,
    nov: 11,
    november: 11,
    novembre: 11,
    oct: 10,
    october: 10,
    octobre: 10,
    sep: 9,
    september: 9,
    septembre: 9,
  };
  for (const named of normalized.matchAll(
    /\b([0-3]?\d)(?:st|nd|rd|th)?\s+(janvier|january|jan|fevrier|february|feb|mars|march|mar|avril|april|apr|mai|may|juin|june|jun|juillet|july|jul|aout|august|aug|septembre|september|sep|octobre|october|oct|novembre|november|nov|decembre|december|dec)(?:(?:,\s*|\s+)(\d{4}))?\b/g,
  )) {
    addCandidate(
      normalizeExplicitDate({
        day: Number(named[1]),
        month: monthNames[named[2]],
        today,
        year: named[3] ? Number(named[3]) : undefined,
      }),
      named.index,
    );
  }

  for (const namedMonthFirst of normalized.matchAll(
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|october|oct|november|nov|december|dec)\s+([0-3]?\d)(?:st|nd|rd|th)?(?:(?:,\s*|\s+)(\d{4}))?\b/g,
  )) {
    addCandidate(
      normalizeExplicitDate({
        day: Number(namedMonthFirst[2]),
        month: monthNames[namedMonthFirst[1]],
        today,
        year: namedMonthFirst[3] ? Number(namedMonthFirst[3]) : undefined,
      }),
      namedMonthFirst.index,
    );
  }

  return candidates;
}

function parseAbsoluteDateTime(text: string) {
  const match = text.match(
    /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})\b/i,
  );
  if (!match) return undefined;

  const date = new Date(match[0]);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function parseRelativeDateCandidates(text: string, today: LocalDate) {
  const candidates: ParsedRelativeDate[] = [];
  const occupied: Array<{ end: number; start: number }> = [];
  const addCandidate = (
    match: RegExpMatchArray,
    date: LocalDate,
    kind: ParsedRelativeDate["kind"],
  ) => {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (occupied.some((range) => start < range.end && end > range.start)) {
      return;
    }
    candidates.push({ date, index: start, kind });
    occupied.push({ end, start });
  };

  for (const match of text.matchAll(/\b(apres demain|day after tomorrow)\b/g)) {
    addCandidate(match, shiftLocalDate(today, 2), "future");
  }
  for (const match of text.matchAll(/\b(demain|tomorrow)\b/g)) {
    addCandidate(match, shiftLocalDate(today, 1), "future");
  }
  for (const match of text.matchAll(/\b(aujourd hui|today)\b/g)) {
    addCandidate(match, today, "today");
  }

  const wordValues: Record<string, number> = {
    cinq: 5,
    deux: 2,
    five: 5,
    four: 4,
    one: 1,
    quatre: 4,
    sept: 7,
    seven: 7,
    six: 6,
    three: 3,
    trois: 3,
    two: 2,
    un: 1,
    une: 1,
  };
  for (const match of text.matchAll(
    /\b(?:dans|in)\s+(\d+|un|une|deux|trois|quatre|cinq|six|sept|one|two|three|four|five|six|seven)\s+(?:jours?|days?)\b/g,
  )) {
    const value = match[1];
    addCandidate(
      match,
      shiftLocalDate(
        today,
        /^\d+$/.test(value) ? Number(value) : wordValues[value],
      ),
      "future",
    );
  }

  const weekdays: Record<string, number> = {
    dimanche: 0,
    friday: 5,
    fri: 5,
    jeudi: 4,
    lundi: 1,
    mardi: 2,
    mercredi: 3,
    monday: 1,
    mon: 1,
    samedi: 6,
    saturday: 6,
    sat: 6,
    sunday: 0,
    sun: 0,
    thursday: 4,
    thu: 4,
    tuesday: 2,
    tue: 2,
    vendredi: 5,
    wednesday: 3,
    wed: 3,
  };
  const currentWeekday = new Date(
    Date.UTC(today.year, today.month - 1, today.day),
  ).getUTCDay();
  for (const match of text.matchAll(
    /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat|sunday|sun)\b/g,
  )) {
    const weekday = match[1];
    if (!isSupportedWeekdayAbbreviation(text, match)) continue;

    const start = match.index ?? 0;
    const end = start + match[0].length;
    const before = text.slice(Math.max(0, start - 12), start);
    const after = text.slice(end, end + 16);
    const historical =
      /\b(?:last|previous)\s*$/.test(before) ||
      /^\s+(?:dernier|derniere|passe|passee)\b/.test(after);
    const targetWeekday = weekdays[weekday];
    let offset = historical
      ? -((currentWeekday - targetWeekday + 7) % 7 || 7)
      : (targetWeekday - currentWeekday + 7) % 7;
    if (!historical && offset === 0) offset = 7;
    addCandidate(
      match,
      shiftLocalDate(today, offset),
      historical ? "historical" : "weekday",
    );
  }

  return candidates.sort((left, right) => left.index - right.index);
}

function parseTime(text: string) {
  const meridiem = text.match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/);
  if (meridiem) {
    const rawHour = Number(meridiem[1]);
    return {
      hour:
        meridiem[3] === "pm"
          ? rawHour === 12
            ? 12
            : rawHour + 12
          : rawHour === 12
            ? 0
            : rawHour,
      minute: meridiem[2] ? Number(meridiem[2]) : 0,
    };
  }

  const explicit = text.match(/\b([01]?\d|2[0-3])\s*(?:h|:)\s*([0-5]\d)?\b/);
  if (explicit) {
    return {
      hour: Number(explicit[1]),
      minute: explicit[2] ? Number(explicit[2]) : 0,
    };
  }

  if (/\b(matin|morning)\b/.test(text)) return { hour: 9, minute: 0 };
  if (/\b(apres midi|afternoon)\b/.test(text)) {
    return { hour: 14, minute: 0 };
  }
  return undefined;
}

function sliceScheduledClause(
  text: string,
  startIndex: number,
  anchorEndIndex: number,
) {
  const remaining = text.slice(anchorEndIndex);
  let boundaryIndex: number | undefined;

  for (const boundary of remaining.matchAll(/[,;!?]|\.(?=\s|$)/g)) {
    const index = boundary.index ?? 0;
    if (boundary[0] !== ",") {
      boundaryIndex = index;
      break;
    }

    const nextClause = remaining.slice(index + 1);
    if (
      /^\s*(?:(?:j|je|tu|il|elle|on|nous|vous|ils|elles|i|you|he|she|we|they)\s+\w+|(?:puis|ensuite|mais|car|parce que|because|but|then)\b)/.test(
        nextClause,
      )
    ) {
      boundaryIndex = index;
      break;
    }
  }

  const endIndex =
    boundaryIndex === undefined ? text.length : anchorEndIndex + boundaryIndex;

  return text.slice(startIndex, endIndex);
}

function normalizeModelLeadDate(value: unknown, timeZone: string) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const clean = value.trim();
  const dateOnly = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return isValidCalendarDate({
      day: Number(dateOnly[3]),
      month: Number(dateOnly[2]),
      year: Number(dateOnly[1]),
    })
      ? clean
      : undefined;
  }

  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(clean)) {
    const zoned = clean.match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})$/i,
    );
    if (!zoned || !isValidCalendarDateTime(zoned)) return undefined;

    const date = new Date(clean);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  const local = clean.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/,
  );
  if (!local || !isValidCalendarDateTime(local)) return undefined;

  const date = zonedLocalTimeToUtc(
    {
      day: Number(local[3]),
      hour: Number(local[4]),
      minute: Number(local[5]),
      month: Number(local[2]),
      year: Number(local[1]),
    },
    timeZone,
  );
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function isValidCalendarDate({
  day,
  month,
  year,
}: Pick<LocalDateTime, "day" | "month" | "year">) {
  const candidate = new Date(Date.UTC(year, month - 1, day));

  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() + 1 === month &&
    candidate.getUTCDate() === day
  );
}

function isValidCalendarDateTime(match: RegExpMatchArray) {
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] ? Number(match[6]) : 0;

  return (
    isValidCalendarDate({
      day: Number(match[3]),
      month: Number(match[2]),
      year: Number(match[1]),
    }) &&
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59 &&
    second >= 0 &&
    second <= 59
  );
}

function hasDateSignal(text: string, now: Date, timeZone: string) {
  if (
    parseExplicitDateCandidates(text, getLocalDateParts(now, timeZone)).length >
    0
  ) {
    return true;
  }

  const normalized = normalizeText(text);
  if (
    /\b(demain|tomorrow|aujourd hui|today|apres demain|day after tomorrow|semaine prochaine|next week|fin du mois|end of month|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b(?:dans|in)\s+(?:\d+|un|une|deux|trois|quatre|cinq|six|sept|one|two|three|four|five|six|seven)\s+(?:jours?|days?)\b/.test(
      normalized,
    )
  ) {
    return true;
  }

  return [...normalized.matchAll(/\b(mon|tue|wed|thu|fri|sat|sun)\b/g)].some(
    (match) => isSupportedWeekdayAbbreviation(normalized, match),
  );
}

function isSupportedWeekdayAbbreviation(text: string, match: RegExpMatchArray) {
  const weekday = match[1];
  if (!/^(?:mon|tue|wed|thu|fri|sat|sun)$/.test(weekday)) return true;
  if (!/^(?:mon|sat|sun)$/.test(weekday)) return true;

  const start = match.index ?? 0;
  const end = start + match[0].length;
  const before = text.slice(Math.max(0, start - 12), start);
  const after = text.slice(end, end + 32);

  return (
    /\b(?:next|on)\s*$/.test(before) ||
    /^\s+(?:(?:at|a)\s+)?(?:\d{1,2}(?::[0-5]\d)?\s*(?:am|pm|h)?|morning|afternoon|evening)\b/.test(
      after,
    )
  );
}

type LocalDate = { day: number; month: number; year: number };
type ExplicitDateCandidate = LocalDate & { index: number };
type LocalDateTime = LocalDate & { hour: number; minute: number };
type ParsedRelativeDate = {
  date: LocalDate;
  index: number;
  kind: "future" | "historical" | "today" | "weekday";
};

function getLocalDateParts(date: Date, timeZone: string): LocalDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return {
    day: Number(values.day),
    month: Number(values.month),
    year: Number(values.year),
  };
}

function normalizeExplicitDate({
  day,
  month,
  today,
  year,
}: {
  day: number;
  month: number;
  today: LocalDate;
  year?: number;
}) {
  let resolvedYear = year ?? today.year;
  if (
    year === undefined &&
    (month < today.month || (month === today.month && day < today.day))
  ) {
    resolvedYear += 1;
  }
  const candidate = new Date(Date.UTC(resolvedYear, month - 1, day));
  if (
    candidate.getUTCFullYear() !== resolvedYear ||
    candidate.getUTCMonth() + 1 !== month ||
    candidate.getUTCDate() !== day
  ) {
    return undefined;
  }
  return { day, month, year: resolvedYear };
}

function normalizeYear(year: number) {
  return year < 100 ? 2000 + year : year;
}

function shiftLocalDate(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(
    Date.UTC(date.year, date.month - 1, date.day + days),
  );
  return {
    day: shifted.getUTCDate(),
    month: shifted.getUTCMonth() + 1,
    year: shifted.getUTCFullYear(),
  };
}

function formatDate(date: LocalDate) {
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}
