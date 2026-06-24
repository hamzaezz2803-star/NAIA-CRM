"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/platform/auth/supabase-server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CrmLeadStatus,
  CrmLeadSummary,
  CrmCompanySummary,
  CrmContactSummary,
} from "./contracts";

// ────────────────────────────────────────────────────────────
// Types for DB rows (aligned with 20260624120000_crm_tables.sql)
// ────────────────────────────────────────────────────────────

type DbLead = {
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

function sanitizeJsonString(str: string): string {
  let inString = false;
  let result = "";
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === '"' && (i === 0 || str[i - 1] !== "\\")) {
      inString = !inString;
      result += char;
    } else if (inString) {
      if (char === "\n") {
        result += "\\n";
      } else if (char === "\r") {
        result += "\\r";
      } else if (char === "\t") {
        result += "\\t";
      } else {
        result += char;
      }
    } else {
      result += char;
    }
  }
  return result;
}

// ────────────────────────────────────────────────────────────
// LEADS
// ────────────────────────────────────────────────────────────

export async function fetchLeadsAction(): Promise<CrmLeadSummary[]> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];

  const orgId = await getOrgId();
  if (!orgId) return [];

  const { data, error } = await supabase
    .from("crm_leads")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return (data as DbLead[]).map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    companyId: row.company_id ?? undefined,
    contactId: row.contact_id ?? undefined,
    topic: row.topic,
    source: row.source ?? undefined,
    status: row.status,
    notes: row.notes ?? undefined,
    nextAction: row.next_action ?? undefined,
    nextActionDate: row.next_action_date ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function createLeadAction(input: {
  topic: string;
  companyId?: string;
  contactId?: string;
  source?: string;
  status?: CrmLeadStatus;
  notes?: string;
  nextAction?: string;
  nextActionDate?: string;
}): Promise<{ success: boolean; lead?: CrmLeadSummary; error?: string }> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { success: false, error: "Not configured" };

  const orgId = await getOrgId();
  if (!orgId) return { success: false, error: "Not authenticated" };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("crm_leads")
    .insert({
      organization_id: orgId,
      topic: input.topic,
      company_id: input.companyId ?? null,
      contact_id: input.contactId ?? null,
      source: input.source ?? null,
      status: input.status ?? "lead-to-contact",
      notes: input.notes ?? null,
      next_action: input.nextAction ?? null,
      next_action_date: input.nextActionDate ?? null,
      created_by_profile_id: user?.id ?? null,
    })
    .select()
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? "Insert failed" };
  }

  const row = data as DbLead;

  // Sync to Google Calendar if nextActionDate is set
  if (input.nextActionDate) {
    await syncLeadToGoogleCalendar(supabase, orgId, row.id);
  }

  revalidatePath("/crm");
  revalidatePath("/dashboard/leads");

  return {
    success: true,
    lead: {
      id: row.id,
      organizationId: row.organization_id,
      companyId: row.company_id ?? undefined,
      contactId: row.contact_id ?? undefined,
      topic: row.topic,
      source: row.source ?? undefined,
      status: row.status,
      notes: row.notes ?? undefined,
      nextAction: row.next_action ?? undefined,
      nextActionDate: row.next_action_date ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  };
}

export async function updateLeadStatusAction(
  leadId: string,
  status: CrmLeadStatus,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { success: false, error: "Not configured" };

  const orgId = await getOrgId();
  if (!orgId) return { success: false, error: "Not authenticated" };

  const { error } = await supabase
    .from("crm_leads")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", leadId)
    .eq("organization_id", orgId);

  if (error) return { success: false, error: error.message };

  revalidatePath("/crm");
  revalidatePath("/dashboard/leads");
  return { success: true };
}

export async function updateLeadAction(
  leadId: string,
  updates: Partial<{
    topic: string;
    status: CrmLeadStatus;
    notes: string;
    nextAction: string;
    nextActionDate: string;
    source: string;
    companyId: string;
    contactId: string;
  }>,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { success: false, error: "Not configured" };

  const orgId = await getOrgId();
  if (!orgId) return { success: false, error: "Not authenticated" };

  const { error } = await supabase
    .from("crm_leads")
    .update({
      ...(updates.topic !== undefined && { topic: updates.topic }),
      ...(updates.status !== undefined && { status: updates.status }),
      ...(updates.notes !== undefined && { notes: updates.notes }),
      ...(updates.nextAction !== undefined && {
        next_action: updates.nextAction,
      }),
      ...(updates.nextActionDate !== undefined && {
        next_action_date: updates.nextActionDate,
      }),
      ...(updates.source !== undefined && { source: updates.source }),
      ...(updates.companyId !== undefined && { company_id: updates.companyId }),
      ...(updates.contactId !== undefined && { contact_id: updates.contactId }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", leadId)
    .eq("organization_id", orgId);

  if (error) return { success: false, error: error.message };

  await syncLeadToGoogleCalendar(supabase, orgId, leadId);

  revalidatePath("/crm");
  revalidatePath("/dashboard/leads");
  return { success: true };
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
    .select("notes")
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .single();

  if (lead && lead.notes) {
    const eventIdMatch = lead.notes.match(
      /\[Google Calendar Event ID:\s*([^\]]+)\]/,
    );
    const eventId = eventIdMatch ? eventIdMatch[1].trim() : null;

    if (eventId) {
      const { data: connection } = await supabase
        .from("integration_connections")
        .select("*")
        .eq("organization_id", orgId)
        .eq("provider", "google")
        .limit(1)
        .maybeSingle();

      if (connection && connection.status === "connected") {
        const accessToken = await getOrRefreshGoogleToken(
          supabase,
          orgId,
          connection,
        );
        if (accessToken) {
          try {
            await fetch(
              `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
              {
                method: "DELETE",
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              },
            );
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
  return { success: true };
}

// ────────────────────────────────────────────────────────────
// COMPANIES
// ────────────────────────────────────────────────────────────

export async function fetchCompaniesAction(): Promise<CrmCompanySummary[]> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];

  const orgId = await getOrgId();
  if (!orgId) return [];

  const { data, error } = await supabase
    .from("crm_companies")
    .select("id, organization_id, name, drive_folder_url")
    .eq("organization_id", orgId)
    .order("name");

  if (error || !data) return [];

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

// ────────────────────────────────────────────────────────────
// CONTACTS
// ────────────────────────────────────────────────────────────

export async function fetchContactsAction(): Promise<CrmContactSummary[]> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];

  const orgId = await getOrgId();
  if (!orgId) return [];

  const { data, error } = await supabase
    .from("crm_contacts")
    .select("id, organization_id, company_id, name, email, phone, job_title")
    .eq("organization_id", orgId)
    .order("name");

  if (error || !data) return [];

  return (data as DbContact[]).map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    companyId: row.company_id ?? undefined,
    name: row.name,
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    jobTitle: row.job_title ?? undefined,
  }));
}

export async function createContactAction(input: {
  name: string;
  companyId?: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
  notes?: string;
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
      notes: input.notes ?? null,
      created_by_profile_id: user?.id ?? null,
    })
    .select()
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? "Insert failed" };
  }

  revalidatePath("/crm");
  const row = data as DbContact;
  return {
    success: true,
    contact: {
      id: row.id,
      organizationId: row.organization_id,
      companyId: row.company_id ?? undefined,
      name: row.name,
      email: row.email ?? undefined,
      phone: row.phone ?? undefined,
      jobTitle: row.job_title ?? undefined,
    },
  };
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
    contactPhone?: string;
    source?: string;
    notes?: string;
    nextAction?: string;
    nextActionDate?: string;
  };
  error?: string;
}> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { success: false, error: "GROQ_API_KEY not configured" };
  }

  try {
    const Groq = (await import("groq-sdk")).default;
    const groq = new Groq({ apiKey });

    const today = new Date().toISOString().split("T")[0];

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: `Tu es un assistant CRM expert. Extrait les informations d'un lead commercial depuis un texte en langage naturel.
Aujourd'hui: ${today}
Retourne UNIQUEMENT un JSON valide avec ces champs (omets les champs manquants):
{
  "topic": "sujet/projet commercial (obligatoire)",
  "companyName": "nom de l'entreprise",
  "contactName": "nom du contact",
  "contactEmail": "email si mentionné",
  "contactPhone": "téléphone si mentionné",
  "source": "source du lead (salon, LinkedIn, appel, etc.)",
  "notes": "notes complémentaires",
  "nextAction": "prochaine action à faire",
  "nextActionDate": "date ISO YYYY-MM-DD si mentionnée"
}`,
        },
        {
          role: "user",
          content: text,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 512,
    });

    const content = completion.choices[0]?.message?.content ?? "";

    // Extract JSON from response (handle potential markdown code blocks)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { success: false, error: "Could not parse AI response" };
    }

    const sanitizedContent = sanitizeJsonString(jsonMatch[0]);
    const extracted = JSON.parse(sanitizedContent);
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
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { success: false, error: "GROQ_API_KEY not configured" };
  }

  try {
    const Groq = (await import("groq-sdk")).default;
    const groq = new Groq({ apiKey });

    const context = [
      lead.contactName && `Contact: ${lead.contactName}`,
      lead.companyName && `Entreprise: ${lead.companyName}`,
      `Sujet: ${lead.topic}`,
      lead.notes && `Notes: ${lead.notes}`,
      lead.nextAction && `Prochaine action prévue: ${lead.nextAction}`,
    ]
      .filter(Boolean)
      .join("\n");

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: `Tu es un assistant commercial pour Qarizmi, une agence IA au Maroc.
Génère des messages de relance professionnels et chaleureux en français.
Retourne UNIQUEMENT un JSON valide:
{
  "email": "corps de l'email de relance (sans objet)",
  "whatsapp": "message WhatsApp court et direct (max 3 lignes)"
}`,
        },
        {
          role: "user",
          content: `Génère une relance pour ce lead:\n${context}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 800,
    });

    const content = completion.choices[0]?.message?.content ?? "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { success: false, error: "Could not parse AI response" };
    }

    const sanitizedContent = sanitizeJsonString(jsonMatch[0]);
    const drafts = JSON.parse(sanitizedContent);
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

  const { data, error } = await supabase
    .from("integration_connections")
    .select("status")
    .eq("organization_id", orgId)
    .eq("provider", "google")
    .limit(1)
    .maybeSingle();

  if (error || !data) return false;

  return data.status === "connected";
}

export async function disconnectGoogleAuthAction(): Promise<{
  success: boolean;
  error?: string;
}> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { success: false, error: "Not configured" };

  const orgId = await getOrgId();
  if (!orgId) return { success: false, error: "Not authenticated" };

  const { error } = await supabase
    .from("integration_connections")
    .delete()
    .eq("organization_id", orgId)
    .eq("provider", "google");

  if (error) return { success: false, error: error.message };

  revalidatePath("/crm");
  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/documents");

  return { success: true };
}

export async function createGoogleDriveFolderAction(
  leadId: string,
  companyName: string,
): Promise<{ success: boolean; folderLink?: string; error?: string }> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { success: false, error: "Not configured" };

  const orgId = await getOrgId();
  if (!orgId) return { success: false, error: "Not authenticated" };

  // Fetch google connection details
  const { data: connection, error: connError } = await supabase
    .from("integration_connections")
    .select("*")
    .eq("organization_id", orgId)
    .eq("provider", "google")
    .limit(1)
    .maybeSingle();

  if (connError || !connection || connection.status !== "connected") {
    return { success: false, error: "Google integration not connected" };
  }

  // Get active access token
  const accessToken = await getOrRefreshGoogleToken(
    supabase,
    orgId,
    connection,
  );
  if (!accessToken) {
    return {
      success: false,
      error: "Failed to authenticate with Google APIs",
    };
  }

  try {
    // Create folder in Google Drive
    const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: `Client - ${companyName}`,
        mimeType: "application/vnd.google-apps.folder",
      }),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      return { success: false, error: `Google Drive API error: ${errText}` };
    }

    const folder = await createRes.json();
    const folderId = folder.id;
    const folderLink = `https://drive.google.com/drive/folders/${folderId}`;

    // Create subfolders inside the client folder
    const subfolders = [
      "01_Pitch",
      "02_Meeting Notes",
      "03_Proposal",
      "04_Contract",
      "05_Delivery",
    ];

    for (const subName of subfolders) {
      await fetch("https://www.googleapis.com/drive/v3/files", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: subName,
          mimeType: "application/vnd.google-apps.folder",
          parents: [folderId],
        }),
      });
    }

    // Get lead notes
    const { data: lead, error: leadError } = await supabase
      .from("crm_leads")
      .select("company_id, notes")
      .eq("id", leadId)
      .eq("organization_id", orgId)
      .single();

    if (!leadError && lead) {
      // Update company drive folder url if company exists
      if (lead.company_id) {
        await supabase
          .from("crm_companies")
          .update({
            drive_folder_url: folderLink,
            updated_at: new Date().toISOString(),
          })
          .eq("id", lead.company_id);
      }

      // Update lead notes to append the drive link
      const existingNotes = lead.notes || "";
      const updatedNotes = existingNotes
        ? `${existingNotes}\n[Google Drive Folder: Client - ${companyName}](${folderLink})`
        : `[Google Drive Folder: Client - ${companyName}](${folderLink})`;

      await supabase
        .from("crm_leads")
        .update({
          notes: updatedNotes,
          updated_at: new Date().toISOString(),
        })
        .eq("id", leadId);
    }

    revalidatePath("/crm");
    revalidatePath("/dashboard/leads");
    revalidatePath("/dashboard/documents");

    return { success: true, folderLink };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: message };
  }
}

async function getOrRefreshGoogleToken(
  supabase: SupabaseClient,
  orgId: string,
  connection: { id: string; encrypted_token_reference: string | null },
): Promise<string | null> {
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

async function syncLeadToGoogleCalendar(
  supabase: SupabaseClient,
  orgId: string,
  leadId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: lead, error: leadError } = await supabase
      .from("crm_leads")
      .select("*")
      .eq("id", leadId)
      .eq("organization_id", orgId)
      .single();

    if (leadError || !lead) {
      return { success: false, error: "Lead introuvable" };
    }

    const notesStr = lead.notes || "";
    const eventIdMatch = notesStr.match(
      /\[Google Calendar Event ID:\s*([^\]]+)\]/,
    );
    const existingEventId = eventIdMatch ? eventIdMatch[1].trim() : null;

    // Fetch google connection
    const { data: connection } = await supabase
      .from("integration_connections")
      .select("*")
      .eq("organization_id", orgId)
      .eq("provider", "google")
      .limit(1)
      .maybeSingle();

    if (!connection || connection.status !== "connected") {
      return {
        success: false,
        error: "Google Workspace non connecté. Veuillez connecter votre compte Google.",
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
        error: "Session Google expirée ou invalide. Veuillez déconnecter et reconnecter votre compte Google.",
      };
    }

    // If nextActionDate is cleared but an event exists, delete it
    if (!lead.next_action_date) {
      if (existingEventId) {
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

          if (!delRes.ok) {
            const errText = await delRes.text();
            console.error("Google Calendar delete failed:", errText);
          }

          // Remove the event ID and link tags from notes
          const updatedNotes = notesStr
            .replace(/\[Google Calendar Event ID:\s*([^\]]+)\]\n?/, "")
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
      }
      return { success: true };
    }

    // Otherwise, create or update the event
    const startDate = lead.next_action_date;
    const startDay = new Date(startDate);
    const nextDay = new Date(startDay.getTime() + 24 * 60 * 60 * 1000);
    const endDate = nextDay.toISOString().split("T")[0];

    const cleanNotes = notesStr
      .replace(/\[Google Calendar Event ID:\s*([^\]]+)\]/g, "")
      .replace(/\[Google Calendar Event Link:\s*([^\]]+)\]/g, "")
      .trim();

    const eventPayload = {
      summary: `Suivi : ${lead.topic}`,
      description: `Action prévue : ${lead.next_action || "Aucune description"}\n\nNotes :\n${cleanNotes}`,
      start: {
        date: startDate,
      },
      end: {
        date: endDate,
      },
    };

    if (existingEventId) {
      const updateRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${existingEventId}`,
        {
          method: "PUT",
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
      } else {
        const errText = await updateRes.text();
        return {
          success: false,
          error: `Erreur API Google Calendar (Update) : ${errText}`,
        };
      }
    }

    const createRes = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
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
        .replace(/\[Google Calendar Event Link:\s*([^\]]+)\]\n?/g, "")
        .trim();

      const updatedNotes = cleanIdNotes
        ? `${cleanIdNotes}\n[Google Calendar Event ID: ${newEventId}]\n[Google Calendar Event Link: ${htmlLink}]`
        : `[Google Calendar Event ID: ${newEventId}]\n[Google Calendar Event Link: ${htmlLink}]`;

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
        error: `Erreur API Google Calendar (Create) : ${errText}`,
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur inconnue";
    console.error("Error syncing to Google Calendar:", err);
    return { success: false, error: msg };
  }
}

export async function syncLeadToGoogleCalendarAction(
  leadId: string,
): Promise<{ success: boolean; error?: string; calendarLink?: string }> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { success: false, error: "Not configured" };

  const orgId = await getOrgId();
  if (!orgId) return { success: false, error: "Not authenticated" };

  const syncRes = await syncLeadToGoogleCalendar(supabase, orgId, leadId);
  if (!syncRes.success) {
    return { success: false, error: syncRes.error };
  }

  // Fetch updated lead notes to find the new link
  const { data: lead } = await supabase
    .from("crm_leads")
    .select("notes")
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .single();

  const notesStr = lead?.notes || "";
  const eventIdMatch = notesStr.match(
    /\[Google Calendar Event Link:\s*([^\]]+)\]/,
  );
  const link = eventIdMatch ? eventIdMatch[1].trim() : undefined;

  revalidatePath("/crm");
  revalidatePath("/dashboard/leads");

  return { success: true, calendarLink: link };
}
