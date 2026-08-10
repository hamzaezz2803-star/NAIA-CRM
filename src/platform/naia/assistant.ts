import "server-only";

import { z } from "zod";
import type { CrmLeadSummary } from "@/features/crm/contracts";
import {
  getNaiaAgent,
  naiaAgents,
  type NaiaAgentId,
} from "@/features/naia/agents";
import { buildNaiaOperatingContext } from "@/features/naia/operational-context";
import type { NaiaPageContext } from "@/features/naia/page-context";
import {
  isNaiaOverviewQuestion,
  orchestrateNaiaCommand,
  type NaiaOrchestrationResult,
} from "@/features/naia/orchestrator";
import {
  inferPersonalCalendarDays,
  isAssistantIdentityQuery,
  isCalendarReadQuery,
  isCrmMeetingReadQuery,
  isGmailReadQuery,
  isGoogleAccessQuery,
  isIdentityQuery,
  isPersonalCalendarQuery,
  isPersonalGmailQuery,
  isUrgentGmailQuery,
  normalizePersonalQuery,
  wantsCalendarOutsideCrm,
} from "@/features/naia/personal-query-intents";
import {
  inspectGoogleWorkspaceCapabilities,
  listGmailMessages,
  listGoogleCalendarEvents,
  type GmailMessageSummary,
  type GoogleCalendarEventSummary,
  type GoogleWorkspaceContext,
} from "@/platform/integrations/google-workspace";
import { completeGroqJson, getGroqApiKey } from "@/platform/ai/groq";
import {
  loadNaiaPrivateKnowledge,
  type NaiaPrivateKnowledgeContext,
} from "@/platform/naia/private-knowledge";

export type NaiaAssistantMode = "groq-orchestrated" | "local-orchestrated";
export type NaiaConversationMessage = {
  content: string;
  role: "assistant" | "user";
};
export type NaiaActorContext = {
  email: string;
  name: string;
  organizationName?: string;
  role: "owner" | "admin" | "member" | "viewer";
};

const naiaDecisionSchema = z.object({
  agentId: z.custom<NaiaAgentId>((value) => parseAgentId(value) !== null),
  confidence: z.number().min(0).max(1),
  response: z.string().trim().min(1).max(1600),
});

const naiaDecisionJsonSchema = {
  additionalProperties: false,
  properties: {
    agentId: {
      enum: naiaAgents.map((agent) => agent.id),
      type: "string",
    },
    confidence: { maximum: 1, minimum: 0, type: "number" },
    response: { maxLength: 1600, minLength: 1, type: "string" },
  },
  required: ["agentId", "confidence", "response"],
  type: "object",
};

export async function planNaiaAssistant({
  actor,
  allowPersonalData = true,
  command,
  crmLeads,
  googleContext,
  history = [],
  pageContext,
  privateKnowledge,
}: {
  actor?: NaiaActorContext;
  allowPersonalData?: boolean;
  command: string;
  crmLeads: CrmLeadSummary[];
  googleContext?: GoogleWorkspaceContext;
  history?: NaiaConversationMessage[];
  pageContext?: NaiaPageContext;
  privateKnowledge?: NaiaPrivateKnowledgeContext | null;
}): Promise<{ mode: NaiaAssistantMode; result: NaiaOrchestrationResult }> {
  const selectedLead = resolveSelectedLead(pageContext, crmLeads);
  const crmReadLeads = filterCrmLeadsForPageContext(
    command,
    pageContext,
    crmLeads,
  );
  const localResult = orchestrateNaiaCommand({
    command,
    contextAgentId: getContextAgentId(pageContext),
    crmLeads,
    crmReadLeads,
    selectedLeadId: selectedLead?.id,
  });
  if (!allowPersonalData && localResult.agent.id === "crm") {
    return {
      mode: "local-orchestrated",
      result: createDirectAnswer({
        agentId: "naia",
        command,
        crmLeads,
        response:
          "Pour protéger les données CRM de Qarizmi, pose cette question en message privé à NAIA.",
      }),
    };
  }
  const personalCommand = resolvePersonalFollowUp(command, history);
  const apiKey = getGroqApiKey();
  const resolvedPrivateKnowledge = !allowPersonalData
    ? undefined
    : privateKnowledge === undefined &&
        (Boolean(apiKey) || isIdentityQuery(personalCommand)) &&
        shouldLoadPrivateKnowledge(personalCommand, localResult)
      ? await loadNaiaPrivateKnowledge({
          actor,
          allowPersonalData,
          command: personalCommand,
        })
      : (privateKnowledge ?? undefined);
  const personalAnswer = await answerPersonalQuery({
    actor,
    allowPersonalData,
    command: personalCommand,
    crmLeads: crmReadLeads,
    googleContext,
    meetingPagePeriod: getContextualMeetingPeriod(command, pageContext),
    privateKnowledge: resolvedPrivateKnowledge,
    resultCommand: command,
  });
  if (personalAnswer) {
    return { mode: "local-orchestrated", result: personalAnswer };
  }

  // Deterministic answers and every write plan stay authoritative. The LLM is
  // used for open questions, never to invent or mutate an action payload.
  if (
    !apiKey ||
    !command ||
    isNaiaOverviewQuestion(command) ||
    localResult.responseType !== "handoff"
  ) {
    return { mode: "local-orchestrated", result: localResult };
  }

  const realGoogleCalendar =
    allowPersonalData && shouldReadCalendar(command)
      ? await buildRealGoogleCalendarContext(googleContext)
      : null;

  const completion = await completeGroqJson({
    jsonSchema: naiaDecisionJsonSchema,
    maxTokens: 800,
    messages: [
      {
        content: buildSystemPrompt(),
        role: "system",
      },
      {
        content: JSON.stringify({
          agents: naiaAgents.map((agent) => ({
            id: agent.id,
            label: agent.label,
            mission: agent.mission,
            name: agent.name,
            role: agent.role,
            status: agent.status,
          })),
          command,
          conversationHistory: allowPersonalData ? history.slice(-8) : [],
          currentPage:
            allowPersonalData && pageContext
              ? {
                  dataMode: pageContext.dataMode,
                  filters: pageContext.filters,
                  moduleId: pageContext.moduleId,
                  pathname: pageContext.pathname,
                  selectedEntity: selectedLead
                    ? {
                        companyName: selectedLead.companyName,
                        contactName: selectedLead.contactName,
                        id: selectedLead.id,
                        status: selectedLead.status,
                        topic: selectedLead.topic,
                      }
                    : pageContext.entity
                      ? {
                          id: pageContext.entity.id,
                          kind: pageContext.entity.kind,
                        }
                      : undefined,
                  view: pageContext.view,
                }
              : undefined,
          contextSources: {
            crm: allowPersonalData
              ? "live organization data"
              : "not loaded on shared surfaces",
            googleCalendar: realGoogleCalendar
              ? "live connected user data"
              : "not loaded",
            qarizmiKnowledge: resolvedPrivateKnowledge
              ? `private internal deck: ${resolvedPrivateKnowledge.sourceFileName}`
              : "not loaded",
            operations:
              "simulated working data; always disclose this when used",
          },
          crmSnapshot: (allowPersonalData ? crmReadLeads : [])
            .slice(0, 30)
            .map((lead) => ({
              companyName: lead.companyName,
              contactName: lead.contactName,
              id: lead.id,
              leadDate: lead.leadDate,
              nextAction: lead.nextAction,
              notes: lead.notes,
              status: lead.status,
              topic: lead.topic,
            })),
          suggestedAgentId: localResult.agent.id,
          operatingContext: buildNaiaOperatingContext(),
          privateKnowledge: resolvedPrivateKnowledge,
          realGoogleCalendar: realGoogleCalendar ?? undefined,
        }),
        role: "user",
      },
    ],
    schema: naiaDecisionSchema,
    schemaName: "naia_orchestration_decision",
    temperature: 0.15,
  });
  if (!completion) {
    return { mode: "local-orchestrated", result: localResult };
  }

  const result = orchestrateNaiaCommand({
    agentIdOverride: completion.data.agentId,
    command,
    confidenceOverride: completion.data.confidence,
    contextAgentId: getContextAgentId(pageContext),
    crmLeads,
    crmReadLeads,
    responseOverride: completion.data.response,
    selectedLeadId: selectedLead?.id,
  });

  return {
    mode: "groq-orchestrated",
    result: { ...result, responseType: "answer" },
  };
}

function resolveSelectedLead(
  pageContext: NaiaPageContext | undefined,
  crmLeads: CrmLeadSummary[],
) {
  if (pageContext?.entity?.kind !== "lead") return undefined;
  return crmLeads.find((lead) => lead.id === pageContext.entity?.id);
}

function filterCrmLeadsForPageContext(
  command: string,
  pageContext: NaiaPageContext | undefined,
  crmLeads: CrmLeadSummary[],
) {
  if (!pageContext?.filters || wantsGlobalCrmScope(command)) {
    return crmLeads;
  }

  if (pageContext.moduleId === "meetings") {
    const now = Date.now();
    const period = getContextualMeetingPeriod(command, pageContext);
    const status = pageContext.filters.status;

    return crmLeads.filter((lead) => {
      if (status && lead.status !== status) return false;
      if (
        !status &&
        period === "past" &&
        !["meeting-booked", "proposal-sent", "won", "dead-end"].includes(
          lead.status,
        )
      ) {
        return false;
      }
      if (!status && period !== "past" && lead.status !== "meeting-booked") {
        return false;
      }

      const meetingTime = lead.leadDate
        ? new Date(lead.leadDate).getTime()
        : null;
      if (period === "past") {
        if (lead.status !== "meeting-booked") {
          return meetingTime !== null && Number.isFinite(meetingTime);
        }
        return (
          meetingTime !== null &&
          Number.isFinite(meetingTime) &&
          meetingTime < now
        );
      }
      if (period === "upcoming") {
        return (
          meetingTime === null ||
          !Number.isFinite(meetingTime) ||
          meetingTime >= now
        );
      }
      return true;
    });
  }

  if (pageContext.moduleId !== "crm") {
    return crmLeads;
  }

  const status = pageContext.filters.status?.trim();
  const company = pageContext.filters.company?.trim().toLocaleLowerCase("fr");

  return crmLeads.filter((lead) => {
    if (status && lead.status !== status) return false;
    if (
      company &&
      lead.companyName?.trim().toLocaleLowerCase("fr") !== company
    ) {
      return false;
    }
    return true;
  });
}

function getContextualMeetingPeriod(
  command: string,
  pageContext: NaiaPageContext | undefined,
): "past" | "upcoming" | undefined {
  if (pageContext?.moduleId !== "meetings" || wantsGlobalCrmScope(command)) {
    return undefined;
  }

  const period = pageContext.filters?.period;
  return period === "past" || period === "upcoming" ? period : undefined;
}

function wantsGlobalCrmScope(command: string) {
  const normalized = normalizePersonalQuery(command);
  return [
    "all leads",
    "au total",
    "dans le crm",
    "dans tout le crm",
    "entire crm",
    "globalement",
    "pipeline complet",
    "tous les leads",
    "toutes les opportunites",
    "tout le pipeline",
    "whole pipeline",
  ].some((phrase) => normalized.includes(phrase));
}

function getContextAgentId(
  pageContext: NaiaPageContext | undefined,
): NaiaAgentId | undefined {
  if (!pageContext) return undefined;

  const agentsByModule: Partial<
    Record<NaiaPageContext["moduleId"], NaiaAgentId>
  > = {
    automations: "automations",
    crm: "crm",
    finance: "finance",
    hr: "hr",
    integrations: "integrations",
    leads: "leads",
    meetings: "meetings",
    projects: "projects",
    proposals: "proposals",
    settings: "settings",
  };

  return agentsByModule[pageContext.moduleId];
}

async function answerPersonalQuery({
  actor,
  allowPersonalData,
  command,
  crmLeads,
  googleContext,
  meetingPagePeriod,
  privateKnowledge,
  resultCommand,
}: {
  actor?: NaiaActorContext;
  allowPersonalData: boolean;
  command: string;
  crmLeads: CrmLeadSummary[];
  googleContext?: GoogleWorkspaceContext;
  meetingPagePeriod?: "past" | "upcoming";
  privateKnowledge?: NaiaPrivateKnowledgeContext;
  resultCommand: string;
}): Promise<NaiaOrchestrationResult | null> {
  const readsMeetingsFromCurrentPage =
    Boolean(meetingPagePeriod) && isContextualMeetingReadQuery(command);
  const personalQuery =
    isIdentityQuery(command) ||
    isGoogleAccessQuery(command) ||
    isGmailReadQuery(command) ||
    isCalendarReadQuery(command) ||
    isCrmMeetingReadQuery(command) ||
    readsMeetingsFromCurrentPage;

  if (!allowPersonalData && personalQuery) {
    return createDirectAnswer({
      agentId: "naia",
      command: resultCommand,
      crmLeads,
      response:
        "Pour protéger tes données personnelles et celles de Qarizmi, pose cette question en message privé à NAIA.",
    });
  }

  if (isIdentityQuery(command)) {
    const response = actor
      ? formatIdentityAnswer(actor, privateKnowledge)
      : "Je ne peux pas identifier ton profil dans cette session. Reconnecte-toi à Qarizmi OS avec ton compte professionnel.";
    return createDirectAnswer({
      agentId: "naia",
      command: resultCommand,
      crmLeads,
      response,
    });
  }

  if (isAssistantIdentityQuery(command)) {
    return createDirectAnswer({
      agentId: "naia",
      command: resultCommand,
      crmLeads,
      response:
        "Je suis NAIA, l'assistante opérationnelle de Qarizmi. Je comprends ta demande, consulte les sources autorisées et coordonne les agents spécialisés; toute écriture ou action externe reste soumise à ta validation.",
    });
  }

  if (isCrmMeetingReadQuery(command) || readsMeetingsFromCurrentPage) {
    return createDirectAnswer({
      agentId: "crm",
      command: resultCommand,
      crmLeads,
      response: formatCrmMeetingsAnswer(crmLeads, meetingPagePeriod),
    });
  }

  if (isGoogleAccessQuery(command)) {
    const capabilities =
      await inspectGoogleWorkspaceCapabilities(googleContext);
    return createDirectAnswer({
      agentId: "integrations",
      command: resultCommand,
      crmLeads,
      response: formatGoogleAccessAnswer(command, capabilities),
    });
  }

  if (isGmailReadQuery(command)) {
    try {
      const urgent = isUrgentGmailQuery(command);
      const normalized = normalizePersonalQuery(command);
      const messages = await listGmailMessages(
        {
          maxResults: urgent ? 10 : 8,
          query: urgent
            ? "is:unread newer_than:14d {label:important subject:urgent subject:important}"
            : undefined,
          unreadOnly:
            urgent ||
            normalized.includes("non lu") ||
            normalized.includes("unread"),
        },
        googleContext,
      );
      return createDirectAnswer({
        agentId: "integrations",
        command: resultCommand,
        crmLeads,
        response: formatGmailAnswer(messages, urgent),
      });
    } catch (error) {
      return createDirectAnswer({
        agentId: "integrations",
        command: resultCommand,
        crmLeads,
        response: formatGoogleReadError("Gmail", error),
      });
    }
  }

  if (isCalendarReadQuery(command)) {
    try {
      const calendarWindow = resolvePersonalCalendarWindow(command);
      const outsideCrm = wantsCalendarOutsideCrm(command);
      const events = await listGoogleCalendarEvents(
        {
          daysAhead: calendarWindow.daysAhead,
          maxResults: 20,
          ...(calendarWindow.timeMax
            ? { timeMax: calendarWindow.timeMax }
            : {}),
          ...(calendarWindow.timeMin
            ? { timeMin: calendarWindow.timeMin }
            : {}),
        },
        googleContext,
      );
      const visibleEvents = outsideCrm
        ? filterCalendarEventsOutsideCrm(events, crmLeads)
        : events;
      return createDirectAnswer({
        agentId: "meetings",
        command: resultCommand,
        crmLeads,
        response: formatCalendarAnswer(
          visibleEvents,
          calendarWindow.label,
          outsideCrm,
        ),
      });
    } catch (error) {
      return createDirectAnswer({
        agentId: "meetings",
        command: resultCommand,
        crmLeads,
        response: formatGoogleReadError("Google Calendar", error),
      });
    }
  }

  return null;
}

function isContextualMeetingReadQuery(command: string) {
  const normalized = normalizePersonalQuery(command);
  const asksForMeetings = [
    "meeting",
    "meetings",
    "rdv",
    "rendez vous",
    "reunion",
    "reunions",
  ].some((phrase) => normalized.includes(phrase));
  const asksToRead = [
    "combien",
    "quels",
    "quelles",
    "liste",
    "montre",
    "affiche",
    "visible",
    "which",
    "list",
    "show",
  ].some((phrase) => normalized.includes(phrase));

  return asksForMeetings && asksToRead;
}

function resolvePersonalFollowUp(
  command: string,
  history: NaiaConversationMessage[],
) {
  const alreadyExplicit =
    isIdentityQuery(command) ||
    isAssistantIdentityQuery(command) ||
    isPersonalGmailQuery(command) ||
    isPersonalCalendarQuery(command) ||
    isCrmMeetingReadQuery(command);
  if (alreadyExplicit) return command;

  const normalized = normalizePersonalQuery(command);
  const looksLikeFollowUp =
    /^(et|and)\b/.test(normalized) ||
    /\b(ceux|celles|lesquels|lesquelles|them|those)\b/.test(normalized);
  if (!looksLikeFollowUp) return command;

  const previousUserCommand = [...history]
    .reverse()
    .find(
      (message) =>
        message.role === "user" &&
        (isPersonalGmailQuery(message.content) ||
          isPersonalCalendarQuery(message.content) ||
          isCrmMeetingReadQuery(message.content)),
    )?.content;

  if (!previousUserCommand) return command;

  // Keep the previous provider explicit so "hors CRM" is interpreted as a
  // Calendar exclusion, not as a request to switch to CRM meetings.
  const source = wantsCalendarOutsideCrm(command)
    ? "Google Calendar"
    : isPersonalCalendarQuery(previousUserCommand)
      ? "Google Calendar"
      : isPersonalGmailQuery(previousUserCommand)
        ? "Gmail"
        : "CRM";
  return `${previousUserCommand} Source: ${source}. ${command}`;
}

function createDirectAnswer({
  agentId,
  command,
  crmLeads,
  response,
}: {
  agentId: "crm" | "integrations" | "meetings" | "naia";
  command: string;
  crmLeads: CrmLeadSummary[];
  response: string;
}): NaiaOrchestrationResult {
  const base = orchestrateNaiaCommand({ command, crmLeads });
  const agent = getNaiaAgent(agentId);

  return {
    ...base,
    actions: [],
    agent: {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      route: agent.route,
    },
    confidence: 1,
    intent:
      agentId === "crm"
        ? "crm"
        : agentId === "meetings"
          ? "meetings"
          : agentId === "integrations"
            ? "integrations"
            : "overview",
    response,
    responseType: "answer",
  };
}

function formatIdentityAnswer(
  actor: NaiaActorContext,
  privateKnowledge?: NaiaPrivateKnowledgeContext,
) {
  const roleLabels: Record<NaiaActorContext["role"], string> = {
    admin: "administrateur",
    member: "membre",
    owner: "propriétaire",
    viewer: "lecteur",
  };
  const organization = actor.organizationName
    ? ` de l'organisation ${actor.organizationName}`
    : " de Qarizmi OS";

  const identity = `Tu es ${actor.name} (${actor.email}), ${roleLabels[actor.role]}${organization}.`;
  if (!privateKnowledge?.actorProfile) return identity;

  return [
    identity,
    `Le dernier deck générique Qarizmi précise ce contexte professionnel: ${privateKnowledge.actorProfile}`,
  ].join("\n\n");
}

function formatGoogleAccessAnswer(
  command: string,
  status: Awaited<ReturnType<typeof inspectGoogleWorkspaceCapabilities>>,
) {
  if (!status.connected) {
    return "Non, ta connexion Google Workspace n'est pas utilisable actuellement. Reconnecte ton compte depuis https://os.qarizmi.com/integrations.";
  }

  const asksGmail = isPersonalGmailQuery(command);
  const asksCalendar = isPersonalCalendarQuery(command);
  const requestedCapabilities = [
    asksGmail
      ? status.gmail
        ? "Gmail en lecture"
        : "Gmail: scope manquant"
      : null,
    asksCalendar
      ? status.calendar
        ? "Google Calendar"
        : "Calendar: scope manquant"
      : null,
  ].filter(Boolean);
  const account = status.accountLabel ? ` ${status.accountLabel}` : "";

  if ((asksGmail && !status.gmail) || (asksCalendar && !status.calendar)) {
    return `Ton compte Google${account} est connecté, mais l'autorisation de lecture demandée manque. Reconnecte Google Workspace depuis https://os.qarizmi.com/integrations.`;
  }

  return `Oui, ton compte Google${account} est connecté. Accès disponible: ${requestedCapabilities.join(" et ") || "Google Workspace"}.`;
}

function formatCrmMeetingsAnswer(
  crmLeads: CrmLeadSummary[],
  meetingPagePeriod?: "past" | "upcoming",
) {
  if (meetingPagePeriod === "past") {
    if (crmLeads.length === 0) {
      return "Aucune réunion n'est visible dans l'historique Meetings.";
    }

    const lines = crmLeads.slice(0, 12).map(formatCrmMeetingLine);
    return [
      crmLeads.length === 1
        ? "1 réunion est visible dans l'historique Meetings:"
        : `${crmLeads.length} réunions sont visibles dans l'historique Meetings:`,
      ...lines,
    ].join("\n");
  }

  const meetings = crmLeads.filter((lead) => lead.status === "meeting-booked");
  if (meetings.length === 0) {
    return "Il n'y a aucun lead au statut Meeting fixé dans le CRM.";
  }

  const lines = meetings.slice(0, 12).map(formatCrmMeetingLine);

  return [
    meetings.length === 1
      ? "1 lead est au statut Meeting fixé dans le CRM:"
      : `${meetings.length} leads sont au statut Meeting fixé dans le CRM:`,
    ...lines,
  ].join("\n");
}

function formatCrmMeetingLine(lead: CrmLeadSummary) {
  const company = lead.companyName || lead.topic;
  const contact = lead.contactName ? ` — ${lead.contactName}` : "";
  const date = lead.leadDate ? ` (${formatCrmMeetingDate(lead.leadDate)})` : "";
  return `• ${company}${contact}${date}`;
}

function formatGmailAnswer(messages: GmailMessageSummary[], urgent: boolean) {
  if (messages.length === 0) {
    return urgent
      ? "Je n'ai trouvé aucun mail urgent non lu dans Gmail sur les 14 derniers jours."
      : "Je n'ai trouvé aucun mail correspondant dans Gmail.";
  }

  const heading = urgent
    ? messages.length === 1
      ? "J'ai trouvé 1 mail urgent ou important non lu:"
      : `J'ai trouvé ${messages.length} mails urgents ou importants non lus:`
    : messages.length === 1
      ? "J'ai trouvé 1 mail dans Gmail:"
      : `J'ai trouvé ${messages.length} mails dans Gmail:`;
  const lines = messages.slice(0, 8).map((message) => {
    const sender = message.from ?? "Expéditeur inconnu";
    const subject = message.subject ?? "Sans objet";
    const date = formatMailDate(message.date);
    return `• ${subject} — ${sender}${date ? ` (${date})` : ""}`;
  });

  return [heading, ...lines].join("\n").slice(0, 2800);
}

function formatCalendarAnswer(
  events: GoogleCalendarEventSummary[],
  rangeLabel: string,
  outsideCrm: boolean,
) {
  const scope = outsideCrm ? " hors événements déjà reliés au CRM" : "";
  if (events.length === 0) {
    return `Je n'ai trouvé aucun événement Google Calendar${scope} ${rangeLabel}.`;
  }

  const lines = events
    .slice(0, 12)
    .map(
      (event) =>
        `• ${formatRealCalendarDate(event.start)} — ${event.title || "Événement sans titre"}`,
    );
  return [
    events.length === 1
      ? `J'ai trouvé 1 événement dans ton Google Calendar${scope} ${rangeLabel}:`
      : `J'ai trouvé ${events.length} événements dans ton Google Calendar${scope} ${rangeLabel}:`,
    ...lines,
  ]
    .join("\n")
    .slice(0, 2800);
}

function resolvePersonalCalendarWindow(
  command: string,
  now = new Date(),
  timeZone = REAL_CALENDAR_TIME_ZONE,
) {
  const normalized = normalizePersonalQuery(command);
  const relativeDay = normalized.includes("demain")
    ? 1
    : normalized.includes("aujourd hui")
      ? 0
      : null;

  if (relativeDay !== null) {
    const targetDate = shiftLocalDate(getLocalDate(now, timeZone), relativeDay);
    const nextDate = shiftLocalDate(targetDate, 1);
    return {
      daysAhead: 1,
      label: relativeDay === 0 ? "aujourd'hui" : "demain",
      timeMax: localMidnightToUtc(nextDate, timeZone).toISOString(),
      timeMin: localMidnightToUtc(targetDate, timeZone).toISOString(),
    };
  }

  const daysAhead = inferPersonalCalendarDays(command);
  return {
    daysAhead,
    label:
      daysAhead === 1
        ? "sur le prochain jour"
        : `sur les ${daysAhead} prochains jours`,
  };
}

type LocalDate = { day: number; month: number; year: number };

function getLocalDate(date: Date, timeZone: string): LocalDate {
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

function localMidnightToUtc(date: LocalDate, timeZone: string) {
  const target = Date.UTC(date.year, date.month - 1, date.day);
  let guess = target;

  for (let index = 0; index < 3; index += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      month: "2-digit",
      second: "2-digit",
      timeZone,
      year: "numeric",
    }).formatToParts(new Date(guess));
    const values = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );
    const represented = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second),
    );
    guess += target - represented;
  }

  return new Date(guess);
}

function filterCalendarEventsOutsideCrm(
  events: GoogleCalendarEventSummary[],
  crmLeads: CrmLeadSummary[],
) {
  const syncedIds = new Set<string>();
  const syncedLinks = new Set<string>();

  for (const lead of crmLeads) {
    const id = lead.notes?.match(
      /\[Google Calendar Event ID:\s*([^\]]+)\]/,
    )?.[1];
    const link = lead.notes?.match(
      /\[Google Calendar Event Link:\s*([^\]]+)\]/,
    )?.[1];
    if (id) syncedIds.add(id.trim());
    if (link) syncedLinks.add(link.trim());
  }

  return events.filter((event) => {
    const baseEventId = event.id.split("_")[0];
    if (syncedIds.has(event.id) || syncedIds.has(baseEventId)) return false;
    return !event.htmlLink || !syncedLinks.has(event.htmlLink);
  });
}

function formatGoogleReadError(provider: string, error: unknown) {
  void error;
  return `Je ne peux pas lire ${provider} pour le moment. Vérifie ou reconnecte Google Workspace depuis https://os.qarizmi.com/integrations.`;
}

function formatCrmMeetingDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "date non précisée";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: REAL_CALENDAR_TIME_ZONE,
  }).format(date);
}

function formatMailDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
  }).format(date);
}

function buildSystemPrompt() {
  return [
    "Tu es NAIA, l'assistante opérationnelle de Qarizmi.",
    "Comprends la question avant de choisir un agent, puis réponds directement dans la langue de l'utilisateur.",
    'Retourne uniquement du JSON valide: {"agentId":"...","confidence":0.0,"response":"..."}.',
    "Le crmSnapshot contient des données CRM réelles de l'organisation. N'invente jamais un lead, un chiffre ou une action.",
    "operatingContext contient encore des données de travail simulées pour Finance, Projects et HR. Si tu les utilises, commence explicitement par dire qu'il s'agit de données simulées.",
    "realGoogleCalendar, lorsqu'il est présent, contient les vrais événements Google Calendar de l'utilisateur et prime sur tout exemple.",
    "privateKnowledge, lorsqu'il est présent, provient du dernier deck générique du Drive privé Qarizmi. Utilise uniquement les extraits fournis et n'invente aucun parcours, credential, chiffre ou offre absent de cette source.",
    "Le contexte privé est réservé aux cofondateurs en conversation privée. Ne le répète jamais comme une information publique et ne prétends pas avoir lu d'autres documents.",
    "Pour une question générale, choisis naia et réponds comme un assistant compétent.",
    "currentPage est un contexte serveur vérifié. Priorité: instruction explicite, entité sélectionnée, module et vue, historique, contexte général.",
    "Une entité explicitement nommée dans la commande remplace toujours l'entité sélectionnée dans currentPage.",
    "Réponds toujours au fond de la question. Ne réponds jamais seulement qu'un agent prend le relais, peut lire un module ou peut préparer une action.",
    "Pour une information insuffisante, pose une seule question de clarification utile.",
    "Ne prétends jamais avoir exécuté une écriture, envoyé un message, créé un événement ou modifié le CRM.",
  ].join(" ");
}

function shouldLoadPrivateKnowledge(
  command: string,
  localResult: NaiaOrchestrationResult,
) {
  if (isIdentityQuery(command)) return true;
  if (isNaiaOverviewQuestion(command)) return false;
  if (
    isGoogleAccessQuery(command) ||
    isGmailReadQuery(command) ||
    isCalendarReadQuery(command) ||
    isCrmMeetingReadQuery(command)
  ) {
    return false;
  }

  return (
    localResult.responseType === "handoff" && isQarizmiKnowledgeQuery(command)
  );
}

function isQarizmiKnowledgeQuery(command: string) {
  const normalized = normalizePersonalQuery(command);
  return [
    "qarizmi",
    "qui sommes nous",
    "notre entreprise",
    "notre cabinet",
    "notre offre",
    "nos offres",
    "nos services",
    "notre positionnement",
    "notre proposition de valeur",
    "nos references",
    "nos credentials",
    "notre expertise",
    "nos expertises",
    "who are we",
    "our company",
    "our firm",
    "our offer",
    "our services",
    "our positioning",
    "our value proposition",
    "our credentials",
    "our expertise",
  ].some((phrase) => normalized.includes(phrase));
}

function parseAgentId(value: unknown): NaiaAgentId | null {
  return typeof value === "string" &&
    naiaAgents.some((agent) => agent.id === value)
    ? (value as NaiaAgentId)
    : null;
}

function shouldReadCalendar(command: string) {
  return /\b(agenda|calendar|calendrier|dispo|disponibilit|meeting|reunion|réunion|rdv|rendez[- ]vous)\b/i.test(
    command,
  );
}

const REAL_CALENDAR_DAYS_AHEAD = 7;
const REAL_CALENDAR_MAX_EVENTS = 15;
const REAL_CALENDAR_TIME_ZONE = "Africa/Casablanca";
const REAL_CALENDAR_CONTEXT_TIMEOUT_MS = 2500;

async function buildRealGoogleCalendarContext(
  googleContext?: GoogleWorkspaceContext,
): Promise<string | null> {
  try {
    const events = await withDeadline(
      listGoogleCalendarEvents(
        {
          daysAhead: REAL_CALENDAR_DAYS_AHEAD,
          maxResults: REAL_CALENDAR_MAX_EVENTS,
        },
        googleContext,
      ),
      REAL_CALENDAR_CONTEXT_TIMEOUT_MS,
    );

    if (events.length === 0) {
      return `Agenda Google réel de l'utilisateur (${REAL_CALENDAR_DAYS_AHEAD} prochains jours): aucun événement.`;
    }

    const summary = events
      .map((event) => `${event.title} — ${formatRealCalendarDate(event.start)}`)
      .join(" ; ");
    return `Agenda Google réel de l'utilisateur (${REAL_CALENDAR_DAYS_AHEAD} prochains jours): ${summary}`;
  } catch {
    return null;
  }
}

function withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });

  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

function formatRealCalendarDate(start?: string) {
  if (!start) return "date non précisée";
  const date = new Date(start);
  if (Number.isNaN(date.getTime())) return "date non précisée";

  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    ...(start.includes("T")
      ? { hour: "2-digit" as const, minute: "2-digit" as const }
      : {}),
    month: "long",
    timeZone: REAL_CALENDAR_TIME_ZONE,
    weekday: "long",
  }).format(date);
}
