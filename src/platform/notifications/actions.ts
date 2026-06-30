"use server";

import { createServerSupabaseClient } from "@/platform/auth/supabase-server";

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
    .order("created_at", { ascending: false })
    .limit(20);

  let notifications: AppNotification[] = [];

  if (!dbError && dbNotifications) {
    notifications = dbNotifications.map((n) => ({
      id: n.id,
      type: n.type as AppNotification["type"],
      title: n.title,
      description: n.description || "",
      link_url: n.link_url || undefined,
      is_read: n.is_read,
      created_at: n.created_at,
    }));
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
      .map(({ lead, dueDate }) => ({
        id: `lead-reminder-${lead.id}`,
        type: "lead_reminder",
        title: "Rappel Lead : " + lead.topic,
        description: lead.next_action || "Une action est requise pour ce lead.",
        link_url: "/dashboard/leads",
        is_read: false,
        created_at: new Date(dueDate as string).toISOString(),
      }));

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
  // We can only mark persistent notifications as read in the DB.
  // Smart reminders (starting with lead-reminder-) disappear automatically when the lead is updated.
  if (notificationId.startsWith("lead-reminder-")) {
    return true; // Pretend it worked; the UI can optimistically hide it or prompt user to resolve lead.
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
    return true; // Dynamic notifications are filtered on client side
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

  const { error } = await supabase
    .from("notifications")
    .delete()
    .eq("organization_id", organizationId)
    .eq("profile_id", userId);

  if (error) {
    console.error("Database error deleting all notifications:", error);
    return false;
  }

  return true;
}
