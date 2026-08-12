import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createServiceRoleSupabaseClient } from "@/platform/auth/supabase-server";
import {
  listGmailThreadMetadata,
  listGoogleCalendarEvents,
  type GoogleCalendarEventSummary,
} from "@/platform/integrations/google-workspace";
import {
  formatGmailTriageReason,
  GMAIL_TRIAGE_CRM_STATUSES,
  GMAIL_TRIAGE_QUERY,
  triageGmailThreads,
  type GmailTriageItem,
} from "@/features/naia/gmail-triage";
import {
  findSlackUserByEmail,
  isSlackMessageRejectedError,
  postSlackMessage,
} from "@/platform/integrations/slack";
import { resolveBridgeUser, type NaiaBridgeUser } from "@/platform/naia/bridge";
import {
  isWhatsAppMessageRejectedError,
  resolveWhatsAppPhone,
  sendWhatsAppTemplate,
  truncateToLimit,
} from "@/platform/naia/whatsapp";

const DEFAULT_RECIPIENT = "ali@qarizmi.com";
const DEFAULT_TIME_ZONE = "Africa/Casablanca";
const COFOUNDER_EMAILS = new Set(["ali@qarizmi.com", "nabil@qarizmi.com"]);
const TERMINAL_CRM_STATUSES = new Set(["won", "dead-end"]);
const DAILY_BRIEF_CRM_STATUSES = GMAIL_TRIAGE_CRM_STATUSES.filter(
  (status) => !TERMINAL_CRM_STATUSES.has(status),
);
const FAST_OPERATION_TIMEOUT_MS = 5_000;
const PROVIDER_OPERATION_TIMEOUT_MS = 12_000;
const DEFAULT_DAILY_BRIEF_CHANNELS = "slack";
const DEFAULT_WHATSAPP_TEMPLATE_NAME = "naia_daily_brief";
const DEFAULT_WHATSAPP_TEMPLATE_LANGUAGE = "fr";

export type DailyBriefChannel = "slack" | "whatsapp";

export type DailyBriefTask = {
  dueAt?: string;
  id: string;
  leadId?: string;
  leadStatus?: string;
  status: string;
  taskKind?: "manual" | "lead-next-action" | "meeting-recommendation";
  title: string;
};

export type DailyBriefLead = {
  companyName?: string;
  contactEmail?: string;
  id: string;
  leadDate?: string;
  nextAction?: string;
  nextActionDate?: string;
  nextActionState?: "pending" | "done";
  status: string;
  topic: string;
};

export type DailyBriefData = {
  calendarEvents: GoogleCalendarEventSummary[];
  gmailCandidates: GmailTriageItem[];
  leads: DailyBriefLead[];
  tasks: DailyBriefTask[];
  warnings: string[];
};

export type DailyBriefMessage = {
  blocks: unknown[];
  text: string;
};

export type DailyBriefDispatchResult = {
  channel: DailyBriefChannel;
  email: string;
  reason?: string;
  status: "failed" | "sent" | "skipped";
};

export type WhatsAppDailyBriefTemplate = {
  bodyParameters: string[];
  languageCode: string;
  name: string;
};

type DailyBriefRunRow = {
  id: string;
};

type CrmTaskRow = {
  due_date: string | null;
  id: string;
  lead: { status: string | null } | null;
  lead_id: string | null;
  status: string;
  task_kind: "manual" | "lead-next-action" | "meeting-recommendation";
  title: string;
};

type CrmLeadRow = {
  company: { name: string | null } | null;
  contact: { email: string | null } | null;
  id: string;
  lead_date: string | null;
  next_action: string | null;
  next_action_date: string | null;
  next_action_state: "pending" | "done";
  status: string;
  topic: string;
};

export function getDailyBriefRecipients(
  value = process.env.NAIA_DAILY_BRIEF_RECIPIENTS,
) {
  const recipients = (value ?? DEFAULT_RECIPIENT)
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  return [...new Set(recipients)];
}

export function getDailyBriefTimeZone() {
  return process.env.NAIA_DAILY_BRIEF_TIME_ZONE?.trim() || DEFAULT_TIME_ZONE;
}

export function getDailyBriefChannels(
  value = process.env.NAIA_DAILY_BRIEF_CHANNELS,
): DailyBriefChannel[] {
  const channels = (value ?? DEFAULT_DAILY_BRIEF_CHANNELS)
    .split(",")
    .map((channel) => channel.trim().toLowerCase())
    .filter(
      (channel): channel is DailyBriefChannel =>
        channel === "slack" || channel === "whatsapp",
    );

  return [
    ...new Set(channels.length > 0 ? channels : ["slack"]),
  ] as DailyBriefChannel[];
}

export function isDailyBriefDispatchWindow(
  now: Date,
  timeZone = getDailyBriefTimeZone(),
) {
  const parts = zonedDateTimeParts(now, timeZone);
  return parts.hour === 9 && parts.minute >= 30 && parts.minute < 45;
}

export async function runConfiguredDailyBriefs({
  now = new Date(),
}: {
  now?: Date;
} = {}): Promise<DailyBriefDispatchResult[]> {
  const timeZone = getDailyBriefTimeZone();
  const deliveries = getDailyBriefRecipients().flatMap((email) =>
    getDailyBriefChannels().map((channel) => ({ channel, email })),
  );
  if (!isDailyBriefDispatchWindow(now, timeZone)) {
    return deliveries.map(({ channel, email }) => ({
      channel,
      email,
      reason: "outside_local_dispatch_window",
      status: "skipped" as const,
    }));
  }

  return Promise.all(
    deliveries.map(async ({ channel, email }) => {
      try {
        return await dispatchDailyBrief({ channel, email, now, timeZone });
      } catch (error) {
        const errorCode = dailyBriefErrorCode(error);
        console.error("NAIA daily brief dispatch could not start:", errorCode);
        return {
          channel,
          email,
          reason: errorCode,
          status: "failed" as const,
        };
      }
    }),
  );
}

export async function dispatchDailyBrief({
  channel = "slack",
  email,
  now,
  timeZone,
}: {
  channel?: DailyBriefChannel;
  email: string;
  now: Date;
  timeZone: string;
}): Promise<DailyBriefDispatchResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await withTimeout(
    resolveBridgeUser(normalizedEmail),
    FAST_OPERATION_TIMEOUT_MS,
    "identity_timeout",
  );
  if (
    !user ||
    user.role !== "owner" ||
    !COFOUNDER_EMAILS.has(normalizedEmail)
  ) {
    return {
      channel,
      email: normalizedEmail,
      reason: "recipient_not_authorized",
      status: "skipped",
    };
  }

  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) {
    return {
      channel,
      email: normalizedEmail,
      reason: "supabase_service_role_unavailable",
      status: "failed",
    };
  }

  const localDate = localDateKey(now, timeZone);
  const claim = await withTimeout(
    claimDailyBriefRun({
      channel,
      localDate,
      supabase,
      user,
    }),
    FAST_OPERATION_TIMEOUT_MS,
    "daily_brief_claim_timeout",
  );
  if (!claim) {
    return {
      channel,
      email: normalizedEmail,
      reason: "already_claimed_for_local_date",
      status: "skipped",
    };
  }

  let deliveryAttempted = false;
  try {
    const [data, slackUser] = await Promise.all([
      loadDailyBriefData({ now, supabase, user }),
      channel === "slack"
        ? withTimeout(
            findSlackUserByEmail(normalizedEmail),
            PROVIDER_OPERATION_TIMEOUT_MS,
            "slack_recipient_lookup_timeout",
          )
        : Promise.resolve(null),
    ]);
    if (channel === "slack" && !slackUser)
      throw new Error("slack_recipient_not_found");

    const displayName =
      user.fullName ?? slackUser?.displayName ?? normalizedEmail;
    const message = buildDailyBriefMessage({
      data,
      displayName,
      now,
      timeZone,
    });
    const whatsappRecipient =
      channel === "whatsapp"
        ? resolveWhatsAppPhone(normalizedEmail)
        : undefined;
    if (channel === "whatsapp" && !whatsappRecipient) {
      throw new Error("whatsapp_recipient_not_found");
    }
    const whatsappTemplate =
      channel === "whatsapp"
        ? buildWhatsAppDailyBriefTemplate({ data, displayName, now, timeZone })
        : undefined;
    const deliveryStartRecorded = await updateDailyBriefRun({
      claimId: claim.id,
      organizationId: user.organizationId,
      supabase,
      values: {
        delivery_started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
    if (!deliveryStartRecorded) {
      throw new Error("daily_brief_delivery_start_ledger_failed");
    }

    deliveryAttempted = true;
    let deliveryReceipt: Record<string, unknown>;
    if (channel === "slack") {
      const posted = await withTimeout(
        postSlackMessage({
          blocks: message.blocks,
          channel: slackUser!.id,
          text: message.text,
        }),
        PROVIDER_OPERATION_TIMEOUT_MS,
        "slack_delivery_timeout",
      );
      deliveryReceipt = {
        slack_channel_id: posted.channel ?? slackUser!.id,
        slack_message_ts: posted.ts ?? null,
      };
    } else {
      const posted = await withTimeout(
        sendWhatsAppTemplate({
          ...whatsappTemplate!,
          to: whatsappRecipient!,
        }),
        PROVIDER_OPERATION_TIMEOUT_MS,
        "whatsapp_delivery_timeout",
      );
      deliveryReceipt = { whatsapp_message_id: posted.messageId };
    }

    const ledgerUpdated = await updateDailyBriefRun({
      claimId: claim.id,
      organizationId: user.organizationId,
      supabase,
      values: {
        error_code: null,
        sent_at: new Date().toISOString(),
        ...deliveryReceipt,
        status: "sent",
        updated_at: new Date().toISOString(),
      },
    });
    if (!ledgerUpdated) {
      console.error("NAIA daily brief sent but its ledger update failed.");
      return {
        channel,
        email: normalizedEmail,
        reason: "daily_brief_sent_ledger_update_failed",
        status: "failed",
      };
    }

    return { channel, email: normalizedEmail, status: "sent" };
  } catch (error) {
    const errorCode = dailyBriefErrorCode(error);
    const retrySafe =
      !deliveryAttempted ||
      (channel === "slack"
        ? isSlackMessageRejectedError(error)
        : isWhatsAppMessageRejectedError(error));
    const ledgerUpdated = await updateDailyBriefRun({
      claimId: claim.id,
      organizationId: user.organizationId,
      supabase,
      values: {
        error_code: errorCode,
        ...(retrySafe ? { delivery_started_at: null } : {}),
        status: retrySafe ? "failed" : "delivery_uncertain",
        updated_at: new Date().toISOString(),
      },
    });
    if (!ledgerUpdated) {
      console.error(
        "NAIA daily brief failed and its ledger update also failed:",
        errorCode,
      );
      return {
        channel,
        email: normalizedEmail,
        reason: "daily_brief_ledger_update_failed",
        status: "failed",
      };
    }

    console.error("NAIA daily brief failed:", errorCode);
    return {
      channel,
      email: normalizedEmail,
      reason: errorCode,
      status: "failed",
    };
  }
}

async function claimDailyBriefRun({
  channel,
  localDate,
  supabase,
  user,
}: {
  channel: DailyBriefChannel;
  localDate: string;
  supabase: SupabaseClient;
  user: NaiaBridgeUser;
}): Promise<DailyBriefRunRow | null> {
  const { data, error } = await supabase
    .from("naia_daily_brief_runs")
    .insert({
      delivery_channel: channel,
      local_date: localDate,
      organization_id: user.organizationId,
      profile_id: user.profileId,
      status: "sending",
    })
    .select("id")
    .single();

  if (!error && data?.id) return data as DailyBriefRunRow;
  if (error?.code === "23505") {
    const { data: reclaimed, error: reclaimError } = await supabase
      .rpc("reclaim_naia_daily_brief_run", {
        p_delivery_channel: channel,
        p_local_date: localDate,
        p_organization_id: user.organizationId,
        p_profile_id: user.profileId,
      })
      .maybeSingle();

    if (reclaimError) throw new Error("daily_brief_reclaim_failed");
    const reclaimedRun = reclaimed as DailyBriefRunRow | null;
    return reclaimedRun?.id ? reclaimedRun : null;
  }
  throw new Error("daily_brief_claim_failed");
}

async function updateDailyBriefRun({
  claimId,
  organizationId,
  supabase,
  values,
}: {
  claimId: string;
  organizationId: string;
  supabase: SupabaseClient;
  values: Record<string, unknown>;
}) {
  try {
    const { error } = await withTimeout(
      supabase
        .from("naia_daily_brief_runs")
        .update(values)
        .eq("id", claimId)
        .eq("organization_id", organizationId),
      FAST_OPERATION_TIMEOUT_MS,
      "daily_brief_ledger_update_timeout",
    );
    return !error;
  } catch {
    return false;
  }
}

export async function loadDailyBriefData({
  now,
  supabase,
  user,
}: {
  now: Date;
  supabase: SupabaseClient;
  user: NaiaBridgeUser;
}): Promise<DailyBriefData> {
  const calendarEnd = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
  const googleContext = {
    organizationId: user.organizationId,
    profileId: user.profileId,
    supabase,
  };
  const warnings: string[] = [];

  const tasksPromise = supabase
    .from("crm_tasks")
    .select("id,title,status,due_date,lead_id,task_kind,lead:lead_id(status)")
    .eq("organization_id", user.organizationId)
    .is("archived_at", null)
    .in("status", ["todo", "in-progress"])
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(100);
  const leadsPromise = supabase
    .from("crm_leads")
    .select(
      "id,topic,status,next_action,next_action_date,next_action_state,lead_date,company:company_id(name),contact:contact_id(email)",
    )
    .eq("organization_id", user.organizationId)
    .is("archived_at", null)
    .in("status", DAILY_BRIEF_CRM_STATUSES)
    .order("lead_date", { ascending: true, nullsFirst: false })
    .limit(1000);
  const calendarPromise = listGoogleCalendarEvents(
    {
      maxResults: 100,
      timeMax: calendarEnd.toISOString(),
      timeMin: now.toISOString(),
    },
    googleContext,
  );
  const gmailPromise = listGmailThreadMetadata(
    {
      maxResults: 100,
      query: GMAIL_TRIAGE_QUERY,
    },
    googleContext,
  );

  const [tasksResult, leadsResult, calendarEvents, gmailThreads] =
    await Promise.all([
      withTimeout(
        tasksPromise,
        PROVIDER_OPERATION_TIMEOUT_MS,
        "crm_tasks_timeout",
      ),
      withTimeout(
        leadsPromise,
        PROVIDER_OPERATION_TIMEOUT_MS,
        "crm_leads_timeout",
      ),
      withTimeout(
        calendarPromise,
        PROVIDER_OPERATION_TIMEOUT_MS,
        "calendar_timeout",
      ).catch(() => {
        warnings.push("calendar_unavailable");
        return [];
      }),
      withTimeout(
        gmailPromise,
        PROVIDER_OPERATION_TIMEOUT_MS,
        "gmail_timeout",
      ).catch(() => {
        warnings.push("gmail_unavailable");
        return [];
      }),
    ]);

  if (tasksResult.error) throw new Error("crm_tasks_unavailable");
  if (leadsResult.error) throw new Error("crm_leads_unavailable");

  const leads = ((leadsResult.data ?? []) as unknown as CrmLeadRow[]).map(
    (lead) => ({
      companyName: lead.company?.name ?? undefined,
      contactEmail: lead.contact?.email ?? undefined,
      id: lead.id,
      leadDate: lead.lead_date ?? undefined,
      nextAction: lead.next_action ?? undefined,
      nextActionDate: lead.lead_date ?? lead.next_action_date ?? undefined,
      nextActionState: lead.next_action_state ?? "pending",
      status: lead.status,
      topic: lead.topic,
    }),
  );

  return {
    calendarEvents,
    gmailCandidates: triageGmailThreads({
      accountEmail: user.email,
      crmLeads: leads,
      maxResults: 10,
      now,
      threads: gmailThreads,
    }),
    leads,
    tasks: ((tasksResult.data ?? []) as unknown as CrmTaskRow[])
      .map((task) => ({
        dueAt: task.due_date ?? undefined,
        id: task.id,
        leadId: task.lead_id ?? undefined,
        leadStatus: task.lead?.status ?? undefined,
        status: task.status,
        taskKind: task.task_kind ?? "manual",
        title: task.title,
      }))
      .filter(
        (task) =>
          task.taskKind !== "lead-next-action" ||
          !isTerminalCrmStatus(task.leadStatus),
      ),
    warnings: [...new Set(warnings)],
  };
}

function withTimeout<T>(
  operation: PromiseLike<T>,
  timeoutMs: number,
  errorCode: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(errorCode)), timeoutMs);
    Promise.resolve(operation).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

type DailyBriefContent = {
  calendarUnavailable: boolean;
  dateLabel: string;
  firstName: string;
  gmailUnavailable: boolean;
  mailLines: string[];
  todayLines: string[];
  urgentLines: string[];
  warnings: string[];
  weekLines: string[];
};

function buildDailyBriefContent({
  data,
  displayName,
  now,
  timeZone,
}: {
  data: DailyBriefData;
  displayName: string;
  now: Date;
  timeZone: string;
}): DailyBriefContent {
  const today = localDateKey(now, timeZone);
  const weekEnd = addDaysToDateKey(today, 7);
  const firstName = displayName.trim().split(/\s+/)[0] || "Ali";
  const activeTasks = data.tasks.filter(
    (task) =>
      task.taskKind !== "lead-next-action" ||
      !isTerminalCrmStatus(task.leadStatus),
  );
  const overdueTasks = activeTasks.filter(
    (task) =>
      task.dueAt && localDateKey(new Date(task.dueAt), timeZone) < today,
  );
  const todayTasks = activeTasks.filter(
    (task) =>
      task.dueAt && localDateKey(new Date(task.dueAt), timeZone) === today,
  );
  const weekTasks = activeTasks.filter((task) => {
    if (!task.dueAt) return false;
    const date = localDateKey(new Date(task.dueAt), timeZone);
    return date > today && date <= weekEnd;
  });
  const projectedLeadIds = new Set(
    activeTasks
      .filter((task) => task.taskKind === "lead-next-action" && task.leadId)
      .map((task) => task.leadId as string),
  );
  const overdueLeads = data.leads.filter((lead) => {
    const dueAt = lead.leadDate ?? lead.nextActionDate;
    return Boolean(
      hasPendingDailyBriefAction(lead) &&
      dueAt &&
      localDateKey(new Date(dueAt), timeZone) < today &&
      !projectedLeadIds.has(lead.id),
    );
  });
  const todayLeads = data.leads.filter((lead) => {
    const dueAt = lead.leadDate ?? lead.nextActionDate;
    return Boolean(
      hasPendingDailyBriefAction(lead) &&
      dueAt &&
      localDateKey(new Date(dueAt), timeZone) === today &&
      !projectedLeadIds.has(lead.id),
    );
  });
  const todayEvents = data.calendarEvents.filter(
    (event) => event.start && eventDateKey(event.start, timeZone) === today,
  );
  const weekEvents = data.calendarEvents.filter((event) => {
    if (!event.start) return false;
    const date = eventDateKey(event.start, timeZone);
    return date > today && date <= weekEnd;
  });
  const weekMeetings = data.leads.filter((lead) => {
    if (
      lead.status !== "meeting-booked" ||
      !lead.leadDate ||
      !hasPendingDailyBriefAction(lead)
    ) {
      return false;
    }
    const date = eventDateKey(lead.leadDate, timeZone);
    return date >= today && date <= weekEnd;
  });
  const calendarUnavailable = data.warnings.includes("calendar_unavailable");
  const gmailUnavailable = data.warnings.includes("gmail_unavailable");

  const urgentLines = [
    ...overdueTasks.map(
      (task) =>
        `Tâche en retard : ${task.title} (${formatShortDate(task.dueAt!, timeZone)})`,
    ),
    ...overdueLeads.map(
      (lead) =>
        `Relance en retard : ${lead.topic}${lead.nextAction ? ` — ${lead.nextAction}` : ""}`,
    ),
  ].slice(0, 8);
  const todayLines = [
    ...todayEvents.map(
      (event) => `${formatEventTime(event.start!, timeZone)} — ${event.title}`,
    ),
    ...todayTasks.map((task) => `Tâche : ${task.title}`),
    ...todayLeads.map(
      (lead) =>
        `Relance : ${lead.topic}${lead.nextAction ? ` — ${lead.nextAction}` : ""}`,
    ),
    ...(calendarUnavailable
      ? ["Google Calendar indisponible : événements du jour non vérifiés"]
      : []),
  ].slice(0, 10);
  const weekLines = [
    calendarUnavailable
      ? "Google Calendar indisponible : agenda non vérifié"
      : `${weekEvents.length} événement(s) Calendar à venir`,
    `${weekTasks.length} tâche(s) CRM à échéance`,
    `${weekMeetings.length} lead(s) en meeting booked`,
  ];
  const mailLines = data.gmailCandidates.slice(0, 5).map((message) => {
    const from = (message.from ?? "Expéditeur inconnu").slice(0, 100);
    const subject = (message.subject ?? "Sans objet").slice(0, 160);
    const priority =
      message.priority === "urgent"
        ? "Priorité haute"
        : message.priority === "important"
          ? "Important"
          : "À répondre";
    const reasons = message.reasons
      .filter(
        (reason) =>
          !["direct-recipient", "gmail-important", "gmail-starred"].includes(
            reason,
          ),
      )
      .slice(0, 2)
      .map(formatGmailTriageReason)
      .join(" · ");
    return `[${priority}] ${from} — ${subject}${reasons ? ` (${reasons})` : ""}`;
  });
  const dateLabel = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "full",
    timeZone,
  }).format(now);

  return {
    calendarUnavailable,
    dateLabel,
    firstName,
    gmailUnavailable,
    mailLines,
    todayLines,
    urgentLines,
    warnings: data.warnings,
    weekLines,
  };
}

export function buildDailyBriefMessage({
  data,
  displayName,
  now,
  timeZone,
}: {
  data: DailyBriefData;
  displayName: string;
  now: Date;
  timeZone: string;
}): DailyBriefMessage {
  const content = buildDailyBriefContent({ data, displayName, now, timeZone });
  const {
    dateLabel,
    firstName,
    gmailUnavailable,
    mailLines,
    todayLines,
    urgentLines,
    warnings,
    weekLines,
  } = content;

  const blocks: unknown[] = [
    {
      text: { text: `Briefing NAIA — ${dateLabel}`, type: "plain_text" },
      type: "header",
    },
    sectionBlock(
      `Bonjour ${cleanSlackText(firstName, 60)}. Voici les priorités détectées à 09:30, sans action automatique sur tes mails ou ton CRM.`,
    ),
    sectionBlock(formatSection("Urgent et important", urgentLines)),
    sectionBlock(formatSection("Aujourd’hui", todayLines)),
    sectionBlock(formatSection("Vue de la semaine", weekLines)),
    sectionBlock(
      formatSection(
        "Mails à traiter",
        mailLines,
        gmailUnavailable
          ? "Gmail indisponible : les fils en attente de réponse n'ont pas été vérifiés."
          : "Aucun échange humain récent ne semble attendre une réponse.",
      ) +
        "\n_Triage des fils lus et non lus : bots, noreply, GitHub/Dependabot et listes de diffusion exclus._",
    ),
  ];

  if (warnings.length > 0) {
    blocks.push(
      sectionBlock(
        `Sources indisponibles pendant ce briefing : ${warnings
          .map((warning) => cleanSlackText(formatWarning(warning), 80))
          .join(", ")}.`,
      ),
    );
  }

  const fallbackSections = [
    `Briefing NAIA — ${dateLabel}`,
    `Urgent: ${urgentLines.length || "aucun"}`,
    `Aujourd’hui: ${todayLines.length || "aucun"}`,
    `Semaine: ${weekLines.join("; ")}`,
    `Mails à traiter: ${gmailUnavailable ? "source indisponible" : mailLines.length}`,
  ];

  return {
    blocks,
    text: fallbackSections.join("\n"),
  };
}

export function buildWhatsAppDailyBriefTemplate({
  data,
  displayName,
  now,
  timeZone,
}: {
  data: DailyBriefData;
  displayName: string;
  now: Date;
  timeZone: string;
}): WhatsAppDailyBriefTemplate {
  const content = buildDailyBriefContent({ data, displayName, now, timeZone });
  const mailEmpty = content.gmailUnavailable
    ? "Gmail indisponible : fils non vérifiés."
    : "Aucun échange humain récent à traiter.";
  const warningLine =
    content.warnings.length > 0
      ? `Sources non vérifiées : ${content.warnings
          .map(formatWarning)
          .join(", ")}.`
      : "";

  return {
    bodyParameters: [
      cleanWhatsAppBriefText(content.firstName, 30),
      cleanWhatsAppBriefText(content.dateLabel, 50),
      formatWhatsAppBriefLines(
        content.urgentLines,
        160,
        "Rien de critique détecté.",
      ),
      formatWhatsAppBriefLines(
        content.todayLines,
        180,
        "Aucune échéance détectée.",
      ),
      formatWhatsAppBriefLines(content.weekLines, 110, "Aucun élément."),
      formatWhatsAppBriefLines(
        [...content.mailLines, ...(warningLine ? [warningLine] : [])],
        180,
        mailEmpty,
      ),
    ],
    languageCode:
      process.env.WHATSAPP_DAILY_BRIEF_TEMPLATE_LANGUAGE?.trim() ||
      DEFAULT_WHATSAPP_TEMPLATE_LANGUAGE,
    name:
      process.env.WHATSAPP_DAILY_BRIEF_TEMPLATE_NAME?.trim() ||
      DEFAULT_WHATSAPP_TEMPLATE_NAME,
  };
}

function formatWhatsAppBriefLines(
  lines: string[],
  maxLength: number,
  empty: string,
) {
  const value = lines.length
    ? lines.map((line) => `• ${cleanWhatsAppBriefText(line, 240)}`).join(" · ")
    : empty;
  return cleanWhatsAppBriefText(value, maxLength);
}

function cleanWhatsAppBriefText(value: string, maxLength: number) {
  const clean = value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/ +/g, " ")
    .trim();
  if (clean.length <= maxLength) return clean;
  return `${truncateToLimit(clean, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function hasPendingDailyBriefAction(lead: DailyBriefLead) {
  return Boolean(
    lead.nextAction?.trim() &&
    lead.nextActionState !== "done" &&
    !isTerminalCrmStatus(lead.status),
  );
}

function isTerminalCrmStatus(status: string | undefined) {
  return Boolean(status && TERMINAL_CRM_STATUSES.has(status));
}

function formatWarning(warning: string) {
  const labels: Record<string, string> = {
    calendar_unavailable: "Google Calendar",
    gmail_unavailable: "Gmail",
  };
  return labels[warning] ?? warning.replaceAll("_", " ");
}

function sectionBlock(text: string) {
  return {
    text: { text: text.slice(0, 3000), type: "mrkdwn" },
    type: "section",
  };
}

function formatSection(
  title: string,
  lines: string[],
  empty = "Rien de critique détecté.",
) {
  const safeLines = lines.map((line) => `• ${cleanSlackText(line, 360)}`);
  return `*${cleanSlackText(title, 100)}*\n${safeLines.length ? safeLines.join("\n") : empty}`;
}

export function cleanSlackText(value: string, maxLength = 360) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/@(channel|here|everyone)/gi, "@\u200b$1")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function localDateKey(date: Date, timeZone: string) {
  const parts = zonedDateTimeParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function eventDateKey(value: string, timeZone: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return localDateKey(new Date(value), timeZone);
}

function addDaysToDateKey(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

function zonedDateTimeParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, Number(part.value)]),
  );
  return {
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    month: values.month,
    year: values.year,
  };
}

function formatShortDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    timeZone,
  }).format(new Date(value));
}

function formatEventTime(value: string, timeZone: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Toute la journée";
  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

function dailyBriefErrorCode(error: unknown) {
  if (error instanceof Error) {
    return error.message
      .replace(/[^a-z0-9_-]+/gi, "_")
      .toLowerCase()
      .slice(0, 120);
  }
  return "unknown_daily_brief_error";
}
