import "server-only";

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createLeadAction,
  updateLeadStatusAction,
  type CrmActionContext,
} from "@/features/crm/actions";
import {
  crmLeadStatuses,
  type CrmLeadStatus,
  type CrmLeadSummary,
} from "@/features/crm/contracts";
import { orchestrateNaiaCommand } from "@/features/naia/orchestrator";
import { createServiceRoleSupabaseClient } from "@/platform/auth/supabase-server";
import {
  hasPermission,
  type OrganizationRole,
  type PermissionAction,
} from "@/platform/core/permissions";
import {
  listGmailMessages,
  listGoogleCalendarEvents,
} from "@/platform/integrations/google-workspace";
import {
  signAction,
  verifyApprovalToken,
  type SignedNaiaAction,
} from "@/platform/naia/action-tokens";

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

const CONSUMED_TOKEN_RETENTION_MS = 10 * 60 * 1000;

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
  response: string;
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
): Promise<NaiaBridgePlan> {
  // The commandHash inside the approval tokens is computed on this same
  // truncated string, so HMAC verification stays consistent per channel.
  const cleanCommand = command.trim().slice(0, maxLength);
  const crmLeads = await fetchBridgeLeads(user.organizationId);
  const result = orchestrateNaiaCommand({ command: cleanCommand, crmLeads });

  return {
    actions: result.actions.map((action) => signAction(action, cleanCommand)),
    agentName: result.agent.name,
    command: cleanCommand,
    response: result.response,
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
  const action = verifyApprovalToken(approvalToken, actionId, command);
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

  // Single-use claim BEFORE any side effect: the first click inserts the
  // token hash, any concurrent or repeated click fails on the primary key.
  const claim = await claimApprovalToken(
    supabase,
    approvalToken,
    user.organizationId,
  );
  if (!claim.claimed) {
    return { message: claim.message, success: false };
  }

  const crmContext: CrmActionContext = {
    actorProfileId: user.profileId,
    organizationId: user.organizationId,
    supabase,
  };
  const googleContext = {
    organizationId: user.organizationId,
    profileId: user.profileId,
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

  if (action.kind === "crm.updateLeadStatus") {
    const denied = requireCrmPermission(user, "update");
    if (denied) return denied;

    const status = coerceStatus(action.payload.status);
    if (!status) {
      return { message: "Statut CRM invalide.", success: false };
    }

    const response = await updateLeadStatusAction(
      action.payload.leadId,
      status,
      crmContext,
    );

    return {
      message: response.success
        ? `Statut CRM appliqué pour "${action.payload.leadLabel}".`
        : (response.error ?? "Action CRM impossible."),
      success: response.success,
    };
  }

  if (action.kind === "crm.createLead") {
    const denied = requireCrmPermission(user, "create");
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
        contactName: draft.contactName,
        contactPhone: draft.contactPhone,
        leadDate: draft.leadDate,
        nextAction: draft.nextAction?.slice(0, 280),
        notes: draft.notes,
        source: draft.source || "NAIA",
        status,
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

  if (action.kind === "calendar.scheduleMeeting") {
    return {
      message:
        "Adam passera par le lead CRM validé pour vérifier Google Calendar et créer l'événement. Valide d'abord l'action Salma si le lead n'existe pas encore.",
      success: true,
    };
  }

  return {
    message:
      "Cette action se valide depuis le cockpit web NAIA: https://os.qarizmi.com/naia",
    success: false,
  };
}

async function claimApprovalToken(
  supabase: SupabaseClient,
  approvalToken: string,
  organizationId: string,
): Promise<{ claimed: true } | { claimed: false; message: string }> {
  const tokenHash = createHash("sha256").update(approvalToken).digest("hex");

  // Opportunistic purge: consumed rows are useless once the 5 minute token
  // TTL has passed; 10 minutes keeps a safety margin for clock skew.
  await supabase
    .from("naia_consumed_action_tokens")
    .delete()
    .lt(
      "consumed_at",
      new Date(Date.now() - CONSUMED_TOKEN_RETENTION_MS).toISOString(),
    );

  const { error } = await supabase.from("naia_consumed_action_tokens").insert({
    organization_id: organizationId,
    token_hash: tokenHash,
  });

  if (!error) {
    return { claimed: true };
  }

  if (error.code === "23505") {
    return { claimed: false, message: "Cette action a déjà été validée." };
  }

  // Fail closed: without a registered claim the action must not run.
  console.error("NAIA bridge approval token claim failed:", error);
  return {
    claimed: false,
    message:
      "Validation impossible pour le moment (enregistrement du jeton). Réessaie dans un instant.",
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
  organizationId: string,
): Promise<CrmLeadSummary[]> {
  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("crm_leads")
    .select(
      `id,organization_id,topic,source,status,notes,next_action,lead_date,next_action_date,created_at,updated_at,
      company:company_id(id,name),
      contact:contact_id(id,name,email,phone)`,
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error || !data) return [];

  type BridgeLeadRow = {
    company: { id: string; name: string } | null;
    contact: {
      email: string | null;
      id: string;
      name: string;
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

  return (data as unknown as BridgeLeadRow[]).map((row) => ({
    companyId: row.company?.id ?? undefined,
    companyName: row.company?.name ?? undefined,
    contactEmail: row.contact?.email ?? undefined,
    contactId: row.contact?.id ?? undefined,
    contactName: row.contact?.name ?? undefined,
    contactPhone: row.contact?.phone ?? undefined,
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
  }));
}

function coerceStatus(status: string): CrmLeadStatus | null {
  return (crmLeadStatuses as readonly string[]).includes(status)
    ? status
    : null;
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
