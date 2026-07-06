import type {
  CrmLeadDraft,
  CrmLeadStatus,
  CrmLeadSummary,
} from "@/features/crm/contracts";

import { getNaiaAgent, type NaiaAgentId } from "./agents";

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
  crmLeads = [],
  responseOverride,
}: {
  agentIdOverride?: NaiaAgentId;
  command: string;
  confidenceOverride?: number;
  crmLeads?: CrmLeadSummary[];
  responseOverride?: string;
}): NaiaOrchestrationResult {
  const cleanCommand = command.trim();
  const localAgentId = classifyNaiaAgent(cleanCommand);
  const normalized = normalize(cleanCommand);
  const forceCrmForProspectMeeting =
    localAgentId === "crm" && isPotentialClientMeeting(normalized);
  const agentId = forceCrmForProspectMeeting
    ? "crm"
    : (agentIdOverride ?? localAgentId);
  const agent = getNaiaAgent(agentId);
  const actions =
    agentId === "crm" || localAgentId === "crm"
      ? buildCrmActions(cleanCommand, crmLeads)
      : agentId === "developer" || localAgentId === "developer"
        ? [buildDeveloperAction(cleanCommand)]
        : [];

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
      buildResponse(agentId, cleanCommand, actions, crmLeads),
  };
}

export function classifyNaiaAgent(command: string): NaiaAgentId {
  const normalized = normalize(command);

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

  if (
    includesAny(normalized, [
      "crm",
      "lead",
      "pipeline",
      "meeting booked",
      "meeting fixe",
      "propale",
      "proposition",
      "pitch",
      "contacte",
      "relance",
      "gagne",
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
    includesAny(normalized, [
      "cash",
      "finance",
      "tresorerie",
      "paiement",
      "cout",
      "relance client",
      "facture",
    ])
  ) {
    return "finance";
  }

  if (
    includesAny(normalized, [
      "projet",
      "delivery",
      "retard",
      "gantt",
      "use case",
      "jalon",
    ])
  ) {
    return "projects";
  }

  if (includesAny(normalized, ["rh", "recrut", "candidat", "entretien"])) {
    return "hr";
  }

  if (includesAny(normalized, ["meeting", "reunion", "rdv", "compte rendu"])) {
    return "meetings";
  }

  if (
    includesAny(normalized, ["proposal", "proposition", "propale", "offre"])
  ) {
    return "proposals";
  }

  if (includesAny(normalized, ["automation", "workflow", "agent ops"])) {
    return "automations";
  }

  if (includesAny(normalized, ["integration", "connecteur", "token", "api"])) {
    return "integrations";
  }

  if (includesAny(normalized, ["setting", "permission", "role", "audit"])) {
    return "settings";
  }

  return "naia";
}

export function inferCrmStatus(command: string): CrmLeadStatus | null {
  const normalized = normalize(command);

  if (
    includesAny(normalized, [
      "meeting booked",
      "meeting fixe",
      "rdv fixe",
      "rendez vous fixe",
      "call confirme",
      "meeting",
    ])
  ) {
    return "meeting-booked";
  }

  if (includesAny(normalized, ["propale", "proposition", "offre"])) {
    return "proposal-sent";
  }

  if (includesAny(normalized, ["relance", "relancer", "follow up"])) {
    return "to-follow-up";
  }

  if (
    includesAny(normalized, [
      "contacte",
      "appele",
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
      "met with",
    ])
  ) {
    return "contacted";
  }

  if (includesAny(normalized, ["gagne", "signe", "won"])) {
    return "won";
  }

  if (includesAny(normalized, ["dead", "perdu", "stop"])) {
    return "dead-end";
  }

  return null;
}

function buildCrmActions(command: string, crmLeads: CrmLeadSummary[]) {
  const status = inferCrmStatus(command);
  const matchedLead = findBestLeadMatch(command, crmLeads);
  const normalized = normalize(command);
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
  const wantsProspectMeeting = isPotentialClientMeeting(normalized);
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
          effectiveStatus === "meeting-booked"
            ? "Preparer le meeting et confirmer le contexte avec le contact"
            : "Qualifier le besoin et confirmer le prochain rendez-vous",
        notes: command,
        source: "NAIA",
        status: effectiveStatus,
        topic: extractLeadTopic(command),
        ...identity,
      },
      risk: "medium",
    } satisfies NaiaActionDraft;
    const actions: NaiaActionDraft[] = [createLeadAction];

    if (effectiveStatus === "meeting-booked") {
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

  if (status && matchedLead) {
    const nextAction =
      status === "meeting-booked"
        ? "Preparer le pitch decideur avec contexte CRM"
        : status === "proposal-sent"
          ? "Preparer la proposition, le scope et le plan de paiement"
          : status === "to-follow-up"
            ? "Preparer une relance commerciale personnalisee"
            : undefined;

    return [
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

function findBestLeadMatch(command: string, crmLeads: CrmLeadSummary[]) {
  const normalizedCommand = normalize(command);
  const commandTokens = tokenSet(normalizedCommand);

  let bestLead: CrmLeadSummary | null = null;
  let bestScore = 0;

  for (const lead of crmLeads) {
    const haystack = normalize(
      [lead.topic, lead.source, lead.notes, lead.nextAction]
        .filter(Boolean)
        .join(" "),
    );
    const leadTokens = tokenSet(haystack);
    let score = 0;

    for (const token of leadTokens) {
      if (commandTokens.has(token)) {
        score += token.length > 4 ? 2 : 1;
      }
    }

    if (haystack && normalizedCommand.includes(haystack.slice(0, 18))) {
      score += 3;
    }

    if (score > bestScore) {
      bestScore = score;
      bestLead = lead;
    }
  }

  return bestScore >= 2 ? bestLead : null;
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

  if (agentId === "crm") {
    if (actions.length > 0) {
      const actionLabels = actions.map((action) => `"${action.label}"`);
      if (
        actions.some((action) => action.kind === "crm.createLead") &&
        actions.some((action) => action.kind === "calendar.scheduleMeeting")
      ) {
        return `${agent.name} prend le relais CRM avec Adam en support calendrier. J'ai prepare ${actionLabels.join(" et ")}: le lead sera cree en meeting booked, puis Google Calendar sera verifie avant creation de l'evenement.`;
      }

      return `${agent.name} prend le relais CRM. J'ai prepare l'action ${actionLabels[0]} avec validation humaine avant ecriture dans le pipeline.`;
    }

    if (crmLeads.length === 0) {
      return `${agent.name} prend le relais CRM. Je n'ai pas encore de leads charges dans cette session, donc je peux preparer un brouillon ou ouvrir le pipeline.`;
    }

    return `${agent.name} prend le relais CRM. Je peux lire le pipeline, preparer un pitch, une proposition ou une action de changement d'etape a valider.`;
  }

  if (agentId === "developer") {
    return `${agent.name} peut preparer la mission dev: spec, branche, criteres d'acceptation et revue humaine. NAIA ne modifie pas le code sans validation.`;
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
  const withoutPrefix = command
    .replace(/^(naia[, ]*)?/i, "")
    .replace(/^(un\s+|une\s+)?(nouveau|nouvelle)\s+lead\s*[:,;-]?\s*/i, "")
    .trim()
    .replace(/[.!?]$/g, "");
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
    contactName: contextualMatch[1].trim().slice(0, 120),
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

function includesAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle));
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
