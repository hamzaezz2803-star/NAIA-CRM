import "server-only";

import type { CrmLeadSummary } from "@/features/crm/contracts";
import { naiaAgents, type NaiaAgentId } from "@/features/naia/agents";
import { buildNaiaOperatingContext } from "@/features/naia/operational-context";
import {
  isNaiaOverviewQuestion,
  orchestrateNaiaCommand,
  type NaiaOrchestrationResult,
} from "@/features/naia/orchestrator";
import {
  listGoogleCalendarEvents,
  type GoogleWorkspaceContext,
} from "@/platform/integrations/google-workspace";

export type NaiaAssistantMode = "groq-orchestrated" | "local-orchestrated";
export type NaiaConversationMessage = {
  content: string;
  role: "assistant" | "user";
};

export async function planNaiaAssistant({
  command,
  crmLeads,
  googleContext,
  history = [],
}: {
  command: string;
  crmLeads: CrmLeadSummary[];
  googleContext?: GoogleWorkspaceContext;
  history?: NaiaConversationMessage[];
}): Promise<{ mode: NaiaAssistantMode; result: NaiaOrchestrationResult }> {
  const localResult = orchestrateNaiaCommand({ command, crmLeads });
  const apiKey = process.env.GROQ_API_KEY ?? process.env.GROQ_KEY;

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

  const realGoogleCalendar = shouldReadCalendar(command)
    ? await buildRealGoogleCalendarContext(googleContext)
    : null;

  try {
    const groqResponse = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        body: JSON.stringify({
          max_tokens: 800,
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
                conversationHistory: history.slice(-8),
                contextSources: {
                  crm: "live organization data",
                  googleCalendar: realGoogleCalendar
                    ? "live connected user data"
                    : "not loaded",
                  operations:
                    "simulated working data; always disclose this when used",
                },
                crmSnapshot: crmLeads.slice(0, 30).map((lead) => ({
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
                realGoogleCalendar: realGoogleCalendar ?? undefined,
              }),
              role: "user",
            },
          ],
          model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
          response_format: { type: "json_object" },
          temperature: 0.15,
        }),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      },
    );

    if (!groqResponse.ok) {
      return { mode: "local-orchestrated", result: localResult };
    }

    const payload = (await groqResponse.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const decision = parseGroqDecision(payload.choices?.[0]?.message?.content);
    if (!decision) {
      return { mode: "local-orchestrated", result: localResult };
    }

    const result = orchestrateNaiaCommand({
      agentIdOverride: decision.agentId,
      command,
      confidenceOverride: decision.confidence,
      crmLeads,
      responseOverride: decision.response,
    });

    return {
      mode: "groq-orchestrated",
      result: { ...result, responseType: "answer" },
    };
  } catch {
    return { mode: "local-orchestrated", result: localResult };
  }
}

function buildSystemPrompt() {
  return [
    "Tu es NAIA, l'assistante opérationnelle de Qarizmi.",
    "Comprends la question avant de choisir un agent, puis réponds directement dans la langue de l'utilisateur.",
    'Retourne uniquement du JSON valide: {"agentId":"...","confidence":0.0,"response":"..."}.',
    "Le crmSnapshot contient des données CRM réelles de l'organisation. N'invente jamais un lead, un chiffre ou une action.",
    "operatingContext contient encore des données de travail simulées pour Finance, Projects et HR. Si tu les utilises, commence explicitement par dire qu'il s'agit de données simulées.",
    "realGoogleCalendar, lorsqu'il est présent, contient les vrais événements Google Calendar de l'utilisateur et prime sur tout exemple.",
    "Pour une question générale, choisis naia et réponds comme un assistant compétent.",
    "Réponds toujours au fond de la question. Ne réponds jamais seulement qu'un agent prend le relais, peut lire un module ou peut préparer une action.",
    "Pour une information insuffisante, pose une seule question de clarification utile.",
    "Ne prétends jamais avoir exécuté une écriture, envoyé un message, créé un événement ou modifié le CRM.",
  ].join(" ");
}

function parseGroqDecision(content: string | undefined) {
  if (!content) return null;

  try {
    const parsed = JSON.parse(content) as {
      agentId?: unknown;
      confidence?: unknown;
      response?: unknown;
    };
    const agentId = parseAgentId(parsed.agentId);
    const response =
      typeof parsed.response === "string" ? parsed.response.trim() : "";
    if (!agentId || !response) return null;

    return {
      agentId,
      confidence:
        typeof parsed.confidence === "number" &&
        parsed.confidence >= 0 &&
        parsed.confidence <= 1
          ? parsed.confidence
          : undefined,
      response: response.slice(0, 1600),
    };
  } catch {
    return null;
  }
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
