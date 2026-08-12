import "server-only";

import { randomUUID } from "node:crypto";

import { createServiceRoleSupabaseClient } from "@/platform/auth/supabase-server";

export type AuthorizedWhatsAppInboundMessage = {
  audio?: { id?: string; mime_type?: string };
  authorizedEmail: string;
  from: string;
  id: string;
  interactive?: {
    button_reply?: { id?: string; title?: string };
    type?: string;
  };
  organizationId: string;
  profileId: string;
  text?: { body?: string };
  type?: string;
};

type ClaimedWhatsAppInboundRow = {
  attempts: number;
  authorized_email: string;
  button_reply_id: string | null;
  id: string;
  lease_token: string;
  media_id: string | null;
  message_kind: "audio" | "button_reply" | "text";
  organization_id: string;
  profile_id: string;
  sender_phone: string;
  text_body: string | null;
  wamid: string;
};

export type WhatsAppInboxDrainResult = {
  completed: number;
  failed: number;
  claimed: number;
};

const COMPLETED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const PROCESSING_LEASE_SECONDS = 90;
const MAX_PROCESSING_ATTEMPTS = 5;

export async function enqueueWhatsAppInboundMessages(
  messages: AuthorizedWhatsAppInboundMessage[],
): Promise<boolean> {
  if (messages.length === 0) return true;

  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) return false;

  await cleanupTerminalWhatsAppInboundMessages(supabase);

  const rows = messages.map(serializeInboundMessage);
  const { error } = await supabase
    .from("naia_whatsapp_inbound_queue")
    .upsert(rows, { ignoreDuplicates: true, onConflict: "wamid" });

  if (error) {
    console.error("NAIA WhatsApp inbox enqueue failed:", error);
    return false;
  }

  return true;
}

export async function drainWhatsAppInboundQueue({
  maxMessages,
  processMessage,
}: {
  maxMessages: number;
  processMessage: (message: AuthorizedWhatsAppInboundMessage) => Promise<void>;
}): Promise<WhatsAppInboxDrainResult> {
  const result: WhatsAppInboxDrainResult = {
    claimed: 0,
    completed: 0,
    failed: 0,
  };
  const boundedLimit = Math.max(1, Math.min(Math.floor(maxMessages), 10));

  await cleanupTerminalWhatsAppInboundMessages();

  for (let index = 0; index < boundedLimit; index += 1) {
    const claim = await claimNextWhatsAppInboundMessage();
    if (!claim) break;
    result.claimed += 1;

    try {
      await processMessage(deserializeInboundMessage(claim));
      if (await completeWhatsAppInboundMessage(claim)) {
        result.completed += 1;
      } else {
        result.failed += 1;
      }
    } catch (error) {
      console.error("NAIA WhatsApp queued message failed:", error);
      await releaseWhatsAppInboundMessage(claim);
      result.failed += 1;
    }
  }

  return result;
}

async function cleanupTerminalWhatsAppInboundMessages(
  supabase = createServiceRoleSupabaseClient(),
) {
  if (!supabase) return;

  const retentionCutoff = new Date(
    Date.now() - COMPLETED_RETENTION_MS,
  ).toISOString();
  const { error } = await supabase
    .from("naia_whatsapp_inbound_queue")
    .delete()
    .in("status", ["completed", "failed"])
    .lt("updated_at", retentionCutoff);
  if (error) {
    console.error("NAIA WhatsApp inbox cleanup failed:", error);
  }
}

function serializeInboundMessage(message: AuthorizedWhatsAppInboundMessage) {
  const messageKind = inboundMessageKind(message);

  return {
    authorized_email: message.authorizedEmail.trim().toLowerCase(),
    button_reply_id:
      messageKind === "button_reply"
        ? message.interactive?.button_reply?.id?.trim()
        : null,
    media_id: messageKind === "audio" ? message.audio?.id?.trim() : null,
    message_kind: messageKind,
    organization_id: message.organizationId,
    profile_id: message.profileId,
    sender_phone: message.from,
    text_body:
      messageKind === "text"
        ? message.text?.body?.replace(/\s+/g, " ").trim().slice(0, 2000)
        : null,
    wamid: message.id,
  };
}

function inboundMessageKind(
  message: AuthorizedWhatsAppInboundMessage,
): ClaimedWhatsAppInboundRow["message_kind"] {
  if (message.type === "audio") return "audio";
  if (message.type === "interactive") return "button_reply";
  return "text";
}

async function claimNextWhatsAppInboundMessage(): Promise<ClaimedWhatsAppInboundRow | null> {
  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) throw new Error("whatsapp_inbox_unavailable");

  const { data, error } = await supabase
    .rpc("claim_naia_whatsapp_inbound_message", {
      p_lease_seconds: PROCESSING_LEASE_SECONDS,
      p_lease_token: randomUUID(),
    })
    .maybeSingle();

  if (error) throw new Error("whatsapp_inbox_claim_failed");
  return data ? (data as ClaimedWhatsAppInboundRow) : null;
}

async function completeWhatsAppInboundMessage(
  claim: ClaimedWhatsAppInboundRow,
): Promise<boolean> {
  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) return false;

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("naia_whatsapp_inbound_queue")
    .update({
      button_reply_id: null,
      last_error_code: null,
      lease_expires_at: null,
      lease_token: null,
      media_id: null,
      processed_at: now,
      status: "completed",
      text_body: null,
      updated_at: now,
    })
    .eq("id", claim.id)
    .eq("lease_token", claim.lease_token)
    .eq("status", "processing")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("NAIA WhatsApp inbox completion failed:", error);
  }
  return Boolean(data?.id);
}

async function releaseWhatsAppInboundMessage(
  claim: ClaimedWhatsAppInboundRow,
): Promise<void> {
  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) return;

  const exhausted = claim.attempts >= MAX_PROCESSING_ATTEMPTS;
  const retryDelaySeconds = Math.min(
    300,
    30 * 2 ** Math.max(0, claim.attempts - 1),
  );
  const now = new Date();
  const { error } = await supabase
    .from("naia_whatsapp_inbound_queue")
    .update({
      available_at: new Date(
        now.getTime() + retryDelaySeconds * 1000,
      ).toISOString(),
      last_error_code: "processing_failed",
      lease_expires_at: null,
      lease_token: null,
      status: exhausted ? "failed" : "queued",
      updated_at: now.toISOString(),
    })
    .eq("id", claim.id)
    .eq("lease_token", claim.lease_token)
    .eq("status", "processing");

  if (error) {
    console.error("NAIA WhatsApp inbox release failed:", error);
  }
}

function deserializeInboundMessage(
  row: ClaimedWhatsAppInboundRow,
): AuthorizedWhatsAppInboundMessage {
  if (row.message_kind === "audio") {
    return {
      audio: { id: row.media_id ?? undefined },
      authorizedEmail: row.authorized_email,
      from: row.sender_phone,
      id: row.wamid,
      organizationId: row.organization_id,
      profileId: row.profile_id,
      type: "audio",
    };
  }

  if (row.message_kind === "button_reply") {
    return {
      authorizedEmail: row.authorized_email,
      from: row.sender_phone,
      id: row.wamid,
      interactive: {
        button_reply: { id: row.button_reply_id ?? undefined },
        type: "button_reply",
      },
      organizationId: row.organization_id,
      profileId: row.profile_id,
      type: "interactive",
    };
  }

  return {
    authorizedEmail: row.authorized_email,
    from: row.sender_phone,
    id: row.wamid,
    organizationId: row.organization_id,
    profileId: row.profile_id,
    text: { body: row.text_body ?? "" },
    type: "text",
  };
}
