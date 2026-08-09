import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createServiceRoleSupabaseClient } from "@/platform/auth/supabase-server";
import {
  listGmailMessages,
  listGoogleCalendarEvents,
  type GmailMessageSummary,
  type GoogleCalendarEventSummary,
} from "@/platform/integrations/google-workspace";
import {
  findSlackUserByEmail,
  postSlackMessage,
} from "@/platform/integrations/slack";
import { resolveBridgeUser, type NaiaBridgeUser } from "@/platform/naia/bridge";

const DEFAULT_RECIPIENT = "ali@qarizmi.com";
const DEFAULT_TIME_ZONE = "Africa/Casablanca";
const ACTIVE_LEAD_STATUSES = [
  "lead-to-contact",
  "contacted",
  "to-follow-up",
  "meeting-booked",
  "proposal-sent",
] as const;
const COFOUNDER_EMAILS = new Set(["ali@qarizmi.com", "nabil@qarizmi.com"]);

export type DailyBriefTask = {
  dueAt?: string;
  id: string;
  status: string;
  title: string;
};

export type DailyBriefLead = {
  id: string;
  leadDate?: string;
  nextAction?: string;
  nextActionDate?: string;
  status: string;
  topic: string;
};

export type DailyBriefData = {
  calendarEvents: GoogleCalendarEventSummary[];
  gmailCandidates: GmailMessageSummary[];
  leads: DailyBriefLead[];
  tasks: DailyBriefTask[];
  warnings: string[];
};

export type DailyBriefMessage = {
  blocks: unknown[];
  text: string;
};

export type DailyBriefDispatchResult = {
  email: string;
  reason?: string;
  status: "failed" | "sent" | "skipped";
};

type DailyBriefRunRow = {
  id: string;
};

type CrmTaskRow = {
  due_date: string | null;
  id: string;
  status: string;
  title: string;
};

type CrmLeadRow = {
  id: string;
  lead_date: string | null;
  next_action: string | null;
  next_action_date: string | null;
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
  if (!isDailyBriefDispatchWindow(now, timeZone)) {
    return getDailyBriefRecipients().map((email) => ({
      email,
      reason: "outside_local_dispatch_window",
      status: "skipped" as const,
    }));
  }

  const results: DailyBriefDispatchResult[] = [];
  for (const email of getDailyBriefRecipients()) {
    try {
      results.push(await dispatchDailyBrief({ email, now, timeZone }));
    } catch (error) {
      const errorCode = dailyBriefErrorCode(error);
      console.error("NAIA daily brief dispatch could not start:", errorCode);
      results.push({ email, reason: errorCode, status: "failed" });
    }
  }
  return results;
}

export async function dispatchDailyBrief({
  email,
  now,
  timeZone,
}: {
  email: string;
  now: Date;
  timeZone: string;
}): Promise<DailyBriefDispatchResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await resolveBridgeUser(normalizedEmail);
  if (
    !user ||
    user.role !== "owner" ||
    !COFOUNDER_EMAILS.has(normalizedEmail)
  ) {
    return {
      email: normalizedEmail,
      reason: "recipient_not_authorized",
      status: "skipped",
    };
  }

  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) {
    return {
      email: normalizedEmail,
      reason: "supabase_service_role_unavailable",
      status: "failed",
    };
  }

  const localDate = localDateKey(now, timeZone);
  const claim = await claimDailyBriefRun({
    localDate,
    supabase,
    user,
  });
  if (!claim) {
    return {
      email: normalizedEmail,
      reason: "already_claimed_for_local_date",
      status: "skipped",
    };
  }

  try {
    const [data, slackUser] = await Promise.all([
      loadDailyBriefData({ now, supabase, user }),
      findSlackUserByEmail(normalizedEmail),
    ]);
    if (!slackUser) {
      throw new Error("slack_recipient_not_found");
    }

    const message = buildDailyBriefMessage({
      data,
      displayName: user.fullName ?? slackUser.displayName ?? normalizedEmail,
      now,
      timeZone,
    });
    const posted = await postSlackMessage({
      blocks: message.blocks,
      channel: slackUser.id,
      text: message.text,
    });

    await supabase
      .from("naia_daily_brief_runs")
      .update({
        error_code: null,
        sent_at: new Date().toISOString(),
        slack_channel_id: posted.channel ?? slackUser.id,
        slack_message_ts: posted.ts ?? null,
        status: "sent",
        updated_at: new Date().toISOString(),
      })
      .eq("id", claim.id)
      .eq("organization_id", user.organizationId);

    return { email: normalizedEmail, status: "sent" };
  } catch (error) {
    const errorCode = dailyBriefErrorCode(error);
    await supabase
      .from("naia_daily_brief_runs")
      .update({
        error_code: errorCode,
        status: "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", claim.id)
      .eq("organization_id", user.organizationId);

    console.error("NAIA daily brief failed:", errorCode);
    return { email: normalizedEmail, reason: errorCode, status: "failed" };
  }
}

async function claimDailyBriefRun({
  localDate,
  supabase,
  user,
}: {
  localDate: string;
  supabase: SupabaseClient;
  user: NaiaBridgeUser;
}): Promise<DailyBriefRunRow | null> {
  const { data, error } = await supabase
    .from("naia_daily_brief_runs")
    .insert({
      local_date: localDate,
      organization_id: user.organizationId,
      profile_id: user.profileId,
      status: "sending",
    })
    .select("id")
    .single();

  if (!error && data?.id) return data as DailyBriefRunRow;
  if (error?.code === "23505") return null;
  throw new Error("daily_brief_claim_failed");
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
    .select("id,title,status,due_date")
    .eq("organization_id", user.organizationId)
    .in("status", ["todo", "in-progress"])
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(100);
  const leadsPromise = supabase
    .from("crm_leads")
    .select("id,topic,status,next_action,next_action_date,lead_date")
    .eq("organization_id", user.organizationId)
    .in("status", [...ACTIVE_LEAD_STATUSES])
    .order("next_action_date", { ascending: true, nullsFirst: false })
    .limit(100);
  const calendarPromise = listGoogleCalendarEvents(
    {
      maxResults: 50,
      timeMax: calendarEnd.toISOString(),
      timeMin: now.toISOString(),
    },
    googleContext,
  ).catch(() => {
    warnings.push("calendar_unavailable");
    return [];
  });
  const gmailPromise = listGmailMessages(
    {
      maxResults: 20,
      query:
        "in:inbox is:unread newer_than:30d -in:spam -in:trash -category:promotions -category:social -category:forums",
    },
    googleContext,
  ).catch(() => {
    warnings.push("gmail_unavailable");
    return [];
  });

  const [tasksResult, leadsResult, calendarEvents, gmailCandidates] =
    await Promise.all([
      tasksPromise,
      leadsPromise,
      calendarPromise,
      gmailPromise,
    ]);

  if (tasksResult.error) throw new Error("crm_tasks_unavailable");
  if (leadsResult.error) throw new Error("crm_leads_unavailable");

  return {
    calendarEvents,
    gmailCandidates,
    leads: ((leadsResult.data ?? []) as CrmLeadRow[]).map((lead) => ({
      id: lead.id,
      leadDate: lead.lead_date ?? undefined,
      nextAction: lead.next_action ?? undefined,
      nextActionDate: lead.next_action_date ?? undefined,
      status: lead.status,
      topic: lead.topic,
    })),
    tasks: ((tasksResult.data ?? []) as CrmTaskRow[]).map((task) => ({
      dueAt: task.due_date ?? undefined,
      id: task.id,
      status: task.status,
      title: task.title,
    })),
    warnings: [...new Set(warnings)],
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
  const today = localDateKey(now, timeZone);
  const weekEnd = addDaysToDateKey(today, 7);
  const firstName = displayName.trim().split(/\s+/)[0] || "Ali";
  const overdueTasks = data.tasks.filter(
    (task) =>
      task.dueAt && localDateKey(new Date(task.dueAt), timeZone) < today,
  );
  const todayTasks = data.tasks.filter(
    (task) =>
      task.dueAt && localDateKey(new Date(task.dueAt), timeZone) === today,
  );
  const weekTasks = data.tasks.filter((task) => {
    if (!task.dueAt) return false;
    const date = localDateKey(new Date(task.dueAt), timeZone);
    return date > today && date <= weekEnd;
  });
  const overdueLeads = data.leads.filter(
    (lead) => lead.nextActionDate && lead.nextActionDate < today,
  );
  const todayLeads = data.leads.filter((lead) => lead.nextActionDate === today);
  const todayEvents = data.calendarEvents.filter(
    (event) => event.start && eventDateKey(event.start, timeZone) === today,
  );
  const weekEvents = data.calendarEvents.filter((event) => {
    if (!event.start) return false;
    const date = eventDateKey(event.start, timeZone);
    return date > today && date <= weekEnd;
  });
  const weekMeetings = data.leads.filter(
    (lead) =>
      lead.status === "meeting-booked" &&
      Boolean(lead.leadDate) &&
      lead.leadDate! >= today &&
      lead.leadDate! <= weekEnd,
  );

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
  ].slice(0, 10);
  const weekLines = [
    `${weekEvents.length} événement(s) Calendar à venir`,
    `${weekTasks.length} tâche(s) CRM à échéance`,
    `${weekMeetings.length} lead(s) en meeting booked`,
  ];
  const mailLines = data.gmailCandidates.slice(0, 5).map((message) => {
    const from = (message.from ?? "Expéditeur inconnu").slice(0, 100);
    const subject = (message.subject ?? "Sans objet").slice(0, 160);
    return `${from} — ${subject}`;
  });
  const dateLabel = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "full",
    timeZone,
  }).format(now);

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
        "Mails non lus à vérifier",
        mailLines,
        "Aucun message non lu récent dans la boîte de réception.",
      ) +
        "\n_Indicateur de triage uniquement : NAIA ne prétend pas qu’un mail lu est sans réponse sans relire son fil._",
    ),
  ];

  if (data.warnings.length > 0) {
    blocks.push(
      sectionBlock(
        `Sources indisponibles pendant ce briefing : ${data.warnings
          .map((warning) => cleanSlackText(warning.replaceAll("_", " "), 80))
          .join(", ")}.`,
      ),
    );
  }

  const fallbackSections = [
    `Briefing NAIA — ${dateLabel}`,
    `Urgent: ${urgentLines.length || "aucun"}`,
    `Aujourd’hui: ${todayLines.length || "aucun"}`,
    `Semaine: ${weekLines.join("; ")}`,
    `Mails non lus à vérifier: ${mailLines.length}`,
  ];

  return {
    blocks,
    text: fallbackSections.join("\n"),
  };
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
