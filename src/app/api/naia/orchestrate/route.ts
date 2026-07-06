import { createHmac, timingSafeEqual } from "node:crypto";

import {
  createLeadAction,
  extractLeadFromNaturalTextAction,
  fetchLeadsAction,
  updateLeadStatusAction,
} from "@/features/crm/actions";
import {
  crmLeadStatuses,
  type CrmLeadDraft,
  type CrmLeadStatus,
} from "@/features/crm/contracts";
import {
  inferCrmStatus,
  isNaiaOverviewQuestion,
  orchestrateNaiaCommand,
  type NaiaOrchestrationResult,
  type NaiaActionDraft,
} from "@/features/naia/orchestrator";
import { naiaAgents, type NaiaAgentId } from "@/features/naia/agents";
import { createServerSupabaseClient } from "@/platform/auth/supabase-server";
import {
  hasPermission,
  type OrganizationRole,
  type PermissionAction,
} from "@/platform/core/permissions";

type OrchestratePayload = {
  actionId?: string;
  approvalToken?: string;
  command?: string;
  execute?: boolean;
  leadInput?: Partial<CrmLeadDraft>;
};

type SignedAction = NaiaActionDraft & {
  approvalToken: string;
};

const APPROVAL_TTL_MS = 5 * 60 * 1000;

export async function POST(request: Request) {
  let payload: OrchestratePayload;

  try {
    payload = (await request.json()) as OrchestratePayload;
  } catch {
    return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const command = parseCommand(payload.command);
  const crmLeads = await fetchLeadsAction();
  const localResult = orchestrateNaiaCommand({ command, crmLeads });

  if (payload.execute) {
    const hydratedLocalResult = await hydrateCrmLeadDrafts({
      command,
      result: localResult,
    });

    return executeAction({
      actionId: payload.actionId,
      approvalToken: payload.approvalToken,
      command,
      leadInput: payload.leadInput,
      serverActions: hydratedLocalResult.actions,
    });
  }

  const { mode, result } = await enhanceWithGroqOrchestrator({
    command,
    crmLeads,
    localResult,
  });
  const hydratedResult = await hydrateCrmLeadDrafts({
    command,
    result,
  });

  return Response.json({
    ...hydratedResult,
    actions: hydratedResult.actions.map((action) =>
      signAction(action, command),
    ),
    crmSnapshot: {
      leadCount: crmLeads.length,
      openLeadCount: crmLeads.filter(
        (lead) => lead.status !== "won" && lead.status !== "dead-end",
      ).length,
    },
    mode,
  });
}

async function enhanceWithGroqOrchestrator({
  command,
  crmLeads,
  localResult,
}: {
  command: string;
  crmLeads: Awaited<ReturnType<typeof fetchLeadsAction>>;
  localResult: NaiaOrchestrationResult;
}): Promise<{
  mode: "groq-orchestrated" | "local-orchestrated";
  result: NaiaOrchestrationResult;
}> {
  const apiKey = process.env.GROQ_API_KEY ?? process.env.GROQ_KEY;
  if (!apiKey || !command || isNaiaOverviewQuestion(command)) {
    return { mode: "local-orchestrated", result: localResult };
  }

  try {
    const groqResponse = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        body: JSON.stringify({
          max_tokens: 600,
          messages: [
            {
              content:
                'Tu es NAIA, orchestrateur vocal de Qarizmi OS. Tu choisis exactement un agent pour traiter la demande, puis tu reponds en francais comme un assistant operationnel. Retourne uniquement du JSON valide: {"agentId":"...","confidence":0.0,"response":"..."}. Si la demande mentionne un rendez-vous, call ou meeting avec un prospect/client potentiel, choisis toujours "crm" pour que Salma cree ou mette a jour le lead; Adam intervient ensuite pour le calendrier. N\'invente jamais une action deja executee. Pour les actions externes ou CRM, parle de brouillon, preparation ou validation humaine.',
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
                })),
                command,
                crmSnapshot: crmLeads.slice(0, 8).map((lead) => ({
                  id: lead.id,
                  nextAction: lead.nextAction,
                  notes: lead.notes,
                  status: lead.status,
                  topic: lead.topic,
                })),
                localSuggestion: {
                  agentId: localResult.agent.id,
                  actions: localResult.actions.map((action) => ({
                    kind: action.kind,
                    label: action.label,
                  })),
                  response: localResult.response,
                },
              }),
              role: "user",
            },
          ],
          model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
          response_format: { type: "json_object" },
          temperature: 0.2,
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

    return {
      mode: "groq-orchestrated",
      result: orchestrateNaiaCommand({
        agentIdOverride: decision.agentId,
        command,
        confidenceOverride: decision.confidence,
        crmLeads,
        responseOverride: decision.response,
      }),
    };
  } catch {
    return { mode: "local-orchestrated", result: localResult };
  }
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

    const confidence =
      typeof parsed.confidence === "number" &&
      parsed.confidence >= 0 &&
      parsed.confidence <= 1
        ? parsed.confidence
        : undefined;

    return {
      agentId,
      confidence,
      response,
    };
  } catch {
    return null;
  }
}

function parseAgentId(agentId: unknown): NaiaAgentId | null {
  return typeof agentId === "string" &&
    naiaAgents.some((agent) => agent.id === agentId)
    ? (agentId as NaiaAgentId)
    : null;
}

async function executeAction({
  actionId,
  approvalToken,
  command,
  leadInput,
  serverActions,
}: {
  actionId?: string;
  approvalToken?: string;
  command: string;
  leadInput?: Partial<CrmLeadDraft>;
  serverActions: NaiaActionDraft[];
}) {
  if (!actionId || !approvalToken) {
    return Response.json({ error: "Missing approval token" }, { status: 400 });
  }

  const action = serverActions.find((candidate) => candidate.id === actionId);
  if (!action) {
    return Response.json({ error: "Action not found" }, { status: 404 });
  }

  if (!verifyApprovalToken(approvalToken, action, command)) {
    return Response.json(
      { error: "Invalid or expired approval token" },
      { status: 403 },
    );
  }

  if (action.kind === "crm.updateLeadStatus") {
    const status = coerceStatus(action.payload.status);
    if (!status) {
      return Response.json({ error: "Invalid CRM status" }, { status: 400 });
    }

    const permission = await requireCrmPermission("update");
    if (!permission.allowed) {
      return Response.json(
        { error: permission.error },
        { status: permission.status },
      );
    }

    const response = await updateLeadStatusAction(
      action.payload.leadId,
      status,
    );

    return Response.json({
      action,
      execution: response.success ? "applied" : "failed",
      message: response.success
        ? "Statut CRM appliqué sans action provider externe."
        : (response.error ?? "Action CRM impossible."),
      success: response.success,
    });
  }

  if (action.kind === "crm.createLead") {
    const leadDraft = sanitizeLeadDraft({
      ...action.payload,
      ...leadInput,
    });
    const status = coerceStatus(leadDraft.status);
    const topic = leadDraft.topic.trim().slice(0, 160);

    if (!status || topic.length < 3) {
      return Response.json(
        { error: "Invalid CRM lead payload" },
        { status: 400 },
      );
    }

    const permission = await requireCrmPermission("create");
    if (!permission.allowed) {
      return Response.json(
        { error: permission.error },
        { status: permission.status },
      );
    }

    const response = await createLeadAction({
      companyName: leadDraft.companyName,
      contactEmail: leadDraft.contactEmail,
      contactName: leadDraft.contactName,
      contactPhone: leadDraft.contactPhone,
      leadDate: leadDraft.leadDate,
      nextAction: leadDraft.nextAction?.slice(0, 280),
      notes: buildLeadNotes(leadDraft),
      source: leadDraft.source || "NAIA",
      status,
      topic,
    });
    const calendarSuccess = Boolean(response.calendarSynced);
    let calendarMessage = "";

    if (response.success && leadDraft.leadDate) {
      calendarMessage = response.calendarSynced
        ? response.calendarLink
          ? ` Adam a vérifié Google Calendar et créé l'événement: ${response.calendarLink}`
          : " Adam a vérifié Google Calendar."
        : ` Adam n'a pas pu créer l'événement Calendar: ${response.calendarError ?? "connexion Google à vérifier"}`;
    }

    return Response.json({
      action,
      calendarSuccess,
      execution: response.success ? "applied" : "failed",
      lead: response.lead,
      message: response.success
        ? `Lead CRM créé.${calendarMessage}`
        : (response.error ?? "Création du lead impossible."),
      success: response.success,
    });
  }

  if (action.kind === "calendar.scheduleMeeting") {
    return Response.json({
      action,
      execution: "prepared",
      message:
        "Adam passera par le lead CRM validé pour vérifier les disponibilités Google Calendar et créer l'événement. Valide d'abord l'action Salma si le lead n'existe pas encore.",
      success: true,
    });
  }

  if (action.kind === "dev.prepareSpec") {
    return Response.json({
      action,
      execution: "prepared",
      message:
        "Mission dev préparée. L'étape suivante doit créer une branche, une spécification et une revue avant implémentation.",
      success: true,
    });
  }

  return Response.json({ error: "Unsupported action" }, { status: 400 });
}

async function requireCrmPermission(
  action: PermissionAction,
): Promise<
  { allowed: true } | { allowed: false; error: string; status: 401 | 403 | 500 }
> {
  if (
    process.env.NODE_ENV === "development" &&
    process.env.CRM_DUMMY_DATA !== "disabled"
  ) {
    return { allowed: true };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return { allowed: false, error: "Not authenticated", status: 401 };
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { allowed: false, error: "Not authenticated", status: 401 };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("organization_memberships")
    .select("role")
    .eq("profile_id", user.id)
    .limit(1)
    .single();

  if (membershipError || !membership) {
    return { allowed: false, error: "Membership not found", status: 403 };
  }

  const role = membership.role as OrganizationRole;
  if (!hasPermission(role, { action, module: "crm" })) {
    return { allowed: false, error: "Forbidden", status: 403 };
  }

  return { allowed: true };
}

async function hydrateCrmLeadDrafts({
  command,
  result,
}: {
  command: string;
  result: NaiaOrchestrationResult;
}): Promise<NaiaOrchestrationResult> {
  if (!result.actions.some((action) => action.kind === "crm.createLead")) {
    return result;
  }

  const extracted = await extractLeadDraft(command);
  const inferredStatus = inferCrmStatus(command);

  const hasCalendarAction = result.actions.some(
    (action) => action.kind === "calendar.scheduleMeeting",
  );

  return {
    ...result,
    actions: result.actions.map((action) => {
      if (action.kind === "calendar.scheduleMeeting") {
        return {
          ...action,
          payload: {
            ...action.payload,
            requestedDate: extracted.leadDate,
            title:
              extracted.companyName || extracted.contactName
                ? `Meeting ${[extracted.companyName, extracted.contactName].filter(Boolean).join(" - ")}`
                : action.payload.title,
          },
        };
      }

      if (action.kind !== "crm.createLead") return action;

      return {
        ...action,
        description:
          "Salma a pré-rempli le formulaire CRM depuis la même extraction IA que le module Leads.",
        payload: sanitizeLeadDraft({
          ...action.payload,
          ...extracted,
          status: inferredStatus ?? extracted.status ?? action.payload.status,
          notes: extracted.notes
            ? [extracted.notes, `Commande NAIA: ${command}`].join("\n")
            : action.payload.notes,
        }),
      };
    }),
    response: hasCalendarAction
      ? "Salma prend le relais CRM et Adam prépare le calendrier. J'ai pré-rempli le lead; valide-le pour l'écrire en meeting booked dans le pipeline et laisser Adam vérifier Google Calendar avant de créer l'événement."
      : "Salma prend le relais CRM. J'ai pré-rempli le formulaire du lead avec l'extraction IA. Vérifie les champs, puis clique sur \"Valider et créer le lead\" pour l'écrire dans le pipeline.",
  };
}

async function extractLeadDraft(
  command: string,
): Promise<Partial<CrmLeadDraft>> {
  const extracted = await extractLeadFromNaturalTextAction(command);
  if (extracted.success && extracted.extracted?.topic) {
    return {
      companyName: extracted.extracted.companyName,
      contactEmail: extracted.extracted.contactEmail,
      contactName: extracted.extracted.contactName,
      contactPhone: extracted.extracted.contactPhone,
      leadDate: extracted.extracted.leadDate,
      nextAction: extracted.extracted.nextAction,
      notes: extracted.extracted.notes,
      source: extracted.extracted.source ?? "NAIA",
      status: extracted.extracted.status ?? "lead-to-contact",
      topic: extracted.extracted.topic,
    };
  }

  return extractLeadDraftLocally(command);
}

function extractLeadDraftLocally(command: string): Partial<CrmLeadDraft> {
  const clean = command
    .replace(/^(naia[, ]*)?/i, "")
    .replace(/^(un\s+|une\s+)?(nouveau|nouvelle)\s+lead\s*[:,;-]?\s*/i, "")
    .trim()
    .replace(/[.!?]$/g, "");
  const prospectMeetingMatch =
    clean.match(
      /\b(?:parle|parlé|contacte|contacté|appele|appelé|echange|échangé|discute|discuté)\s+(?:(?:a|à|avec)\s+)?(.+?)\s+(?:de|chez)\s+([^,.;]+?)(?=\s+(?:et|qui|il|elle|pour|afin|and|with)\b|[,.;]|$)/i,
    ) ??
    clean.match(
      /\b(?:talked|spoke|contacted|called|discussed|exchanged|met)\s+(?:to|with)?\s*(.+?)\s+(?:from|at|with)\s+([^,.;]+?)(?=\s+(?:and|who|they|he|she|to|for|with|would|will|have|has)\b|[,.;]|$)/i,
    );
  const isMeetingCommand =
    /\b(meeting|rdv|rendez[- ]vous|call|demo|démo|visio|reunion|réunion)\b/i.test(
      clean,
    );

  if (prospectMeetingMatch) {
    const contactName = prospectMeetingMatch[1].trim();
    const companyName = prospectMeetingMatch[2].trim();

    return {
      companyName,
      contactName,
      nextAction: isMeetingCommand
        ? "Preparer le meeting et confirmer le contexte avec le contact"
        : "Qualifier le besoin et confirmer le prochain rendez-vous",
      notes: `Commande NAIA: ${command}`,
      source: "NAIA",
      status: isMeetingCommand ? "meeting-booked" : "contacted",
      topic: `${companyName} - nouveau lead`,
    };
  }

  const chezMatch = clean.match(/^(.+?)\s+chez\s+(.+)$/i);

  if (chezMatch) {
    const contactName = chezMatch[1].trim();
    const companyName = chezMatch[2].trim();
    return {
      companyName,
      contactName,
      nextAction: "Qualifier le besoin et confirmer le prochain rendez-vous",
      notes: `Commande NAIA: ${command}`,
      source: "NAIA",
      status: "lead-to-contact",
      topic: `${companyName} - nouveau lead`,
    };
  }

  return {
    nextAction: "Qualifier le besoin et confirmer le prochain rendez-vous",
    notes: `Commande NAIA: ${command}`,
    source: "NAIA",
    status: "lead-to-contact",
    topic: clean.slice(0, 160) || "Nouveau lead NAIA",
  };
}

function sanitizeLeadDraft(input: Partial<CrmLeadDraft>): CrmLeadDraft {
  const status = coerceStatus(input.status ?? "") ?? "lead-to-contact";

  return {
    companyName: cleanOptional(input.companyName, 120),
    contactEmail: cleanOptional(input.contactEmail, 160),
    contactName: cleanOptional(input.contactName, 120),
    contactPhone: cleanOptional(input.contactPhone, 80),
    leadDate: cleanOptional(input.leadDate, 80),
    nextAction:
      cleanOptional(input.nextAction, 280) ??
      "Qualifier le besoin et confirmer le prochain rendez-vous",
    notes: cleanOptional(input.notes, 1200),
    source: cleanOptional(input.source, 120) ?? "NAIA",
    status,
    topic: cleanRequired(input.topic, "Nouveau lead NAIA", 160),
  };
}

function buildLeadNotes(leadDraft: CrmLeadDraft) {
  return (
    [
      leadDraft.companyName && `Entreprise: ${leadDraft.companyName}`,
      leadDraft.contactName && `Contact: ${leadDraft.contactName}`,
      leadDraft.contactEmail && `Email: ${leadDraft.contactEmail}`,
      leadDraft.contactPhone && `Tel: ${leadDraft.contactPhone}`,
      leadDraft.notes,
    ]
      .filter(Boolean)
      .join("\n") || undefined
  );
}

function cleanRequired(value: unknown, fallback: string, maxLength: number) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : fallback;
}

function cleanOptional(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : undefined;
}

function coerceStatus(status: string): CrmLeadStatus | null {
  return (crmLeadStatuses as readonly string[]).includes(status)
    ? status
    : null;
}

function parseCommand(command: unknown) {
  return typeof command === "string" ? command.trim().slice(0, 2000) : "";
}

function signAction(action: NaiaActionDraft, command: string): SignedAction {
  const expiresAt = Date.now() + APPROVAL_TTL_MS;
  const payload = {
    actionHash: actionHash(action),
    actionId: action.id,
    commandHash: hashValue(command),
    expiresAt,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signature = hmac(encodedPayload);

  return {
    ...action,
    approvalToken: `${encodedPayload}.${signature}`,
  };
}

function verifyApprovalToken(
  approvalToken: string,
  action: NaiaActionDraft,
  command: string,
) {
  const [encodedPayload, signature] = approvalToken.split(".");
  if (!encodedPayload || !signature) return false;

  const expected = hmac(encodedPayload);
  if (!safeEqual(signature, expected)) return false;

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as {
      actionHash?: string;
      actionId?: string;
      commandHash?: string;
      expiresAt?: number;
    };

    return (
      payload.actionId === action.id &&
      payload.commandHash === hashValue(command) &&
      payload.actionHash === actionHash(action) &&
      typeof payload.expiresAt === "number" &&
      payload.expiresAt >= Date.now()
    );
  } catch {
    return false;
  }
}

function actionHash(action: NaiaActionDraft) {
  if (action.kind === "crm.createLead") {
    return hashValue(
      JSON.stringify({
        agentId: action.agentId,
        id: action.id,
        kind: action.kind,
      }),
    );
  }

  return hashValue(JSON.stringify(action));
}

function hashValue(value: string) {
  return createHmac("sha256", getApprovalSecret()).update(value).digest("hex");
}

function hmac(value: string) {
  return createHmac("sha256", getApprovalSecret()).update(value).digest("hex");
}

function getApprovalSecret() {
  const secret =
    process.env.NAIA_ACTION_APPROVAL_SECRET ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (secret) return secret;

  if (process.env.NODE_ENV === "development") {
    return "naia-local-approval-secret";
  }

  throw new Error("NAIA_ACTION_APPROVAL_SECRET is required");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
