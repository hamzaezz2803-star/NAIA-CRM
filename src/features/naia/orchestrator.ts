import type {
  CrmLeadDraft,
  CrmLeadStatus,
  CrmLeadSummary,
} from "@/features/crm/contracts";
import { crmLeadStatuses } from "@/features/crm/contracts";

import { getNaiaAgent, type NaiaAgentId } from "./agents";
import { extractLeadIdentity, inferReminderDate } from "./lead-understanding";
import { buildOperationalAnalysisResponse } from "./operational-context";
import {
  inferPersonalCalendarDays,
  isCalendarReadQuery,
  isGmailReadQuery,
  isPersonalCalendarQuery,
  isPersonalGmailQuery,
  isUrgentGmailQuery,
} from "./personal-query-intents";

export type NaiaActionRisk = "low" | "medium" | "high";

export type NaiaActionDraft =
  | {
      agentId: "crm";
      approvalRequired: true;
      description: string;
      id: string;
      kind: "crm.updateLeadStatus";
      label: string;
      payload: {
        leadId: string;
        leadLabel: string;
        nextAction?: string;
        notes?: string;
        status: CrmLeadStatus;
      };
      risk: NaiaActionRisk;
    }
  | {
      agentId: "meetings";
      approvalRequired: true;
      description: string;
      id: string;
      kind: "calendar.scheduleMeeting";
      label: string;
      payload: {
        companyName?: string;
        contactName?: string;
        leadActionId?: string;
        notes: string;
        requestedDate?: string;
        title: string;
      };
      risk: NaiaActionRisk;
    }
  | {
      agentId: "meetings";
      approvalRequired: true;
      description: string;
      id: string;
      kind: "calendar.createReminder";
      label: string;
      payload: {
        notes: string;
        scheduledAt?: string;
        timeWasInferred: boolean;
        timeZone: string;
        title: string;
      };
      risk: NaiaActionRisk;
    }
  | {
      agentId: "crm";
      approvalRequired: true;
      description: string;
      id: string;
      kind: "crm.createLead";
      label: string;
      payload: CrmLeadDraft;
      risk: NaiaActionRisk;
    }
  | {
      agentId: "developer";
      approvalRequired: true;
      description: string;
      id: string;
      kind: "dev.prepareSpec";
      label: string;
      payload: {
        branchPrefix: string;
        request: string;
      };
      risk: NaiaActionRisk;
    }
  | {
      agentId: "integrations";
      approvalRequired: true;
      description: string;
      id: string;
      kind: "google.gmail.listMessages";
      label: string;
      payload: {
        maxResults: number;
        query?: string;
        unreadOnly: boolean;
      };
      risk: NaiaActionRisk;
    }
  | {
      agentId: "meetings";
      approvalRequired: true;
      description: string;
      id: string;
      kind: "google.calendar.listEvents";
      label: string;
      payload: {
        calendarId?: string;
        daysAhead: number;
        maxResults: number;
      };
      risk: NaiaActionRisk;
    }
  | {
      agentId: "integrations";
      approvalRequired: true;
      description: string;
      id: string;
      kind: "slack.prepareMessage";
      label: string;
      payload: {
        channel?: string;
        targetLabel?: string;
        text: string;
      };
      risk: NaiaActionRisk;
    }
  | {
      agentId: "crm";
      approvalRequired: true;
      description: string;
      id: string;
      kind: "crm.generateFollowUpDraft";
      label: string;
      payload: {
        leadId: string;
        leadLabel: string;
        contactName?: string;
        companyName?: string;
      };
      risk: NaiaActionRisk;
    }
  | {
      agentId: "proposals";
      approvalRequired: true;
      description: string;
      id: string;
      kind: "pitch.generateDraft";
      label: string;
      payload: {
        clientName?: string;
        contactName?: string;
        leadId: string;
        leadLabel: string;
        notes?: string;
      };
      risk: NaiaActionRisk;
    };

export type NaiaOrchestrationResult = {
  actions: NaiaActionDraft[];
  agent: {
    id: NaiaAgentId;
    name: string;
    role: string;
    route: string;
  };
  command: string;
  confidence: number;
  intent:
    | "lead-research"
    | "crm"
    | "finance"
    | "projects"
    | "hr"
    | "meetings"
    | "proposals"
    | "automations"
    | "integrations"
    | "settings"
    | "developer"
    | "overview";
  response: string;
  responseType: "action" | "answer" | "handoff";
};

const crmStatusLabels: Record<CrmLeadStatus, string> = {
  contacted: "Contacté",
  "dead-end": "Dead end",
  "lead-to-contact": "À contacter",
  "meeting-booked": "Meeting fixé",
  "proposal-sent": "Proposition envoyée",
  "to-follow-up": "À relancer",
  won: "Gagné",
};

export function orchestrateNaiaCommand({
  agentIdOverride,
  command,
  confidenceOverride,
  contextAgentId,
  crmLeads = [],
  crmReadLeads,
  responseOverride,
  selectedLeadId,
}: {
  agentIdOverride?: NaiaAgentId;
  command: string;
  confidenceOverride?: number;
  contextAgentId?: NaiaAgentId;
  crmLeads?: CrmLeadSummary[];
  crmReadLeads?: CrmLeadSummary[];
  responseOverride?: string;
  selectedLeadId?: string;
}): NaiaOrchestrationResult {
  const cleanCommand = command.trim();
  const localAgentId = classifyNaiaAgent(cleanCommand);
  const normalized = normalize(cleanCommand);
  const forceCrmForProspectMeeting =
    localAgentId === "crm" && isPotentialClientMeeting(normalized);
  const contextualAgentId =
    localAgentId === "naia" && !isNaiaOverviewQuestion(cleanCommand)
      ? contextAgentId
      : undefined;
  const agentId = forceCrmForProspectMeeting
    ? "crm"
    : (agentIdOverride ?? contextualAgentId ?? localAgentId);
  const agent = getNaiaAgent(agentId);
  const workspaceActions = buildWorkspaceActions(
    cleanCommand,
    localAgentId,
    crmLeads,
    selectedLeadId,
  );
  const actions =
    agentId === "crm" || localAgentId === "crm"
      ? buildCrmActions(cleanCommand, crmLeads, selectedLeadId)
      : agentId === "developer" || localAgentId === "developer"
        ? [buildDeveloperAction(cleanCommand)]
        : workspaceActions.length > 0
          ? workspaceActions
          : [];

  const responseType = classifyResponseType({
    actions,
    agentId,
    command: cleanCommand,
  });

  return {
    actions,
    agent: {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      route: agent.route,
    },
    command: cleanCommand,
    confidence:
      confidenceOverride ??
      (cleanCommand ? confidenceFor(agentId, cleanCommand) : 0.2),
    intent: intentForAgent(agentId),
    response:
      (forceCrmForProspectMeeting ? undefined : responseOverride)
        ?.trim()
        .slice(0, 1200) ||
      buildResponse(agentId, cleanCommand, actions, crmReadLeads ?? crmLeads),
    responseType,
  };
}

function classifyResponseType({
  actions,
  agentId,
  command,
}: {
  actions: NaiaActionDraft[];
  agentId: NaiaAgentId;
  command: string;
}): NaiaOrchestrationResult["responseType"] {
  if (actions.length > 0) return "action";
  if (isNaiaOverviewQuestion(command)) return "answer";
  if (agentId === "crm" && buildCrmQuestionResponse(command, [])) {
    return "answer";
  }
  if (buildOperationalAnalysisResponse({ agentId, command })) return "answer";
  return "handoff";
}

export function classifyNaiaAgent(command: string): NaiaAgentId {
  const normalized = normalize(command);

  if (isNaiaOverviewQuestion(normalized)) {
    return "naia";
  }

  if (
    includesAny(normalized, [
      "ajoute une feature",
      "ajouter une feature",
      "nouvelle feature",
      "feature",
      "fonctionnalite",
      "code",
      "codex",
      "openclaw",
      "pull request",
      "branche",
    ])
  ) {
    return "developer";
  }

  if (isCashFlowIntent(normalized)) {
    return "finance";
  }

  if (isPersonalGmailQuery(normalized)) {
    return "integrations";
  }

  if (isPersonalCalendarQuery(normalized) && isCalendarReadQuery(normalized)) {
    return "meetings";
  }

  if (wantsGmailRead(normalized) || wantsSlackMessage(normalized)) {
    return "integrations";
  }

  if (
    isPitchGenerationIntent(normalized) &&
    !isLeadCaptureIntent(normalized) &&
    !includesAny(normalized, [
      "meeting booked",
      "meeting fixe",
      "rdv fixe",
      "rendez vous fixe",
      "rendez-vous fixe",
      "passe",
      "mets",
      "met ",
    ])
  ) {
    return "proposals";
  }

  if (
    includesAny(normalized, [
      "crm",
      "lead",
      "pipeline",
      "meeting booked",
      "meeting fixe",
      "propale",
      "proposition",
      "contacte",
      "relance",
      "relancer",
      "gagne",
      "brouillon",
      "draft",
      "suivi",
      "mail",
      "email",
      "whatsapp",
      "message",
      "rediger",
      "ecrire",
    ])
  ) {
    if (
      includesAny(normalized, [
        "scrap",
        "scrape",
        "prospect",
        "societe",
        "linkedin",
        "key people",
        "ca entre",
      ])
    ) {
      return "leads";
    }

    return "crm";
  }

  if (isPotentialClientMeeting(normalized)) {
    return "crm";
  }

  if (isPotentialClientOpportunity(normalized)) {
    return "crm";
  }

  if (
    isCashFlowIntent(normalized) ||
    includesAny(normalized, ["paiement", "cout", "relance client", "facture"])
  ) {
    return "finance";
  }

  if (
    includesAny(normalized, [
      "rh",
      "recrut",
      "candidat",
      "entretien",
      "staffing",
      "capacity",
      "hire",
      "hiring",
      "recruit",
      "roles",
    ])
  ) {
    return "hr";
  }

  if (
    includesAny(normalized, [
      "projet",
      "projets",
      "project",
      "projects",
      "delivery",
      "retard",
      "risk",
      "blocked",
      "blocking",
      "gantt",
      "use case",
      "jalon",
    ])
  ) {
    return "projects";
  }

  if (
    includesAny(normalized, [
      "meeting",
      "reunion",
      "rdv",
      "compte rendu",
      "agenda",
      "calendrier",
      "calendar",
      "dispo",
      "disponibilite",
    ])
  ) {
    return "meetings";
  }

  if (
    isPitchGenerationIntent(normalized) ||
    includesAny(normalized, ["proposal", "proposition", "propale", "offre"])
  ) {
    return "proposals";
  }

  if (includesAny(normalized, ["automation", "workflow", "agent ops"])) {
    return "automations";
  }

  if (
    includesAny(normalized, [
      "integration",
      "connecteur",
      "token",
      "api",
      "gmail",
      "email",
      "emails",
      "mail",
      "mails",
      "inbox",
      "slack",
    ])
  ) {
    return "integrations";
  }

  if (includesAny(normalized, ["setting", "permission", "role", "audit"])) {
    return "settings";
  }

  return "naia";
}

export function isNaiaOverviewQuestion(command: string) {
  const normalized = normalize(command).replace(/-/g, " ");
  if (normalized === "aide" || normalized === "help") return true;

  return includesAny(normalized, [
    "que sais tu faire",
    "qu est ce que tu sais faire",
    "qu est-ce que tu sais faire",
    "tu peux faire quoi",
    "que peux tu faire",
    "qu est ce que tu peux faire",
    "qu est-ce que tu peux faire",
    "a quoi tu sers",
    "a quoi sers tu",
    "comment tu peux m aider",
    "comment peux tu m aider",
    "tes capacites",
    "tes fonctions",
    "what can you do",
    "how can you help",
    "your capabilities",
    "what are your capabilities",
  ]);
}

export function inferCrmStatus(command: string): CrmLeadStatus | null {
  const normalized = normalize(command);
  const tokens = tokenSet(normalized);

  if (
    !isInternalReminderMeeting(normalized) &&
    includesAny(normalized, [
      "meeting booked",
      "meeting fixe",
      "rdv fixe",
      "rendez vous fixe",
      "call confirme",
      "meeting",
      "demo",
      "demontration",
      "demonstration",
      "démonstration",
      "visio",
      "reunion",
      "réunion",
      "appel",
      "rdv",
      "rendez-vous",
    ])
  ) {
    return "meeting-booked";
  }

  if (hasAnyToken(tokens, ["propale", "proposition", "offre"])) {
    return "proposal-sent";
  }

  if (
    hasAnyToken(tokens, ["relance", "relancer"]) ||
    normalized.includes("follow up")
  ) {
    return "to-follow-up";
  }

  if (
    hasAnyToken(tokens, [
      "contacte",
      "contactee",
      "contactes",
      "appele",
      "appelee",
      "appeles",
      "joint",
      "parle",
      "discute",
      "echange",
      "rencontre",
      "talked",
      "spoke",
      "contacted",
      "called",
      "discussed",
      "exchanged",
    ]) ||
    normalized.includes("met with")
  ) {
    return "contacted";
  }

  if (hasAnyToken(tokens, ["gagne", "signee", "signe", "won"])) {
    return "won";
  }

  if (hasAnyToken(tokens, ["dead", "perdu", "stop"])) {
    return "dead-end";
  }

  return null;
}

function buildCrmActions(
  command: string,
  crmLeads: CrmLeadSummary[],
  selectedLeadId?: string,
) {
  const normalized = normalize(command);
  if (
    isCrmReadQuestion(normalized) ||
    (isCrmInformationQuestion(command, normalized) &&
      !isExplicitCrmWriteRequest(normalized))
  ) {
    return [];
  }

  const status = inferCrmStatus(command);
  const matchedLead = resolveLeadMatch(command, crmLeads, selectedLeadId);
  const wantsLeadCreation = includesAny(normalized, [
    "cree un lead",
    "creer un lead",
    "cree le lead",
    "creer le lead",
    "cree ce lead",
    "creer ce lead",
    "ajoute un lead",
    "nouveau lead",
    "nouvelle opportunite",
    "opportunite",
    "prospect",
  ]);
  const explicitLeadStatusUpdate = isExplicitLeadStatusUpdate(normalized);
  const wantsProspectMeeting =
    !explicitLeadStatusUpdate && isPotentialClientMeeting(normalized);
  const wantsPotentialClientOpportunity =
    isPotentialClientOpportunity(normalized);

  if (
    wantsLeadCreation ||
    wantsProspectMeeting ||
    wantsPotentialClientOpportunity
  ) {
    const identity = extractSimpleLeadIdentity(command);
    const effectiveStatus =
      status ??
      (wantsPotentialClientOpportunity && !wantsProspectMeeting
        ? "contacted"
        : "lead-to-contact");
    const createLeadAction = {
      agentId: "crm",
      approvalRequired: true,
      description:
        wantsProspectMeeting && !wantsLeadCreation
          ? "Salma creera le lead CRM car un rendez-vous avec un prospect doit toujours etre rattache au pipeline."
          : wantsPotentialClientOpportunity && !wantsLeadCreation
            ? "Salma creera une opportunite CRM depuis cette conversation commerciale pour que tu puisses verifier et completer le lead."
            : "Salma creera un lead avec le texte de la commande comme contexte initial.",
      id: `crm-create-${stableActionSuffix(command)}`,
      kind: "crm.createLead",
      label: "Creer le lead CRM",
      payload: {
        nextAction:
          inferLeadNextAction(normalized, effectiveStatus) ??
          (effectiveStatus === "meeting-booked"
            ? "Preparer le meeting et confirmer le contexte avec le contact"
            : "Qualifier le besoin et confirmer le prochain rendez-vous"),
        notes: command,
        source: "NAIA",
        status: effectiveStatus,
        topic: extractLeadTopic(command),
        ...identity,
      },
      risk: "medium",
    } satisfies NaiaActionDraft;
    const actions: NaiaActionDraft[] = [createLeadAction];

    if (isInternalReminderMeeting(normalized)) {
      actions.push({
        agentId: "meetings",
        approvalRequired: true,
        description:
          "Adam créera un rappel personnel transparent dans Google Calendar après validation.",
        id: `calendar-reminder-${stableActionSuffix(command)}`,
        kind: "calendar.createReminder",
        label: "Créer le rappel Calendar",
        payload: {
          notes: command,
          scheduledAt: inferReminderDate(command),
          timeWasInferred: true,
          timeZone: "Africa/Casablanca",
          title: inferReminderTitle(normalized),
        },
        risk: "medium",
      });
    }

    if (
      effectiveStatus === "meeting-booked" &&
      !isInternalReminderMeeting(normalized)
    ) {
      actions.push({
        agentId: "meetings",
        approvalRequired: true,
        description:
          "Adam verifiera Google Calendar via le lead CRM, proposera un autre creneau si tu es deja pris, puis creera l'evenement apres validation.",
        id: `calendar-schedule-${stableActionSuffix(command)}`,
        kind: "calendar.scheduleMeeting",
        label: "Verifier le calendrier",
        payload: {
          companyName: identity.companyName,
          contactName: identity.contactName,
          leadActionId: createLeadAction.id,
          notes: command,
          title: buildMeetingTitle(command, identity),
        },
        risk: "medium",
      });
    }

    return actions;
  }

  const isRelanceKeyword = includesAny(normalized, [
    "relance",
    "follow up",
    "suivi",
  ]);
  const isDraftingKeyword = includesAny(normalized, [
    "draft",
    "brouillon",
    "rediger",
    "generer",
    "ecrire",
    "message",
    "mail",
    "email",
    "whatsapp",
  ]);
  const wantsFollowUpDraft =
    (isRelanceKeyword && isDraftingKeyword) ||
    includesAny(normalized, [
      "draft",
      "brouillon",
      "rediger le mail",
      "rediger le whatsapp",
      "rediger le message",
      "creer un relance",
    ]);

  if (wantsFollowUpDraft && matchedLead) {
    return [
      {
        agentId: "crm",
        approvalRequired: true,
        description: `Salma va préparer les messages de relance (Email et WhatsApp) pour "${matchedLead.topic}" et vous rediriger vers les brouillons.`,
        id: `crm-draft-${matchedLead.id}`,
        kind: "crm.generateFollowUpDraft",
        label: "Rédiger la relance (Email/WhatsApp)",
        payload: {
          leadId: matchedLead.id,
          leadLabel: matchedLead.topic,
          companyName: matchedLead.companyName,
          contactName: matchedLead.contactName,
        },
        risk: "low",
      } satisfies NaiaActionDraft,
    ];
  }

  if (status && matchedLead) {
    const nextAction =
      status === "meeting-booked"
        ? "Preparer le pitch decideur avec contexte CRM"
        : status === "proposal-sent"
          ? "Preparer la proposition, le scope et le plan de paiement"
          : status === "to-follow-up"
            ? "Preparer une relance commerciale personnalisee"
            : undefined;

    const actions: NaiaActionDraft[] = [
      {
        agentId: "crm",
        approvalRequired: true,
        description: `Salma mettra "${matchedLead.topic}" au statut ${crmStatusLabels[status]}.`,
        id: `crm-status-${matchedLead.id}-${status}`,
        kind: "crm.updateLeadStatus",
        label: `Appliquer: ${crmStatusLabels[status]}`,
        payload: {
          leadId: matchedLead.id,
          leadLabel: matchedLead.topic,
          nextAction,
          notes:
            status === "meeting-booked" || status === "proposal-sent"
              ? `NAIA: action preparee depuis la commande "${command}".`
              : undefined,
          status,
        },
        risk: "medium",
      } satisfies NaiaActionDraft,
    ];

    if (status === "meeting-booked") {
      actions.push(buildPitchDraftAction(command, matchedLead));
    }

    return actions;
  }

  return [];
}

function buildDeveloperAction(command: string): NaiaActionDraft {
  return {
    agentId: "developer",
    approvalRequired: true,
    description:
      "Rayan preparera une specification technique, une branche et une revue avant toute modification du code.",
    id: `dev-spec-${stableActionSuffix(command)}`,
    kind: "dev.prepareSpec",
    label: "Preparer une mission dev",
    payload: {
      branchPrefix: "ali/",
      request: command,
    },
    risk: "high",
  };
}

function buildWorkspaceActions(
  command: string,
  localAgentId: NaiaAgentId,
  crmLeads: CrmLeadSummary[],
  selectedLeadId?: string,
): NaiaActionDraft[] {
  const normalized = normalize(command);

  if (localAgentId === "proposals" && isPitchGenerationIntent(normalized)) {
    const matchedLead = resolveLeadMatch(command, crmLeads, selectedLeadId);
    return matchedLead ? [buildPitchDraftAction(command, matchedLead)] : [];
  }

  if (wantsGmailRead(normalized)) {
    return [
      {
        agentId: "integrations",
        approvalRequired: true,
        description:
          "Lina lira les derniers messages Gmail autorises par OAuth et retournera un resume avant toute action d'envoi.",
        id: `gmail-list-${stableActionSuffix(command)}`,
        kind: "google.gmail.listMessages",
        label: "Lire Gmail",
        payload: {
          maxResults: isUrgentGmailQuery(normalized) ? 15 : 10,
          query: isUrgentGmailQuery(normalized)
            ? "is:unread newer_than:14d {label:important subject:urgent subject:important}"
            : undefined,
          unreadOnly: includesAny(normalized, [
            "non lu",
            "non lus",
            "unread",
            "urgent",
          ]),
        },
        risk: "low",
      },
    ];
  }

  if (wantsCalendarRead(normalized)) {
    return [
      {
        agentId: "meetings",
        approvalRequired: true,
        description:
          "Adam lira Google Calendar pour te donner les creneaux et conflits visibles avant toute creation d'evenement.",
        id: `calendar-list-${stableActionSuffix(command)}`,
        kind: "google.calendar.listEvents",
        label: "Lire l'agenda",
        payload: {
          daysAhead: inferPersonalCalendarDays(normalized),
          maxResults: 10,
        },
        risk: "low",
      },
    ];
  }

  if (wantsSlackMessage(normalized)) {
    return [
      {
        agentId: "integrations",
        approvalRequired: true,
        description:
          "Lina preparera le message Slack. L'envoi restera bloque tant qu'un canal explicite et une validation ne sont pas fournis.",
        id: `slack-message-${stableActionSuffix(command)}`,
        kind: "slack.prepareMessage",
        label: "Preparer le message Slack",
        payload: extractSlackMessageDraft(command),
        risk: "medium",
      },
    ];
  }

  return [];
}

function buildPitchDraftAction(
  command: string,
  lead: CrmLeadSummary,
): NaiaActionDraft {
  return {
    agentId: "proposals",
    approvalRequired: true,
    description:
      "Maya generera un draft PPTX dans le dossier Drive prive du client, a partir du dernier deck generique, du contexte CRM et des questions de cadrage disponibles.",
    id: `pitch-draft-${lead.id}-${stableActionSuffix(command)}`,
    kind: "pitch.generateDraft",
    label: "Generer le pitch Maya",
    payload: {
      clientName: lead.companyName,
      contactName: lead.contactName,
      leadId: lead.id,
      leadLabel: lead.topic,
      notes: command,
    },
    risk: "medium",
  };
}

function findBestLeadMatch(command: string, crmLeads: CrmLeadSummary[]) {
  const normalizedCommand = normalize(command);
  const commandTokens = tokenSet(normalizedCommand);
  const genericLeadTokens = new Set([
    "commercial",
    "contact",
    "contacte",
    "crm",
    "lead",
    "meeting",
    "opportunite",
    "pipeline",
    "pitch",
    "projet",
    "proposal",
    "proposition",
    "relance",
    "rendez",
    "statut",
  ]);

  let bestLead: CrmLeadSummary | null = null;
  let bestScore = 0;

  for (const lead of crmLeads) {
    const haystack = normalize(
      [
        lead.topic,
        lead.source,
        lead.notes,
        lead.nextAction,
        lead.companyName,
        lead.contactName,
      ]
        .filter(Boolean)
        .join(" "),
    );
    const leadTokens = tokenSet(haystack);
    let score = 0;

    for (const token of leadTokens) {
      if (!genericLeadTokens.has(token) && commandTokens.has(token)) {
        score += token.length > 4 ? 2 : 1;
      }
    }

    if (haystack && normalizedCommand.includes(haystack.slice(0, 18))) {
      score += 3;
    }

    const companyName = lead.companyName ? normalize(lead.companyName) : "";
    const contactName = lead.contactName ? normalize(lead.contactName) : "";
    if (companyName && normalizedCommand.includes(companyName)) {
      score += companyName.length <= 4 ? 3 : 4;
    }
    if (contactName && normalizedCommand.includes(contactName)) {
      score += 4;
    }

    if (score > bestScore) {
      bestScore = score;
      bestLead = lead;
    }
  }

  return bestScore >= 2 ? bestLead : null;
}

function resolveLeadMatch(
  command: string,
  crmLeads: CrmLeadSummary[],
  selectedLeadId?: string,
) {
  const namedMatch = findBestLeadMatch(command, crmLeads);
  if (namedMatch) return namedMatch;
  if (!selectedLeadId || !canUseSelectedLeadContext(command)) return null;

  return crmLeads.find((lead) => lead.id === selectedLeadId) ?? null;
}

function canUseSelectedLeadContext(command: string) {
  const normalized = normalize(command).replace(/-/g, " ");
  if (
    includesAny(normalized, [
      "ce lead",
      "ce prospect",
      "cette opportunite",
      "celui ci",
      "celle ci",
      "du lead",
      "le lead selectionne",
      "pour lui",
      "pour elle",
      "sa relance",
      "son pitch",
      "ses informations",
      "this lead",
      "this prospect",
    ])
  ) {
    return true;
  }

  const targetlessStatusUpdate =
    /^(?:(?:naia|salma)\s+)?(?:passe|mets|met|change|modifie|deplace|update|move|set)(?:\s+(?:le|ce)\s+lead)?\s+(?:(?:au|a)\s+statut\s+|en\s+)?(?:a contacter|contacte|dead end|gagne|meeting booke|meeting fixe|proposal sent|proposition envoyee|relancer|to follow up|won)$/;
  if (targetlessStatusUpdate.test(normalized)) return true;

  const hasLeadActionIntent =
    isPitchGenerationIntent(normalized) ||
    includesAny(normalized, ["brouillon", "draft", "follow up", "relance"]);
  const namesExplicitTarget =
    /\b(?:chez|client|de|du|entreprise|pour|prospect|societe)\s+(?!ce\b|cette\b|le\b|la\b|lui\b|elle\b)[\p{Letter}\p{Number}]/u.test(
      normalized,
    );

  return hasLeadActionIntent && !namesExplicitTarget;
}

function buildResponse(
  agentId: NaiaAgentId,
  command: string,
  actions: NaiaActionDraft[],
  crmLeads: CrmLeadSummary[],
) {
  const agent = getNaiaAgent(agentId);

  if (!command) {
    return "Je suis en ligne. Donne-moi une instruction et je route vers le bon agent.";
  }

  if (agentId === "naia" && isNaiaOverviewQuestion(command)) {
    return "Je suis l'assistante opérationnelle de Qarizmi. Je peux répondre à tes questions générales, lire le CRM réel (pipeline, statuts, contacts et prochaines actions), préparer une fiche lead complète à corriger puis valider, consulter Gmail et Google Calendar quand ton compte est connecté, et lancer Maya pour les pitchs liés aux leads. Finance, Projects et HR disposent encore de données de travail simulées: je te le préciserai toujours au lieu de les présenter comme réelles. Toute écriture CRM ou action externe reste soumise à ta validation.";
  }

  const operationalResponse = buildOperationalAnalysisResponse({
    agentId,
    command,
  });
  if (operationalResponse && actions.length === 0) {
    return operationalResponse;
  }

  if (agentId === "crm") {
    if (actions.length > 0) {
      const actionLabels = actions.map((action) => `"${action.label}"`);
      if (
        actions.some((action) => action.kind === "crm.createLead") &&
        actions.some((action) => action.kind === "calendar.scheduleMeeting")
      ) {
        return `${agent.name} prend le relais CRM avec Adam en support calendrier. J'ai prepare ${actionLabels.join(" et ")}: le lead sera cree en meeting booked, puis Google Calendar sera verifie avant creation de l'evenement.`;
      }

      if (
        actions.some((action) => action.kind === "crm.createLead") &&
        actions.some((action) => action.kind === "calendar.createReminder")
      ) {
        return `${agent.name} prépare la fiche CRM et Adam prépare le rappel personnel. Vérifie puis valide séparément le lead et le rappel Calendar.`;
      }

      return `${agent.name} prend le relais CRM. J'ai prepare l'action ${actionLabels[0]} avec validation humaine avant ecriture dans le pipeline.`;
    }

    const crmQuestionResponse = buildCrmQuestionResponse(command, crmLeads);
    if (crmQuestionResponse) return crmQuestionResponse;

    if (
      actions.length === 0 &&
      (inferCrmStatus(command) ||
        isPitchGenerationIntent(normalize(command)) ||
        includesAny(normalize(command), [
          "brouillon",
          "draft",
          "follow up",
          "relance",
        ]))
    ) {
      return "Je n'ai pas trouvé avec certitude le lead visé. Ouvre sa fiche ou précise son entreprise ou son contact avant que je prépare une action.";
    }

    if (crmLeads.length === 0) {
      return `${agent.name} prend le relais CRM. Je n'ai pas encore de leads charges dans cette session, donc je peux preparer un brouillon ou ouvrir le pipeline.`;
    }

    return `${agent.name} prend le relais CRM. Je peux lire le pipeline, preparer un pitch, une proposition ou une action de changement d'etape a valider.`;
  }

  if (
    agentId === "proposals" &&
    actions.length === 0 &&
    isPitchGenerationIntent(normalize(command))
  ) {
    return "Je n'ai pas trouvé avec certitude le lead visé. Ouvre sa fiche ou précise son entreprise ou son contact avant que Maya prépare le pitch.";
  }

  if (agentId === "developer") {
    return `${agent.name} peut preparer la mission dev: spec, branche, criteres d'acceptation et revue humaine. NAIA ne modifie pas le code sans validation.`;
  }

  if (agentId === "proposals") {
    if (actions.some((action) => action.kind === "pitch.generateDraft")) {
      return `${agent.name} prend le relais Docs Generator. J'ai prepare la generation du pitch avec validation humaine avant de creer le draft PPTX dans le Drive prive Qarizmi.`;
    }

    return `${agent.name} prend le relais Docs Generator. Je peux generer un pitch pour un lead meeting booke; indique le client ou passe le lead en meeting booke dans le CRM.`;
  }

  if (agentId === "integrations") {
    if (actions.some((action) => action.kind === "google.gmail.listMessages")) {
      return `${agent.name} prend le relais integrations. J'ai prepare une lecture Gmail limitee et approuvee; NAIA resumera les messages autorises sans envoyer d'email automatiquement.`;
    }

    if (actions.some((action) => action.kind === "slack.prepareMessage")) {
      return `${agent.name} prend le relais Slack. J'ai prepare un brouillon de message; l'envoi reste bloque tant que le canal et la validation humaine ne sont pas confirmes.`;
    }

    return `${agent.name} prend le relais integrations: Google Workspace, Gmail, Calendar et Slack sont traites comme des connecteurs gardes avec validation humaine.`;
  }

  if (agentId === "meetings") {
    if (
      actions.some((action) => action.kind === "google.calendar.listEvents")
    ) {
      return `${agent.name} prend le relais agenda. J'ai prepare une lecture Google Calendar a valider: je n'affiche aucun evenement tant que tu n'as pas approuve cette action, ensuite je liste tes vrais creneaux et conflits.`;
    }

    return `${agent.name} prend le relais meetings. Ici je ne vois que les meetings issus du CRM; pour tes vrais evenements Google Calendar, demande-moi de lire ton agenda et valide l'action de lecture.`;
  }

  if (agentId === "leads") {
    return `${agent.name} prend le relais prospection: ICP, signaux publics, key people et chemins d'introduction a verifier.`;
  }

  if (agentId === "finance") {
    return `${agent.name} prend le relais finance: cash forecast, retards, priorites de relance et brouillons a valider.`;
  }

  if (agentId === "projects") {
    return `${agent.name} prend le relais delivery: portefeuille projets, Gantt, risques de retard et mois critiques.`;
  }

  if (agentId === "hr") {
    return `${agent.name} prend le relais RH: capacite, recrutements, annonces, tests et entretiens.`;
  }

  return `${agent.name} prend le relais. Je garde l'orchestration, les permissions et le fil vocal.`;
}

function buildCrmQuestionResponse(command: string, crmLeads: CrmLeadSummary[]) {
  const normalized = normalize(command);
  if (isCrmStatusDefinitionQuestion(normalized)) {
    const asksContactedVsMeeting =
      includesAny(normalized, ["contacte", "contacted"]) &&
      includesAny(normalized, ["meeting", "rdv", "rendez vous"]);

    if (asksContactedVsMeeting) {
      return [
        "Contacté: un échange réel a eu lieu avec le prospect, mais aucun rendez-vous n'est encore confirmé.",
        "Meeting fixé: une date et une heure de rendez-vous ont été convenues avec le prospect.",
        "Utilise Contacté après un appel, un email ou une discussion; passe en Meeting fixé seulement quand le créneau est confirmé.",
      ].join("\n");
    }

    return [
      "À contacter: prospect identifié, aucun échange encore réalisé.",
      "Contacté: premier échange réalisé, sans rendez-vous confirmé.",
      "À relancer: une réponse ou une prochaine action est attendue.",
      "Meeting fixé: rendez-vous confirmé avec une date et une heure.",
      "Propale envoyée: proposition transmise, décision attendue.",
      "Gagné: opportunité acceptée ou signée.",
      "Dead end: opportunité perdue, disqualifiée ou abandonnée.",
    ].join("\n");
  }

  if (!isCrmReadQuestion(normalized)) return null;

  const requestedStatus = inferCrmQuestionStatus(normalized);
  if (requestedStatus) {
    const matchingLeads = crmLeads.filter(
      (lead) => lead.status === requestedStatus,
    );
    const leadWord = matchingLeads.length > 1 ? "leads" : "lead";
    const statusLabel =
      requestedStatus === "lead-to-contact"
        ? "à contacter"
        : crmStatusLabels[requestedStatus].toLowerCase();
    const examples = matchingLeads.slice(0, 5).map(formatCrmLeadLabel);

    return [
      `${matchingLeads.length} ${leadWord} ${statusLabel} dans le CRM.`,
      examples.length > 0 ? `Exemples: ${examples.join("; ")}.` : undefined,
    ]
      .filter(Boolean)
      .join("\n");
  }

  const openLeadCount = crmLeads.filter(
    (lead) => lead.status !== "won" && lead.status !== "dead-end",
  ).length;
  const counts = crmLeadStatuses
    .map((status) => ({
      count: crmLeads.filter((lead) => lead.status === status).length,
      label: crmStatusLabels[status],
    }))
    .filter((item) => item.count > 0)
    .map((item) => `${item.label}: ${item.count}`);

  const leadLabel = crmLeads.length === 1 ? "lead" : "leads";
  const activeLabel = openLeadCount === 1 ? "actif" : "actifs";

  return [
    `Il y a ${crmLeads.length} ${leadLabel} dans le CRM, dont ${openLeadCount} ${activeLabel}.`,
    counts.length > 0 ? counts.join(" · ") : "Aucun lead chargé.",
  ].join("\n");
}

function isCrmStatusDefinitionQuestion(normalizedCommand: string) {
  const comparableCommand = normalizedCommand.replace(/-/g, " ");
  const mentionsStatus = includesAny(comparableCommand, [
    "statut",
    "status",
    "contacte",
    "contacted",
    "meeting booke",
    "meeting fixe",
  ]);
  const asksDefinition = includesAny(comparableCommand, [
    "explique",
    "difference entre",
    "quand utiliser",
    "que signifie",
    "c est quoi",
    "explain",
    "difference between",
    "when should",
    "what is",
    "what are",
    "compare",
  ]);

  return mentionsStatus && asksDefinition;
}

function isCrmReadQuestion(normalizedCommand: string) {
  if (
    includesAny(normalizedCommand, [
      "cette semaine",
      "cette quinzaine",
      "ce mois",
      "aujourd hui",
      "demain",
      "priorite",
      "priorites",
      "synthese",
      "recap",
      "resume",
      "analyse",
      "pourquoi",
      "comment",
    ])
  ) {
    return false;
  }

  const tokens = tokenSet(normalizedCommand);
  const asksForCountOrList =
    hasAnyToken(tokens, [
      "combien",
      "nombre",
      "total",
      "count",
      "liste",
      "list",
      "quels",
      "quelles",
    ]) || normalizedCommand.includes("on a combien");
  const mentionsPipeline = includesAny(normalizedCommand, [
    "crm",
    "lead",
    "leads",
    "pipeline",
    "pipe",
    "a contacter",
    "contactes",
    "meeting",
    "relancer",
  ]);

  return asksForCountOrList && mentionsPipeline;
}

function isCrmInformationQuestion(command: string, normalizedCommand: string) {
  const comparableCommand = normalizedCommand.replace(/-/g, " ");

  return (
    command.includes("?") ||
    includesAny(comparableCommand, [
      "explique",
      "difference entre",
      "quand utiliser",
      "que signifie",
      "quel statut",
      "quelle etape",
      "c est quoi",
      "qu est ce",
      "est ce que",
      "est il",
      "est elle",
      "pourquoi",
      "comment fonctionne",
      "explain",
      "difference between",
      "when should",
      "what is",
      "what are",
      "which status",
      "how does",
      "why",
      "compare",
    ])
  );
}

function isExplicitCrmWriteRequest(normalizedCommand: string) {
  const comparableCommand = normalizedCommand.replace(/-/g, " ");
  const startsWithWriteVerb = isExplicitLeadStatusUpdate(comparableCommand);

  return (
    startsWithWriteVerb ||
    includesAny(comparableCommand, [
      "cree un lead",
      "creer un lead",
      "cree le lead",
      "creer le lead",
      "ajoute un lead",
      "ajouter un lead",
      "create a lead",
      "add a lead",
      "passe le lead",
      "mets le lead",
      "met le lead",
      "change le statut",
      "modifie le statut",
      "deplace le lead",
      "update the lead",
      "move the lead",
      "set the lead",
      "planifie",
      "schedule a",
      "schedule the",
      "book a",
      "book the",
      "booke un",
      "booke le",
      "redige",
      "prepare le pitch",
      "genere le pitch",
      "il faut",
      "je veux que tu",
      "peux tu creer",
      "peux tu ajouter",
      "peux tu passer",
      "can you create",
      "can you add",
      "can you move",
      "please create",
      "please add",
      "rappelle moi",
      "me rappeler",
    ])
  );
}

function isExplicitLeadStatusUpdate(normalizedCommand: string) {
  const comparableCommand = normalizedCommand.replace(/-/g, " ");
  return /^(?:(?:naia|salma)\s+)?(?:passe|mets|met|change|modifie|deplace|update|move|set)\b/.test(
    comparableCommand,
  );
}

function inferCrmQuestionStatus(
  normalizedCommand: string,
): CrmLeadStatus | null {
  const tokens = tokenSet(normalizedCommand);

  if (
    normalizedCommand.includes("a contacter") ||
    normalizedCommand.includes("to contact") ||
    normalizedCommand.includes("lead to contact")
  ) {
    return "lead-to-contact";
  }

  if (hasAnyToken(tokens, ["relancer", "relance", "follow"])) {
    return "to-follow-up";
  }

  if (
    includesAny(normalizedCommand, [
      "meeting",
      "rdv",
      "rendez vous",
      "rendez-vous",
      "call",
      "demo",
      "visio",
    ])
  ) {
    return "meeting-booked";
  }

  if (hasAnyToken(tokens, ["contacte", "contactee", "contactes"])) {
    return "contacted";
  }

  if (hasAnyToken(tokens, ["propale", "proposition", "offre"])) {
    return "proposal-sent";
  }

  if (hasAnyToken(tokens, ["gagne", "gagnes", "won"])) {
    return "won";
  }

  if (hasAnyToken(tokens, ["perdu", "dead", "stop"])) {
    return "dead-end";
  }

  return null;
}

function formatCrmLeadLabel(lead: CrmLeadSummary) {
  return [lead.companyName, lead.contactName, lead.topic]
    .filter(Boolean)
    .slice(0, 2)
    .join(" - ");
}

function confidenceFor(agentId: NaiaAgentId, command: string) {
  if (agentId === "naia") return 0.62;
  return command.length > 24 ? 0.86 : 0.74;
}

function intentForAgent(
  agentId: NaiaAgentId,
): NaiaOrchestrationResult["intent"] {
  const intents: Record<NaiaAgentId, NaiaOrchestrationResult["intent"]> = {
    automations: "automations",
    crm: "crm",
    developer: "developer",
    finance: "finance",
    hr: "hr",
    integrations: "integrations",
    leads: "lead-research",
    meetings: "meetings",
    naia: "overview",
    projects: "projects",
    proposals: "proposals",
    settings: "settings",
  };

  return intents[agentId];
}

function extractLeadTopic(command: string) {
  const simpleIdentity = extractSimpleLeadIdentity(command);
  if (simpleIdentity.companyName) {
    return `${simpleIdentity.companyName} - nouveau lead`;
  }

  return command
    .replace(/^(naia[, ]*)?/i, "")
    .replace(
      /(cree|creer|ajoute|ajouter|nouveau|nouvelle)\s+(un\s+|une\s+)?lead\s*/i,
      "",
    )
    .trim()
    .slice(0, 160);
}

function extractSimpleLeadIdentity(command: string) {
  const sharedIdentity = extractLeadIdentity(command);
  if (sharedIdentity.companyName || sharedIdentity.contactName) {
    return sharedIdentity;
  }

  const withoutPrefix = command
    .replace(/^(naia[, ]*)?/i, "")
    .replace(/^(un\s+|une\s+)?(nouveau|nouvelle)\s+lead\s*[:,;-]?\s*/i, "")
    .trim()
    .replace(/[.!?]$/g, "");
  const contactEmail = extractEmail(command);
  const contactPhone = extractPhone(command);
  const businessCardMatch = withoutPrefix.match(
    /\b(?:lead|prospect)\s*:?\s*(.+?)\s+(?:directeur|directrice|ceo|cto|cfo|coo|dg|fondateur|fondatrice|founder|responsable|manager|head)\b.+?\s+(?:de|chez)\s+([^,.;\d-]+?)(?=\s+(?:\+?\d|0\d)|\s*[-,;.]|$)/i,
  );

  if (businessCardMatch) {
    return {
      companyName: businessCardMatch[2].trim().slice(0, 120),
      contactEmail,
      contactName: businessCardMatch[1].trim().slice(0, 120),
      contactPhone,
    };
  }

  const contextualMatch =
    withoutPrefix.match(
      /\b(?:parle|parlé|contacte|contacté|appele|appelé|echange|échangé|discute|discuté)\s+(?:(?:a|à|avec)\s+)?(.+?)\s+(?:de|chez)\s+([^,.;]+?)(?=\s+(?:et|qui|il|elle|pour|afin|and|with)\b|[,.;]|$)/i,
    ) ??
    withoutPrefix.match(
      /\b(?:talked|spoke|contacted|called|discussed|exchanged|met)\s+(?:to|with)?\s*(.+?)\s+(?:from|at|with)\s+([^,.;]+?)(?=\s+(?:and|who|they|he|she|to|for|with|would|will|have|has)\b|[,.;]|$)/i,
    ) ??
    withoutPrefix.match(/\b(.+?)\s+chez\s+([^,.;]+)\b/i) ??
    withoutPrefix.match(/\b(.+?)\s+(?:from|at)\s+([^,.;]+)\b/i);

  if (!contextualMatch) {
    return {};
  }

  return {
    companyName: contextualMatch[2].trim().slice(0, 120),
    contactEmail,
    contactName: contextualMatch[1].trim().slice(0, 120),
    contactPhone,
  };
}

function buildMeetingTitle(
  command: string,
  identity: { companyName?: string; contactName?: string },
) {
  if (identity.companyName && identity.contactName) {
    return `Meeting ${identity.companyName} - ${identity.contactName}`;
  }

  if (identity.companyName) {
    return `Meeting ${identity.companyName}`;
  }

  return extractLeadTopic(command) || "Meeting prospect";
}

function isPotentialClientMeeting(normalizedCommand: string) {
  if (isInternalReminderMeeting(normalizedCommand)) return false;
  if (isCalendarReadQuery(normalizedCommand)) return false;

  const hasMeetingIntent = includesAny(normalizedCommand, [
    "meeting",
    "rdv",
    "rendez vous",
    "rendez-vous",
    "reunion",
    "call",
    "demo",
    "visio",
  ]);
  const hasCommercialConversation = includesAny(normalizedCommand, [
    "j ai parle",
    "j ai contacte",
    "j ai discute",
    "j ai echange",
    "on a parle",
    "on a discute",
    "parle a",
    "parle avec",
    "contacte",
    "discute avec",
    "echange avec",
    "contact avec",
    "i talked to",
    "i spoke to",
    "talked to",
    "spoke to",
    "discussed with",
    "met with",
  ]);
  const hasPersonCompanyPattern =
    /\b(?:de|chez|from|at)\s+[\p{Letter}\p{Number}\s&'-]{2,}/u.test(
      normalizedCommand,
    );
  const isExplicitInternalMeeting = includesAny(normalizedCommand, [
    "interne",
    "daily",
    "standup",
    "equipe",
    "team meeting",
  ]);

  return (
    hasMeetingIntent &&
    !isExplicitInternalMeeting &&
    (hasCommercialConversation || hasPersonCompanyPattern)
  );
}

function isPotentialClientOpportunity(normalizedCommand: string) {
  const hasCommercialConversation = includesAny(normalizedCommand, [
    "j ai parle",
    "j ai contacte",
    "j ai discute",
    "j ai echange",
    "on a parle",
    "on a discute",
    "parle a",
    "parle avec",
    "contacte",
    "discute avec",
    "echange avec",
    "contact avec",
    "i talked to",
    "i spoke to",
    "talked to",
    "spoke to",
    "discussed with",
    "met with",
  ]);
  const hasCompanyPattern =
    /\b(?:de|chez|from|at)\s+[\p{Letter}\p{Number}\s&'-]{2,}/u.test(
      normalizedCommand,
    );
  const hasBusinessSignal = includesAny(normalizedCommand, [
    "collabor",
    "use case",
    "use cases",
    "cas d usage",
    "cas d utilisation",
    "cas d'utilisation",
    "solution",
    "solutions",
    "developper",
    "develop",
    "projet",
    "besoin",
    "partenariat",
    "partnered",
    "pipeline",
    "opportunite",
    "opportunity",
    "llm",
    "crm",
    "ia",
    "ai",
  ]);

  return hasCommercialConversation && hasCompanyPattern && hasBusinessSignal;
}

function isLeadCaptureIntent(normalizedCommand: string) {
  return (
    includesAny(normalizedCommand, [
      "cree un lead",
      "creer un lead",
      "cree le lead",
      "creer le lead",
      "ajoute un lead",
      "nouveau lead",
      "nouveau prospect",
      "nouvelle opportunite",
      "contact d un nouveau lead",
      "contact d un prospect",
      "je viens d avoir le contact",
      "j ai eu le contact",
    ]) ||
    (includesAny(normalizedCommand, ["lead", "prospect", "contact"]) &&
      includesAny(normalizedCommand, ["email", "telephone", "tel"]) &&
      /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/.test(normalizedCommand))
  );
}

function isInternalReminderMeeting(normalizedCommand: string) {
  return (
    includesAny(normalizedCommand, [
      "pour me rappeler",
      "pour me souvenir",
      "rappel de",
      "reminder",
      "me rappeler de",
      "me rappeler d",
    ]) &&
    includesAny(normalizedCommand, ["meeting", "rdv", "rendez vous", "agenda"])
  );
}

function inferLeadNextAction(normalizedCommand: string, status: CrmLeadStatus) {
  if (
    includesAny(normalizedCommand, [
      "envoyer une presentation",
      "envoyer la presentation",
      "lui envoyer une presentation",
      "lui envoyer la presentation",
      "send a presentation",
      "send the presentation",
    ])
  ) {
    return "Envoyer la présentation avant le rendez-vous";
  }

  if (status === "to-follow-up") {
    return "Préparer une relance commerciale personnalisée";
  }

  return undefined;
}

function inferReminderTitle(normalizedCommand: string) {
  if (
    includesAny(normalizedCommand, [
      "envoyer une presentation",
      "envoyer la presentation",
      "send a presentation",
      "send the presentation",
    ])
  ) {
    return "Envoyer la présentation";
  }

  return "Rappel NAIA";
}

function isCashFlowIntent(normalizedCommand: string) {
  const tokens = tokenSet(normalizedCommand);

  return (
    tokens.has("cf") ||
    tokens.has("cfs") ||
    includesAny(normalizedCommand, [
      "cash",
      "cash flow",
      "cashflow",
      "finance",
      "tresorerie",
      "encaissement",
      "decaissement",
      "relance cash",
      "relances cash",
    ])
  );
}

function wantsGmailRead(normalizedCommand: string) {
  return isGmailReadQuery(normalizedCommand);
}

function wantsCalendarRead(normalizedCommand: string) {
  return isCalendarReadQuery(normalizedCommand);
}

function wantsSlackMessage(normalizedCommand: string) {
  return (
    normalizedCommand.includes("slack") &&
    includesAny(normalizedCommand, [
      "message",
      "prepare",
      "preparer",
      "ecris",
      "redige",
      "envoie",
      "envoyer",
      "notifie",
      "notification",
    ])
  );
}

function isPitchGenerationIntent(normalizedCommand: string) {
  const mentionsPitch = includesAny(normalizedCommand, [
    "pitch",
    "deck",
    "ppt",
    "pptx",
    "presentation",
    "présentation",
  ]);
  const asksGenerate = includesAny(normalizedCommand, [
    "maya",
    "prepare",
    "preparer",
    "genere",
    "generer",
    "cree",
    "creer",
    "construis",
    "faire",
    "draft",
    "brouillon",
  ]);

  return mentionsPitch && asksGenerate;
}

function extractSlackMessageDraft(command: string) {
  const targetMatch = command.match(
    /\b(?:pour|a|à|dans|sur)\s+([^:]+?)\s*:\s*(.+)$/i,
  );

  if (targetMatch) {
    return {
      targetLabel: targetMatch[1].trim().slice(0, 120),
      text: targetMatch[2].trim().slice(0, 1200),
    };
  }

  const text = command
    .replace(/^(naia[, ]*)?/i, "")
    .replace(
      /\b(slack|message|prepare|preparer|ecris|redige|envoie|envoyer)\b/gi,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();

  return {
    text: text.slice(0, 1200) || command.trim().slice(0, 1200),
  };
}

function includesAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle));
}

function hasAnyToken(tokens: Set<string>, needles: string[]) {
  return needles.some((needle) => tokens.has(needle));
}

function extractEmail(value: string) {
  return value.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0];
}

function extractPhone(value: string) {
  return value
    .match(/(?:\+\d{1,3}[\s.-]?)?(?:0\d|\d)[\d\s.-]{7,}\d/)?.[0]
    ?.replace(/\s+/g, "")
    .trim();
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stableActionSuffix(value: string) {
  const normalized = normalize(value);
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function tokenSet(value: string) {
  return new Set(value.split(/\s+/).filter((token) => token.length > 2));
}
