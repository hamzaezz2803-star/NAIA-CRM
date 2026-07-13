import "server-only";

import { createServiceRoleSupabaseClient } from "@/platform/auth/supabase-server";
import type { NaiaConversationMessage } from "@/platform/naia/assistant";

const WHATSAPP_HISTORY_LIMIT = 8;
const WHATSAPP_MESSAGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const WHATSAPP_MESSAGE_CONTENT_LIMIT = 4096;

export async function storeWhatsAppMessage({
  content,
  organizationId,
  profileId,
  role,
}: {
  content: string;
  organizationId: string;
  profileId: string;
  role: "user";
}): Promise<void> {
  const normalizedContent = content
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, WHATSAPP_MESSAGE_CONTENT_LIMIT);
  if (!normalizedContent) return;

  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) return;

  const { error } = await supabase
    .from("naia_private_whatsapp_messages")
    .insert({
      content: normalizedContent,
      organization_id: organizationId,
      profile_id: profileId,
      role,
    });

  if (error) {
    console.error("NAIA WhatsApp message storage failed:", error);
  }
}

export async function fetchWhatsAppHistory({
  limit = WHATSAPP_HISTORY_LIMIT,
  organizationId,
  profileId,
}: {
  limit?: number;
  organizationId: string;
  profileId: string;
}): Promise<NaiaConversationMessage[]> {
  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) return [];

  await supabase
    .from("naia_private_whatsapp_messages")
    .delete()
    .lt(
      "created_at",
      new Date(Date.now() - WHATSAPP_MESSAGE_RETENTION_MS).toISOString(),
    );

  const safeLimit = Math.max(1, Math.min(limit, WHATSAPP_HISTORY_LIMIT));
  const { data, error } = await supabase
    .from("naia_private_whatsapp_messages")
    .select("role,content")
    .eq("organization_id", organizationId)
    .eq("profile_id", profileId)
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) {
    console.error("NAIA WhatsApp history read failed:", error);
    return [];
  }

  return (data ?? [])
    .filter(isConversationRow)
    .map((row) => ({ content: row.content, role: row.role }))
    .reverse();
}

function isConversationRow(value: unknown): value is {
  content: string;
  role: "user";
} {
  if (!value || typeof value !== "object") return false;

  const row = value as { content?: unknown; role?: unknown };
  return typeof row.content === "string" && row.role === "user";
}
