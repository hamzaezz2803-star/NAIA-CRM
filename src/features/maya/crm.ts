import "server-only";

import { createServerSupabaseClient } from "@/platform/auth/supabase-server";

import { parseMayaDriveFolderId } from "./drive";

type MayaCrmRelation<T> = T | T[] | null;

type MayaCrmLeadRow = {
  company: MayaCrmRelation<{
    drive_folder_url: string | null;
    id: string;
    name: string;
  }>;
  company_id: string | null;
  contact: MayaCrmRelation<{ name: string | null }>;
  drive_folder_url: string | null;
  id: string;
  organization_id: string;
  status: string;
};

export type MayaCrmLeadContext = {
  clientName: string;
  companyDriveFolderUrl?: string;
  companyId: string;
  contactName?: string;
  leadDriveFolderUrl?: string;
  leadId: string;
  leadStatus: string;
  organizationId: string;
};

const MAYA_LEAD_SELECT = `
  id,
  organization_id,
  status,
  company_id,
  drive_folder_url,
  company:company_id(id, name, drive_folder_url),
  contact:contact_id(name)
`;

export async function listMayaCrmLeadContexts({
  organizationId,
}: {
  organizationId: string;
}): Promise<MayaCrmLeadContext[]> {
  const supabase = await requireMayaSupabase();
  const { data, error } = await supabase
    .from("crm_leads")
    .select(MAYA_LEAD_SELECT)
    .eq("organization_id", organizationId)
    .eq("status", "meeting-booked")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Maya could not read CRM leads: ${error.message}`);
  }

  return ((data ?? []) as unknown as MayaCrmLeadRow[]).map(mapMayaLeadRow);
}

export async function getMayaCrmLeadContext({
  leadId,
  organizationId,
}: {
  leadId: string;
  organizationId: string;
}): Promise<MayaCrmLeadContext> {
  const supabase = await requireMayaSupabase();
  const { data, error } = await supabase
    .from("crm_leads")
    .select(MAYA_LEAD_SELECT)
    .eq("organization_id", organizationId)
    .eq("id", leadId)
    .maybeSingle();

  if (error) {
    throw new Error(`Maya could not read the CRM lead: ${error.message}`);
  }
  if (!data) {
    throw new Error("Lead not found in the authenticated organization.");
  }

  return mapMayaLeadRow(data as unknown as MayaCrmLeadRow);
}

export function resolveMayaCrmDriveFolderUrl({
  companyDriveFolderUrl,
  leadDriveFolderUrl,
}: Pick<MayaCrmLeadContext, "companyDriveFolderUrl" | "leadDriveFolderUrl">) {
  const leadUrl = normalizeUrl(leadDriveFolderUrl);
  const companyUrl = normalizeUrl(companyDriveFolderUrl);
  if (!leadUrl && !companyUrl) {
    throw new Error(
      "Aucun dossier Drive n'est enregistré sur le lead ou sa société dans le CRM.",
    );
  }

  if (
    leadUrl &&
    companyUrl &&
    parseMayaDriveFolderId(leadUrl) !== parseMayaDriveFolderId(companyUrl)
  ) {
    throw new Error(
      "Le lead et la société pointent vers deux dossiers Drive différents ; la destination est ambiguë.",
    );
  }

  return leadUrl ?? companyUrl!;
}

async function requireMayaSupabase() {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    throw new Error("Supabase is not configured for Maya CRM reads.");
  }
  return supabase;
}

function mapMayaLeadRow(row: MayaCrmLeadRow): MayaCrmLeadContext {
  const company = firstRelation(row.company);
  if (!row.company_id || !company?.name?.trim()) {
    throw new Error(
      `Le lead ${row.id} n'est pas rattaché à une société CRM valide.`,
    );
  }
  const contact = firstRelation(row.contact);

  return {
    clientName: company.name.trim(),
    companyDriveFolderUrl: normalizeUrl(company.drive_folder_url),
    companyId: row.company_id,
    contactName: contact?.name?.trim() || undefined,
    leadDriveFolderUrl: normalizeUrl(row.drive_folder_url),
    leadId: row.id,
    leadStatus: row.status,
    organizationId: row.organization_id,
  };
}

function firstRelation<T>(relation: MayaCrmRelation<T>) {
  return Array.isArray(relation) ? relation[0] : relation;
}

function normalizeUrl(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || undefined;
}
