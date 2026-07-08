import "server-only";

import type { NaiaActionDraft } from "@/features/naia/orchestrator";
import { createServiceRoleSupabaseClient } from "@/platform/auth/supabase-server";

// Durable storage for NAIA action drafts awaiting approval on channels whose
// buttons cannot carry the serialized draft (WhatsApp reply-button ids are
// capped at 256 characters). The draft {action, approvalToken, command} is
// parked in the service-role-only `naia_pending_actions` table and the button
// only references the row uuid. Unlike the Slack in-memory fallback, this
// survives serverless instances and deploys. Claims are single-use and
// scoped to the profile that owns the draft; expired rows are purged on read.
export type NaiaPendingDraft = {
  action: NaiaActionDraft;
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

  const { data } = await supabase
    .from("naia_pending_actions")
    .delete()
    .eq("id", id)
    .eq("profile_id", profileId)
    .gt("expires_at", nowIso)
    .select("draft")
    .maybeSingle();

  const draft = (data as { draft?: unknown } | null)?.draft;

  return isPendingDraft(draft) ? draft : null;
}

function isPendingDraft(value: unknown): value is NaiaPendingDraft {
  if (!value || typeof value !== "object") return false;

  const draft = value as Partial<NaiaPendingDraft>;

  return (
    typeof draft.approvalToken === "string" &&
    typeof draft.command === "string" &&
    Boolean(draft.action) &&
    typeof draft.action === "object" &&
    typeof (draft.action as { id?: unknown }).id === "string" &&
    typeof (draft.action as { kind?: unknown }).kind === "string"
  );
}
