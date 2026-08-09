import "server-only";

import { createServiceRoleSupabaseClient } from "@/platform/auth/supabase-server";

import {
  MEETING_RECORDINGS_BUCKET,
  recommendationEvidenceMatchesTranscript,
  recordingManifestSchema,
  workerCompletionSchema,
  workerProgressSchema,
} from "./contracts";
import {
  archiveMeetingOutput,
  loadMeetingSupportContext,
  type MeetingSupportContext,
} from "./drive";

type JobRow = {
  audio_asset_id: string;
  id: string;
  lease_token: string;
  meeting_id: string;
  organization_id: string;
  status: string;
  worker_id?: string | null;
};

type MeetingRow = {
  attendees?: unknown;
  company_id?: string | null;
  contact_id?: string | null;
  id: string;
  lead_id?: string | null;
  live_notes_markdown?: string | null;
  organization_id: string;
  starts_at?: string | null;
  support_drive_file_id?: string | null;
  support_file_name?: string | null;
  title: string;
};

type ClaimedMeetingSupport = MeetingSupportContext & {
  file?: {
    mimeType: string;
    name: string;
    sha256: string;
    signedUrl: string;
    sizeBytes: number;
  };
};

export class MeetingJobLeaseError extends Error {
  constructor(message = "Job introuvable ou bail du worker expiré.") {
    super(message);
    this.name = "MeetingJobLeaseError";
  }
}

export async function claimNextMeetingJob(workerId: string) {
  const supabase = requireServiceRoleClient();
  const { data: claimed, error: claimError } = await supabase.rpc(
    "claim_next_meeting_processing_job",
    {
      lease_seconds: 1800,
      requested_worker_id: workerId,
    },
  );
  if (claimError) throw claimError;

  const job = (Array.isArray(claimed) ? claimed[0] : claimed) as
    JobRow | undefined;
  if (!job) return null;

  try {
    const [
      { data: meeting, error: meetingError },
      { data: asset, error: assetError },
      { data: uploadedSupport, error: uploadedSupportError },
    ] = await Promise.all([
      supabase
        .from("meetings")
        .select("*")
        .eq("id", job.meeting_id)
        .eq("organization_id", job.organization_id)
        .single(),
      supabase
        .from("meeting_assets")
        .select("metadata, mime_type, display_name")
        .eq("id", job.audio_asset_id)
        .eq("organization_id", job.organization_id)
        .single(),
      supabase
        .from("meeting_assets")
        .select("metadata, mime_type, display_name, storage_path")
        .eq("meeting_id", job.meeting_id)
        .eq("organization_id", job.organization_id)
        .eq("kind", "support")
        .eq("provider", "supabase-storage")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (meetingError) throw meetingError;
    if (assetError) throw assetError;
    if (uploadedSupportError) throw uploadedSupportError;

    if (!job.lease_token) {
      throw new Error("Le job réclamé n'a pas de jeton de bail.");
    }
    const manifest = recordingManifestSchema.parse(
      (asset?.metadata as { manifest?: unknown } | null)?.manifest,
    );
    const expectedPrefix = `${job.organization_id}/${job.meeting_id}/`;
    if (
      manifest.chunks.some((chunk) => !chunk.path.startsWith(expectedPrefix))
    ) {
      throw new Error("Le manifeste audio référence un autre meeting.");
    }
    const paths = manifest.chunks.map((chunk) => chunk.path);
    const { data: signed, error: signedError } = await supabase.storage
      .from(MEETING_RECORDINGS_BUCKET)
      .createSignedUrls(paths, 3600);
    if (signedError) throw signedError;

    const signedByPath = new Map(
      (signed ?? []).map((entry) => [entry.path, entry.signedUrl]),
    );
    const audioChunks = manifest.chunks.map((chunk) => {
      const signedUrl = signedByPath.get(chunk.path);
      if (!signedUrl) {
        throw new Error(`Impossible de signer le chunk ${chunk.path}.`);
      }
      return { ...chunk, signedUrl };
    });

    const context = await loadMeetingContext(supabase, meeting as MeetingRow);
    let support: ClaimedMeetingSupport;
    if (uploadedSupport) {
      const uploadedManifest = recordingManifestSchema.parse(
        (uploadedSupport.metadata as { manifest?: unknown } | null)?.manifest,
      );
      if (
        uploadedManifest.chunks.length !== 1 ||
        !uploadedManifest.chunks[0].path.startsWith(expectedPrefix)
      ) {
        throw new Error("Le manifeste du support meeting est invalide.");
      }
      const supportChunk = uploadedManifest.chunks[0];
      const { data: signedSupport, error: signedSupportError } =
        await supabase.storage
          .from(MEETING_RECORDINGS_BUCKET)
          .createSignedUrl(supportChunk.path, 3600);
      if (signedSupportError || !signedSupport?.signedUrl) {
        throw (
          signedSupportError ??
          new Error("Impossible de signer le support meeting.")
        );
      }
      support = {
        file: {
          mimeType: uploadedManifest.mimeType,
          name: uploadedManifest.originalFileName,
          sha256: supportChunk.sha256,
          signedUrl: signedSupport.signedUrl,
          sizeBytes: supportChunk.sizeBytes,
        },
        fileName: uploadedManifest.originalFileName,
      };
    } else {
      support = context.companyName
        ? await loadMeetingSupportContext({
            companyName: context.companyName,
            preferredFileId: meeting.support_drive_file_id,
            preferredFileName: meeting.support_file_name,
          }).catch((error: unknown) => ({
            warning:
              error instanceof Error
                ? `Support non chargé: ${error.message}`
                : "Support non chargé.",
          }))
        : {
            warning:
              "Support non chargé: renseigne d'abord l'entreprise du lead CRM.",
          };
    }

    if (support.fileId) {
      await Promise.all([
        supabase
          .from("meetings")
          .update({
            support_drive_file_id: support.fileId,
            support_file_name: support.fileName,
            support_file_url: support.fileUrl,
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.meeting_id)
          .eq("organization_id", job.organization_id),
        ensureSupportAsset({
          fileId: support.fileId,
          fileName: support.fileName ?? "Support meeting",
          fileUrl: support.fileUrl,
          job,
          supabase,
        }),
      ]);
    }

    return {
      audio: {
        chunks: audioChunks,
        mimeType: manifest.mimeType,
        originalFileName: manifest.originalFileName,
      },
      context: {
        attendees: meeting.attendees ?? [],
        companyName: context.companyName,
        contactName: context.contactName,
        crmContext: context.crmContext,
        liveNotesMarkdown: meeting.live_notes_markdown ?? "",
        startsAt: meeting.starts_at ?? undefined,
        title: meeting.title,
      },
      jobId: job.id,
      leaseToken: job.lease_token,
      meetingId: job.meeting_id,
      support: {
        file: support.file,
        fileName: support.fileName,
        slideText: support.slideText,
        warning: support.warning,
      },
    };
  } catch (error) {
    await markMeetingJobFailed(job.id, workerId, job.lease_token, error);
    throw error;
  }
}

export async function updateMeetingJobProgress(
  jobId: string,
  rawProgress: unknown,
) {
  const progress = workerProgressSchema.parse(rawProgress);
  const supabase = requireServiceRoleClient();
  const now = new Date();
  const { data, error } = await supabase
    .from("meeting_processing_jobs")
    .update({
      lease_expires_at: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
      message: progress.message,
      progress: progress.progress,
      status: progress.stage,
      updated_at: now.toISOString(),
    })
    .eq("id", jobId)
    .eq("worker_id", progress.workerId)
    .eq("lease_token", progress.leaseToken)
    .in("status", ["claimed", "transcribing", "analyzing", "uploading"])
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new MeetingJobLeaseError();
}

export async function completeMeetingJob(jobId: string, rawPayload: unknown) {
  const payload = workerCompletionSchema.parse(rawPayload);
  if (
    payload.structured.actions.some(
      (recommendation) =>
        !recommendationEvidenceMatchesTranscript(
          recommendation,
          payload.transcriptText,
        ),
    )
  ) {
    throw new Error(
      "Une recommandation n'est pas reliée à une preuve horodatée du transcript.",
    );
  }
  const supabase = requireServiceRoleClient();
  const { data: job, error: jobError } = await supabase
    .from("meeting_processing_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("worker_id", payload.workerId)
    .eq("lease_token", payload.leaseToken)
    .single();
  if (jobError) {
    if (jobError.code === "PGRST116") throw new MeetingJobLeaseError();
    throw jobError;
  }

  const { data: existingOutput, error: existingOutputError } = await supabase
    .from("meeting_outputs")
    .select("*")
    .eq("job_id", jobId)
    .eq("organization_id", job.organization_id)
    .maybeSingle();
  if (existingOutputError) throw existingOutputError;

  if (["review-ready", "completed"].includes(job.status as string)) {
    return {
      outputId: existingOutput?.id,
      replayed: true,
      warnings: (existingOutput?.warnings as string[] | null) ?? [],
    };
  }

  if (
    !["claimed", "transcribing", "analyzing", "uploading"].includes(
      job.status as string,
    )
  ) {
    throw new MeetingJobLeaseError(
      `Le job ne peut pas être finalisé depuis ${job.status}.`,
    );
  }

  const completionLeaseExpiresAt = new Date(
    Date.now() + 10 * 60 * 1000,
  ).toISOString();
  const { data: reservedJob, error: reservationError } = await supabase
    .from("meeting_processing_jobs")
    .update({
      lease_expires_at: completionLeaseExpiresAt,
      message: "Finalisation sécurisée du compte rendu",
      status: "finalizing",
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("worker_id", payload.workerId)
    .eq("lease_token", payload.leaseToken)
    .in("status", ["claimed", "transcribing", "analyzing", "uploading"])
    .select("id")
    .maybeSingle();
  if (reservationError) throw reservationError;
  if (!reservedJob) {
    throw new MeetingJobLeaseError("Le bail du companion n'est plus valide.");
  }

  try {
    const { data: meeting, error: meetingError } = await supabase
      .from("meetings")
      .select("*")
      .eq("id", job.meeting_id)
      .eq("organization_id", job.organization_id)
      .single();
    if (meetingError) throw meetingError;

    let output = existingOutput;
    if (!output) {
      const { data: latest } = await supabase
        .from("meeting_outputs")
        .select("version")
        .eq("meeting_id", job.meeting_id)
        .eq("organization_id", job.organization_id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      const version = Number(latest?.version ?? 0) + 1;

      const { data: insertedOutput, error: outputError } = await supabase
        .from("meeting_outputs")
        .insert({
          engine_metadata: payload.engine,
          job_id: jobId,
          meeting_id: job.meeting_id,
          notes_markdown: payload.notesMarkdown,
          organization_id: job.organization_id,
          structured_output: payload.structured,
          transcript_srt: payload.transcriptSrt,
          transcript_text: payload.transcriptText,
          version,
          warnings: payload.warnings,
        })
        .select("*")
        .single();

      if (outputError) {
        if (outputError.code !== "23505") throw outputError;
        const { data: racedOutput, error: racedOutputError } = await supabase
          .from("meeting_outputs")
          .select("*")
          .eq("job_id", jobId)
          .eq("organization_id", job.organization_id)
          .single();
        if (racedOutputError) throw racedOutputError;
        output = racedOutput;
      } else {
        output = insertedOutput;
      }
    }
    if (!output)
      throw new Error("Le résultat du meeting n'a pas pu être créé.");

    const context = await loadMeetingContext(supabase, meeting as MeetingRow);
    const notesMarkdown = output.notes_markdown as string;
    const structuredOutput = output.structured_output;
    const transcriptSrt = output.transcript_srt as string;
    const transcriptText = output.transcript_text as string;
    const warnings = uniqueStrings([
      ...payload.warnings,
      ...((output.warnings as string[] | null) ?? []).filter(Boolean),
    ]);
    try {
      if (!context.companyName) {
        throw new Error(
          "Renseigne l'entreprise du lead CRM avant l'archivage privé.",
        );
      }
      const archive = await archiveMeetingOutput({
        companyName: context.companyName,
        meetingDate: meeting.starts_at,
        meetingId: job.meeting_id,
        meetingTitle: meeting.title,
        notesMarkdown,
        outputVersion: Number(output.version),
        structuredOutput,
        transcriptSrt,
        transcriptText,
      });

      const { error: meetingArchiveError } = await supabase
        .from("meetings")
        .update({
          drive_folder_id: archive.folderId,
          drive_folder_url: archive.folderUrl,
        })
        .eq("id", job.meeting_id)
        .eq("organization_id", job.organization_id);
      if (meetingArchiveError) throw meetingArchiveError;

      const externalIds = archive.files
        .map((file) => file.externalId)
        .filter((id): id is string => Boolean(id));
      const { data: existingAssets, error: existingAssetsError } =
        externalIds.length
          ? await supabase
              .from("meeting_assets")
              .select("external_id")
              .eq("meeting_id", job.meeting_id)
              .eq("organization_id", job.organization_id)
              .in("external_id", externalIds)
          : { data: [], error: null };
      if (existingAssetsError) throw existingAssetsError;
      const archivedIds = new Set(
        (existingAssets ?? []).map((asset) => asset.external_id as string),
      );
      const assetRows = archive.files
        .filter((file) => !file.externalId || !archivedIds.has(file.externalId))
        .map((file) => ({
          display_name: file.name,
          external_id: file.externalId,
          kind: file.kind,
          meeting_id: job.meeting_id,
          mime_type: file.mimeType,
          organization_id: job.organization_id,
          provider: "google-drive",
          url: file.url,
        }));
      if (assetRows.length) {
        const { error: assetInsertError } = await supabase
          .from("meeting_assets")
          .insert(assetRows);
        if (assetInsertError) throw assetInsertError;
      }
    } catch (error) {
      warnings.push(
        error instanceof Error
          ? `Archivage Drive différé: ${error.message}`
          : "Archivage Drive différé.",
      );
    }

    const normalizedWarnings = uniqueStrings(warnings);
    const { error: warningUpdateError } = await supabase
      .from("meeting_outputs")
      .update({ warnings: normalizedWarnings })
      .eq("id", output.id)
      .eq("organization_id", job.organization_id);
    if (warningUpdateError) throw warningUpdateError;

    const completedAt = new Date().toISOString();
    const { error: meetingUpdateError } = await supabase
      .from("meetings")
      .update({ status: "review-ready", updated_at: completedAt })
      .eq("id", job.meeting_id)
      .eq("organization_id", job.organization_id);
    if (meetingUpdateError) throw meetingUpdateError;

    const { data: completedJob, error: jobUpdateError } = await supabase
      .from("meeting_processing_jobs")
      .update({
        error: null,
        lease_expires_at: null,
        message: "Compte rendu prêt à relire",
        progress: 100,
        status: "review-ready",
        updated_at: completedAt,
      })
      .eq("id", jobId)
      .eq("worker_id", payload.workerId)
      .eq("lease_token", payload.leaseToken)
      .eq("status", "finalizing")
      .select("id")
      .maybeSingle();
    if (jobUpdateError) throw jobUpdateError;
    if (!completedJob) {
      throw new MeetingJobLeaseError(
        "Le bail du companion a expiré avant la finalisation.",
      );
    }

    return { outputId: output.id, warnings: normalizedWarnings };
  } catch (error) {
    await supabase
      .from("meeting_processing_jobs")
      .update({
        message: "Finalisation interrompue, nouvelle tentative autorisée",
        status: "uploading",
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("worker_id", payload.workerId)
      .eq("lease_token", payload.leaseToken)
      .eq("status", "finalizing");
    throw error;
  }
}

export async function markMeetingJobFailed(
  jobId: string,
  workerId: string,
  leaseToken: string,
  rawError: unknown,
) {
  const supabase = requireServiceRoleClient();
  const message =
    typeof rawError === "string"
      ? rawError
      : rawError instanceof Error
        ? rawError.message
        : "Le companion local a rencontré une erreur.";
  const { data, error } = await supabase.rpc("fail_meeting_processing_job", {
    failure_message: message,
    requested_job_id: jobId,
    requested_lease_token: leaseToken,
    requested_worker_id: workerId,
  });
  if (error) throw error;
  if (data !== true) throw new MeetingJobLeaseError();
}

async function loadMeetingContext(
  supabase: ReturnType<typeof requireServiceRoleClient>,
  meeting: MeetingRow,
) {
  const [companyResult, contactResult, leadResult, notesResult] =
    await Promise.all([
      meeting.company_id
        ? supabase
            .from("crm_companies")
            .select("name, industry, website, notes")
            .eq("id", meeting.company_id)
            .eq("organization_id", meeting.organization_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      meeting.contact_id
        ? supabase
            .from("crm_contacts")
            .select("name, job_title, email, phone")
            .eq("id", meeting.contact_id)
            .eq("organization_id", meeting.organization_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      meeting.lead_id
        ? supabase
            .from("crm_leads")
            .select("topic, notes, next_action, status, source")
            .eq("id", meeting.lead_id)
            .eq("organization_id", meeting.organization_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      meeting.lead_id
        ? supabase
            .from("crm_lead_notes")
            .select("content, created_at")
            .eq("lead_id", meeting.lead_id)
            .eq("organization_id", meeting.organization_id)
            .order("created_at", { ascending: false })
            .limit(20)
        : Promise.resolve({ data: [] }),
    ]);

  const company = companyResult.data as {
    industry?: string;
    name?: string;
    notes?: string;
    website?: string;
  } | null;
  const contact = contactResult.data as {
    email?: string;
    job_title?: string;
    name?: string;
    phone?: string;
  } | null;
  const lead = leadResult.data as {
    next_action?: string;
    notes?: string;
    source?: string;
    status?: string;
    topic?: string;
  } | null;
  const leadNotes = (notesResult.data ?? []) as Array<{
    content?: string;
    created_at?: string;
  }>;

  const crmContext = [
    company?.industry ? `Secteur: ${company.industry}` : null,
    company?.website ? `Site: ${company.website}` : null,
    company?.notes ? `Contexte entreprise: ${company.notes}` : null,
    contact?.job_title ? `Fonction contact: ${contact.job_title}` : null,
    contact?.email ? `Email contact: ${contact.email}` : null,
    contact?.phone ? `Téléphone contact: ${contact.phone}` : null,
    lead?.topic ? `Opportunité: ${lead.topic}` : null,
    lead?.status ? `Statut CRM: ${lead.status}` : null,
    lead?.next_action ? `Prochaine action: ${lead.next_action}` : null,
    lead?.notes ? `Notes lead: ${lead.notes}` : null,
    ...leadNotes.map((note) =>
      note.content ? `Note ${note.created_at ?? ""}: ${note.content}` : null,
    ),
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 100_000);

  return {
    companyName: company?.name?.trim() || undefined,
    contactName: contact?.name?.trim() || undefined,
    crmContext,
  };
}

function requireServiceRoleClient() {
  const supabase = createServiceRoleSupabaseClient();
  if (!supabase) {
    throw new Error("Supabase service role is not configured.");
  }
  return supabase;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

async function ensureSupportAsset({
  fileId,
  fileName,
  fileUrl,
  job,
  supabase,
}: {
  fileId: string;
  fileName: string;
  fileUrl?: string;
  job: JobRow;
  supabase: ReturnType<typeof requireServiceRoleClient>;
}) {
  const { data: existing } = await supabase
    .from("meeting_assets")
    .select("id")
    .eq("meeting_id", job.meeting_id)
    .eq("organization_id", job.organization_id)
    .eq("kind", "support")
    .eq("external_id", fileId)
    .maybeSingle();
  if (existing) return;

  const { error } = await supabase.from("meeting_assets").insert({
    display_name: fileName,
    external_id: fileId,
    kind: "support",
    meeting_id: job.meeting_id,
    organization_id: job.organization_id,
    provider: "google-drive",
    url: fileUrl,
  });
  if (error) throw error;
}
