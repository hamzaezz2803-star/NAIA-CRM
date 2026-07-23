"use server";

import { createServerSupabaseClient } from "@/platform/auth/supabase-server";
import {
  buildCrmReminderNotificationId,
  parseCrmReminderNotificationId,
} from "./reminder-keys";

type ServerSupabaseClient = NonNullable<
  Awaited<ReturnType<typeof createServerSupabaseClient>>
>;

type NotificationContext = {
  supabase: ServerSupabaseClient;
  userId: string;
  organizationId: string;
};

type ReminderLeadRow = {
  id: string;
  topic: string;
  next_action: string | null;
  next_action_date: string | null;
  lead_date: string | null;
};

export type AppNotification = {
  id: string;
  type: "system" | "mention" | "alert" | "success" | "lead_reminder";
  title: string;
  description: string;
  link_url?: string;
  is_read: boolean;
  created_at: string;
};

async function getNotificationContext(): Promise<NotificationContext | null> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return null;

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) return null;

  const { data: membership } = await supabase
    .from("organization_memberships")
    .select("organization_id")
    .eq("profile_id", userData.user.id)
    .limit(1)
    .single();

  if (!membership?.organization_id) return null;

  return {
    supabase,
    userId: userData.user.id,
    organizationId: membership.organization_id,
  };
}

export async function getNotifications(): Promise<AppNotification[]> {
  const context = await getNotificationContext();
  if (!context) return [];

  const { supabase, organizationId } = context;

  // Fetch persistent notifications
  const { data: dbNotifications, error: dbError } = await supabase
    .from("notifications")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  let notifications: AppNotification[] = [];
  const dismissedLeadKeys = new Set<string>();
  const readLeadKeys = new Set<string>();

  if (!dbError && dbNotifications) {
    dbNotifications.forEach((n) => {
      if (n.title === "lead-reminder-dismissed") {
        if (n.description) dismissedLeadKeys.add(n.description);
      } else if (n.title === "lead-reminder-read") {
        if (n.description) readLeadKeys.add(n.description);
      } else {
        notifications.push({
          id: n.id,
          type: n.type as AppNotification["type"],
          title: n.title,
          description: n.description || "",
          link_url: n.link_url || undefined,
          is_read: n.is_read,
          created_at: n.created_at,
        });
      }
    });
  }

  // Fetch smart CRM reminders
  // A reminder is shown for leads with lead_date/legacy next_action_date <= today.
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const { data: leads, error: leadsError } = await supabase
    .from("crm_leads")
    .select("id, topic, lead_date, next_action_date, next_action")
    .eq("organization_id", organizationId)
    .not("status", "in", '("won","dead-end")');

  if (!leadsError && leads) {
    const leadReminders: AppNotification[] = (leads as ReminderLeadRow[])
      .map((lead) => ({
        lead,
        dueDate: lead.lead_date ?? lead.next_action_date,
      }))
      .filter(({ dueDate }) => dueDate && dueDate.slice(0, 10) <= today)
      .map(({ lead, dueDate }) => {
        const dateStr = (dueDate as string).slice(0, 10);
        const notificationId = buildCrmReminderNotificationId(lead.id, dateStr);
        return {
          id: notificationId,
          type: "lead_reminder" as const,
          title: "Rappel Lead : " + lead.topic,
          description:
            lead.next_action || "Une action est requise pour ce lead.",
          link_url: "/dashboard/leads",
          is_read: readLeadKeys.has(`${lead.id}:${dateStr}`),
          created_at: new Date(dueDate as string).toISOString(),
        };
      })
      .filter((reminder) => {
        const { compositeKey } = parseCrmReminderNotificationId(reminder.id);
        return !dismissedLeadKeys.has(compositeKey);
      });

    notifications = [...notifications, ...leadReminders];
  }

  // Sort combined notifications by date descending
  notifications.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  return notifications;
}

export async function markNotificationAsRead(
  notificationId: string,
): Promise<boolean> {
  if (notificationId.startsWith("lead-reminder-")) {
    const { compositeKey } = parseCrmReminderNotificationId(notificationId);
    const context = await getNotificationContext();
    if (!context) return false;
    const { supabase, userId, organizationId } = context;

    const { error } = await supabase.from("notifications").insert({
      organization_id: organizationId,
      profile_id: userId,
      title: "lead-reminder-read",
      description: compositeKey,
      type: "system",
      is_read: true,
    });
    return !error;
  }

  const context = await getNotificationContext();
  if (!context) return false;

  const { supabase, userId, organizationId } = context;

  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("id", notificationId)
    .eq("organization_id", organizationId)
    .eq("profile_id", userId);

  return !error;
}

export async function createSystemNotification(input: {
  title: string;
  description: string;
  type?: "system" | "mention" | "alert" | "success";
  link_url?: string;
}): Promise<boolean> {
  const context = await getNotificationContext();
  if (!context) return false;

  const { supabase, userId, organizationId } = context;

  const { error } = await supabase.from("notifications").insert({
    organization_id: organizationId,
    profile_id: userId,
    title: input.title,
    description: input.description,
    type: input.type || "system",
    link_url: input.link_url,
  });

  return !error;
}

export async function deleteNotification(
  notificationId: string,
): Promise<boolean> {
  if (notificationId.startsWith("lead-reminder-")) {
    const { compositeKey } = parseCrmReminderNotificationId(notificationId);
    const context = await getNotificationContext();
    if (!context) return false;
    const { supabase, userId, organizationId } = context;

    const { error } = await supabase.from("notifications").insert({
      organization_id: organizationId,
      profile_id: userId,
      title: "lead-reminder-dismissed",
      description: compositeKey,
      type: "system",
      is_read: true,
    });
    return !error;
  }

  const context = await getNotificationContext();
  if (!context) return false;

  const { supabase, userId, organizationId } = context;

  const { error } = await supabase
    .from("notifications")
    .delete()
    .eq("id", notificationId)
    .eq("organization_id", organizationId)
    .eq("profile_id", userId);

  if (error) {
    console.error("Database error deleting notification:", error);
    return false;
  }

  return true;
}

export async function deleteAllNotifications(): Promise<boolean> {
  const context = await getNotificationContext();
  if (!context) return false;

  const { supabase, userId, organizationId } = context;

  // 1. Tombstone all currently active CRM lead reminders so "Tout supprimer"
  // clears them and prevents them from reappearing on next refresh.
  const today = new Date().toISOString().split("T")[0];
  const { data: leads, error: leadsError } = await supabase
    .from("crm_leads")
    .select("id, topic, lead_date, next_action_date")
    .eq("organization_id", organizationId)
    .not("status", "in", '("won","dead-end")');

  if (leadsError) {
    console.error(
      "Database error loading CRM reminders before deleting notifications:",
      leadsError,
    );
    return false;
  }

  if (leads && leads.length > 0) {
    const overdueLeads = (leads as ReminderLeadRow[])
      .map((lead) => ({
        leadId: lead.id,
        dueDate: lead.lead_date ?? lead.next_action_date,
      }))
      .filter(({ dueDate }) => dueDate && dueDate.slice(0, 10) <= today);

    if (overdueLeads.length > 0) {
      const markerRows = overdueLeads.map(({ leadId, dueDate }) => ({
        organization_id: organizationId,
        profile_id: userId,
        title: "lead-reminder-dismissed",
        description: `${leadId}:${(dueDate as string).slice(0, 10)}`,
        type: "system",
        is_read: true,
      }));

      const { error: markerError } = await supabase
        .from("notifications")
        .insert(markerRows);

      if (markerError) {
        console.error(
          "Database error preserving CRM reminder dismissals:",
          markerError,
        );
        return false;
      }
    }
  }

  // 2. Delete all ordinary notifications while preserving marker tombstones.
  const { error } = await supabase
    .from("notifications")
    .delete()
    .eq("organization_id", organizationId)
    .eq("profile_id", userId)
    .not("title", "in", '("lead-reminder-dismissed","lead-reminder-read")');

  if (error) {
    console.error("Database error deleting all notifications:", error);
    return false;
  }

  return true;
}
