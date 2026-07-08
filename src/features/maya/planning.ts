import type { CrmLeadSummary } from "@/features/crm/contracts";

import type {
  MayaBrief,
  MayaClientType,
  MayaDeckPlan,
  MayaIndexedDeck,
  MayaLearningEvent,
} from "./contracts";

export function buildMayaPitchBriefFromLead(lead: CrmLeadSummary): MayaBrief {
  const crmContext = [lead.topic, lead.notes, lead.nextAction, lead.source]
    .filter(Boolean)
    .join("\n");
  const clientName = lead.companyName || inferClientNameFromLead(lead);
  const brief: MayaBrief = {
    clientName,
    clientType: inferMayaClientType(crmContext),
    contactName: lead.contactName,
    crmContext,
    leadId: lead.id,
    meetingObjective:
      lead.status === "meeting-booked"
        ? "Préparer un pitch de diagnostic IA pour le prochain meeting."
        : undefined,
    missingQuestions: [],
    sourceLead: lead,
    status: "needs-context",
  };

  const missingQuestions = buildMissingMayaPitchQuestions(brief);

  return {
    ...brief,
    missingQuestions,
    status: missingQuestions.length ? "needs-context" : "ready",
  };
}

export function inferMayaClientType(input: string): MayaClientType {
  const normalized = normalize(input);

  if (
    includesAny(normalized, [
      "private equity",
      "fonds",
      "portfolio",
      "portefeuille",
      "participations",
    ])
  ) {
    return "portfolio";
  }

  if (
    includesAny(normalized, [
      "holding",
      "filiales",
      "groupe",
      "subsidiaries",
      "business units",
    ])
  ) {
    return "group";
  }

  return "single-company";
}

export function buildMissingMayaPitchQuestions(brief: MayaBrief) {
  const questions: string[] = [];
  if (!brief.websiteUrl)
    questions.push("Quel est le site web exact du client ?");
  if (!brief.meetingObjective) {
    questions.push("Quel est l'objectif principal du meeting ?");
  }
  if (!brief.contactName) {
    questions.push("Qui sera l'interlocuteur principal côté client ?");
  }
  return questions;
}

export function selectMayaCredentialSlides({
  brief,
  genericDeck,
}: {
  brief: MayaBrief;
  genericDeck: MayaIndexedDeck;
}) {
  const profile = normalize(
    [brief.clientName, brief.industry, brief.crmContext, brief.clientType].join(
      " ",
    ),
  );
  const credentialSlides = genericDeck.slides.filter(
    (slide) => slide.section === "credentials",
  );
  const scored = credentialSlides
    .map((slide) => ({
      score: scoreCredentialSlide(profile, slide.text),
      slide,
    }))
    .filter((item) => item.score > 0)
    .sort(
      (a, b) => b.score - a.score || a.slide.slideNumber - b.slide.slideNumber,
    );

  return scored.slice(0, 4).map((item) => item.slide.slideNumber);
}

export function buildMayaDeckPlan({
  brief,
  genericDeck,
  learningEvents,
}: {
  brief: MayaBrief;
  genericDeck: MayaIndexedDeck;
  learningEvents: MayaLearningEvent[];
}): MayaDeckPlan {
  const presentationSlideNumbers = genericDeck.slides
    .filter(
      (slide) => slide.section === "presentation" || slide.section === "offre",
    )
    .map((slide) => slide.slideNumber);
  const credentialSlideNumbers = selectMayaCredentialSlides({
    brief,
    genericDeck,
  });
  const closingSlideNumbers = genericDeck.slides
    .filter((slide) => slide.section === "closing")
    .map((slide) => slide.slideNumber);
  const credentialSet = new Set(credentialSlideNumbers);
  const omittedSlideNumbers = genericDeck.slides
    .filter(
      (slide) =>
        slide.section === "credentials" &&
        !credentialSet.has(slide.slideNumber),
    )
    .map((slide) => slide.slideNumber);

  return {
    brief,
    closingSlideNumbers,
    credentialSlideNumbers,
    diagnosticOutline: buildDiagnosticOutline(brief, learningEvents),
    genericDeckFileName: genericDeck.fileName,
    omittedSlideNumbers,
    presentationSlideNumbers,
    residueWarnings: genericDeck.residueWarnings,
  };
}

function scoreCredentialSlide(profile: string, slideText: string) {
  const normalized = normalize(slideText);
  let score = 0;

  const keywordGroups = [
    ["healthcare", "pharma", "clinique", "patient", "dentaire", "laboratoire"],
    [
      "retail",
      "hospitality",
      "hotel",
      "station",
      "energie",
      "carburant",
      "gaz",
    ],
    [
      "industrial",
      "industrials",
      "transport",
      "logistics",
      "supply chain",
      "stocks",
    ],
    ["financial", "finance", "assurance", "credit", "bnpl", "scoring", "fonds"],
  ];

  for (const group of keywordGroups) {
    const profileHits = group.filter((keyword) => profile.includes(keyword));
    if (profileHits.length === 0) continue;
    const slideHits = group.filter((keyword) => normalized.includes(keyword));
    score += profileHits.length * slideHits.length;
  }

  if (profile.includes("portfolio") && normalized.includes("financial")) {
    score += 3;
  }

  if (
    (profile.includes("groupe") || profile.includes("filiales")) &&
    (normalized.includes("industrial") ||
      normalized.includes("logistics") ||
      normalized.includes("supply chain"))
  ) {
    score += 2;
  }

  return score;
}

function buildDiagnosticOutline(
  brief: MayaBrief,
  learningEvents: MayaLearningEvent[],
) {
  const base = [
    `Pour ${brief.clientName}, cartographier la chaîne de valeur et repérer les poches de valeur IA.`,
    "Prioriser les cas d'usage selon impact P&L, criticité métier, disponibilité data et faisabilité.",
    "Proposer une feuille de route courte: quick wins, chantiers structurants, puis passage à l'échelle.",
  ];

  if (brief.clientType === "portfolio") {
    return [
      `Pour ${brief.clientName}, segmenter le portefeuille puis scorer les sociétés par potentiel IA et faisabilité.`,
      "Identifier les plateformes ou participations à activer en premier.",
      ...base.slice(1),
      ...learningEvents.slice(0, 2).map((event) => event.summary),
    ];
  }

  if (brief.clientType === "group") {
    return [
      `Pour ${brief.clientName}, cartographier la chaîne de valeur des filiales et les synergies data au niveau groupe.`,
      ...base.slice(1),
      ...learningEvents.slice(0, 2).map((event) => event.summary),
    ];
  }

  return [...base, ...learningEvents.slice(0, 2).map((event) => event.summary)];
}

function inferClientNameFromLead(lead: CrmLeadSummary) {
  if (lead.topic.includes(" - ")) return lead.topic.split(" - ")[0].trim();
  return lead.topic.trim();
}

function includesAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle));
}

function normalize(text: string) {
  return text
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("fr-FR")
    .replace(/\s+/g, " ")
    .trim();
}
