import "server-only";

import { createServiceRoleSupabaseClient } from "@/platform/auth/supabase-server";

// Durable storage for NAIA action drafts awaiting approval on channels whose
// buttons cannot carry the inline draft (WhatsApp reply-button ids are capped
// at 256 characters, versus Slack's 2000-character button values). The draft
// {actionId, actionLabel, approvalToken, command} is parked in the
// service-role-only `naia_pending_actions` table and the button only
// references the row uuid, so it survives serverless instances and deploys.
//
// The two single-use layers are complementary: this claim is the UX layer
// (a tapped WhatsApp button stops working immediately, scoped to the owning
// profile), while the security layer is the HMAC approval token — it embeds
// the exact approved action and is itself claimed single-use in
// naia_consumed_action_tokens by executeBridgeAction before any side effect.
export type NaiaPendingDraft = {
  actionId: string;
  actionLabel: string;
  approvalToken: string;
  command: string;
};

// Slightly longer than the 5-minute HMAC token TTL so a late click still gets
// the explicit "jeton expiré" message from executeBridgeAction instead of a
// generic "draft introuvable".
export const NAIA_PENDING_ACTION_TTL_MS = 10 * 60 * 1000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function storePendingAction({
  draft,
  organizationId,
  profileId,
}: {
  draft: NaiaPendingDraft;
  organizationId: string;
  profileId: string;
}): Promise<string | null> {
  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("naia_pending_actions")
    .insert({
      draft,
      expires_at: new Date(Date.now() + NAIA_PENDING_ACTION_TTL_MS),
      organization_id: organizationId,
      profile_id: profileId,
    })
    .select("id")
    .single();

  if (error || typeof data?.id !== "string") return null;

  return data.id;
}

// Loads AND deletes a pending draft in one statement so an approval can only
// run once (double taps on the WhatsApp button claim nothing the second
// time). The delete is filtered on the owning profile and on a live
// expiry, so a draft can never be executed by another user or after its TTL.
export async function claimPendingAction({
  id,
  profileId,
}: {
  id: string;
  profileId: string;
}): Promise<NaiaPendingDraft | null> {
  if (!UUID_PATTERN.test(id)) return null;

  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) return null;

  const nowIso = new Date().toISOString();

  // Purge expired drafts on every read; the table stays small.
  await supabase
    .from("naia_pending_actions")
    .delete()
    .lte("expires_at", nowIso);

  const { data, error } = await supabase
    .from("naia_pending_actions")
    .delete()
    .eq("id", id)
    .eq("profile_id", profileId)
    .gt("expires_at", nowIso)
    .select("draft")
    .maybeSingle();

  // Still fail-closed, but a transient database failure must stay observable
  // instead of being mistaken for an already-claimed draft.
  if (error) {
    console.error("NAIA pending action claim failed:", error);
    return null;
  }

  const draft = (data as { draft?: unknown } | null)?.draft;

  return isPendingDraft(draft) ? draft : null;
}

// Meta delivers webhooks at least once, so the same message (same wamid) can
// arrive again after a slow ack or a transient error. The first processing
// claims the wamid on the naia_processed_messages primary key; a redelivery
// hits the unique violation and is skipped. Any other failure fails OPEN: a
// duplicate answer is better than a silently dropped command.
const PROCESSED_MESSAGE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export async function claimInboundMessage(wamid: string): Promise<boolean> {
  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) return true;

  // Opportunistic purge of old dedup rows; the table stays small.
  await supabase
    .from("naia_processed_messages")
    .delete()
    .lte(
      "processed_at",
      new Date(Date.now() - PROCESSED_MESSAGE_RETENTION_MS).toISOString(),
    );

  const { error } = await supabase
    .from("naia_processed_messages")
    .insert({ wamid });

  if (!error) return true;

  // 23505 = unique_violation: this wamid was already processed.
  if (error.code === "23505") return false;

  console.error("NAIA inbound message dedup failed:", error);
  return true;
}

function isPendingDraft(value: unknown): value is NaiaPendingDraft {
  if (!value || typeof value !== "object") return false;

  const draft = value as Partial<NaiaPendingDraft>;

  return (
    typeof draft.actionId === "string" &&
    typeof draft.actionLabel === "string" &&
    typeof draft.approvalToken === "string" &&
    typeof draft.command === "string"
  );
}
