"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createServerSupabaseClient } from "@/platform/auth/supabase-server";
import {
  hasPermission,
  type OrganizationRole,
} from "@/platform/core/permissions";

import {
  fetchCrmNavigationSummary,
  fetchCrmPipelineAuxiliary,
  fetchCrmPipelineSnapshot,
} from "./pipeline-data";

const reorderPipelineSchema = z
  .object({
    expectedOrderedIds: z.array(z.string().uuid()).max(5000),
    orderedIds: z.array(z.string().uuid()).max(5000),
    status: z.string().trim().min(1).max(160),
  })
  .superRefine((value, context) => {
    const expected = new Set(value.expectedOrderedIds);
    const requested = new Set(value.orderedIds);
    const isPermutation =
      expected.size === value.expectedOrderedIds.length &&
      requested.size === value.orderedIds.length &&
      expected.size === requested.size &&
      [...expected].every((id) => requested.has(id));

    if (!isPermutation) {
      context.addIssue({
        code: "custom",
        message: "L’ordre demandé n’est pas une permutation valide.",
      });
    }
  });

export async function fetchCrmPipelineSnapshotAction() {
  return fetchCrmPipelineSnapshot();
}

export async function fetchCrmPipelineAuxiliaryAction() {
  return fetchCrmPipelineAuxiliary();
}

export async function reorderCrmPipelineLeadsAction(input: {
  expectedOrderedIds: string[];
  orderedIds: string[];
  status: string;
}): Promise<{ error?: string; success: boolean }> {
  const parsed = reorderPipelineSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Ordre CRM invalide.",
      success: false,
    };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return { error: "Client d’authentification indisponible.", success: false };
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { error: "Authentification requise.", success: false };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("organization_memberships")
    .select("organization_id, role")
    .eq("profile_id", user.id)
    .limit(1)
    .maybeSingle();
  const role = membership?.role as OrganizationRole | undefined;

  if (
    membershipError ||
    !membership?.organization_id ||
    !role ||
    !hasPermission(role, { action: "update", module: "crm" })
  ) {
    return {
      error: "Tu n’as pas la permission de réorganiser ce pipeline.",
      success: false,
    };
  }

  const { error } = await supabase.rpc("reorder_crm_pipeline_leads", {
    expected_ordered_ids: parsed.data.expectedOrderedIds,
    requested_ordered_ids: parsed.data.orderedIds,
    requested_organization_id: membership.organization_id,
    requested_status: parsed.data.status,
  });

  if (error) {
    return {
      error:
        error.code === "40001"
          ? "L’ordre a changé entre-temps. Le pipeline va être rechargé."
          : error.message,
      success: false,
    };
  }

  revalidatePath("/dashboard/leads");
  return { success: true };
}

export async function fetchCrmNavigationSummaryAction() {
  return fetchCrmNavigationSummary();
}
