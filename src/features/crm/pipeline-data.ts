import "server-only";

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { SupabaseClient } from "@supabase/supabase-js";

import { createServerSupabaseClient } from "@/platform/auth/supabase-server";

import type { CrmCategory, CrmLeadSummary, CrmTag } from "./contracts";
import { getDummyCrmLeads } from "./dummy-data";

export const CRM_PIPELINE_LEAD_COLUMNS = `
  id,
  organization_id,
  company_id,
  contact_id,
  access_scope,
  topic,
  source,
  status,
  notes,
  next_action,
  next_action_date,
  lead_date,
  contact_job_title,
  contact_linkedin_url,
  assigned_to_profile_id,
  last_updated_by_profile_id,
  last_updated_at,
  last_contacted_at,
  drive_folder_url,
  created_at,
  updated_at,
  assigned_to:assigned_to_profile_id(id, full_name, email),
  last_updated_by:last_updated_by_profile_id(id, full_name, email),
  company:company_id(id, name),
  contact:contact_id(id, name, email, phone),
  crm_lead_tags(crm_tags(id, organization_id, name, color))
`;

type PipelineContext = {
  organizationId: string;
  userId: string;
};

type PipelineDataOptions = {
  client?: SupabaseClient | null;
  now?: () => Date;
};

export type CrmPipelineSnapshot = {
  categories: CrmCategory[];
  leads: CrmLeadSummary[];
  loadedAt: string;
  source: "database" | "fallback";
};

export type CrmPipelineAuxiliary = {
  isGoogleConnected: boolean;
  tags: CrmTag[];
  teamMembers: Array<{
    avatarUrl?: string;
    email: string;
    fullName: string;
    id: string;
  }>;
};

export type CrmNavigationSummary = {
  clientsCount: number;
  drivesCount: number;
  followUpsCount: number;
  pipelineCount: number;
  todoCount: number;
};

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

async function resolvePipelineContext(
  client: SupabaseClient,
): Promise<PipelineContext | null> {
  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser();

  if (authError || !user) return null;

  const { data: membership, error: membershipError } = await client
    .from("organization_memberships")
    .select("organization_id")
    .eq("profile_id", user.id)
    .limit(1)
    .maybeSingle();

  if (membershipError || !membership?.organization_id) return null;

  return {
    organizationId: membership.organization_id,
    userId: user.id,
  };
}

function relation<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : (value ?? undefined);
}

export function mapCrmPipelineLead(row: any): CrmLeadSummary {
  const assignedTo = relation(row.assigned_to);
  const lastUpdatedBy = relation(row.last_updated_by);
  const company = relation(row.company);
  const contact = relation(row.contact);

  return {
    accessScope: row.access_scope,
    id: row.id,
    organizationId: row.organization_id,
    companyId: row.company_id ?? undefined,
    companyName: company?.name ?? undefined,
    contactId: row.contact_id ?? undefined,
    contactName: contact?.name ?? undefined,
    contactEmail: contact?.email ?? undefined,
    contactPhone: contact?.phone ?? undefined,
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
      assignedTo?.full_name || assignedTo?.email?.split("@")[0] || undefined,
    lastUpdatedByProfileId: row.last_updated_by_profile_id ?? undefined,
    lastUpdatedByName:
      lastUpdatedBy?.full_name ||
      lastUpdatedBy?.email?.split("@")[0] ||
      undefined,
    lastUpdatedAt: row.last_updated_at ?? undefined,
    lastContactedAt: row.last_contacted_at ?? undefined,
    driveFolderUrl: row.drive_folder_url ?? undefined,
    tags: (row.crm_lead_tags ?? [])
      .map((leadTag: any) => relation(leadTag.crm_tags))
      .filter(Boolean)
      .map((tag: any) => ({
        id: tag.id,
        organizationId: tag.organization_id ?? row.organization_id,
        name: tag.name,
        color: tag.color,
      })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCategory(row: any): CrmCategory {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    statusKey: row.status_key,
    color: row.color,
    position: row.position,
  };
}

export async function fetchCrmPipelineSnapshot(
  options: PipelineDataOptions = {},
): Promise<CrmPipelineSnapshot> {
  const now = options.now ?? (() => new Date());
  const client =
    options.client === undefined
      ? await createServerSupabaseClient()
      : options.client;

  if (!client) {
    return {
      categories: [],
      leads: fallbackLeads(),
      loadedAt: now().toISOString(),
      source: "fallback",
    };
  }

  const context = await resolvePipelineContext(client);
  if (!context) {
    return {
      categories: [],
      leads: fallbackLeads(),
      loadedAt: now().toISOString(),
      source: "fallback",
    };
  }

  const [leadsResult, categoriesResult] = await Promise.all([
    client
      .from("crm_leads")
      .select(CRM_PIPELINE_LEAD_COLUMNS)
      .eq("organization_id", context.organizationId)
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
    client
      .from("crm_categories")
      .select(
        "id, organization_id, name, status_key, color, position, access_scope",
      )
      .eq("organization_id", context.organizationId)
      .is("archived_at", null)
      .order("position", { ascending: true }),
  ]);

  if (leadsResult.error) {
    console.error("CRM pipeline lead snapshot failed:", leadsResult.error);
  }
  if (categoriesResult.error) {
    console.error(
      "CRM pipeline category snapshot failed:",
      categoriesResult.error,
    );
  }

  return {
    categories: (categoriesResult.data ?? []).map(mapCategory),
    leads: leadsResult.error
      ? fallbackLeads()
      : (leadsResult.data ?? []).map(mapCrmPipelineLead),
    loadedAt: now().toISOString(),
    source:
      leadsResult.error || categoriesResult.error ? "fallback" : "database",
  };
}

export async function fetchCrmPipelineAuxiliary(
  options: PipelineDataOptions = {},
): Promise<CrmPipelineAuxiliary> {
  const client =
    options.client === undefined
      ? await createServerSupabaseClient()
      : options.client;

  if (!client) {
    return { isGoogleConnected: false, tags: [], teamMembers: [] };
  }

  const context = await resolvePipelineContext(client);
  if (!context) {
    return { isGoogleConnected: false, tags: [], teamMembers: [] };
  }

  const [tagsResult, teamResult, googleResult] = await Promise.all([
    client
      .from("crm_tags")
      .select("id, organization_id, name, color")
      .eq("organization_id", context.organizationId)
      .is("archived_at", null)
      .order("name"),
    client
      .from("organization_memberships")
      .select(
        "profile_id, profiles:profile_id(id, full_name, email, avatar_url)",
      )
      .eq("organization_id", context.organizationId),
    client
      .from("integration_connections")
      .select("status")
      .eq("organization_id", context.organizationId)
      .eq("provider", "google")
      .eq("connected_by_profile_id", context.userId)
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    isGoogleConnected:
      !googleResult.error && googleResult.data?.status === "connected",
    tags: (tagsResult.data ?? []).map((row: any) => ({
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      color: row.color,
    })),
    teamMembers: (teamResult.data ?? [])
      .map((row: any) => relation(row.profiles))
      .filter((profile: any) => profile?.id && profile?.email)
      .map((profile: any) => ({
        id: profile.id,
        fullName: profile.full_name || profile.email.split("@")[0],
        email: profile.email,
        avatarUrl: profile.avatar_url ?? undefined,
      })),
  };
}

export async function fetchCrmNavigationSummary(
  options: PipelineDataOptions = {},
): Promise<CrmNavigationSummary> {
  const empty = {
    clientsCount: 0,
    drivesCount: 0,
    followUpsCount: 0,
    pipelineCount: 0,
    todoCount: 0,
  };
  const client =
    options.client === undefined
      ? await createServerSupabaseClient()
      : options.client;
  if (!client) return empty;

  const context = await resolvePipelineContext(client);
  if (!context) return empty;

  const [leadsResult, companiesResult] = await Promise.all([
    client
      .from("crm_leads")
      .select("id, status, drive_folder_url")
      .eq("organization_id", context.organizationId)
      .is("archived_at", null),
    client
      .from("crm_companies")
      .select("id, drive_folder_url")
      .eq("organization_id", context.organizationId)
      .is("archived_at", null),
  ]);

  if (leadsResult.error || companiesResult.error) return empty;

  const leads = leadsResult.data ?? [];
  const companies = companiesResult.data ?? [];
  const activeLeads = leads.filter(
    (lead: any) => lead.status !== "won" && lead.status !== "dead-end",
  );

  return {
    clientsCount: companies.length,
    drivesCount:
      leads.filter((lead: any) => Boolean(lead.drive_folder_url)).length +
      companies.filter((company: any) => Boolean(company.drive_folder_url))
        .length,
    followUpsCount: activeLeads.length,
    pipelineCount: activeLeads.length,
    todoCount: leads.length,
  };
}
