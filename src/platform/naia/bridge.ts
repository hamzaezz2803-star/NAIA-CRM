import "server-only";

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createLeadAction,
  extractLeadFromNaturalTextAction,
  type CrmActionContext,
} from "@/features/crm/actions";
import {
  crmLeadStatuses,
  type CrmLeadDraft,
  type CrmLeadStatus,
  type CrmLeadSummary,
} from "@/features/crm/contracts";
import {
  inferCrmStatus,
  type NaiaActionDraft,
} from "@/features/naia/orchestrator";
import {
  canonicalizeConversationText,
  extractLeadIdentity,
  inferReminderDate,
} from "@/features/naia/lead-understanding";
import { createServiceRoleSupabaseClient } from "@/platform/auth/supabase-server";
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
import {
  signAction,
  verifyApprovalToken,
  type SignedNaiaAction,
} from "@/platform/naia/action-tokens";
import {
  planNaiaAssistant,
  type NaiaConversationMessage,
  type NaiaAssistantMode,
} from "@/platform/naia/assistant";

// Channel-agnostic NAIA bridge for conversational surfaces (Slack today).
// It reuses the same pure orchestrator and the same HMAC approval tokens as
// the web cockpit, but resolves the acting user by email through the
// service-role Supabase client instead of a cookie session. Every execution
// re-verifies the approval token (which embeds the approved action), claims
// it as single-use, and checks the caller's role before writing.

// Slack commands are truncated before planning so the inline button value
// (approval token + command) always fits Slack's 2000-character limit. The
// token's commandHash is computed on the same truncated string, so
// verification stays consistent. Long dictated notes are therefore truncated
// on the Slack channel; the web cockpit keeps the full 2000-character budget,
// and channels that store drafts server-side (WhatsApp) pass their own
// maxLength to planBridgeCommand instead of inheriting the Slack constraint.
export const SLACK_COMMAND_MAX_LENGTH = 500;

export type NaiaBridgeUser = {
  email: string;
  fullName: string | null;
  organizationId: string;
  profileId: string;
  role: OrganizationRole;
};

export type NaiaBridgePlan = {
  actions: SignedNaiaAction[];
  agentName: string;
  command: string;
  mode: NaiaAssistantMode;
  response: string;
  responseType: "action" | "answer" | "handoff";
};

export type NaiaBridgeExecution = {
  details?: string[];
  message: string;
  success: boolean;
};

const organizationRoles: readonly OrganizationRole[] = [
  "owner",
  "admin",
  "member",
  "viewer",
];

export async function resolveBridgeUser(
  email: string,
): Promise<NaiaBridgeUser | null> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return null;

  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id,email,full_name")
    // Case-insensitive exact match; escape the ilike wildcards so an email
    // can never widen into a pattern.
    .ilike("email", normalizedEmail.replace(/([%_\\])/g, "\\$1"))
    .limit(1)
    .maybeSingle();

  if (!profile?.id) return null;

  const { data: membership } = await supabase
    .from("organization_memberships")
    .select("organization_id,role")
    .eq("profile_id", profile.id)
    .limit(1)
    .maybeSingle();

  const role = membership?.role as OrganizationRole | undefined;
  if (
    !membership?.organization_id ||
    !role ||
    !organizationRoles.includes(role)
  ) {
    return null;
  }

  return {
    email: profile.email,
    fullName: profile.full_name ?? null,
    organizationId: membership.organization_id,
    profileId: profile.id,
    role,
  };
}

export async function planBridgeCommand(
  user: NaiaBridgeUser,
  command: string,
  maxLength = SLACK_COMMAND_MAX_LENGTH,
  history: NaiaConversationMessage[] = [],
  { allowPersonalData = true }: { allowPersonalData?: boolean } = {},
): Promise<NaiaBridgePlan> {
  // The commandHash inside the approval tokens is computed on this same
  // truncated string, so HMAC verification stays consistent per channel.
  const cleanCommand = normalizeBridgeCommand(command).slice(0, maxLength);
  const crmLeads = await fetchBridgeLeads(user);
  const supabase = createServiceRoleSupabaseClient();
  const { mode, result } = await planNaiaAssistant({
    actor: {
      email: user.email,
      name: user.fullName || user.email.split("@")[0],
      role: user.role,
    },
    allowPersonalData,
    command: cleanCommand,
    crmLeads,
    googleContext: supabase
      ? {
          organizationId: user.organizationId,
          profileId: user.profileId,
          supabase,
        }
      : undefined,
    history,
  });
  const actions = await prepareBridgeActions(cleanCommand, result.actions);

  return {
    actions: actions.map((action) =>
      signAction(action, cleanCommand, {
        actorProfileId: user.profileId,
        organizationId: user.organizationId,
      }),
    ),
    agentName: result.agent.name,
    command: cleanCommand,
    mode,
    response: buildBridgeResponse(result.response, result.actions, actions),
    responseType: result.responseType,
  };
}

export async function executeBridgeAction(
  user: NaiaBridgeUser,
  {
    actionId,
    approvalToken,
    command,
  }: {
    actionId: string;
    approvalToken: string;
    command: string;
  },
): Promise<NaiaBridgeExecution> {
  // The token is the source of truth: it embeds the exact action the user
  // approved, so execution runs the decoded action, never a re-derived one.
  const action = verifyApprovalToken(approvalToken, actionId, command, {
    actorProfileId: user.profileId,
    organizationId: user.organizationId,
  });
  if (!action) {
    return {
      message:
        "Jeton d'approbation invalide ou expiré (5 min). Renvoie ta commande à NAIA pour régénérer l'action.",
      success: false,
    };
  }

  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) {
    return {
      message: "Supabase service role non configuré côté serveur.",
      success: false,
    };
  }

  if (action.kind === "crm.updateLeadStatus") {
    const status = coerceStatus(action.payload.status);
    if (!status) {
      return { message: "Statut CRM invalide.", success: false };
    }

    return executeBridgeLeadStatusAction({
      action,
      approvalToken,
      status,
      supabase,
      user,
    });
  }

  // Single-use claim BEFORE any side effect: the first click inserts the
  // token hash, any concurrent or repeated click fails on the primary key.
  const claim = await claimApprovalToken(supabase, approvalToken, user);
  if (!claim.claimed) {
    return { message: claim.message, success: false };
  }

  const executionUser = claim.user;
  const crmContext: CrmActionContext = {
    actorProfileId: executionUser.profileId,
    organizationId: executionUser.organizationId,
    supabase,
  };
  const googleContext = {
    organizationId: executionUser.organizationId,
    profileId: executionUser.profileId,
    supabase,
  };

  if (action.kind === "google.calendar.listEvents") {
    try {
      const events = await listGoogleCalendarEvents(
        action.payload,
        googleContext,
      );

      return {
        details: events.map(
          (event) =>
            `• ${event.title}${event.start ? ` — ${formatDateForSlack(event.start)}` : ""}`,
        ),
        message:
          events.length > 0
            ? `Adam a lu ${events.length} evenement(s) Google Calendar.`
            : "Adam n'a trouvé aucun événement dans la fenêtre demandée.",
        success: true,
      };
    } catch (error) {
      return {
        message:
          error instanceof Error
            ? error.message
            : "Lecture Google Calendar impossible.",
        success: false,
      };
    }
  }

  if (action.kind === "google.gmail.listMessages") {
    try {
      const messages = await listGmailMessages(action.payload, googleContext);

      return {
        details: messages.map(
          (message) =>
            `• ${message.from ?? "Expéditeur inconnu"} — ${message.subject ?? "(sans objet)"}`,
        ),
        message:
          messages.length > 0
            ? `Lina a lu ${messages.length} message(s) Gmail autorise(s).`
            : "Lina n'a trouvé aucun message Gmail correspondant.",
        success: true,
      };
    } catch (error) {
      return {
        message:
          error instanceof Error ? error.message : "Lecture Gmail impossible.",
        success: false,
      };
    }
  }

  if (action.kind === "crm.createLead") {
    return executeClaimedCrmCreateAction({
      action,
      crmContext,
      executionUser,
    });
  }

  if (action.kind === "calendar.scheduleMeeting") {
    return {
      message:
        "Adam passera par le lead CRM validé pour vérifier Google Calendar et créer l'événement. Valide d'abord l'action Salma si le lead n'existe pas encore.",
      success: true,
    };
  }

  if (action.kind === "calendar.createReminder") {
    if (!action.payload.scheduledAt) {
      return {
        message:
          "Adam a besoin d'une date et d'une heure précises pour créer ce rappel.",
        success: false,
      };
    }

    try {
      const reminder = await createGoogleCalendarReminder(
        {
          scheduledAt: action.payload.scheduledAt,
          timeZone: action.payload.timeZone,
          title: action.payload.title,
        },
        googleContext,
      );
      return {
        details: reminder.htmlLink ? [reminder.htmlLink] : undefined,
        message: "Adam a créé le rappel Google Calendar.",
        success: true,
      };
    } catch (error) {
      return {
        message:
          error instanceof Error
            ? error.message
            : "Création du rappel Google Calendar impossible.",
        success: false,
      };
    }
  }

  return {
    message:
      "Cette action se valide depuis le cockpit web NAIA: https://os.qarizmi.com/naia",
    success: false,
  };
}

/**
 * Executes a Slack-edited lead with the original approval token. The modal
 * payload is covered by Slack's verified request signature, while the
 * original HMAC token binds the capability, actor and organization. Claiming
 * that original token before execution makes every modal copy and concurrent
 * resubmission contend on the same database primary key; no derived token is
 * minted, so editing cannot manufacture additional single-use approvals.
 */
export async function executeEditedBridgeLeadAction(
  user: NaiaBridgeUser,
  originalDraft: {
    actionId: string;
    approvalToken: string;
    command: string;
  },
  editedDraft: CrmLeadDraft,
): Promise<NaiaBridgeExecution> {
  const originalAction = verifyApprovalToken(
    originalDraft.approvalToken,
    originalDraft.actionId,
    originalDraft.command,
    {
      actorProfileId: user.profileId,
      organizationId: user.organizationId,
    },
  );
  if (originalAction?.kind !== "crm.createLead") {
    return {
      message:
        "Jeton d'approbation invalide ou expiré (5 min). Renvoie ta commande à NAIA pour régénérer l'action.",
      success: false,
    };
  }

  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) {
    return {
      message: "Supabase service role non configuré côté serveur.",
      success: false,
    };
  }

  const claim = await claimApprovalToken(
    supabase,
    originalDraft.approvalToken,
    user,
  );
  if (!claim.claimed) {
    return { message: claim.message, success: false };
  }

  const executionUser = claim.user;
  return executeClaimedCrmCreateAction({
    action: { ...originalAction, payload: editedDraft },
    crmContext: {
      actorProfileId: executionUser.profileId,
      organizationId: executionUser.organizationId,
      supabase,
    },
    executionUser,
  });
}

async function executeClaimedCrmCreateAction({
  action,
  crmContext,
  executionUser,
}: {
  action: Extract<NaiaActionDraft, { kind: "crm.createLead" }>;
  crmContext: CrmActionContext;
  executionUser: NaiaBridgeUser;
}): Promise<NaiaBridgeExecution> {
  const denied = requireCrmPermission(executionUser, "create");
  if (denied) return denied;

  const draft = action.payload;
  const status = coerceStatus(draft.status) ?? "lead-to-contact";
  const topic = (draft.topic ?? "").trim().slice(0, 160);
  if (topic.length < 3) {
    return { message: "Brouillon de lead CRM invalide.", success: false };
  }

  const response = await createLeadAction(
    {
      companyName: draft.companyName,
      contactEmail: draft.contactEmail,
      contactJobTitle: draft.contactJobTitle,
      contactLinkedinUrl: draft.contactLinkedinUrl,
      contactName: draft.contactName,
      contactPhone: draft.contactPhone,
      leadDate: draft.leadDate,
      nextAction: draft.nextAction?.slice(0, 280),
      notes: draft.notes,
      source: draft.source || "NAIA",
      status,
      tagNames: draft.tags,
      topic,
    },
    crmContext,
  );

  const calendarNote =
    response.success && draft.leadDate
      ? response.calendarSynced
        ? response.calendarLink
          ? ` Adam a créé l'événement Calendar: ${response.calendarLink}`
          : " Adam a vérifié Google Calendar."
        : ` Adam n'a pas pu créer l'événement Calendar: ${response.calendarError ?? "connexion Google à vérifier"}`
      : "";

  return {
    message: response.success
      ? `Lead CRM créé: "${topic}".${calendarNote}`
      : (response.error ?? "Création du lead impossible."),
    success: response.success,
  };
}

async function claimApprovalToken(
  supabase: SupabaseClient,
  approvalToken: string,
  user: NaiaBridgeUser,
): Promise<
  { claimed: true; user: NaiaBridgeUser } | { claimed: false; message: string }
> {
  const tokenHash = createHash("sha256").update(approvalToken).digest("hex");

  // This RPC re-reads auth.users, membership role, organization, and the
  // optional CRM lead's current scope/archived state in the same transaction
  // that claims the token. Service-role execution therefore never trusts the
  // actor or CRM snapshot captured during planning.
  const { data, error } = await supabase.rpc("claim_crm_bridge_action", {
    requested_actor_email: user.email,
    requested_actor_profile_id: user.profileId,
    requested_crm_lead_id: null,
    requested_organization_id: user.organizationId,
    requested_token_hash: tokenHash,
  });

  const claimRow = Array.isArray(data) ? data[0] : data;
  const freshRole = claimRow?.actor_role as OrganizationRole | undefined;

  if (!error && freshRole && organizationRoles.includes(freshRole)) {
    return { claimed: true, user: { ...user, role: freshRole } };
  }

  if (error?.code === "23505") {
    return { claimed: false, message: "Cette action a déjà été validée." };
  }

  // Fail closed: stale identity, membership, confidentiality, archive state,
  // or an unavailable claim ledger all prevent execution.
  console.error("NAIA bridge approval token validation/claim failed:", error);
  return {
    claimed: false,
    message:
      "Validation impossible pour le moment (enregistrement du jeton). Réessaie dans un instant.",
  };
}

async function executeBridgeLeadStatusAction({
  action,
  approvalToken,
  status,
  supabase,
  user,
}: {
  action: Extract<NaiaActionDraft, { kind: "crm.updateLeadStatus" }>;
  approvalToken: string;
  status: CrmLeadStatus;
  supabase: SupabaseClient;
  user: NaiaBridgeUser;
}): Promise<NaiaBridgeExecution> {
  const tokenHash = createHash("sha256").update(approvalToken).digest("hex");
  const { data, error } = await supabase.rpc(
    "execute_crm_bridge_lead_status_action",
    {
      requested_actor_email: user.email,
      requested_actor_profile_id: user.profileId,
      requested_crm_lead_id: action.payload.leadId,
      requested_organization_id: user.organizationId,
      requested_status: status,
      requested_token_hash: tokenHash,
    },
  );

  if (!error && data) {
    return {
      message: `Statut CRM appliqué pour "${action.payload.leadLabel}".`,
      success: true,
    };
  }

  if (error?.code === "23505") {
    return { message: "Cette action a déjà été validée.", success: false };
  }

  console.error("NAIA bridge atomic CRM status execution failed:", error);
  return {
    message:
      "Action CRM refusée : le compte, le rôle, le périmètre ou le lead a changé depuis la préparation.",
    success: false,
  };
}

function requireCrmPermission(
  user: NaiaBridgeUser,
  permissionAction: PermissionAction,
): NaiaBridgeExecution | null {
  if (hasPermission(user.role, { action: permissionAction, module: "crm" })) {
    return null;
  }

  return {
    message: `Ton rôle (${user.role}) ne permet pas cette action CRM.`,
    success: false,
  };
}

async function fetchBridgeLeads(
  user: NaiaBridgeUser,
): Promise<CrmLeadSummary[]> {
  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) return [];

  // Service-role clients bypass RLS. Re-check the actor against the exact
  // auth.users cofounder allowlist before permitting confidential rows. Any
  // missing migration/RPC/error fails closed to an empty CRM context.
  const { data: isCofounder, error: cofounderError } = await supabase.rpc(
    "crm_bridge_actor_is_cofounder",
    {
      target_organization_id: user.organizationId,
      target_profile_id: user.profileId,
    },
  );
  if (cofounderError) {
    console.error(
      "NAIA bridge CRM confidentiality check failed:",
      cofounderError,
    );
    return [];
  }

  let query = supabase
    .from("crm_leads")
    .select(
      `id,organization_id,topic,source,status,notes,next_action,lead_date,next_action_date,created_at,updated_at,
      company:company_id(id,organization_id,name,access_scope,archived_at),
      contact:contact_id(id,organization_id,name,email,phone,access_scope,archived_at)`,
    )
    .eq("organization_id", user.organizationId)
    .is("archived_at", null)
    .eq("company.organization_id", user.organizationId)
    .is("company.archived_at", null)
    .eq("contact.organization_id", user.organizationId)
    .is("contact.archived_at", null);

  if (isCofounder !== true) {
    query = query
      .eq("access_scope", "organization")
      .eq("company.access_scope", "organization")
      .eq("contact.access_scope", "organization");
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(100);

  if (error || !data) return [];

  type BridgeLeadRow = {
    company: {
      access_scope: "cofounders" | "organization";
      archived_at: string | null;
      id: string;
      name: string;
      organization_id: string;
    } | null;
    contact: {
      access_scope: "cofounders" | "organization";
      archived_at: string | null;
      email: string | null;
      id: string;
      name: string;
      organization_id: string;
      phone: string | null;
    } | null;
    created_at: string;
    id: string;
    lead_date: string | null;
    next_action: string | null;
    next_action_date: string | null;
    notes: string | null;
    organization_id: string;
    source: string | null;
    status: CrmLeadStatus;
    topic: string;
    updated_at: string;
  };

  return (data as unknown as BridgeLeadRow[]).map((row) => {
    const company = isVisibleBridgeRelation(
      row.company,
      user.organizationId,
      isCofounder === true,
    )
      ? row.company
      : null;
    const contact = isVisibleBridgeRelation(
      row.contact,
      user.organizationId,
      isCofounder === true,
    )
      ? row.contact
      : null;

    return {
      companyId: company?.id ?? undefined,
      companyName: company?.name ?? undefined,
      contactEmail: contact?.email ?? undefined,
      contactId: contact?.id ?? undefined,
      contactName: contact?.name ?? undefined,
      contactPhone: contact?.phone ?? undefined,
      createdAt: row.created_at,
      id: row.id,
      leadDate: row.lead_date ?? row.next_action_date ?? undefined,
      nextAction: row.next_action ?? undefined,
      notes: row.notes ?? undefined,
      organizationId: row.organization_id,
      source: row.source ?? undefined,
      status: row.status,
      topic: row.topic,
      updatedAt: row.updated_at,
    };
  });
}

function isVisibleBridgeRelation(
  relation: {
    access_scope: "cofounders" | "organization";
    archived_at: string | null;
    organization_id: string;
  } | null,
  organizationId: string,
  isCofounder: boolean,
) {
  return Boolean(
    relation &&
    relation.organization_id === organizationId &&
    relation.archived_at === null &&
    (isCofounder || relation.access_scope === "organization"),
  );
}

function coerceStatus(status: string): CrmLeadStatus | null {
  return (crmLeadStatuses as readonly string[]).includes(status)
    ? status
    : null;
}

async function prepareBridgeActions(
  command: string,
  actions: NaiaActionDraft[],
): Promise<NaiaActionDraft[]> {
  if (!actions.some((action) => action.kind === "crm.createLead")) {
    return actions;
  }

  const extracted = await extractLeadDraft(command);
  const reminderDate = extracted.leadDate ?? inferReminderDate(command);
  const hydratedActions = actions.map((action) => {
    if (action.kind === "calendar.createReminder") {
      return {
        ...action,
        payload: {
          ...action.payload,
          scheduledAt: reminderDate ?? action.payload.scheduledAt,
        },
      } satisfies NaiaActionDraft;
    }

    if (action.kind !== "crm.createLead") return action;

    return {
      ...action,
      description:
        "Salma a pré-rempli le lead CRM depuis l'extraction IA avant validation Slack.",
      payload: hydrateLeadDraft(command, action.payload, extracted),
    } satisfies NaiaActionDraft;
  });

  // On bridge channels, the lead validation itself triggers Calendar sync when
  // leadDate is present. Keeping the separate schedule card would look
  // executable while it is only informational in the web cockpit.
  return hydratedActions.filter(
    (action) =>
      !(
        action.kind === "calendar.scheduleMeeting" &&
        hydratedActions.some((candidate) => candidate.kind === "crm.createLead")
      ),
  );
}

function buildBridgeResponse(
  response: string,
  originalActions: NaiaActionDraft[],
  preparedActions: NaiaActionDraft[],
) {
  const collapsedCalendar =
    originalActions.some(
      (action) => action.kind === "calendar.scheduleMeeting",
    ) &&
    preparedActions.some((action) => action.kind === "crm.createLead") &&
    !preparedActions.some(
      (action) => action.kind === "calendar.scheduleMeeting",
    );

  if (!collapsedCalendar) return response;

  return "Salma prend le relais CRM avec Adam en support calendrier. J'ai préparé l'action \"Créer le lead CRM\": le lead sera créé en meeting booked, puis Adam vérifiera Google Calendar et créera l'événement pendant cette validation si le créneau est libre.";
}

async function extractLeadDraft(
  command: string,
): Promise<Partial<CrmLeadDraft>> {
  const deterministic = extractLeadDraftLocally(command);

  try {
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
  } catch {
    // Fall through to deterministic extraction: Slack should still create a
    // usable lead when Groq is temporarily unavailable.
  }

  return deterministic;
}

function hydrateLeadDraft(
  command: string,
  base: CrmLeadDraft,
  extracted: Partial<CrmLeadDraft>,
): CrmLeadDraft {
  const internalReminder = isInternalReminderCommand(command);
  const status = internalReminder
    ? "contacted"
    : (coerceStatus(inferCrmStatus(command) ?? "") ??
      coerceStatus(extracted.status ?? "") ??
      coerceStatus(base.status) ??
      "lead-to-contact");
  const merged = sanitizeLeadDraft({
    ...base,
    ...extracted,
    leadDate: internalReminder
      ? undefined
      : (extracted.leadDate ?? base.leadDate),
    nextAction:
      inferBridgeNextAction(command) ?? extracted.nextAction ?? base.nextAction,
    source: extracted.source ?? base.source ?? "NAIA",
    status,
  });

  return {
    ...merged,
    notes: buildLeadNotes(command, base.notes, extracted.notes, merged),
  };
}

function extractLeadDraftLocally(command: string): Partial<CrmLeadDraft> {
  const clean = normalizeBridgeCommand(command)
    .replace(/^(un\s+|une\s+)?(nouveau|nouvelle)\s+lead\s*[:,;-]?\s*/i, "")
    .trim()
    .replace(/[.!?]$/g, "");
  const contactEmail = extractEmail(command);
  const contactPhone = extractPhone(command);
  const isMeetingCommand =
    /\b(meeting|rdv|rendez[- ]vous|call|demo|démo|visio|reunion|réunion)\b/i.test(
      clean,
    );
  const isInternalReminder =
    /\b(pour me rappeler|me rappeler de|me rappeler d|reminder)\b/i.test(
      clean,
    ) && isMeetingCommand;
  const nextAction = inferLocalNextAction(clean, isMeetingCommand);
  const sharedIdentity = extractLeadIdentity(clean);

  if (sharedIdentity.companyName && sharedIdentity.contactName) {
    return {
      ...sharedIdentity,
      nextAction,
      notes: clean,
      source: "NAIA",
      status: isInternalReminder
        ? "contacted"
        : isMeetingCommand
          ? "meeting-booked"
          : "contacted",
      topic: `${sharedIdentity.companyName} - nouveau lead`,
    };
  }

  const businessCardMatch = clean.match(
    /\b(?:lead|prospect)\s*:?\s*(.+?)\s+(?:directeur|directrice|ceo|cto|cfo|coo|dg|fondateur|fondatrice|founder|responsable|manager|head)\b.+?\s+(?:de|chez)\s+([^,.;\d-]+?)(?=\s+(?:\+?\d|0\d)|\s*[-,;.]|$)/i,
  );

  if (businessCardMatch) {
    const contactName = businessCardMatch[1].trim();
    const companyName = businessCardMatch[2].trim();

    return {
      companyName,
      contactEmail,
      contactName,
      contactPhone,
      nextAction,
      notes: clean,
      source: "NAIA",
      status: isInternalReminder
        ? "contacted"
        : isMeetingCommand
          ? "meeting-booked"
          : "contacted",
      topic: `${companyName} - nouveau lead`,
    };
  }

  const prospectMatch =
    clean.match(
      /\b(?:parle|parlé|contacte|contacté|appele|appelé|echange|échangé|discute|discuté)\s+(?:(?:a|à|avec)\s+)?(.+?)\s+(?:de|chez)\s+([^,.;]+?)(?=\s+(?:et|qui|il|elle|pour|afin|and|with)\b|[,.;]|$)/i,
    ) ??
    clean.match(
      /\b(?:talked|spoke|contacted|called|discussed|exchanged|met)\s+(?:to|with)?\s*(.+?)\s+(?:from|at|with)\s+([^,.;]+?)(?=\s+(?:and|who|they|he|she|to|for|with|would|will|have|has)\b|[,.;]|$)/i,
    );

  if (prospectMatch) {
    const contactName = prospectMatch[1].trim();
    const companyName = prospectMatch[2].trim();

    return {
      companyName,
      contactEmail,
      contactName,
      contactPhone,
      nextAction,
      notes: clean,
      source: "NAIA",
      status: isInternalReminder
        ? "contacted"
        : isMeetingCommand
          ? "meeting-booked"
          : "contacted",
      topic: `${companyName} - nouveau lead`,
    };
  }

  const companyFirstMatch = clean.match(
    /\b(?:pour|chez)\s+([^,.;]+?)\s+(?:avec|contact(?:\s+principal)?|pour contact)\s+([^,.;]+?)(?=\s+(?:meeting|rdv|rendez[- ]vous|call|demo|démo|visio|reunion|réunion|et|qui|il|elle)\b|[,.;]|$)/i,
  );

  if (companyFirstMatch) {
    const companyName = companyFirstMatch[1].trim();
    const contactName = companyFirstMatch[2].trim();

    return {
      companyName,
      contactEmail,
      contactName,
      contactPhone,
      nextAction,
      notes: clean,
      source: "NAIA",
      status: isInternalReminder
        ? "contacted"
        : isMeetingCommand
          ? "meeting-booked"
          : "lead-to-contact",
      topic: `${companyName} - nouveau lead`,
    };
  }

  return {
    contactEmail,
    contactPhone,
    nextAction,
    notes: clean,
    source: "NAIA",
    status: isInternalReminder
      ? "contacted"
      : isMeetingCommand
        ? "meeting-booked"
        : "lead-to-contact",
    topic: clean.slice(0, 160) || "Nouveau lead NAIA",
  };
}

function inferLocalNextAction(cleanCommand: string, isMeetingCommand: boolean) {
  const bridgeNextAction = inferBridgeNextAction(cleanCommand);
  if (bridgeNextAction) return bridgeNextAction;

  return isMeetingCommand
    ? "Préparer le meeting et confirmer le contexte avec le contact"
    : "Qualifier le besoin et confirmer le prochain rendez-vous";
}

function inferBridgeNextAction(command: string) {
  if (
    /\b(envoyer une présentation|envoyer la présentation|lui envoyer une présentation|lui envoyer la présentation|send a presentation|send the presentation)\b/i.test(
      command,
    )
  ) {
    return "Envoyer la présentation avant le rendez-vous";
  }

  return undefined;
}

function sanitizeLeadDraft(input: Partial<CrmLeadDraft>): CrmLeadDraft {
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
    status: coerceStatus(input.status ?? "") ?? "lead-to-contact",
    topic: cleanRequired(input.topic, "Nouveau lead NAIA", 160),
    tags: Array.isArray(input.tags) ? input.tags.slice(0, 12) : undefined,
  };
}

function buildLeadNotes(
  command: string,
  baseNotes: string | undefined,
  extractedNotes: string | undefined,
  draft: CrmLeadDraft,
) {
  const cleanCommand = normalizeBridgeCommand(command);
  const notes = normalizeBridgeCommand(extractedNotes ?? baseNotes ?? "");
  const parts = [
    draft.companyName && `Entreprise: ${draft.companyName}`,
    draft.contactName && `Contact: ${draft.contactName}`,
    draft.contactJobTitle && `Fonction: ${draft.contactJobTitle}`,
    draft.contactEmail && `Email: ${draft.contactEmail}`,
    draft.contactPhone && `Téléphone: ${draft.contactPhone}`,
    notes,
    cleanCommand && `Commande NAIA: ${cleanCommand}`,
  ].filter((part): part is string => Boolean(part && part.trim()));

  const seen = new Set<string>();
  return parts
    .filter((part) => {
      const key = part.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join("\n")
    .slice(0, 1200);
}

function normalizeBridgeCommand(value: string | undefined) {
  return canonicalizeConversationText(value ?? "")
    .replace(/^@?naia\b[:,\s-]*/i, "")
    .replace(/^<@[^>]+>\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
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

function isInternalReminderCommand(command: string) {
  const clean = normalizeBridgeCommand(command);

  return (
    /\b(pour me rappeler|me rappeler de|me rappeler d|reminder)\b/i.test(
      clean,
    ) && /\b(meeting|rdv|rendez[- ]vous|agenda)\b/i.test(clean)
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

function extractEmail(value: string) {
  return value.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0];
}

function extractPhone(value: string) {
  return value
    .match(/(?:\+\d{1,3}[\s.-]?)?(?:0\d|\d)[\d\s.-]{7,}\d/)?.[0]
    ?.replace(/\s+/g, "")
    .trim();
}

function formatDateForSlack(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle: value.includes("T") ? "short" : undefined,
    timeZone: "Africa/Casablanca",
  });
}
