import "server-only";

import { createServiceRoleSupabaseClient } from "@/platform/auth/supabase-server";
import type { NaiaConversationMessage } from "@/platform/naia/assistant";

const WHATSAPP_HISTORY_LIMIT = 8;
const WHATSAPP_MESSAGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const WHATSAPP_MESSAGE_CONTENT_LIMIT = 4096;

export async function storeWhatsAppMessage({
  content,
  messageId,
  organizationId,
  profileId,
  role,
}: {
  content: string;
  messageId: string;
  organizationId: string;
  profileId: string;
  role: "user";
}): Promise<void> {
  const normalizedContent = content
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, WHATSAPP_MESSAGE_CONTENT_LIMIT);
  const normalizedMessageId = messageId.trim().slice(0, 512);
  if (!normalizedContent || !normalizedMessageId) return;

  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) return;

  const { error } = await supabase
    .from("naia_private_whatsapp_messages")
    .upsert(
      {
        content: normalizedContent,
        organization_id: organizationId,
        profile_id: profileId,
        role,
        wamid: normalizedMessageId,
      },
      { ignoreDuplicates: true, onConflict: "wamid" },
    );

  if (error) {
    console.error("NAIA WhatsApp message storage failed:", error);
  }
}

export async function fetchWhatsAppHistory({
  excludeMessageId,
  limit = WHATSAPP_HISTORY_LIMIT,
  organizationId,
  profileId,
}: {
  excludeMessageId?: string;
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
  const normalizedExcludedId = excludeMessageId?.trim();
  const { data, error } = await supabase
    .from("naia_private_whatsapp_messages")
    .select("role,content,wamid")
    .eq("organization_id", organizationId)
    .eq("profile_id", profileId)
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(safeLimit + (normalizedExcludedId ? 1 : 0));

  if (error) {
    console.error("NAIA WhatsApp history read failed:", error);
    return [];
  }

  return (data ?? [])
    .filter(isConversationRow)
    .filter(
      (row) => !normalizedExcludedId || row.wamid !== normalizedExcludedId,
    )
    .slice(0, safeLimit)
    .map((row) => ({ content: row.content, role: row.role }))
    .reverse();
}

function isConversationRow(value: unknown): value is {
  content: string;
  role: "user";
  wamid?: string | null;
} {
  if (!value || typeof value !== "object") return false;

  const row = value as {
    content?: unknown;
    role?: unknown;
    wamid?: unknown;
  };
  return (
    typeof row.content === "string" &&
    row.role === "user" &&
    (row.wamid === undefined ||
      row.wamid === null ||
      typeof row.wamid === "string")
  );
}
