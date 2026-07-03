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
  contacted: "Contacte",
  "dead-end": "Dead end",
  "lead-to-contact": "A contacter",
  "meeting-booked": "Meeting fixe",
  "proposal-sent": "Proposition envoyee",
  "to-follow-up": "A relancer",
  won: "Gagne",
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
  const agentId = agentIdOverride ?? localAgentId;
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
      responseOverride?.trim().slice(0, 1200) ||
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
      "developpe",
      "developper",
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

  if (includesAny(normalized, ["contacte", "appele", "joint"])) {
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

  if (
    includesAny(normalize(command), [
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
    ])
  ) {
    return [
      {
        agentId: "crm",
        approvalRequired: true,
        description:
          "Salma creera un lead avec le texte de la commande comme contexte initial.",
        id: `crm-create-${stableActionSuffix(command)}`,
        kind: "crm.createLead",
        label: "Creer le lead CRM",
        payload: {
          nextAction:
            "Qualifier le besoin et confirmer le prochain rendez-vous",
          notes: command,
          source: "NAIA",
          status: status ?? "lead-to-contact",
          topic: extractLeadTopic(command),
          ...extractSimpleLeadIdentity(command),
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
      const action = actions[0];
      return `${agent.name} prend le relais CRM. J'ai prepare l'action "${action.label}" avec validation humaine avant ecriture dans le pipeline.`;
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
      /\b(?:parle|parlé|echange|échangé|discute|discuté)\s+(?:a|à|avec)\s+(.+?)\s+(?:de|chez)\s+([^,.;]+)\b/i,
    ) ?? withoutPrefix.match(/\b(.+?)\s+chez\s+([^,.;]+)\b/i);

  if (!contextualMatch) {
    return {};
  }

  return {
    companyName: contextualMatch[2].trim().slice(0, 120),
    contactName: contextualMatch[1].trim().slice(0, 120),
  };
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
