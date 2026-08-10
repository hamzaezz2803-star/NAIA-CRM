"use server";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getGroqApiKey } from "@/platform/ai/groq";
import { createServerSupabaseClient } from "@/platform/auth/supabase-server";
import { getAppBaseUrl } from "@/platform/auth/config";
import {
  ensureClientDriveFolder,
  isDriveServiceConfigured,
} from "@/platform/integrations/google-drive-service";
import { hasForbiddenGoogleDriveScope } from "@/platform/integrations/google-workspace-scopes";
import { createSystemNotification } from "@/platform/notifications/actions";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CrmLeadStatus,
  CrmLeadSummary,
  CrmCompanyDetail,
  CrmCompanySummary,
  CrmContactSummary,
  CrmCategory,
  CrmTag,
  CrmLeadNote,
} from "./contracts";
import {
  addDummyCrmLead,
  dummyCrmCompanies,
  dummyCrmContacts,
  dummyCrmOrganizationId,
  getDummyCrmLeads,
} from "./dummy-data";
import { extractCrmLeadWithGroq, generateCrmFollowUpWithGroq } from "./ai";
import { normalizeCrmDateTimeForStorage } from "./date-time";
import {
  allowsCrmProviderSideEffects,
  type CrmAccessScope,
} from "./confidentiality";
import { CRM_PIPELINE_LEAD_COLUMNS, mapCrmPipelineLead } from "./pipeline-data";
import {
  hasPermission,
  type OrganizationRole,
} from "@/platform/core/permissions";

// ────────────────────────────────────────────────────────────
// Types for DB rows (aligned with 20260624120000_crm_tables.sql)
// ────────────────────────────────────────────────────────────

type DbLead = {
  access_scope: CrmAccessScope;
  id: string;
  organization_id: string;
  company_id: string | null;
  contact_id: string | null;
  topic: string;
  source: string | null;
  status: CrmLeadStatus;
  notes: string | null;
  next_action: string | null;
  next_action_date: string | null;
  lead_date: string | null;
  contact_job_title: string | null;
  contact_linkedin_url: string | null;
  assigned_to_profile_id: string | null;
  last_updated_by_profile_id: string | null;
  last_updated_at: string;
  last_contacted_at: string | null;
  drive_folder_url: string | null;
  created_at: string;
  updated_at: string;
};

type DbCompany = {
  id: string;
  organization_id: string;
  name: string;
  industry: string | null;
  website: string | null;
  drive_folder_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type DbContact = {
  id: string;
  organization_id: string;
  company_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  linkedin_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

async function getOrgId(): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return null;

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return null;

  const { data: membership } = await supabase
    .from("organization_memberships")
    .select("organization_id")
    .eq("profile_id", user.id)
    .limit(1)
    .single();

  return membership?.organization_id ?? null;
}

// Trusted execution context for server-side bridges (for example the Slack
// bridge) that already resolved the acting user and organization without a
// cookie session. The caller is responsible for checking role permissions
// with hasPermission() before invoking a write action with this context.
export type CrmActionContext = {
  actorProfileId: string | null;
  organizationId: string;
  supabase: SupabaseClient;
};

function resolveTrustedCrmContext(
  context?: CrmActionContext,
): CrmActionContext | null {
  if (!context) return null;

  // Server actions are network-invokable, so a malicious client could post a
  // forged context object to hijack the organization scope. A serialized
  // payload can never carry a callable Supabase client, so requiring one
  // guarantees the context was injected by trusted server code.
  if (typeof context.supabase?.from !== "function") return null;
  if (!context.organizationId || typeof context.organizationId !== "string") {
    return null;
  }

  return context;
}

function shouldUseDummyCrmData() {
  return (
    process.env.CRM_DUMMY_DATA === "enabled" ||
    (process.env.NODE_ENV === "development" &&
      process.env.CRM_DUMMY_DATA !== "disabled")
  );
}

function fallbackLeads() {
  return shouldUseDummyCrmData() ? getDummyCrmLeads() : [];
}

function fallbackCompanies() {
  return shouldUseDummyCrmData() ? dummyCrmCompanies : [];
}

function fallbackContacts() {
  return shouldUseDummyCrmData() ? dummyCrmContacts : [];
}

function fallbackCompanyDetail(companyId: string): {
  company: CrmCompanyDetail | null;
  contacts: CrmContactSummary[];
  leads: CrmLeadSummary[];
} {
  if (!shouldUseDummyCrmData()) {
    return { company: null, contacts: [], leads: [] };
  }

  const company = dummyCrmCompanies.find(({ id }) => id === companyId) ?? null;

  if (!company) {
    return { company: null, contacts: [], leads: [] };
  }

  return {
    company,
    contacts: dummyCrmContacts.filter(
      ({ companyId: contactCompanyId }) => contactCompanyId === companyId,
    ),
    leads: getDummyCrmLeads().filter(
      ({ companyId: leadCompanyId }) => leadCompanyId === companyId,
    ),
  };
}

function parseContactInfoFromNotes(notes?: string | null) {
  if (!notes) return { company: "", contact: "" };
  const lines = notes.split("\n");
  const company =
    lines
      .find((l) => l.startsWith("Entreprise:"))
      ?.replace("Entreprise:", "")
      .trim() ?? "";
  const contact =
    lines
      .find((l) => l.startsWith("Contact:"))
      ?.replace("Contact:", "")
      .trim() ?? "";
  return { company, contact };
}

async function syncLeadTask(
  supabase: any,
  orgId: string,
  leadId: string,
  userId: string | null,
) {
  const { data: leadData } = await supabase
    .from("crm_leads")
    .select("topic, next_action, lead_date, assigned_to_profile_id")
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .single();

  if (leadData) {
    if (leadData.next_action && leadData.next_action.trim()) {
      // Check if a task exists for this lead
      const { data: existingTask } = await supabase
        .from("crm_tasks")
        .select("id")
        .eq("lead_id", leadId)
        .eq("organization_id", orgId)
        .limit(1)
        .maybeSingle();

      if (existingTask) {
        // Update task title, due date, assignee
        await supabase
          .from("crm_tasks")
          .update({
            title: leadData.next_action.trim(),
            description: `Tâche de suivi pour le lead: ${leadData.topic}`,
            due_date: leadData.lead_date
              ? new Date(leadData.lead_date).toISOString()
              : null,
            assigned_to_profile_id: leadData.assigned_to_profile_id,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingTask.id);
      } else {
        // Insert new task
        await supabase.from("crm_tasks").insert({
          organization_id: orgId,
          title: leadData.next_action.trim(),
          description: `Tâche de suivi pour le lead: ${leadData.topic}`,
          status: "todo",
          due_date: leadData.lead_date
            ? new Date(leadData.lead_date).toISOString()
            : null,
          lead_id: leadId,
          assigned_to_profile_id: leadData.assigned_to_profile_id,
          created_by_profile_id: userId,
        });
      }
    } else {
      // Delete any active task linked to this lead to keep it clean
      await supabase
        .from("crm_tasks")
        .delete()
        .eq("lead_id", leadId)
        .eq("status", "todo");
    }
  }
}

// ────────────────────────────────────────────────────────────
// LEADS
// ────────────────────────────────────────────────────────────

export async function fetchLeadsAction(
  _options: { backfill?: boolean } = {},
): Promise<CrmLeadSummary[]> {
  // Kept temporarily for callers that still pass { backfill: false }.
  // Reads are now always side-effect-free regardless of this legacy option.
  void _options;
  const supabase = await createServerSupabaseClient();
  if (!supabase) return fallbackLeads();

  const orgId = await getOrgId();
  if (!orgId) return fallbackLeads();

  const { data, error } = await supabase
    .from("crm_leads")
    .select(CRM_PIPELINE_LEAD_COLUMNS)
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (error || !data) {
    if (error) console.error("fetchLeadsAction query error:", error);
    return fallbackLeads();
  }

  const rows = data as any[];
  if (rows.length === 0) return fallbackLeads();

  return rows.map(mapCrmPipelineLead);
}

export type LeadTodoCard = {
  id: string;
  topic: string;
  status: string;
  nextAction?: string;
  leadDate?: string;
  companyName?: string;
  contactName?: string;
  contactJobTitle?: string;
  assignedToProfileId?: string;
  assignedToName?: string;
  lastContactedAt?: string;
  tags?: import("./contracts").CrmTag[];
  source?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export async function fetchLeadsForTodoAction(): Promise<LeadTodoCard[]> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  const orgId = await getOrgId();
  if (!orgId) return [];

  const { data, error } = await supabase
    .from("crm_leads")
    .select(
      `
      *,
      company:company_id(id, name),
      contact:contact_id(id, name),
      assigned_to:assigned_to_profile_id(id, full_name, email),
      crm_lead_tags(
        crm_tags(id, name, color)
      )
    `,
    )
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .order("lead_date", { ascending: true, nullsFirst: false });

  if (error || !data) {
    if (error) console.error("fetchLeadsForTodoAction error:", error);
    return [];
  }

  return (data as any[]).map((row) => ({
    id: row.id,
    topic: row.topic,
    status: row.status,
    nextAction: row.next_action ?? undefined,
    leadDate: row.lead_date ?? row.next_action_date ?? undefined,
    companyName: row.company?.name ?? undefined,
    contactName: row.contact?.name ?? undefined,
    contactJobTitle: row.contact_job_title ?? undefined,
    assignedToProfileId: row.assigned_to_profile_id ?? undefined,
    assignedToName:
      row.assigned_to?.full_name ||
      row.assigned_to?.email?.split("@")[0] ||
      undefined,
    lastContactedAt: row.last_contacted_at ?? undefined,
    source: row.source ?? undefined,
    notes: row.notes ?? undefined,
    tags: (row.crm_lead_tags ?? [])
      .map((lt: any) => lt.crm_tags)
      .filter(Boolean)
      .map((t: any) => ({
        id: t.id,
        organizationId: t.organization_id ?? "",
        name: t.name,
        color: t.color,
      })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

type CreateLeadActionResult = {
  accessScope?: CrmAccessScope;
  calendarError?: string;
  calendarLink?: string;
  calendarSynced?: boolean;
  error?: string;
  lead?: CrmLeadSummary;
  success: boolean;
};

export async function createLeadAction(
  input: {
    topic: string;
    companyId?: string;
    companyName?: string;
    contactId?: string;
    contactEmail?: string;
    contactName?: string;
    contactPhone?: string;
    source?: string;
    status?: CrmLeadStatus;
    notes?: string;
    nextAction?: string;
    leadDate?: string;
    contactJobTitle?: string;
    contactLinkedinUrl?: string;
    assignedToProfileId?: string;
    tagIds?: string[];
    tagNames?: string[];
    skipGoogleCalendarSync?: boolean;
    skipGoogleDriveCreate?: boolean;
  },
  context?: CrmActionContext,
): Promise<CreateLeadActionResult> {
  if (input.leadDate) {
    const normalizedLeadDate = normalizeCrmDateTimeForStorage(input.leadDate);
    if (!normalizedLeadDate) {
      return { success: false, error: "Date planifiée invalide." };
    }
    input = { ...input, leadDate: normalizedLeadDate };
  }

  const trustedContext = resolveTrustedCrmContext(context);
  const supabase =
    trustedContext?.supabase ?? (await createServerSupabaseClient());
  if (!supabase) {
    return shouldUseDummyCrmData()
      ? createDummyLead(input)
      : { success: false, error: "Not configured" };
  }

  const orgId = trustedContext?.organizationId ?? (await getOrgId());
  if (!orgId) {
    return shouldUseDummyCrmData()
      ? createDummyLead(input)
      : { success: false, error: "Not authenticated" };
  }

  const actorProfileId = trustedContext
    ? trustedContext.actorProfileId
    : ((await supabase.auth.getUser()).data.user?.id ?? null);

  if (!actorProfileId) {
    return { success: false, error: "Not authenticated" };
  }

  const parsedContactInfo = parseContactInfoFromNotes(input.notes);
  const company = input.companyName?.trim() || parsedContactInfo.company;
  const contact = input.contactName?.trim() || parsedContactInfo.contact;
  // Company/contact enrichment, confidentiality classification, lead creation
  // and tag associations are one PostgreSQL transaction. A non-founder
  // sensitive attempt fails before the first write, so no partially visible
  // company or contact can survive a rejected lead.
  const { data: atomicResult, error: atomicError } = await supabase.rpc(
    "create_crm_lead_atomic",
    {
      requested_actor_profile_id: actorProfileId,
      requested_assigned_to_profile_id: input.assignedToProfileId ?? null,
      requested_company_id: input.companyId ?? null,
      requested_company_name: company || null,
      requested_contact_email: input.contactEmail ?? null,
      requested_contact_id: input.contactId ?? null,
      requested_contact_job_title: input.contactJobTitle ?? null,
      requested_contact_linkedin_url: input.contactLinkedinUrl ?? null,
      requested_contact_name: contact || null,
      requested_contact_phone: input.contactPhone ?? null,
      requested_lead_date: input.leadDate ?? null,
      requested_next_action: input.nextAction ?? null,
      requested_notes: input.notes ?? null,
      requested_organization_id: orgId,
      requested_source: input.source ?? null,
      requested_status: resolveLeadInsertStatus(input),
      requested_tag_ids: input.tagIds ?? [],
      requested_tag_names: input.tagNames ?? [],
      requested_topic: input.topic,
    },
  );

  type AtomicLeadResult = {
    access_scope: CrmAccessScope;
    company_id: string | null;
    contact_id: string | null;
    lead_id: string;
  };
  const created = atomicResult as AtomicLeadResult | null;

  if (atomicError || !created?.lead_id) {
    return {
      success: false,
      error: atomicError?.message ?? "Atomic lead creation failed",
    };
  }

  const companyId = created.company_id;
  const { data, error } = await supabase
    .from("crm_leads")
    .select()
    .eq("id", created.lead_id)
    .eq("organization_id", orgId)
    .single();

  if (error || !data) {
    return {
      success: false,
      error: error?.message ?? "Created lead could not be read back",
    };
  }

  const row = data as DbLead;

  let calendarSyncResult: { error?: string; success: boolean } | null = null;

  // Sync to Google Calendar if leadDate is set and not skipped
  if (
    input.leadDate &&
    !input.skipGoogleCalendarSync &&
    allowsCrmProviderSideEffects(created.access_scope)
  ) {
    calendarSyncResult = await syncLeadToGoogleCalendar(
      supabase,
      orgId,
      row.id,
      actorProfileId,
    );
  } else if (input.leadDate && created.access_scope === "cofounders") {
    calendarSyncResult = {
      error:
        "Synchronisation Calendar désactivée pour les leads confidentiels.",
      success: false,
    };
  }

  // Sync Todo task
  await syncLeadTask(supabase, orgId, row.id, actorProfileId);

  // Auto-create the client folder in the cofounders shared drive if not
  // skipped. Folders are named after the client company: without a resolved
  // company there is nothing to create (a topic-named folder is never a
  // client folder).
  if (
    !input.skipGoogleDriveCreate &&
    allowsCrmProviderSideEffects(created.access_scope)
  ) {
    try {
      const companyName =
        company ||
        (companyId
          ? ((
              await supabase
                .from("crm_companies")
                .select("name")
                .eq("id", companyId)
                .single()
            ).data?.name ?? null)
          : null);
      if (companyName) {
        await createLeadDriveFolderIfConfigured(supabase, row.id, companyName);
      }
    } catch (driveErr) {
      // Non-blocking — Drive failure must not block lead creation
      console.error("Drive folder auto-create error:", driveErr);
    }
  }

  revalidatePath("/crm");
  revalidatePath("/dashboard/leads");

  await createSystemNotification({
    title: "Nouveau Lead",
    description: `Le lead "${input.topic}" a été créé le ${new Date().toLocaleString("fr-FR")}.`,
    type: "success",
  });

  // Query back populated lead
  const { data: populated, error: popErr } = await supabase
    .from("crm_leads")
    .select(
      `
      *,
      assigned_to:assigned_to_profile_id(id, full_name, email),
      last_updated_by:last_updated_by_profile_id(id, full_name, email),
      company:company_id(id, name),
      contact:contact_id(id, name, email, phone),
      crm_lead_tags(
        crm_tags(id, name, color)
      )
    `,
    )
    .eq("id", row.id)
    .single();

  if (popErr || !populated) {
    return {
      accessScope: created.access_scope,
      success: true,
      calendarError: calendarSyncResult?.error,
      calendarSynced: calendarSyncResult?.success,
      lead: {
        id: row.id,
        organizationId: row.organization_id,
        companyId: row.company_id ?? undefined,
        companyName: input.companyName ?? company ?? undefined,
        contactId: row.contact_id ?? undefined,
        contactName: input.contactName ?? contact ?? undefined,
        contactEmail: input.contactEmail ?? undefined,
        contactPhone: input.contactPhone ?? undefined,
        topic: row.topic,
        source: row.source ?? undefined,
        status: row.status,
        notes: row.notes ?? undefined,
        nextAction: row.next_action ?? undefined,
        leadDate: row.lead_date ?? row.next_action_date ?? undefined,
        contactJobTitle: row.contact_job_title ?? undefined,
        contactLinkedinUrl: row.contact_linkedin_url ?? undefined,
        lastContactedAt: row.last_contacted_at ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    };
  }

  const popRow = populated as any;
  return {
    accessScope: created.access_scope,
    success: true,
    calendarError: calendarSyncResult?.error,
    calendarLink: extractGoogleCalendarEventLink(popRow.notes),
    calendarSynced: calendarSyncResult?.success,
    lead: {
      id: popRow.id,
      organizationId: popRow.organization_id,
      companyId: popRow.company_id ?? undefined,
      companyName: popRow.company?.name ?? undefined,
      contactId: popRow.contact_id ?? undefined,
      contactName: popRow.contact?.name ?? undefined,
      contactEmail: popRow.contact?.email ?? undefined,
      contactPhone: popRow.contact?.phone ?? undefined,
      topic: popRow.topic,
      source: popRow.source ?? undefined,
      status: popRow.status,
      notes: popRow.notes ?? undefined,
      nextAction: popRow.next_action ?? undefined,
      leadDate: popRow.lead_date ?? popRow.next_action_date ?? undefined,
      contactJobTitle: popRow.contact_job_title ?? undefined,
      contactLinkedinUrl: popRow.contact_linkedin_url ?? undefined,
      assignedToProfileId: popRow.assigned_to_profile_id ?? undefined,
      assignedToName:
        popRow.assigned_to?.full_name ||
        popRow.assigned_to?.email?.split("@")[0] ||
        undefined,
      lastUpdatedByProfileId: popRow.last_updated_by_profile_id ?? undefined,
      lastUpdatedByName:
        popRow.last_updated_by?.full_name ||
        popRow.last_updated_by?.email?.split("@")[0] ||
        undefined,
      lastUpdatedAt: popRow.last_updated_at ?? undefined,
      lastContactedAt: popRow.last_contacted_at ?? undefined,
      tags: (popRow.crm_lead_tags ?? [])
        .map((lt: any) => lt.crm_tags)
        .filter(Boolean)
        .map((t: any) => ({
          id: t.id,
          organizationId: t.organization_id,
          name: t.name,
          color: t.color,
        })),
      createdAt: popRow.created_at,
      updatedAt: popRow.updated_at,
    },
  };
}

function createDummyLead(input: {
  topic: string;
  companyId?: string;
  companyName?: string;
  contactId?: string;
  contactEmail?: string;
  contactName?: string;
  contactPhone?: string;
  source?: string;
  status?: CrmLeadStatus;
  notes?: string;
  nextAction?: string;
  leadDate?: string;
  contactJobTitle?: string;
  contactLinkedinUrl?: string;
  assignedToProfileId?: string;
  tagIds?: string[];
}): { success: true; lead: CrmLeadSummary } {
  const now = new Date().toISOString();
  const suffix = Math.random().toString(36).slice(2, 9);
  const { company, contact } = parseContactInfoFromNotes(input.notes);
  const lead: CrmLeadSummary = {
    assignedToProfileId: input.assignedToProfileId,
    companyId: input.companyId,
    companyName: input.companyName ?? company ?? undefined,
    contactId: input.contactId,
    contactEmail: input.contactEmail,
    contactName: input.contactName ?? contact ?? undefined,
    contactPhone: input.contactPhone,
    contactJobTitle: input.contactJobTitle,
    contactLinkedinUrl: input.contactLinkedinUrl,
    tags: (input.tagIds ?? []).map((tagId) => ({
      id: tagId,
      organizationId: dummyCrmOrganizationId,
      name: tagId.replace("demo-tag-", ""),
      color: "teal",
    })),
    createdAt: now,
    id: `demo-lead-${Date.now().toString(36)}-${suffix}`,
    leadDate: input.leadDate,
    nextAction: input.nextAction,
    notes: input.notes,
    organizationId: dummyCrmOrganizationId,
    source: input.source ?? "NAIA",
    status: input.status ?? "lead-to-contact",
    topic: input.topic,
    updatedAt: now,
  };

  addDummyCrmLead(lead);

  return {
    lead,
    success: true,
  };
}

function resolveLeadInsertStatus(input: {
  leadDate?: string;
  status?: CrmLeadStatus;
}): CrmLeadStatus {
  const status = input.status ?? "lead-to-contact";

  if (
    input.leadDate &&
    (status === "lead-to-contact" || status === "contacted")
  ) {
    return "meeting-booked";
  }

  return status;
}

export async function updateLeadStatusAction(
  leadId: string,
  status: CrmLeadStatus,
  context?: CrmActionContext,
): Promise<{ success: boolean; error?: string }> {
  const trustedContext = resolveTrustedCrmContext(context);
  const supabase =
    trustedContext?.supabase ?? (await createServerSupabaseClient());
  if (!supabase) return { success: false, error: "Not configured" };

  const orgId = trustedContext?.organizationId ?? (await getOrgId());
  if (!orgId) return { success: false, error: "Not authenticated" };

  const previousStatus =
    status === "meeting-booked"
      ? await fetchLeadStatus(supabase, orgId, leadId)
      : null;

  const nextAction = getStatusDrivenNextAction(status);
  const { data, error } = await supabase
    .from("crm_leads")
    .update({
      ...(nextAction ? { next_action: nextAction } : {}),
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .select("id");

  if (error) return { success: false, error: error.message };

  // Zero returned rows means the update matched nothing (unknown lead id or
  // another organization): report a failure instead of a silent no-op.
  if (!data || data.length === 0) {
    return { success: false, error: "Lead introuvable" };
  }

  if (status === "meeting-booked" && previousStatus !== "meeting-booked") {
    // Deferred after the response: up to a dozen sequential Drive calls must
    // not block the status change.
    after(() => createMeetingBookedLeadDriveFolder(supabase, leadId));
  }

  revalidatePath("/crm");
  revalidatePath("/dashboard/leads");
  return { success: true };
}

/** Status of a lead before an update, used to detect real transitions. */
async function fetchLeadStatus(
  supabase: any,
  orgId: string,
  leadId: string,
): Promise<CrmLeadStatus | null> {
  const { data } = await supabase
    .from("crm_leads")
    .select("status")
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .maybeSingle();

  return data?.status ?? null;
}

function getStatusDrivenNextAction(status: CrmLeadStatus) {
  if (status === "meeting-booked") {
    return "Maya: preparer le pitch tailor-made avec notes CRM, base Qarizmi et cas d'usage client.";
  }

  if (status === "proposal-sent") {
    return "Maya: preparer la propale depuis le compte rendu meeting, le scope, le planning et le payment plan.";
  }

  return undefined;
}

export async function updateLeadAction(
  leadId: string,
  updates: Partial<{
    topic: string;
    status: CrmLeadStatus;
    notes: string;
    nextAction: string;
    leadDate: string;
    source: string;
    companyId: string;
    contactId: string;
    contactJobTitle: string;
    contactLinkedinUrl: string;
    assignedToProfileId: string | null;
    tagIds: string[];
    skipGoogleDriveCreate: boolean;
  }>,
): Promise<{ success: boolean; lead?: CrmLeadSummary; error?: string }> {
  if (updates.leadDate) {
    const normalizedLeadDate = normalizeCrmDateTimeForStorage(updates.leadDate);
    if (!normalizedLeadDate) {
      return { success: false, error: "Date planifiée invalide." };
    }
    updates = { ...updates, leadDate: normalizedLeadDate };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) return { success: false, error: "Not configured" };

  const orgId = await getOrgId();
  if (!orgId) return { success: false, error: "Not authenticated" };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return { success: false, error: "Not authenticated" };

  // Notes can suggest a company/contact, but resolving or creating those
  // records must happen inside the same database transaction as the lead
  // update. A rejected confidential update must never leave visible orphans.
  const parsedContactInfo =
    updates.notes !== undefined
      ? parseContactInfoFromNotes(updates.notes)
      : { company: undefined, contact: undefined };

  const requestedUpdates: Record<string, unknown> = {};
  if (updates.topic !== undefined) requestedUpdates.topic = updates.topic;
  if (updates.status !== undefined) requestedUpdates.status = updates.status;
  if (updates.notes !== undefined) requestedUpdates.notes = updates.notes;
  if (updates.nextAction !== undefined)
    requestedUpdates.next_action = updates.nextAction;
  if (updates.leadDate !== undefined)
    requestedUpdates.lead_date = updates.leadDate || null;
  if (updates.source !== undefined) requestedUpdates.source = updates.source;
  if (updates.companyId !== undefined)
    requestedUpdates.company_id = updates.companyId || null;
  if (updates.contactId !== undefined)
    requestedUpdates.contact_id = updates.contactId || null;
  if (updates.contactJobTitle !== undefined)
    requestedUpdates.contact_job_title = updates.contactJobTitle || null;
  if (updates.contactLinkedinUrl !== undefined)
    requestedUpdates.contact_linkedin_url = updates.contactLinkedinUrl || null;
  if (updates.assignedToProfileId !== undefined)
    requestedUpdates.assigned_to_profile_id = updates.assignedToProfileId;
  if (updates.tagIds !== undefined) requestedUpdates.tag_ids = updates.tagIds;

  const shouldCreateDriveFolder =
    updates.status === "meeting-booked" && !updates.skipGoogleDriveCreate;
  const previousStatus = shouldCreateDriveFolder
    ? await fetchLeadStatus(supabase, orgId, leadId)
    : null;

  const { data: atomicUpdate, error } = await supabase.rpc(
    "update_crm_lead_atomic",
    {
      requested_actor_profile_id: user.id,
      requested_auto_company_name:
        updates.companyId === undefined
          ? (parsedContactInfo.company ?? null)
          : null,
      requested_auto_contact_name:
        updates.contactId === undefined
          ? (parsedContactInfo.contact ?? null)
          : null,
      requested_lead_id: leadId,
      requested_organization_id: orgId,
      requested_updates: requestedUpdates,
    },
  );

  if (error) return { success: false, error: error.message };
  if (!atomicUpdate) {
    return { success: false, error: "Lead introuvable" };
  }

  if (shouldCreateDriveFolder && previousStatus !== "meeting-booked") {
    // Deferred after the response: up to a dozen sequential Drive calls must
    // not block the update.
    after(() => createMeetingBookedLeadDriveFolder(supabase, leadId));
  }

  await syncLeadToGoogleCalendar(supabase, orgId, leadId);

  // Sync Todo task
  await syncLeadTask(supabase, orgId, leadId, user?.id ?? null);

  // Query back populated lead
  const { data: updatedData } = await supabase
    .from("crm_leads")
    .select(
      `
      *,
      assigned_to:assigned_to_profile_id(id, full_name, email),
      last_updated_by:last_updated_by_profile_id(id, full_name, email),
      company:company_id(id, name),
      contact:contact_id(id, name, email, phone),
      crm_lead_tags(
        crm_tags(id, name, color)
      )
    `,
    )
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .single();

  revalidatePath("/crm");
  revalidatePath("/dashboard/leads");

  let updatedLead: CrmLeadSummary | undefined;
  if (updatedData) {
    const row = updatedData as any;
    updatedLead = {
      id: row.id,
      organizationId: row.organization_id,
      companyId: row.company_id ?? undefined,
      companyName: row.company?.name ?? undefined,
      contactId: row.contact_id ?? undefined,
      contactName: row.contact?.name ?? undefined,
      contactEmail: row.contact?.email ?? undefined,
      contactPhone: row.contact?.phone ?? undefined,
      topic: row.topic,
      source: row.source ?? undefined,
      status: row.status,
      notes: row.notes ?? undefined,
      nextAction: row.next_action ?? undefined,
      leadDate: row.lead_date ?? row.next_action_date ?? undefined,
      contactJobTitle: row.contact_job_title ?? undefined,
      contactLinkedinUrl: row.contact_linkedin_url ?? undefined,
      assignedToProfileId: row.assigned_to_profile_id ?? undefined,
      assignedToName:
        row.assigned_to?.full_name ||
        row.assigned_to?.email?.split("@")[0] ||
        undefined,
      lastUpdatedByProfileId: row.last_updated_by_profile_id ?? undefined,
      lastUpdatedByName:
        row.last_updated_by?.full_name ||
        row.last_updated_by?.email?.split("@")[0] ||
        undefined,
      lastUpdatedAt: row.last_updated_at ?? undefined,
      lastContactedAt: row.last_contacted_at ?? undefined,
      tags: (row.crm_lead_tags ?? [])
        .map((lt: any) => lt.crm_tags)
        .filter(Boolean)
        .map((t: any) => ({
          id: t.id,
          organizationId: t.organization_id,
          name: t.name,
          color: t.color,
        })),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  return { success: true, lead: updatedLead };
}

export async function deleteLeadAction(
  leadId: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { success: false, error: "Not configured" };

  const orgId = await getOrgId();
  if (!orgId) return { success: false, error: "Not authenticated" };

  // Fetch lead to get the event ID first for deletion from Google Calendar
  const { data: lead } = await supabase
    .from("crm_leads")
    .select("notes, access_scope")
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .single();

  if (
    lead &&
    lead.notes &&
    allowsCrmProviderSideEffects(lead.access_scope as CrmAccessScope)
  ) {
    const eventIdMatch = lead.notes.match(
      /\[Google Calendar Event ID:\s*([^\]]+)\]/,
    );
    const eventId = eventIdMatch ? eventIdMatch[1].trim() : null;

    if (eventId) {
      const eventOwnerMatch = lead.notes.match(
        /\[Google Calendar Event Owner:\s*([^\]]+)\]/,
      );
      const eventOwner = eventOwnerMatch ? eventOwnerMatch[1].trim() : null;

      const {
        data: { user: actingUser },
      } = await supabase.auth.getUser();

      // Per-user RLS only exposes the caller's own connection; an event
      // created by another member stays on their calendar (logged below).
      const { data: connection } =
        actingUser && (!eventOwner || eventOwner === actingUser.id)
          ? await supabase
              .from("integration_connections")
              .select("*")
              .eq("organization_id", orgId)
              .eq("provider", "google")
              .eq("connected_by_profile_id", actingUser.id)
              .limit(1)
              .maybeSingle()
          : { data: null };

      if (!connection) {
        console.warn(
          "Calendar event not removed during lead deletion (owned by another member or no connection):",
          eventId,
        );
      }

      if (connection && connection.status === "connected") {
        const accessToken = await getOrRefreshGoogleToken(
          supabase,
          orgId,
          connection,
        );
        if (accessToken) {
          try {
            const delRes = await fetch(
              `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
              {
                method: "DELETE",
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              },
            );
            if (!delRes.ok && delRes.status !== 404 && delRes.status !== 410) {
              console.error(
                "Google Calendar event delete failed during lead deletion:",
                await delRes.text(),
              );
            }
          } catch (err) {
            console.error(
              "Failed to delete Google Calendar event during lead deletion:",
              err,
            );
          }
        }
      }
    }
  }

  const { error } = await supabase
    .from("crm_leads")
    .delete()
    .eq("id", leadId)
    .eq("organization_id", orgId);

  if (error) return { success: false, error: error.message };

  revalidatePath("/crm");
  revalidatePath("/dashboard/leads");

  await createSystemNotification({
    title: "Lead supprimé",
    description: `Un lead a été supprimé le ${new Date().toLocaleString("fr-FR")}.`,
    type: "alert",
  });

  return { success: true };
}

// ────────────────────────────────────────────────────────────
// COMPANIES
// ────────────────────────────────────────────────────────────

export async function fetchCompaniesAction(): Promise<CrmCompanySummary[]> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return fallbackCompanies();

  const orgId = await getOrgId();
  if (!orgId) return fallbackCompanies();

  const { data, error } = await supabase
    .from("crm_companies")
    .select("id, organization_id, name, drive_folder_url")
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .order("name");

  if (error || !data || data.length === 0) return fallbackCompanies();

  return (data as DbCompany[]).map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    driveFolderUrl: row.drive_folder_url ?? undefined,
  }));
}

export async function createCompanyAction(input: {
  name: string;
  industry?: string;
  website?: string;
  notes?: string;
}): Promise<{ success: boolean; company?: CrmCompanySummary; error?: string }> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { success: false, error: "Not configured" };

  const orgId = await getOrgId();
  if (!orgId) return { success: false, error: "Not authenticated" };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("crm_companies")
    .insert({
      organization_id: orgId,
      name: input.name,
      industry: input.industry ?? null,
      website: input.website ?? null,
      notes: input.notes ?? null,
      created_by_profile_id: user?.id ?? null,
    })
    .select()
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? "Insert failed" };
  }

  revalidatePath("/crm");
  const row = data as DbCompany;
  return {
    success: true,
    company: {
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      driveFolderUrl: row.drive_folder_url ?? undefined,
    },
  };
}

export async function updateCompanyDriveFolderAction(
  companyId: string,
  driveFolderUrl: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { success: false, error: "Not configured" };

  const orgId = await getOrgId();
  if (!orgId) return { success: false, error: "Not authenticated" };

  const { error } = await supabase
    .from("crm_companies")
    .update({
      drive_folder_url: driveFolderUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("id", companyId)
    .eq("organization_id", orgId);

  if (error) return { success: false, error: error.message };

  revalidatePath("/crm");
  revalidatePath("/dashboard/documents");
  return { success: true };
}

export async function updateCompanyAction(
  companyId: string,
  updates: Partial<{
    name: string;
    industry: string;
    website: string;
    notes: string;
  }>,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { success: false, error: "Not configured" };

  const orgId = await getOrgId();
  if (!orgId) return { success: false, error: "Not authenticated" };

  const { error } = await supabase
    .from("crm_companies")
    .update({
      ...(updates.name !== undefined && { name: updates.name }),
      ...(updates.industry !== undefined && {
        industry: updates.industry || null,
      }),
      ...(updates.website !== undefined && {
        website: updates.website || null,
      }),
      ...(updates.notes !== undefined && { notes: updates.notes || null }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", companyId)
    .eq("organization_id", orgId);

  if (error) return { success: false, error: error.message };

  revalidatePath("/crm");
  revalidatePath("/dashboard/clients");
  return { success: true };
}

export async function fetchCompanyDetailAction(companyId: string): Promise<{
  company: import("./contracts").CrmCompanyDetail | null;
  contacts: import("./contracts").CrmContactSummary[];
  leads: import("./contracts").CrmLeadSummary[];
}> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return fallbackCompanyDetail(companyId);

  const orgId = await getOrgId();
  if (!orgId) return fallbackCompanyDetail(companyId);

  const [companyRes, contactsRes, leadsRes] = await Promise.all([
    supabase
      .from("crm_companies")
      .select(
        "id, organization_id, name, industry, website, drive_folder_url, notes",
      )
      .eq("id", companyId)
      .eq("organization_id", orgId)
      .single(),
    supabase
      .from("crm_contacts")
      .select(
        `
        id, organization_id, company_id, name, email, phone, job_title, linkedin_url,
        crm_contact_tags(
          crm_tags(id, name, color)
        )
        `,
      )
      .eq("company_id", companyId)
      .eq("organization_id", orgId)
      .order("name"),
    supabase
      .from("crm_leads")
      .select("*")
      .eq("company_id", companyId)
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false }),
  ]);

  if (companyRes.error || !companyRes.data) {
    return { company: null, contacts: [], leads: [] };
  }

  const row = companyRes.data as DbCompany;
  const company: import("./contracts").CrmCompanyDetail = {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    driveFolderUrl: row.drive_folder_url ?? undefined,
    industry: row.industry ?? undefined,
    website: row.website ?? undefined,
    notes: row.notes ?? undefined,
  };

  const contacts: import("./contracts").CrmContactSummary[] = (
    (contactsRes.data ?? []) as any[]
  ).map((c) => ({
    id: c.id,
    organizationId: c.organization_id,
    companyId: c.company_id ?? undefined,
    name: c.name,
    email: c.email ?? undefined,
    phone: c.phone ?? undefined,
    jobTitle: c.job_title ?? undefined,
    linkedinUrl: c.linkedin_url ?? undefined,
    tags: (c.crm_contact_tags ?? [])
      .map((ct: any) => ct.crm_tags)
      .filter(Boolean)
      .map((t: any) => ({
        id: t.id,
        organizationId: t.organization_id,
        name: t.name,
        color: t.color,
      })),
  }));

  const leads: import("./contracts").CrmLeadSummary[] = (
    (leadsRes.data ?? []) as DbLead[]
  ).map((l) => ({
    id: l.id,
    organizationId: l.organization_id,
    companyId: l.company_id ?? undefined,
    contactId: l.contact_id ?? undefined,
    topic: l.topic,
    source: l.source ?? undefined,
    status: l.status,
    notes: l.notes ?? undefined,
    nextAction: l.next_action ?? undefined,
    leadDate: l.lead_date ?? l.next_action_date ?? undefined,
    contactJobTitle: l.contact_job_title ?? undefined,
    contactLinkedinUrl: l.contact_linkedin_url ?? undefined,
    createdAt: l.created_at,
    updatedAt: l.updated_at,
  }));

  return { company, contacts, leads };
}

// ────────────────────────────────────────────────────────────
// CONTACTS
// ────────────────────────────────────────────────────────────

export async function fetchContactsAction(): Promise<CrmContactSummary[]> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return fallbackContacts();

  const orgId = await getOrgId();
  if (!orgId) return fallbackContacts();

  const { data, error } = await supabase
    .from("crm_contacts")
    .select(
      `
      id, organization_id, company_id, name, email, phone, job_title, linkedin_url,
      crm_contact_tags(
        crm_tags(id, name, color)
      )
      `,
    )
    .eq("organization_id", orgId)
    .order("name");

  if (error || !data || data.length === 0) return fallbackContacts();

  return data.map((row: any) => ({
    id: row.id,
    organizationId: row.organization_id,
    companyId: row.company_id ?? undefined,
    name: row.name,
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    jobTitle: row.job_title ?? undefined,
    linkedinUrl: row.linkedin_url ?? undefined,
    tags: (row.crm_contact_tags ?? [])
      .map((ct: any) => ct.crm_tags)
      .filter(Boolean)
      .map((t: any) => ({
        id: t.id,
        organizationId: t.organization_id,
        name: t.name,
        color: t.color,
      })),
  }));
}

export async function createContactAction(input: {
  name: string;
  companyId?: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
  linkedinUrl?: string;
  notes?: string;
  tagIds?: string[];
}): Promise<{ success: boolean; contact?: CrmContactSummary; error?: string }> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { success: false, error: "Not configured" };

  const orgId = await getOrgId();
  if (!orgId) return { success: false, error: "Not authenticated" };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("crm_contacts")
    .insert({
      organization_id: orgId,
      company_id: input.companyId ?? null,
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      job_title: input.jobTitle ?? null,
      linkedin_url: input.linkedinUrl ?? null,
      notes: input.notes ?? null,
      created_by_profile_id: user?.id ?? null,
    })
    .select()
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? "Insert failed" };
  }

  const row = data as DbContact;

  if (input.tagIds && input.tagIds.length > 0) {
    const tagInserts = input.tagIds.map((tagId) => ({
      contact_id: row.id,
      tag_id: tagId,
    }));
    await supabase.from("crm_contact_tags").insert(tagInserts);
  }

  revalidatePath("/crm");
  revalidatePath("/dashboard/clients");

  // Query contact with populated tags
  const { data: populated } = await supabase
    .from("crm_contacts")
    .select(
      `
      id, organization_id, company_id, name, email, phone, job_title, linkedin_url,
      crm_contact_tags(
        crm_tags(id, name, color)
      )
    `,
    )
    .eq("id", row.id)
    .single();

  const pop = (populated || row) as any;

  return {
    success: true,
    contact: {
      id: pop.id,
      organizationId: pop.organization_id,
      companyId: pop.company_id ?? undefined,
      name: pop.name,
      email: pop.email ?? undefined,
      phone: pop.phone ?? undefined,
      jobTitle: pop.job_title ?? undefined,
      linkedinUrl: pop.linkedin_url ?? undefined,
      tags: (pop.crm_contact_tags ?? [])
        .map((ct: any) => ct.crm_tags)
        .filter(Boolean)
        .map((t: any) => ({
          id: t.id,
          organizationId: t.organization_id,
          name: t.name,
          color: t.color,
        })),
    },
  };
}

export async function updateContactAction(
  contactId: string,
  updates: {
    name: string;
    companyId?: string;
    email?: string;
    phone?: string;
    jobTitle?: string;
    linkedinUrl?: string;
    tagIds?: string[];
  },
): Promise<{ success: boolean; contact?: CrmContactSummary; error?: string }> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { success: false, error: "Not configured" };

  const orgId = await getOrgId();
  if (!orgId) return { success: false, error: "Not authenticated" };

  const { error } = await supabase
    .from("crm_contacts")
    .update({
      name: updates.name,
      company_id: updates.companyId ?? null,
      email: updates.email || null,
      phone: updates.phone || null,
      job_title: updates.jobTitle || null,
      linkedin_url: updates.linkedinUrl || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", contactId)
    .eq("organization_id", orgId);

  if (error) return { success: false, error: error.message };

  if (updates.tagIds !== undefined) {
    await supabase
      .from("crm_contact_tags")
      .delete()
      .eq("contact_id", contactId);

    if (updates.tagIds.length > 0) {
      const tagInserts = updates.tagIds.map((tagId) => ({
        contact_id: contactId,
        tag_id: tagId,
      }));
      await supabase.from("crm_contact_tags").insert(tagInserts);
    }
  }

  revalidatePath("/crm");
  revalidatePath("/dashboard/clients");

  const { data: populated } = await supabase
    .from("crm_contacts")
    .select(
      `
      id, organization_id, company_id, name, email, phone, job_title, linkedin_url,
      crm_contact_tags(
        crm_tags(id, name, color)
      )
    `,
    )
    .eq("id", contactId)
    .single();

  if (!populated)
    return { success: false, error: "Failed to fetch updated contact" };
  const pop = populated as any;

  return {
    success: true,
    contact: {
      id: pop.id,
      organizationId: pop.organization_id,
      companyId: pop.company_id ?? undefined,
      name: pop.name,
      email: pop.email ?? undefined,
      phone: pop.phone ?? undefined,
      jobTitle: pop.job_title ?? undefined,
      linkedinUrl: pop.linkedin_url ?? undefined,
      tags: (pop.crm_contact_tags ?? [])
        .map((ct: any) => ct.crm_tags)
        .filter(Boolean)
        .map((t: any) => ({
          id: t.id,
          organizationId: t.organization_id,
          name: t.name,
          color: t.color,
        })),
    },
  };
}

export async function deleteContactAction(
  contactId: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { success: false, error: "Not configured" };

  const orgId = await getOrgId();
  if (!orgId) return { success: false, error: "Not authenticated" };

  const { error } = await supabase
    .from("crm_contacts")
    .delete()
    .eq("id", contactId)
    .eq("organization_id", orgId);

  if (error) return { success: false, error: error.message };

  revalidatePath("/crm");
  revalidatePath("/dashboard/clients");
  return { success: true };
}

// ────────────────────────────────────────────────────────────
// GROQ — Lead extraction from natural language
// ────────────────────────────────────────────────────────────

export async function extractLeadFromNaturalTextAction(text: string): Promise<{
  success: boolean;
  extracted?: {
    topic: string;
    companyName?: string;
    contactName?: string;
    contactEmail?: string;
    contactJobTitle?: string;
    contactLinkedinUrl?: string;
    contactPhone?: string;
    source?: string;
    notes?: string;
    nextAction?: string;
    leadDate?: string;
    status?: CrmLeadStatus;
    tags?: string[];
  };
  error?: string;
}> {
  const apiKey = getGroqApiKey();
  if (!apiKey) {
    return { success: false, error: "GROQ_API_KEY not configured" };
  }

  try {
    const extracted = await extractCrmLeadWithGroq(text);
    if (!extracted) {
      return { success: false, error: "Could not parse AI response" };
    }
    return { success: true, extracted };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: message };
  }
}

// ────────────────────────────────────────────────────────────
// GROQ — Follow-up draft generation
// ────────────────────────────────────────────────────────────

export async function generateFollowUpDraftAction(lead: {
  topic: string;
  contactName?: string;
  companyName?: string;
  notes?: string;
  nextAction?: string;
}): Promise<{
  success: boolean;
  drafts?: { email: string; whatsapp: string };
  error?: string;
}> {
  const apiKey = getGroqApiKey();
  if (!apiKey) {
    return { success: false, error: "GROQ_API_KEY not configured" };
  }

  try {
    const drafts = await generateCrmFollowUpWithGroq(lead);
    if (!drafts) {
      return { success: false, error: "Could not parse AI response" };
    }

    await createSystemNotification({
      title: "Brouillon IA généré",
      description: `Un brouillon de relance a été généré pour le lead "${lead.topic}" le ${new Date().toLocaleString("fr-FR")}.`,
      type: "system",
    });

    return { success: true, drafts };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: message };
  }
}

// ────────────────────────────────────────────────────────────
// GOOGLE DRIVE INTEGRATION ACTIONS
// ────────────────────────────────────────────────────────────

export async function checkGoogleAuthAction(): Promise<boolean> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return false;

  const orgId = await getOrgId();
  if (!orgId) return false;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { data, error } = await supabase
    .from("integration_connections")
    .select("status,scopes")
    .eq("organization_id", orgId)
    .eq("provider", "google")
    .eq("connected_by_profile_id", user.id)
    .limit(1)
    .maybeSingle();

  if (error || !data) return false;

  return (
    data.status === "connected" &&
    !hasForbiddenGoogleDriveScope(
      Array.isArray(data.scopes) ? (data.scopes as string[]) : [],
    )
  );
}

export async function disconnectGoogleAuthAction(): Promise<{
  success: boolean;
  error?: string;
}> {
  // Fail closed for stale clients. Remote OAuth revocation requires the
  // same-origin, explicitly confirmed `/api/integrations/google/revoke` flow;
  // deleting only the local row would leave Google's grant active.
  return {
    success: false,
    error: "Déconnexion Google sécurisée requise depuis le flux de révocation.",
  };
}

export async function createGoogleDriveFolderAction(
  leadId: string,
): Promise<{ success: boolean; folderLink?: string; error?: string }> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { success: false, error: "Not configured" };

  const orgId = await getOrgId();
  if (!orgId) return { success: false, error: "Not authenticated" };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return { success: false, error: "Not authenticated" };

  try {
    let authorized = await resolveAuthorizedDriveLead({
      actorProfileId: user.id,
      leadId,
      organizationId: orgId,
      supabase,
    });
    if (!authorized.ok) {
      return { success: false, error: authorized.error };
    }

    // If already has a folder, return it
    if (authorized.leadFolderUrl) {
      return { success: true, folderLink: authorized.leadFolderUrl };
    }

    // The company's stored folder wins over a name lookup (client renames
    // must not spawn a second folder).
    let folderLink = authorized.companyFolderUrl;
    let folderReused = Boolean(folderLink);
    const providerCompanyId = authorized.companyId;

    // One folder per client (not per lead), created by the org service
    // account inside the cofounders-only "clients" shared-drive folder.
    if (!folderLink) {
      if (!isDriveServiceConfigured()) {
        return {
          success: false,
          error:
            "Drive service account non configuré (GOOGLE_SERVICE_ACCOUNT_KEY / MAYA_DRIVE_OUTPUT_FOLDER_ID).",
        };
      }

      // Re-read membership, tenant, archive state, scope and the canonical
      // company immediately before the provider call. The browser-provided
      // company label is never accepted by this action.
      authorized = await resolveAuthorizedDriveLead({
        actorProfileId: user.id,
        leadId,
        organizationId: orgId,
        supabase,
      });
      if (!authorized.ok) {
        return { success: false, error: authorized.error };
      }
      if (authorized.leadFolderUrl) {
        return { success: true, folderLink: authorized.leadFolderUrl };
      }
      if (authorized.companyId !== providerCompanyId) {
        return {
          success: false,
          error:
            "Le client lié au lead a changé. Recharge la fiche et réessaie.",
        };
      }
      if (authorized.companyFolderUrl) {
        folderLink = authorized.companyFolderUrl;
        folderReused = true;
      }
    }

    if (!folderLink) {
      const clientFolder = await ensureClientDriveFolder(
        authorized.companyName,
      );
      folderLink = clientFolder.folderUrl;
      folderReused = !clientFolder.created;
    }

    // The provider call can outlive an authorization change. Revalidate once
    // more and require checked update results; zero-row writes never become a
    // false success.
    authorized = await resolveAuthorizedDriveLead({
      actorProfileId: user.id,
      leadId,
      organizationId: orgId,
      supabase,
    });
    if (!authorized.ok) {
      return { success: false, error: authorized.error };
    }
    if (authorized.leadFolderUrl) {
      return { success: true, folderLink: authorized.leadFolderUrl };
    }
    if (authorized.companyId !== providerCompanyId) {
      return {
        success: false,
        error: "Le client lié au lead a changé. Recharge la fiche et réessaie.",
      };
    }

    folderLink = authorized.companyFolderUrl ?? folderLink;
    const now = new Date().toISOString();
    const { data: updatedCompany, error: companyUpdateError } = await supabase
      .from("crm_companies")
      .update({ drive_folder_url: folderLink, updated_at: now })
      .eq("id", authorized.companyId)
      .eq("organization_id", orgId)
      .eq("access_scope", "organization")
      .is("archived_at", null)
      .select("id")
      .maybeSingle();
    if (companyUpdateError || !updatedCompany) {
      return {
        success: false,
        error:
          companyUpdateError?.message ??
          "Le client n'est plus modifiable dans ce périmètre.",
      };
    }

    const { data: updatedLead, error: leadUpdateError } = await supabase
      .from("crm_leads")
      .update({ drive_folder_url: folderLink, updated_at: now })
      .eq("id", leadId)
      .eq("organization_id", orgId)
      .eq("company_id", authorized.companyId)
      .eq("access_scope", "organization")
      .is("archived_at", null)
      .select("id")
      .maybeSingle();
    if (leadUpdateError || !updatedLead) {
      return {
        success: false,
        error:
          leadUpdateError?.message ??
          "Le lead n'est plus modifiable dans ce périmètre.",
      };
    }

    const finalAuthorization = await resolveAuthorizedDriveLead({
      actorProfileId: user.id,
      leadId,
      organizationId: orgId,
      supabase,
    });
    if (!finalAuthorization.ok) {
      return { success: false, error: finalAuthorization.error };
    }
    if (finalAuthorization.leadFolderUrl !== folderLink) {
      return {
        success: false,
        error: "Le lien Drive n'a pas été confirmé sur le lead.",
      };
    }

    revalidatePath("/crm");
    revalidatePath("/dashboard/leads");
    revalidatePath("/dashboard/documents");

    await createSystemNotification({
      title: folderReused
        ? "Dossier client Drive retrouvé"
        : "Dossier client Drive créé",
      description: `Le dossier client "${finalAuthorization.companyName}" est disponible dans le Drive partagé Qarizmi (clients) depuis le ${new Date().toLocaleString("fr-FR")}.`,
      type: "success",
      link_url: folderLink,
    });

    return { success: true, folderLink };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: message };
  }
}

type AuthorizedDriveLead = {
  companyFolderUrl: string | null;
  companyId: string;
  companyName: string;
  leadFolderUrl: string | null;
  ok: true;
};

async function resolveAuthorizedDriveLead({
  actorProfileId,
  leadId,
  organizationId,
  supabase,
}: {
  actorProfileId: string;
  leadId: string;
  organizationId: string;
  supabase: any;
}): Promise<AuthorizedDriveLead | { error: string; ok: false }> {
  const { data: membership, error: membershipError } = await supabase
    .from("organization_memberships")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("profile_id", actorProfileId)
    .maybeSingle();
  const role = membership?.role as OrganizationRole | undefined;
  if (
    membershipError ||
    !role ||
    !hasPermission(role, { action: "update", module: "crm" })
  ) {
    return {
      error: "Tu n'as plus la permission de modifier ce lead.",
      ok: false,
    };
  }

  const { data: lead, error: leadError } = await supabase
    .from("crm_leads")
    .select(
      "id, company_id, drive_folder_url, access_scope, company:company_id(id, organization_id, name, drive_folder_url, access_scope, archived_at)",
    )
    .eq("id", leadId)
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .maybeSingle();
  if (leadError || !lead) {
    return {
      error: leadError?.message ?? "Lead introuvable dans cette organisation.",
      ok: false,
    };
  }
  if (!allowsCrmProviderSideEffects(lead.access_scope as CrmAccessScope)) {
    return {
      error: "Les dossiers Drive sont désactivés pour les leads confidentiels.",
      ok: false,
    };
  }

  const relatedCompany = Array.isArray(lead.company)
    ? lead.company[0]
    : lead.company;
  if (
    !lead.company_id ||
    !relatedCompany ||
    relatedCompany.id !== lead.company_id ||
    relatedCompany.organization_id !== organizationId ||
    relatedCompany.archived_at ||
    !allowsCrmProviderSideEffects(
      relatedCompany.access_scope as CrmAccessScope,
    ) ||
    !relatedCompany.name?.trim()
  ) {
    return {
      error:
        "Le lead n'a pas de client actif et autorisé dans cette organisation.",
      ok: false,
    };
  }

  return {
    companyFolderUrl: relatedCompany.drive_folder_url ?? null,
    companyId: relatedCompany.id,
    companyName: relatedCompany.name.trim(),
    leadFolderUrl: lead.drive_folder_url ?? null,
    ok: true,
  };
}

/**
 * Non-blocking helper run after the response when a lead transitions to
 * meeting-booked: the client folder must exist before Maya writes the pitch
 * draft into it. Skips leads that already have a folder or have no
 * resolvable company name.
 */
async function createMeetingBookedLeadDriveFolder(
  supabase: any,
  leadId: string,
): Promise<void> {
  try {
    const { data: lead } = await supabase
      .from("crm_leads")
      .select(
        "company_id, drive_folder_url, notes, access_scope, company:company_id(name)",
      )
      .eq("id", leadId)
      .is("archived_at", null)
      .maybeSingle();

    if (
      !lead ||
      lead.drive_folder_url ||
      !allowsCrmProviderSideEffects(lead.access_scope as CrmAccessScope)
    )
      return;

    const companyName =
      lead.company?.name?.trim() ||
      parseContactInfoFromNotes(lead.notes).company;
    if (!companyName) return;

    await createLeadDriveFolderIfConfigured(supabase, leadId, companyName);

    // The folder was created after the response: make the link show up on
    // the next render.
    revalidatePath("/dashboard/leads");
  } catch (driveErr) {
    // Non-blocking — Drive failure must not block the status change
    console.error("Drive folder auto-create error:", driveErr);
  }
}

/** Non-blocking helper called during createLeadAction */
async function createLeadDriveFolderIfConfigured(
  supabase: any,
  leadId: string,
  companyName: string,
): Promise<void> {
  if (!isDriveServiceConfigured()) {
    console.warn(
      "Drive service account not configured; skipping client folder for lead",
      leadId,
    );
    return;
  }

  const { data: lead } = await supabase
    .from("crm_leads")
    .select("company_id, access_scope")
    .eq("id", leadId)
    .is("archived_at", null)
    .single();

  if (
    !lead ||
    !allowsCrmProviderSideEffects(lead.access_scope as CrmAccessScope)
  ) {
    return;
  }

  // The company's stored folder wins over a name lookup (client renames
  // must not spawn a second folder).
  let folderUrl: string | null = null;
  if (lead?.company_id) {
    const { data: companyRow } = await supabase
      .from("crm_companies")
      .select("drive_folder_url")
      .eq("id", lead.company_id)
      .maybeSingle();
    folderUrl = companyRow?.drive_folder_url ?? null;
  }

  if (!folderUrl) {
    const clientFolder = await ensureClientDriveFolder(companyName);
    folderUrl = clientFolder.folderUrl;
  }

  // Store the client folder on the lead (and its company when linked).
  await supabase
    .from("crm_leads")
    .update({
      drive_folder_url: folderUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("id", leadId);

  if (lead?.company_id) {
    await supabase
      .from("crm_companies")
      .update({
        drive_folder_url: folderUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", lead.company_id);
  }
}

async function getOrRefreshGoogleToken(
  supabase: SupabaseClient,
  orgId: string,
  connection: {
    encrypted_token_reference: string | null;
    id: string;
    scopes?: string[] | null;
  },
): Promise<string | null> {
  if (hasForbiddenGoogleDriveScope(connection.scopes)) return null;

  const tokenData = JSON.parse(connection.encrypted_token_reference || "{}");
  const now = Date.now();

  // If token is valid for more than 5 minutes, use it
  if (tokenData.expiry_date && tokenData.expiry_date > now + 300000) {
    return tokenData.access_token;
  }

  // Token is expired, refresh it
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret || !tokenData.refresh_token) {
    return null;
  }

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokenData.refresh_token,
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    const updatedTokenData = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || tokenData.refresh_token,
      expiry_date: Date.now() + data.expires_in * 1000,
    };

    // Update connection credentials in DB
    await supabase
      .from("integration_connections")
      .update({
        encrypted_token_reference: JSON.stringify(updatedTokenData),
        updated_at: new Date().toISOString(),
      })
      .eq("id", connection.id);

    return data.access_token;
  } catch {
    return null;
  }
}

function parseGoogleError(errText: string): string {
  try {
    const parsed = JSON.parse(errText);
    const message = parsed?.error?.message || "";
    if (
      message.includes("Request had insufficient authentication scopes") ||
      errText.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT")
    ) {
      return "Google Workspace doit etre reconnecte pour autoriser la verification des disponibilites Calendar.";
    }
    if (
      message.includes("Google Calendar API has not been used in project") ||
      errText.includes("SERVICE_DISABLED")
    ) {
      const projectMatch = message.match(/project (\d+)/);
      const projectId = projectMatch ? projectMatch[1] : "603718300262";
      return `L'API Google Calendar n'est pas activée sur votre projet Google Cloud. Veuillez l'activer en visitant ce lien : https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=${projectId} puis réessayez.`;
    }
    return message || errText;
  } catch {
    return errText;
  }
}

type GoogleBusyBlock = {
  end: string;
  start: string;
};

type AvailabilityCheckResult =
  | { available: true }
  | { available: false; suggestedStart?: Date }
  | { error: string };

const CALENDAR_TIME_ZONE = "Africa/Casablanca";
const DEFAULT_MEETING_DURATION_MS = 60 * 60 * 1000;
const SLOT_SEARCH_STEP_MS = 30 * 60 * 1000;

async function checkPrimaryCalendarAvailability(
  accessToken: string,
  requestedStart: Date,
  requestedEnd: Date,
): Promise<AvailabilityCheckResult> {
  const searchEnd = new Date(
    requestedStart.getTime() + 7 * 24 * 60 * 60 * 1000,
  );
  const busyResponse = await fetch(
    "https://www.googleapis.com/calendar/v3/freeBusy",
    {
      body: JSON.stringify({
        calendarExpansionMax: 1,
        items: [{ id: "primary" }],
        timeMax: searchEnd.toISOString(),
        timeMin: requestedStart.toISOString(),
        timeZone: CALENDAR_TIME_ZONE,
      }),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );

  if (!busyResponse.ok) {
    return { error: parseGoogleError(await busyResponse.text()) };
  }

  const payload = (await busyResponse.json()) as {
    calendars?: Record<
      string,
      {
        busy?: GoogleBusyBlock[];
        errors?: Array<{ reason?: string }>;
      }
    >;
  };
  const calendar = payload.calendars?.primary;
  const calendarError = calendar?.errors?.[0]?.reason;
  if (calendarError) {
    return { error: `Google Calendar indisponible: ${calendarError}` };
  }

  const busyBlocks = calendar?.busy ?? [];
  if (!hasBusyOverlap(busyBlocks, requestedStart, requestedEnd)) {
    return { available: true };
  }

  const suggestedStart = findNextAvailableMeetingSlot(
    busyBlocks,
    new Date(requestedStart.getTime() + SLOT_SEARCH_STEP_MS),
    requestedEnd.getTime() - requestedStart.getTime(),
    searchEnd,
  );

  return { available: false, suggestedStart };
}

function hasBusyOverlap(
  busyBlocks: GoogleBusyBlock[],
  candidateStart: Date,
  candidateEnd: Date,
) {
  return busyBlocks.some((block) => {
    const busyStart = new Date(block.start);
    const busyEnd = new Date(block.end);
    return candidateStart < busyEnd && candidateEnd > busyStart;
  });
}

function findNextAvailableMeetingSlot(
  busyBlocks: GoogleBusyBlock[],
  searchStart: Date,
  durationMs: number,
  searchEnd: Date,
) {
  for (
    let candidateStart = new Date(searchStart);
    candidateStart < searchEnd;
    candidateStart = new Date(candidateStart.getTime() + SLOT_SEARCH_STEP_MS)
  ) {
    const candidateEnd = new Date(candidateStart.getTime() + durationMs);
    if (
      isBusinessHourSlot(candidateStart, candidateEnd) &&
      !hasBusyOverlap(busyBlocks, candidateStart, candidateEnd)
    ) {
      return candidateStart;
    }
  }

  return undefined;
}

function isBusinessHourSlot(candidateStart: Date, candidateEnd: Date) {
  const start = getZonedDateParts(candidateStart);
  const end = getZonedDateParts(candidateEnd);
  const isSameLocalDay =
    start.year === end.year &&
    start.month === end.month &&
    start.day === end.day;
  const isWeekday = start.weekday >= 1 && start.weekday <= 5;

  return (
    isSameLocalDay &&
    isWeekday &&
    start.hour >= 9 &&
    (end.hour < 18 || (end.hour === 18 && end.minute === 0))
  );
}

function getZonedDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone: CALENDAR_TIME_ZONE,
    weekday: "short",
    year: "numeric",
  }).formatToParts(date);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const weekdays: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };

  return {
    day: Number(value("day")),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
    month: Number(value("month")),
    weekday: weekdays[value("weekday")] ?? 0,
    year: Number(value("year")),
  };
}

function formatCalendarSuggestion(date: Date) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "long",
    timeZone: CALENDAR_TIME_ZONE,
    weekday: "long",
  }).format(date);
}

function extractGoogleCalendarEventLink(notes?: string | null) {
  const eventLinkMatch = (notes ?? "").match(
    /\[Google Calendar Event Link:\s*([^\]]+)\]/,
  );

  return eventLinkMatch ? eventLinkMatch[1].trim() : undefined;
}

async function syncLeadToGoogleCalendar(
  supabase: SupabaseClient,
  orgId: string,
  leadId: string,
  actorProfileId?: string | null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: lead, error: leadError } = await supabase
      .from("crm_leads")
      .select("*")
      .eq("id", leadId)
      .eq("organization_id", orgId)
      .is("archived_at", null)
      .single();

    if (leadError || !lead) {
      return { success: false, error: "Lead introuvable" };
    }

    // Confidential CRM content never leaves the CRM boundary through an
    // automatic Calendar mutation. This guard runs before looking up or
    // refreshing a Google credential and covers create, update and delete.
    if (!allowsCrmProviderSideEffects(lead.access_scope as CrmAccessScope)) {
      return {
        success: false,
        error:
          "Synchronisation Calendar désactivée pour les leads confidentiels.",
      };
    }

    const notesStr = lead.notes || "";
    const eventIdMatch = notesStr.match(
      /\[Google Calendar Event ID:\s*([^\]]+)\]/,
    );
    const existingEventId = eventIdMatch ? eventIdMatch[1].trim() : null;

    // Fetch the acting user's own google connection: calendar events are
    // created on the calendar of whoever triggers the sync. Bridges without a
    // cookie session (for example Slack) inject the acting profile id.
    const actingUserId =
      actorProfileId ?? (await supabase.auth.getUser()).data.user?.id ?? null;

    const { data: connection } = actingUserId
      ? await supabase
          .from("integration_connections")
          .select("*")
          .eq("organization_id", orgId)
          .eq("provider", "google")
          .eq("connected_by_profile_id", actingUserId)
          .limit(1)
          .maybeSingle()
      : { data: null };

    if (!connection || connection.status !== "connected") {
      return {
        success: false,
        error:
          "Google Workspace non connecté. Veuillez connecter votre compte Google.",
      };
    }

    const accessToken = await getOrRefreshGoogleToken(
      supabase,
      orgId,
      connection,
    );
    if (!accessToken) {
      return {
        success: false,
        error:
          "Session Google expirée ou invalide. Veuillez déconnecter et reconnecter votre compte Google.",
      };
    }

    // Calendar events are calendar-scoped: only the member who created the
    // event can update or delete it. Legacy events without an owner tag are
    // assumed to belong to the acting user; a 404 falls back to re-creation.
    const eventOwnerMatch = notesStr.match(
      /\[Google Calendar Event Owner:\s*([^\]]+)\]/,
    );
    const existingEventOwner = eventOwnerMatch
      ? eventOwnerMatch[1].trim()
      : null;
    const actingUserOwnsEvent =
      !existingEventOwner || existingEventOwner === actingUserId;

    // If lead_date is not set, delete existing event if any
    const finalLeadDate = lead.lead_date ?? lead.next_action_date;
    if (!finalLeadDate) {
      if (existingEventId) {
        if (!actingUserOwnsEvent) {
          // Never touch (or untag) an event that lives on a colleague's
          // calendar: they clear or resync it from their own account.
          return {
            success: false,
            error:
              "L'événement Calendar de ce lead appartient à un autre membre : il doit le resynchroniser (ou le supprimer) depuis son compte.",
          };
        }
        try {
          const delRes = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events/${existingEventId}`,
            {
              method: "DELETE",
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            },
          );

          if (!delRes.ok && delRes.status !== 404 && delRes.status !== 410) {
            const errText = await delRes.text();
            console.error("Google Calendar delete failed:", errText);
          }

          // Remove the event ID, owner, and link tags from notes
          const updatedNotes = notesStr
            .replace(/\[Google Calendar Event ID:\s*([^\]]+)\]\n?/, "")
            .replace(/\[Google Calendar Event Owner:\s*([^\]]+)\]\n?/, "")
            .replace(/\[Google Calendar Event Link:\s*([^\]]+)\]\n?/, "")
            .trim();

          await supabase
            .from("crm_leads")
            .update({
              notes: updatedNotes || null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", leadId);
        } catch (err) {
          console.error("Failed to delete cleared Calendar event:", err);
        }
        return { success: true };
      }
      return {
        success: false,
        error: "Veuillez d'abord définir une date de relance pour ce lead.",
      };
    }

    // Otherwise, create or update the event
    const leadDateStr = finalLeadDate as string;
    const isMidnight =
      !leadDateStr.includes("T") ||
      leadDateStr.includes("T00:00:00") ||
      leadDateStr.endsWith(" 00:00:00");
    const cleanNotes = notesStr
      .replace(/\[Google Calendar Event ID:\s*([^\]]+)\]/g, "")
      .replace(/\[Google Calendar Event Owner:\s*([^\]]+)\]/g, "")
      .replace(/\[Google Calendar Event Link:\s*([^\]]+)\]/g, "")
      .trim();

    const appLink = `${getAppBaseUrl()}/dashboard/leads`;
    const description = `${cleanNotes ? cleanNotes + "\n\n" : ""}Lien vers le lead dans l'application : ${appLink}`;

    let eventPayload: {
      summary: string;
      description: string;
      start: { date?: string; dateTime?: string; timeZone?: string };
      end: { date?: string; dateTime?: string; timeZone?: string };
    };
    if (isMidnight) {
      const startDateStr = leadDateStr.split("T")[0];
      const startDay = new Date(startDateStr);
      const nextDay = new Date(startDay.getTime() + 24 * 60 * 60 * 1000);
      const endDateStr = nextDay.toISOString().split("T")[0];
      eventPayload = {
        summary: lead.topic,
        description,
        start: {
          date: startDateStr,
          timeZone: CALENDAR_TIME_ZONE,
        },
        end: {
          date: endDateStr,
          timeZone: CALENDAR_TIME_ZONE,
        },
      };
    } else {
      const startDate = new Date(leadDateStr);
      const startIso = startDate.toISOString();
      const endDate = new Date(
        startDate.getTime() + DEFAULT_MEETING_DURATION_MS,
      );
      const endIso = endDate.toISOString();
      eventPayload = {
        summary: lead.topic,
        description,
        start: {
          dateTime: startIso,
          timeZone: CALENDAR_TIME_ZONE,
        },
        end: {
          dateTime: endIso,
          timeZone: CALENDAR_TIME_ZONE,
        },
      };
    }

    if (
      !existingEventId &&
      eventPayload.start.dateTime &&
      eventPayload.end.dateTime
    ) {
      const requestedStart = new Date(eventPayload.start.dateTime);
      const requestedEnd = new Date(eventPayload.end.dateTime);
      const availability = await checkPrimaryCalendarAvailability(
        accessToken,
        requestedStart,
        requestedEnd,
      );

      if ("error" in availability) {
        return {
          success: false,
          error: availability.error,
        };
      }

      if (!availability.available) {
        return {
          success: false,
          error: availability.suggestedStart
            ? `Tu as deja un evenement sur ce creneau. Adam suggere ${formatCalendarSuggestion(availability.suggestedStart)}. Modifie la date du lead puis relance la synchronisation.`
            : "Tu as deja un evenement sur ce creneau et Adam n'a pas trouve de creneau libre dans les 7 prochains jours ouvrables.",
        };
      }
    }

    if (existingEventId && !actingUserOwnsEvent) {
      // No-op instead of creating a duplicate event on this user's calendar:
      // the original stays valid on its owner's calendar and keeps its tags.
      return {
        success: false,
        error:
          "L'événement Calendar de ce lead a été créé par un autre membre : lui seul peut le mettre à jour, en resynchronisant depuis son compte.",
      };
    }

    if (existingEventId) {
      const updateRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${existingEventId}?sendUpdates=none`,
        {
          // PATCH changes only the fields NAIA manages. Using a full PUT with
          // an attendee-free payload would silently remove pre-existing
          // attendees from legacy events.
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(eventPayload),
        },
      );

      if (updateRes.ok) {
        const event = await updateRes.json();
        const htmlLink = event.htmlLink;
        if (!notesStr.includes("[Google Calendar Event Link:")) {
          const cleanLinkNotes = notesStr
            .replace(/\[Google Calendar Event Link:\s*([^\]]+)\]\n?/g, "")
            .trim();

          const updatedNotes = cleanLinkNotes
            ? `${cleanLinkNotes}\n[Google Calendar Event Link: ${htmlLink}]`
            : `[Google Calendar Event Link: ${htmlLink}]`;

          await supabase
            .from("crm_leads")
            .update({
              notes: updatedNotes,
              updated_at: new Date().toISOString(),
            })
            .eq("id", leadId);
        }
        return { success: true };
      }

      if (updateRes.status !== 404 && updateRes.status !== 410) {
        const errText = await updateRes.text();
        return {
          success: false,
          error: parseGoogleError(errText),
        };
      }
      // The event vanished from this calendar: fall through and recreate it.
    }

    const createRes = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(eventPayload),
      },
    );

    if (createRes.ok) {
      const event = await createRes.json();
      const newEventId = event.id;
      const htmlLink = event.htmlLink;

      const cleanIdNotes = notesStr
        .replace(/\[Google Calendar Event ID:\s*([^\]]+)\]\n?/g, "")
        .replace(/\[Google Calendar Event Owner:\s*([^\]]+)\]\n?/g, "")
        .replace(/\[Google Calendar Event Link:\s*([^\]]+)\]\n?/g, "")
        .trim();

      const eventTags = `[Google Calendar Event ID: ${newEventId}]\n[Google Calendar Event Owner: ${actingUserId ?? "unknown"}]\n[Google Calendar Event Link: ${htmlLink}]`;
      const updatedNotes = cleanIdNotes
        ? `${cleanIdNotes}\n${eventTags}`
        : eventTags;

      await supabase
        .from("crm_leads")
        .update({
          notes: updatedNotes,
          updated_at: new Date().toISOString(),
        })
        .eq("id", leadId);

      return { success: true };
    } else {
      const errText = await createRes.text();
      return {
        success: false,
        error: parseGoogleError(errText),
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur inconnue";
    console.error("Error syncing to Google Calendar:", err);
    return { success: false, error: msg };
  }
}

export async function syncLeadToGoogleCalendarAction(leadId: string): Promise<{
  success: boolean;
  lead?: CrmLeadSummary;
  error?: string;
  calendarLink?: string;
}> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { success: false, error: "Not configured" };

  const orgId = await getOrgId();
  if (!orgId) return { success: false, error: "Not authenticated" };

  const syncRes = await syncLeadToGoogleCalendar(supabase, orgId, leadId);
  if (!syncRes.success) {
    return { success: false, error: syncRes.error };
  }

  // Fetch updated lead to return it
  const { data: leadData } = await supabase
    .from("crm_leads")
    .select("*")
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .single();

  let updatedLead: CrmLeadSummary | undefined;
  let link: string | undefined;
  if (leadData) {
    const row = leadData as DbLead;
    updatedLead = {
      id: row.id,
      organizationId: row.organization_id,
      companyId: row.company_id ?? undefined,
      contactId: row.contact_id ?? undefined,
      topic: row.topic,
      source: row.source ?? undefined,
      status: row.status,
      notes: row.notes ?? undefined,
      nextAction: row.next_action ?? undefined,
      leadDate: row.lead_date ?? row.next_action_date ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    link = extractGoogleCalendarEventLink(row.notes);
  }

  revalidatePath("/crm");
  revalidatePath("/dashboard/leads");

  return { success: true, lead: updatedLead, calendarLink: link };
}

// ────────────────────────────────────────────────────────────
// CRM Categories / Stages Actions
// ────────────────────────────────────────────────────────────

export async function fetchCategoriesAction(): Promise<CrmCategory[]> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];

  const orgId = await getOrgId();
  if (!orgId) return [];

  const { data, error } = await supabase
    .from("crm_categories")
    .select("id, organization_id, name, status_key, color, position")
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .order("position", { ascending: true });

  if (error) {
    console.error("Error fetching CRM categories:", error);
    return [];
  }

  return data.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    statusKey: row.status_key,
    color: row.color,
    position: row.position,
  }));
}

export async function createCategoryAction(
  name: string,
  color: string,
): Promise<{ success: boolean; error?: string; category?: CrmCategory }> {
  const supabase = await createServerSupabaseClient();
  if (!supabase)
    return { success: false, error: "Authentication client unavailable" };

  const orgId = await getOrgId();
  if (!orgId)
    return { success: false, error: "No active organization context" };

  // Get current maximum position
  const { data: maxPosData } = await supabase
    .from("crm_categories")
    .select("position")
    .eq("organization_id", orgId)
    .order("position", { ascending: false })
    .limit(1);

  const nextPosition =
    maxPosData && maxPosData.length > 0 ? maxPosData[0].position + 1 : 1;

  // Use a random UUID for custom status keys to ensure uniqueness
  const newStatusKey = crypto.randomUUID();

  const { data, error } = await supabase
    .from("crm_categories")
    .insert({
      organization_id: orgId,
      name,
      status_key: newStatusKey,
      color,
      position: nextPosition,
    })
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/crm");
  revalidatePath("/dashboard/leads");

  return {
    success: true,
    category: {
      id: data.id,
      organizationId: data.organization_id,
      name: data.name,
      statusKey: data.status_key,
      color: data.color,
      position: data.position,
    },
  };
}

export async function updateCategoryAction(
  id: string,
  updates: { name?: string; color?: string },
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createServerSupabaseClient();
  if (!supabase)
    return { success: false, error: "Authentication client unavailable" };

  const orgId = await getOrgId();
  if (!orgId)
    return { success: false, error: "No active organization context" };

  const { error } = await supabase
    .from("crm_categories")
    .update({
      ...(updates.name && { name: updates.name }),
      ...(updates.color && { color: updates.color }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("organization_id", orgId);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/crm");
  revalidatePath("/dashboard/leads");

  return { success: true };
}

export async function deleteCategoryAction(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createServerSupabaseClient();
  if (!supabase)
    return { success: false, error: "Authentication client unavailable" };

  const orgId = await getOrgId();
  if (!orgId)
    return { success: false, error: "No active organization context" };

  // Fetch all categories to check size and find a fallback category
  const categories = await fetchCategoriesAction();
  if (categories.length <= 1) {
    return {
      success: false,
      error: "Impossible de supprimer la seule catégorie restante.",
    };
  }

  const categoryToDelete = categories.find((c) => c.id === id);
  if (!categoryToDelete) {
    return { success: false, error: "Catégorie introuvable." };
  }

  const fallbackCategory = categories.find((c) => c.id !== id);
  if (!fallbackCategory) {
    return { success: false, error: "Aucune catégorie de repli disponible." };
  }

  // Re-assign all leads in the deleted category to the fallback category
  const { error: updateError } = await supabase
    .from("crm_leads")
    .update({
      status: fallbackCategory.statusKey,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", orgId)
    .eq("status", categoryToDelete.statusKey);

  if (updateError) {
    return {
      success: false,
      error: `Erreur de réassignation des leads : ${updateError.message}`,
    };
  }

  // Delete the category
  const { error: deleteError } = await supabase
    .from("crm_categories")
    .delete()
    .eq("id", id)
    .eq("organization_id", orgId);

  if (deleteError) {
    return { success: false, error: deleteError.message };
  }

  revalidatePath("/crm");
  revalidatePath("/dashboard/leads");

  return { success: true };
}

export async function reorderCategoriesAction(
  orderedIds: string[],
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createServerSupabaseClient();
  if (!supabase)
    return { success: false, error: "Authentication client unavailable" };

  const orgId = await getOrgId();
  if (!orgId)
    return { success: false, error: "No active organization context" };

  // Perform multiple updates sequentially
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from("crm_categories")
      .update({ position: i + 1, updated_at: new Date().toISOString() })
      .eq("id", orderedIds[i])
      .eq("organization_id", orgId);

    if (error) {
      return {
        success: false,
        error: `Erreur lors de la réorganisation : ${error.message}`,
      };
    }
  }

  revalidatePath("/crm");
  revalidatePath("/dashboard/leads");

  return { success: true };
}

// ────────────────────────────────────────────────────────────
// TEAM MEMBERS
// ────────────────────────────────────────────────────────────

export async function fetchTeamMembersAction(): Promise<
  { id: string; fullName: string; email: string; avatarUrl?: string }[]
> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  const orgId = await getOrgId();
  if (!orgId) return [];

  const { data, error } = await supabase
    .from("organization_memberships")
    .select(
      `
      profile_id,
      profiles:profile_id(id, full_name, email, avatar_url)
    `,
    )
    .eq("organization_id", orgId);

  if (error || !data) return [];

  return data
    .map((row: any) => {
      const p = row.profiles;
      if (!p) return null;
      return {
        id: p.id,
        fullName: p.full_name || p.email.split("@")[0],
        email: p.email,
        avatarUrl: p.avatar_url ?? undefined,
      };
    })
    .filter(Boolean) as {
    id: string;
    fullName: string;
    email: string;
    avatarUrl?: string;
  }[];
}

// ────────────────────────────────────────────────────────────
// TAGS CRUD
// ────────────────────────────────────────────────────────────

export async function fetchTagsAction(): Promise<CrmTag[]> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  const orgId = await getOrgId();
  if (!orgId) return [];

  const { data, error } = await supabase
    .from("crm_tags")
    .select("id, organization_id, name, color")
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .order("name");

  if (error || !data) return [];

  return data.map((row: any) => ({
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    color: row.color,
  }));
}

export async function createTagAction(
  name: string,
  color: string,
): Promise<{ success: boolean; tag?: CrmTag; error?: string }> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { success: false, error: "Not configured" };
  const orgId = await getOrgId();
  if (!orgId) return { success: false, error: "Not authenticated" };

  const { data, error } = await supabase
    .from("crm_tags")
    .insert({
      organization_id: orgId,
      name: name.trim(),
      color,
    })
    .select()
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? "Insert failed" };
  }

  return {
    success: true,
    tag: {
      id: data.id,
      organizationId: data.organization_id,
      name: data.name,
      color: data.color,
    },
  };
}

export async function updateTagAction(
  tagId: string,
  name: string,
  color: string,
): Promise<{ success: boolean; tag?: CrmTag; error?: string }> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { success: false, error: "Not configured" };
  const orgId = await getOrgId();
  if (!orgId) return { success: false, error: "Not authenticated" };

  const { data, error } = await supabase
    .from("crm_tags")
    .update({
      name: name.trim(),
      color,
      updated_at: new Date().toISOString(),
    })
    .eq("id", tagId)
    .eq("organization_id", orgId)
    .select()
    .single();

  if (error || !data)
    return { success: false, error: error?.message ?? "Update failed" };

  return {
    success: true,
    tag: {
      id: data.id,
      organizationId: data.organization_id,
      name: data.name,
      color: data.color,
    },
  };
}

export async function deleteTagAction(
  tagId: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { success: false, error: "Not configured" };
  const orgId = await getOrgId();
  if (!orgId) return { success: false, error: "Not authenticated" };

  const { error } = await supabase
    .from("crm_tags")
    .delete()
    .eq("id", tagId)
    .eq("organization_id", orgId);

  if (error) return { success: false, error: error.message };

  return { success: true };
}

// ────────────────────────────────────────────────────────────
// LEAD NOTES CRUD
// ────────────────────────────────────────────────────────────

export async function fetchLeadNotesAction(
  leadId: string,
): Promise<CrmLeadNote[]> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  const orgId = await getOrgId();
  if (!orgId) return [];

  const { data, error } = await supabase
    .from("crm_lead_notes")
    .select(
      `
      *,
      creator:created_by_profile_id(full_name, email),
      assignee:assigned_to_profile_id(full_name, email)
    `,
    )
    .eq("lead_id", leadId)
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return data.map((row: any) => ({
    id: row.id,
    organizationId: row.organization_id,
    leadId: row.lead_id,
    content: row.content,
    createdByProfileId: row.created_by_profile_id ?? undefined,
    createdByName:
      row.creator?.full_name || row.creator?.email?.split("@")[0] || undefined,
    assignedToProfileId: row.assigned_to_profile_id ?? undefined,
    assignedToName:
      row.assignee?.full_name ||
      row.assignee?.email?.split("@")[0] ||
      undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function createLeadNoteAction(
  leadId: string,
  content: string,
  assignedToProfileId?: string,
): Promise<{ success: boolean; note?: CrmLeadNote; error?: string }> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { success: false, error: "Not configured" };
  const orgId = await getOrgId();
  if (!orgId) return { success: false, error: "Not authenticated" };
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("crm_lead_notes")
    .insert({
      organization_id: orgId,
      lead_id: leadId,
      content: content.trim(),
      created_by_profile_id: user?.id ?? null,
      assigned_to_profile_id: assignedToProfileId || null,
    })
    .select(
      `
      *,
      creator:created_by_profile_id(full_name, email),
      assignee:assigned_to_profile_id(full_name, email)
    `,
    )
    .single();

  if (error || !data)
    return { success: false, error: error?.message ?? "Insert failed" };

  // Update lead last update metadata
  await supabase
    .from("crm_leads")
    .update({
      last_updated_by_profile_id: user?.id ?? null,
      last_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", leadId)
    .eq("organization_id", orgId);

  revalidatePath("/crm");
  revalidatePath("/dashboard/leads");

  return {
    success: true,
    note: {
      id: data.id,
      organizationId: data.organization_id,
      leadId: data.lead_id,
      content: data.content,
      createdByProfileId: data.created_by_profile_id ?? undefined,
      createdByName:
        data.creator?.full_name ||
        data.creator?.email?.split("@")[0] ||
        undefined,
      assignedToProfileId: data.assigned_to_profile_id ?? undefined,
      assignedToName:
        data.assignee?.full_name ||
        data.assignee?.email?.split("@")[0] ||
        undefined,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    },
  };
}

export async function updateLeadNoteAction(
  noteId: string,
  content: string,
  assignedToProfileId?: string,
): Promise<{ success: boolean; note?: CrmLeadNote; error?: string }> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { success: false, error: "Not configured" };
  const orgId = await getOrgId();
  if (!orgId) return { success: false, error: "Not authenticated" };
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: note, error: noteErr } = await supabase
    .from("crm_lead_notes")
    .update({
      content: content.trim(),
      assigned_to_profile_id: assignedToProfileId || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", noteId)
    .eq("organization_id", orgId)
    .select(
      `
      *,
      creator:created_by_profile_id(full_name, email),
      assignee:assigned_to_profile_id(full_name, email)
    `,
    )
    .single();

  if (noteErr || !note)
    return { success: false, error: noteErr?.message ?? "Update failed" };

  // Update lead last update metadata
  await supabase
    .from("crm_leads")
    .update({
      last_updated_by_profile_id: user?.id ?? null,
      last_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", note.lead_id)
    .eq("organization_id", orgId);

  revalidatePath("/crm");
  revalidatePath("/dashboard/leads");

  return {
    success: true,
    note: {
      id: note.id,
      organizationId: note.organization_id,
      leadId: note.lead_id,
      content: note.content,
      createdByProfileId: note.created_by_profile_id ?? undefined,
      createdByName:
        note.creator?.full_name ||
        note.creator?.email?.split("@")[0] ||
        undefined,
      assignedToProfileId: note.assigned_to_profile_id ?? undefined,
      assignedToName:
        note.assignee?.full_name ||
        note.assignee?.email?.split("@")[0] ||
        undefined,
      createdAt: note.created_at,
      updatedAt: note.updated_at,
    },
  };
}

export async function deleteLeadNoteAction(
  noteId: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { success: false, error: "Not configured" };
  const orgId = await getOrgId();
  if (!orgId) return { success: false, error: "Not authenticated" };
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: note } = await supabase
    .from("crm_lead_notes")
    .select("lead_id")
    .eq("id", noteId)
    .eq("organization_id", orgId)
    .single();

  const { error } = await supabase
    .from("crm_lead_notes")
    .delete()
    .eq("id", noteId)
    .eq("organization_id", orgId);

  if (error) return { success: false, error: error.message };

  if (note?.lead_id) {
    // Update lead last update metadata
    await supabase
      .from("crm_leads")
      .update({
        last_updated_by_profile_id: user?.id ?? null,
        last_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", note.lead_id)
      .eq("organization_id", orgId);
  }

  revalidatePath("/crm");
  revalidatePath("/dashboard/leads");
  return { success: true };
}

export async function fetchLeadFollowUpsAction(
  leadId: string,
): Promise<import("./contracts").CrmLeadFollowUp[]> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  const orgId = await getOrgId();
  if (!orgId) return [];

  const { data, error } = await supabase
    .from("crm_lead_follow_ups")
    .select(
      `
      *,
      profiles:created_by_profile_id(full_name, email)
    `,
    )
    .eq("lead_id", leadId)
    .eq("organization_id", orgId)
    .order("contacted_at", { ascending: false });

  if (error || !data) return [];

  return data.map((row: any) => ({
    id: row.id,
    organizationId: row.organization_id,
    leadId: row.lead_id,
    contactedAt: row.contacted_at,
    comment: row.comment ?? undefined,
    createdByProfileId: row.created_by_profile_id ?? undefined,
    createdByName:
      row.profiles?.full_name ||
      row.profiles?.email?.split("@")[0] ||
      undefined,
  }));
}

export async function createFollowUpAction(
  leadId: string,
  comment: string,
): Promise<{
  success: boolean;
  followUp?: import("./contracts").CrmLeadFollowUp;
  error?: string;
}> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { success: false, error: "Not configured" };
  const orgId = await getOrgId();
  if (!orgId) return { success: false, error: "Not authenticated" };
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const now = new Date().toISOString();

  // 1. Insert follow-up log
  const { data, error } = await supabase
    .from("crm_lead_follow_ups")
    .insert({
      organization_id: orgId,
      lead_id: leadId,
      comment: comment.trim(),
      contacted_at: now,
      created_by_profile_id: user?.id ?? null,
    })
    .select(
      `
      *,
      profiles:created_by_profile_id(full_name, email)
    `,
    )
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? "Insert failed" };
  }

  // 2. Update lead's last_contacted_at and metadata
  await supabase
    .from("crm_leads")
    .update({
      last_contacted_at: now,
      last_updated_by_profile_id: user?.id ?? null,
      last_updated_at: now,
      updated_at: now,
    })
    .eq("id", leadId)
    .eq("organization_id", orgId);

  revalidatePath("/crm");
  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard/follow-ups");

  return {
    success: true,
    followUp: {
      id: data.id,
      organizationId: data.organization_id,
      leadId: data.lead_id,
      contactedAt: data.contacted_at,
      comment: data.comment ?? undefined,
      createdByProfileId: data.created_by_profile_id ?? undefined,
      createdByName:
        data.profiles?.full_name ||
        data.profiles?.email?.split("@")[0] ||
        undefined,
    },
  };
}

export async function fetchTasksAction(): Promise<
  import("./contracts").CrmTask[]
> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];
  const orgId = await getOrgId();
  if (!orgId) return [];

  // Optimized on-demand backfill for existing CRM leads with next actions
  try {
    const { data: existingTasks } = await supabase
      .from("crm_tasks")
      .select("lead_id")
      .eq("organization_id", orgId)
      .not("lead_id", "is", null);

    const existingLeadIds = new Set(
      (existingTasks || []).map((t) => t.lead_id),
    );

    const { data: leadsData } = await supabase
      .from("crm_leads")
      .select(
        "id, topic, next_action, lead_date, assigned_to_profile_id, status",
      )
      .eq("organization_id", orgId)
      .not("next_action", "is", null);

    if (leadsData && leadsData.length > 0) {
      const inserts = [];
      for (const lead of leadsData) {
        if (
          lead.next_action &&
          lead.next_action.trim() &&
          !existingLeadIds.has(lead.id)
        ) {
          const taskStatus =
            lead.status === "won" || lead.status === "dead-end"
              ? "done"
              : "todo";
          inserts.push({
            organization_id: orgId,
            title: lead.next_action.trim(),
            description: `Tâche de suivi pour le lead: ${lead.topic}`,
            status: taskStatus,
            due_date: lead.lead_date
              ? new Date(lead.lead_date).toISOString()
              : null,
            lead_id: lead.id,
            assigned_to_profile_id: lead.assigned_to_profile_id,
          });
        }
      }
      if (inserts.length > 0) {
        await supabase.from("crm_tasks").insert(inserts);
      }
    }
  } catch (err) {
    console.error("Backfill tasks error:", err);
  }

  const { data, error } = await supabase
    .from("crm_tasks")
    .select(
      `
      *,
      lead:lead_id(topic),
      assigned_to:assigned_to_profile_id(id, full_name, email),
      crm_task_tags(
        crm_tags(id, name, color)
      )
    `,
    )
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error || !data) {
    if (error) console.error("fetchTasksAction error:", error);
    return [];
  }

  return (data as any[]).map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status,
    dueDate: row.due_date ?? undefined,
    leadId: row.lead_id ?? undefined,
    leadTopic: row.lead?.topic ?? undefined,
    assignedToProfileId: row.assigned_to_profile_id ?? undefined,
    assignedToName:
      row.assigned_to?.full_name ||
      row.assigned_to?.email?.split("@")[0] ||
      undefined,
    tags: (row.crm_task_tags ?? [])
      .map((tt: any) => tt.crm_tags)
      .filter(Boolean)
      .map((t: any) => ({
        id: t.id,
        organizationId: t.organization_id,
        name: t.name,
        color: t.color,
      })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function createTaskAction(input: {
  title: string;
  description?: string;
  status?: import("./contracts").CrmTaskStatus;
  dueDate?: string;
  leadId?: string;
  assignedToProfileId?: string;
  tagIds?: string[];
}): Promise<{
  success: boolean;
  task?: import("./contracts").CrmTask;
  error?: string;
}> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { success: false, error: "Not configured" };
  const orgId = await getOrgId();
  if (!orgId) return { success: false, error: "Not authenticated" };
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("crm_tasks")
    .insert({
      organization_id: orgId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      status: input.status || "todo",
      due_date: input.dueDate ? new Date(input.dueDate).toISOString() : null,
      lead_id: input.leadId || null,
      assigned_to_profile_id: input.assignedToProfileId || null,
      created_by_profile_id: user?.id ?? null,
    })
    .select()
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? "Insert failed" };
  }

  // Insert tags if any
  if (input.tagIds && input.tagIds.length > 0) {
    const tagInserts = input.tagIds.map((tagId) => ({
      task_id: data.id,
      tag_id: tagId,
    }));
    await supabase.from("crm_task_tags").insert(tagInserts);
  }

  revalidatePath("/crm");
  revalidatePath("/dashboard/todo");

  // Query back populated task
  const { data: populated } = await supabase
    .from("crm_tasks")
    .select(
      `
      *,
      lead:lead_id(topic),
      assigned_to:assigned_to_profile_id(id, full_name, email),
      crm_task_tags(
        crm_tags(id, name, color)
      )
    `,
    )
    .eq("id", data.id)
    .single();

  const row = populated as any;
  return {
    success: true,
    task: {
      id: row.id,
      organizationId: row.organization_id,
      title: row.title,
      description: row.description ?? undefined,
      status: row.status,
      dueDate: row.due_date ?? undefined,
      leadId: row.lead_id ?? undefined,
      leadTopic: row.lead?.topic ?? undefined,
      assignedToProfileId: row.assigned_to_profile_id ?? undefined,
      assignedToName:
        row.assigned_to?.full_name ||
        row.assigned_to?.email?.split("@")[0] ||
        undefined,
      tags: (row.crm_task_tags ?? [])
        .map((tt: any) => tt.crm_tags)
        .filter(Boolean)
        .map((t: any) => ({
          id: t.id,
          organizationId: t.organization_id,
          name: t.name,
          color: t.color,
        })),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  };
}

export async function updateTaskAction(
  taskId: string,
  updates: Partial<{
    title: string;
    description: string | null;
    status: import("./contracts").CrmTaskStatus;
    dueDate: string | null;
    leadId: string | null;
    assignedToProfileId: string | null;
    tagIds: string[];
  }>,
): Promise<{
  success: boolean;
  task?: import("./contracts").CrmTask;
  error?: string;
}> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { success: false, error: "Not configured" };
  const orgId = await getOrgId();
  if (!orgId) return { success: false, error: "Not authenticated" };

  const { error } = await supabase
    .from("crm_tasks")
    .update({
      ...(updates.title !== undefined && { title: updates.title.trim() }),
      ...(updates.description !== undefined && {
        description: updates.description || null,
      }),
      ...(updates.status !== undefined && { status: updates.status }),
      ...(updates.dueDate !== undefined && {
        due_date: updates.dueDate
          ? new Date(updates.dueDate).toISOString()
          : null,
      }),
      ...(updates.leadId !== undefined && { lead_id: updates.leadId || null }),
      ...(updates.assignedToProfileId !== undefined && {
        assigned_to_profile_id: updates.assignedToProfileId || null,
      }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", taskId)
    .eq("organization_id", orgId);

  if (error) return { success: false, error: error.message };

  // Sync tags if provided
  if (updates.tagIds !== undefined) {
    await supabase.from("crm_task_tags").delete().eq("task_id", taskId);
    if (updates.tagIds.length > 0) {
      const tagInserts = updates.tagIds.map((tagId) => ({
        task_id: taskId,
        tag_id: tagId,
      }));
      await supabase.from("crm_task_tags").insert(tagInserts);
    }
  }

  revalidatePath("/crm");
  revalidatePath("/dashboard/todo");

  // Query back populated task
  const { data: populated } = await supabase
    .from("crm_tasks")
    .select(
      `
      *,
      lead:lead_id(topic),
      assigned_to:assigned_to_profile_id(id, full_name, email),
      crm_task_tags(
        crm_tags(id, name, color)
      )
    `,
    )
    .eq("id", taskId)
    .eq("organization_id", orgId)
    .single();

  if (!populated) return { success: true };

  const row = populated as any;
  return {
    success: true,
    task: {
      id: row.id,
      organizationId: row.organization_id,
      title: row.title,
      description: row.description ?? undefined,
      status: row.status,
      dueDate: row.due_date ?? undefined,
      leadId: row.lead_id ?? undefined,
      leadTopic: row.lead?.topic ?? undefined,
      assignedToProfileId: row.assigned_to_profile_id ?? undefined,
      assignedToName:
        row.assigned_to?.full_name ||
        row.assigned_to?.email?.split("@")[0] ||
        undefined,
      tags: (row.crm_task_tags ?? [])
        .map((tt: any) => tt.crm_tags)
        .filter(Boolean)
        .map((t: any) => ({
          id: t.id,
          organizationId: t.organization_id,
          name: t.name,
          color: t.color,
        })),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  };
}

export async function updateTaskStatusAction(
  taskId: string,
  status: import("./contracts").CrmTaskStatus,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { success: false, error: "Not configured" };
  const orgId = await getOrgId();
  if (!orgId) return { success: false, error: "Not authenticated" };

  const { error } = await supabase
    .from("crm_tasks")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", taskId)
    .eq("organization_id", orgId);

  if (error) return { success: false, error: error.message };

  revalidatePath("/crm");
  revalidatePath("/dashboard/todo");
  return { success: true };
}

export async function deleteTaskAction(
  taskId: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { success: false, error: "Not configured" };
  const orgId = await getOrgId();
  if (!orgId) return { success: false, error: "Not authenticated" };

  const { error } = await supabase
    .from("crm_tasks")
    .delete()
    .eq("id", taskId)
    .eq("organization_id", orgId);

  if (error) return { success: false, error: error.message };

  revalidatePath("/crm");
  revalidatePath("/dashboard/todo");
  return { success: true };
}
