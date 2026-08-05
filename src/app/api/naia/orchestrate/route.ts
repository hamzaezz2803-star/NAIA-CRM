import {
  createLeadAction,
  extractLeadFromNaturalTextAction,
  fetchLeadsAction,
  updateLeadStatusAction,
  fetchTagsAction,
  createTagAction,
} from "@/features/crm/actions";
import {
  crmLeadStatuses,
  type CrmLeadDraft,
  type CrmLeadStatus,
} from "@/features/crm/contracts";
import {
  inferCrmStatus,
  type NaiaOrchestrationResult,
} from "@/features/naia/orchestrator";
import { parseNaiaPageContext } from "@/features/naia/page-context";
import {
  canonicalizeConversationText,
  extractLeadIdentity,
  inferReminderDate,
} from "@/features/naia/lead-understanding";
import { createServerSupabaseClient } from "@/platform/auth/supabase-server";
import { getAppSession } from "@/platform/auth/session";
import {
  hasPermission,
  type OrganizationRole,
  type PermissionAction,
} from "@/platform/core/permissions";
import {
  createGoogleCalendarReminder,
  listGmailMessages,
  listGoogleCalendarEvents,
} from "@/platform/integrations/google-workspace";
import { signAction, verifyApprovalToken } from "@/platform/naia/action-tokens";
import {
  planNaiaAssistant,
  type NaiaConversationMessage,
} from "@/platform/naia/assistant";
import { generateMayaPitchDraftForLeadAction } from "@/features/maya/actions";

type OrchestratePayload = {
  actionId?: string;
  approvalToken?: string;
  command?: string;
  execute?: boolean;
  history?: NaiaConversationMessage[];
  pageContext?: unknown;
  leadInput?: Partial<
    CrmLeadDraft & {
      createGoogleDrive?: boolean;
      createGoogleCalendar?: boolean;
    }
  >;
};

export async function POST(request: Request) {
  let payload: OrchestratePayload;

  try {
    payload = (await request.json()) as OrchestratePayload;
  } catch {
    return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const command = parseCommand(payload.command);

  if (payload.execute) {
    return executeAction({
      actionId: payload.actionId,
      approvalToken: payload.approvalToken,
      command,
      leadInput: payload.leadInput,
    });
  }

  const actor = await resolveWebActor();
  if (!actor) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const crmLeads = await fetchLeadsAction({ backfill: false });
  const { mode, result } = await planNaiaAssistant({
    actor,
    command,
    crmLeads,
    history: parseHistory(payload.history),
    pageContext: parseNaiaPageContext(payload.pageContext),
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

async function resolveWebActor() {
  try {
    const session = await getAppSession();
    return {
      email: session.user.email,
      name: session.user.name,
      organizationName: session.organization.name,
      role: session.user.role,
    };
  } catch {
    return undefined;
  }
}

async function executeAction({
  actionId,
  approvalToken,
  command,
  leadInput,
}: {
  actionId?: string;
  approvalToken?: string;
  command: string;
  leadInput?: Partial<
    CrmLeadDraft & {
      createGoogleDrive?: boolean;
      createGoogleCalendar?: boolean;
    }
  >;
}) {
  if (!actionId || !approvalToken) {
    return Response.json({ error: "Missing approval token" }, { status: 400 });
  }

  // The HMAC-signed approval token is the source of truth: it carries the
  // exact action (kind + payload) the user approved. Executing from the token
  // keeps validation idempotent even when the CRM state, the clock, or the AI
  // extraction changed between plan and execute, so we never re-derive the
  // action list server-side here.
  const action = verifyApprovalToken(approvalToken, actionId, command);
  if (!action) {
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

    const shouldCreateDrive = leadInput?.createGoogleDrive !== false;
    const shouldCreateCalendar = leadInput?.createGoogleCalendar !== false;

    // Map tag names to database tag IDs
    const tagIds: string[] = [];
    if (leadDraft.tags && leadDraft.tags.length > 0) {
      const existingTags = await fetchTagsAction();
      for (const tagName of leadDraft.tags) {
        const trimmed = tagName.trim();
        if (!trimmed) continue;

        // Check if tag already exists (case-insensitive)
        const found = existingTags.find(
          (t) => t.name.toLowerCase() === trimmed.toLowerCase(),
        );

        if (found) {
          tagIds.push(found.id);
        } else {
          // Create new tag with a random color
          const colors = [
            "teal",
            "blue",
            "indigo",
            "rose",
            "amber",
            "emerald",
            "stone",
            "orange",
          ];
          const randomColor = colors[Math.floor(Math.random() * colors.length)];
          const createRes = await createTagAction(trimmed, randomColor);
          if (createRes.success && createRes.tag) {
            tagIds.push(createRes.tag.id);
          }
        }
      }
    }

    const response = await createLeadAction({
      companyName: leadDraft.companyName,
      contactEmail: leadDraft.contactEmail,
      contactJobTitle: leadDraft.contactJobTitle,
      contactLinkedinUrl: leadDraft.contactLinkedinUrl,
      contactName: leadDraft.contactName,
      contactPhone: leadDraft.contactPhone,
      leadDate: leadDraft.leadDate,
      nextAction: leadDraft.nextAction?.slice(0, 280),
      notes: buildLeadNotes(leadDraft),
      source: leadDraft.source || "NAIA",
      status,
      topic,
      skipGoogleCalendarSync: !shouldCreateCalendar,
      skipGoogleDriveCreate: !shouldCreateDrive,
      tagIds,
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

  if (action.kind === "calendar.createReminder") {
    if (!action.payload.scheduledAt) {
      return Response.json({
        action,
        execution: "failed",
        message:
          "Adam a besoin d'une date et d'une heure précises pour créer ce rappel.",
        success: false,
      });
    }

    try {
      const reminder = await createGoogleCalendarReminder({
        scheduledAt: action.payload.scheduledAt,
        timeZone: action.payload.timeZone,
        title: action.payload.title,
      });
      return Response.json({
        action,
        execution: "applied",
        message: reminder.htmlLink
          ? `Rappel Google Calendar créé: ${reminder.htmlLink}`
          : "Rappel Google Calendar créé.",
        providerResult: { reminder },
        success: true,
      });
    } catch (error) {
      return Response.json({
        action,
        execution: "failed",
        message:
          error instanceof Error
            ? error.message
            : "Création du rappel Google Calendar impossible.",
        success: false,
      });
    }
  }

  if (action.kind === "google.gmail.listMessages") {
    try {
      const messages = await listGmailMessages(action.payload);

      return Response.json({
        action,
        execution: "applied",
        message:
          messages.length > 0
            ? `Lina a lu ${messages.length} message(s) Gmail autorise(s).`
            : "Lina n'a trouvé aucun message Gmail correspondant.",
        providerResult: {
          messages,
        },
        success: true,
      });
    } catch (error) {
      return Response.json({
        action,
        execution: "failed",
        message:
          error instanceof Error ? error.message : "Lecture Gmail impossible.",
        success: false,
      });
    }
  }

  if (action.kind === "google.calendar.listEvents") {
    try {
      const events = await listGoogleCalendarEvents(action.payload);

      return Response.json({
        action,
        execution: "applied",
        message:
          events.length > 0
            ? `Adam a lu ${events.length} evenement(s) Google Calendar.`
            : "Adam n'a trouvé aucun événement dans la fenêtre demandée.",
        providerResult: {
          events,
        },
        success: true,
      });
    } catch (error) {
      return Response.json({
        action,
        execution: "failed",
        message:
          error instanceof Error
            ? error.message
            : "Lecture Google Calendar impossible.",
        success: false,
      });
    }
  }

  if (action.kind === "slack.prepareMessage") {
    return Response.json({
      action,
      execution: "prepared",
      message:
        action.payload.channel && process.env.SLACK_BOT_TOKEN
          ? "Message Slack prêt. L'envoi automatique reste désactivé pour cette action; valide le canal dans le connecteur Slack avant activation."
          : "Brouillon Slack préparé. Ajoute un canal explicite et configure SLACK_BOT_TOKEN avant tout envoi.",
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

  if (action.kind === "crm.generateFollowUpDraft") {
    return Response.json({
      action,
      execution: "applied",
      message:
        "Génération du brouillon de relance préparée. Redirection en cours...",
      success: true,
    });
  }

  if (action.kind === "pitch.generateDraft") {
    try {
      const response = await generateMayaPitchDraftForLeadAction(
        action.payload.leadId,
      );

      return Response.json({
        action,
        execution: response.success ? "applied" : "failed",
        message: response.success
          ? `Pitch Maya généré: ${response.draftFileName}`
          : (response.error ?? "Génération du pitch impossible."),
        providerResult: response.success
          ? {
              draftFileName: response.draftFileName,
              draftFilePath: response.draftFilePath,
              manifestPath: response.manifestPath,
            }
          : undefined,
        success: response.success,
      });
    } catch (error) {
      // Owner-only generation lock and Drive failures surface as a clear
      // failed action instead of a 500.
      return Response.json({
        action,
        execution: "failed",
        message:
          error instanceof Error
            ? error.message
            : "Génération du pitch impossible.",
        success: false,
      });
    }
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
  const internalReminder = isInternalReminderCommand(command);
  const nextActionOverride = inferLeadNextAction(command);

  const hasCalendarAction = result.actions.some(
    (action) => action.kind === "calendar.scheduleMeeting",
  );
  const hasReminderAction = result.actions.some(
    (action) => action.kind === "calendar.createReminder",
  );
  const reminderDate = extracted.leadDate ?? inferReminderDate(command);

  return {
    ...result,
    actions: result.actions.map((action) => {
      if (action.kind === "calendar.createReminder") {
        return {
          ...action,
          payload: {
            ...action.payload,
            scheduledAt: reminderDate ?? action.payload.scheduledAt,
          },
        };
      }

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
          leadDate: internalReminder
            ? undefined
            : (extracted.leadDate ?? action.payload.leadDate),
          nextAction:
            nextActionOverride ??
            extracted.nextAction ??
            action.payload.nextAction,
          status: internalReminder
            ? "contacted"
            : (inferredStatus ?? extracted.status ?? action.payload.status),
          notes: extracted.notes
            ? [extracted.notes, `Commande NAIA: ${command}`].join("\n")
            : action.payload.notes,
        }),
      };
    }),
    response: hasCalendarAction
      ? "Salma prend le relais CRM et Adam prépare le calendrier. J'ai pré-rempli le lead; valide-le pour l'écrire en meeting booked dans le pipeline et laisser Adam vérifier Google Calendar avant de créer l'événement."
      : hasReminderAction
        ? "Salma a pré-rempli la fiche du lead et Adam a préparé un rappel personnel distinct. Vérifie les champs du lead, puis valide séparément la création CRM et le rappel Google Calendar."
        : "Salma prend le relais CRM. J'ai pré-rempli le formulaire du lead avec l'extraction IA. Vérifie les champs, puis clique sur \"Valider et créer le lead\" pour l'écrire dans le pipeline.",
  };
}

async function extractLeadDraft(
  command: string,
): Promise<Partial<CrmLeadDraft>> {
  const deterministic = extractLeadDraftLocally(command);
  const extracted = await extractLeadFromNaturalTextAction(command);
  if (extracted.success && extracted.extracted?.topic) {
    return {
      ...deterministic,
      companyName: extracted.extracted.companyName,
      contactEmail: extracted.extracted.contactEmail,
      contactJobTitle: extracted.extracted.contactJobTitle,
      contactLinkedinUrl: extracted.extracted.contactLinkedinUrl,
      contactName: extracted.extracted.contactName,
      contactPhone: extracted.extracted.contactPhone,
      leadDate: extracted.extracted.leadDate,
      nextAction: extracted.extracted.nextAction,
      notes: extracted.extracted.notes,
      source: extracted.extracted.source ?? "NAIA",
      status: extracted.extracted.status ?? "lead-to-contact",
      topic: extracted.extracted.topic,
      tags: extracted.extracted.tags,
      ...preferDeterministicIdentity(deterministic),
    };
  }

  return deterministic;
}

function extractLeadDraftLocally(command: string): Partial<CrmLeadDraft> {
  const clean = canonicalizeConversationText(command)
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
  const sharedIdentity = extractLeadIdentity(clean);

  if (sharedIdentity.companyName && sharedIdentity.contactName) {
    return {
      ...sharedIdentity,
      nextAction: isMeetingCommand
        ? "Preparer le meeting et confirmer le contexte avec le contact"
        : "Qualifier le besoin et confirmer le prochain rendez-vous",
      notes: `Commande NAIA: ${clean}`,
      source: "NAIA",
      status: isMeetingCommand ? "meeting-booked" : "contacted",
      topic: `${sharedIdentity.companyName} - nouveau lead`,
    };
  }

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

function preferDeterministicIdentity(
  draft: Partial<CrmLeadDraft>,
): Partial<CrmLeadDraft> {
  const identity = {
    companyName: draft.companyName,
    contactEmail: draft.contactEmail,
    contactJobTitle: draft.contactJobTitle,
    contactLinkedinUrl: draft.contactLinkedinUrl,
    contactName: draft.contactName,
    contactPhone: draft.contactPhone,
  };

  return Object.fromEntries(
    Object.entries(identity).filter(
      ([, value]) => typeof value === "string" && value.trim(),
    ),
  );
}

function sanitizeLeadDraft(input: Partial<CrmLeadDraft>): CrmLeadDraft {
  const status = coerceStatus(input.status ?? "") ?? "lead-to-contact";

  return {
    companyName: cleanOptional(input.companyName, 120),
    contactEmail: cleanOptional(input.contactEmail, 160),
    contactJobTitle: cleanOptional(input.contactJobTitle, 160),
    contactLinkedinUrl: cleanOptional(input.contactLinkedinUrl, 300),
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
    tags: normalizeLeadTags(input.tags),
  };
}

function normalizeLeadTags(tags: unknown) {
  const rawTags = Array.isArray(tags)
    ? tags
    : typeof tags === "string"
      ? [tags]
      : [];
  const seen = new Set<string>();

  return rawTags
    .filter((tag): tag is string => typeof tag === "string")
    .flatMap((tag) => tag.split(/[,;]+/))
    .map((tag) => tag.trim().slice(0, 60))
    .filter((tag) => {
      if (!tag) return false;
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

function buildLeadNotes(leadDraft: CrmLeadDraft) {
  return (
    [
      leadDraft.companyName && `Entreprise: ${leadDraft.companyName}`,
      leadDraft.contactName && `Contact: ${leadDraft.contactName}`,
      leadDraft.contactJobTitle && `Fonction: ${leadDraft.contactJobTitle}`,
      leadDraft.contactEmail && `Email: ${leadDraft.contactEmail}`,
      leadDraft.contactPhone && `Tel: ${leadDraft.contactPhone}`,
      leadDraft.notes,
    ]
      .filter(Boolean)
      .join("\n") || undefined
  );
}

function isInternalReminderCommand(command: string) {
  return (
    /\b(pour me rappeler|me rappeler de|me rappeler d|reminder)\b/i.test(
      command,
    ) && /\b(meeting|rdv|rendez[- ]vous|agenda)\b/i.test(command)
  );
}

function inferLeadNextAction(command: string) {
  if (
    /\b(envoyer une présentation|envoyer la présentation|lui envoyer une présentation|lui envoyer la présentation|send a presentation|send the presentation)\b/i.test(
      command,
    )
  ) {
    return "Envoyer la présentation avant le rendez-vous";
  }

  return undefined;
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
  return typeof command === "string"
    ? canonicalizeConversationText(command).slice(0, 2000)
    : "";
}

function parseHistory(history: unknown): NaiaConversationMessage[] {
  if (!Array.isArray(history)) return [];

  return history
    .flatMap((message) => {
      if (!message || typeof message !== "object") return [];
      const candidate = message as { content?: unknown; role?: unknown };
      if (
        (candidate.role !== "assistant" && candidate.role !== "user") ||
        typeof candidate.content !== "string"
      ) {
        return [];
      }
      const content = canonicalizeConversationText(candidate.content).slice(
        0,
        1200,
      );
      const role: NaiaConversationMessage["role"] = candidate.role;
      return content ? [{ content, role }] : [];
    })
    .slice(-8);
}
