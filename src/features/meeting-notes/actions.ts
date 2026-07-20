"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { crmLeadStatuses } from "@/features/crm/contracts";
import {
  listDriveFolderFiles,
  updateDriveFileContent,
  uploadDriveFile,
} from "@/platform/integrations/google-drive-service";
import { createGoogleCalendarReminder } from "@/platform/integrations/google-workspace";

import { requireMeetingNotesAccess } from "./access";
import {
  MEETING_RECORDINGS_BUCKET,
  type MeetingIntelligenceState,
  type MeetingJobSummary,
  type MeetingOutputSummary,
  type MeetingStructuredOutput,
  type MeetingTranscript,
  type MeetingWorkspace,
  meetingStructuredOutputSchema,
  recordingManifestSchema,
} from "./contracts";
import { archiveMeetingOutput } from "./drive";

const queueInputSchema = z.object({
  meetingId: z.string().uuid(),
  recording: recordingManifestSchema,
});

const approvalInputSchema = z.object({
  meetingId: z.string().uuid(),
  notesMarkdown: z.string().trim().min(20).max(500_000),
  outputId: z.string().uuid(),
  reviewRevision: z.number().int().nonnegative(),
  outputVersion: z.number().int().positive(),
  selectedRecommendationIds: z.array(z.string().trim().min(1)).max(40),
});

const meetingIdSchema = z.string().uuid();
const transcriptInputSchema = z.object({
  meetingId: z.string().uuid(),
  outputId: z.string().uuid(),
  outputVersion: z.number().int().positive(),
});

const REVIEW_ARCHIVE_PENDING = "Version relue en attente d'archivage Drive.";
const REVIEW_ARCHIVE_MISSING_FOLDER =
  "Version relue non archivée: relance d'abord l'archivage Drive depuis le cockpit.";

export async function fetchMeetingIntelligenceAction(): Promise<MeetingIntelligenceState> {
  try {
    const { organizationId, supabase } = await requireMeetingNotesAccess();
    const { data: meetings, error: meetingError } = await supabase
      .from("meetings")
      .select("*, company:company_id(name), contact:contact_id(name)")
      .eq("organization_id", organizationId)
      .order("starts_at", { ascending: false, nullsFirst: false })
      .limit(100);

    if (meetingError) {
      if (isMissingMeetingSchema(meetingError.message)) {
        return {
          configured: false,
          error:
            "La migration Meeting Intelligence doit être appliquée dans Supabase.",
          meetings: [],
          organizationId,
        };
      }
      throw meetingError;
    }

    const meetingIds = (meetings ?? []).map((meeting) => meeting.id as string);
    const [jobsResult, outputsResult] = meetingIds.length
      ? await Promise.all([
          supabase
            .from("meeting_processing_jobs")
            .select("*")
            .eq("organization_id", organizationId)
            .in("meeting_id", meetingIds)
            .order("updated_at", { ascending: false }),
          supabase
            .from("meeting_outputs")
            .select(
              "id, meeting_id, version, notes_markdown, reviewed_notes_markdown, review_status, review_revision, structured_output, warnings, approval_warnings, applied_recommendation_ids",
            )
            .eq("organization_id", organizationId)
            .in("meeting_id", meetingIds)
            .order("version", { ascending: false }),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
        ];

    if (jobsResult.error) throw jobsResult.error;
    if (outputsResult.error) throw outputsResult.error;

    const latestJobByMeeting = new Map<string, MeetingJobSummary>();
    for (const row of jobsResult.data ?? []) {
      if (latestJobByMeeting.has(row.meeting_id as string)) continue;
      latestJobByMeeting.set(row.meeting_id as string, {
        error: row.error ?? undefined,
        id: row.id as string,
        message: row.message as string,
        progress: Number(row.progress ?? 0),
        status: row.status as string,
        updatedAt: row.updated_at as string,
        workerId: row.worker_id ?? undefined,
      });
    }

    const latestOutputByMeeting = new Map<string, MeetingOutputSummary>();
    for (const row of outputsResult.data ?? []) {
      if (latestOutputByMeeting.has(row.meeting_id as string)) continue;
      const structured = meetingStructuredOutputSchema.parse(
        row.structured_output ?? {},
      );
      latestOutputByMeeting.set(row.meeting_id as string, {
        appliedRecommendationIds: Array.isArray(row.applied_recommendation_ids)
          ? (row.applied_recommendation_ids as string[])
          : [],
        approvalWarnings: Array.isArray(row.approval_warnings)
          ? (row.approval_warnings as string[])
          : [],
        id: row.id as string,
        notesMarkdown: row.notes_markdown as string,
        reviewRevision: Number(row.review_revision ?? 0),
        reviewedNotesMarkdown: row.reviewed_notes_markdown ?? undefined,
        reviewStatus: row.review_status as "draft" | "reviewing" | "approved",
        structured,
        transcriptAvailable: true,
        version: Number(row.version),
        warnings: Array.isArray(row.warnings) ? (row.warnings as string[]) : [],
      });
    }

    const shaped = (meetings ?? []).map((row) => {
      const company = firstRelation(row.company) as { name?: string } | null;
      const contact = firstRelation(row.contact) as { name?: string } | null;
      const output = latestOutputByMeeting.get(row.id as string);
      if (output && row.drive_folder_url) {
        output.driveFolderUrl = row.drive_folder_url as string;
      }

      return {
        companyName: company?.name,
        contactName: contact?.name,
        id: row.id as string,
        job: latestJobByMeeting.get(row.id as string),
        leadId: row.lead_id ?? undefined,
        organizationId,
        output,
        startsAt: row.starts_at ?? undefined,
        status: row.status as string,
        supportFileName: row.support_file_name ?? undefined,
        title: row.title as string,
      } satisfies MeetingWorkspace;
    });

    return { configured: true, meetings: shaped, organizationId };
  } catch (error) {
    return {
      configured: false,
      error:
        error instanceof Error
          ? error.message
          : "Meeting Intelligence est indisponible.",
      meetings: [],
    };
  }
}

export async function fetchMeetingTranscriptAction(
  rawInput: unknown,
): Promise<
  ({ success: true } & MeetingTranscript) | { error: string; success: false }
> {
  try {
    const input = transcriptInputSchema.parse(rawInput);
    const { organizationId, supabase } = await requireMeetingNotesAccess();
    const { data, error } = await supabase
      .from("meeting_outputs")
      .select("transcript_text, transcript_srt")
      .eq("id", input.outputId)
      .eq("meeting_id", input.meetingId)
      .eq("organization_id", organizationId)
      .eq("version", input.outputVersion)
      .single();
    if (error) throw error;
    return {
      success: true,
      transcriptSrt: data.transcript_srt as string,
      transcriptText: data.transcript_text as string,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Impossible de charger le transcript.",
      success: false,
    };
  }
}

export async function queueMeetingProcessingAction(
  meetingId: string,
  rawRecording: unknown,
) {
  try {
    const input = queueInputSchema.parse({
      meetingId,
      recording: rawRecording,
    });
    const { organizationId, supabase } = await requireMeetingNotesAccess();
    const { data: meeting, error: meetingError } = await supabase
      .from("meetings")
      .select("id")
      .eq("id", input.meetingId)
      .eq("organization_id", organizationId)
      .single();
    if (meetingError || !meeting) {
      return {
        discardUploadedAudio: true,
        error: "Meeting introuvable.",
        success: false,
      };
    }

    const expectedPrefix = `${organizationId}/${input.meetingId}/`;
    if (
      input.recording.chunks.some(
        (chunk) => !chunk.path.startsWith(expectedPrefix),
      )
    ) {
      return {
        discardUploadedAudio: true,
        error: "Chemin d'upload invalide.",
        success: false,
      };
    }

    const paths = input.recording.chunks.map((chunk) => chunk.path);
    const { data: storageObjects, error: listError } = await supabase.storage
      .from(MEETING_RECORDINGS_BUCKET)
      .list(paths[0].split("/").slice(0, -1).join("/"), {
        limit: input.recording.chunks.length + 5,
      });
    if (listError) throw listError;
    const uploadedNames = new Set(
      (storageObjects ?? []).map((entry) => entry.name),
    );
    if (
      input.recording.chunks.some(
        (chunk) => !uploadedNames.has(chunk.path.split("/").at(-1) ?? ""),
      )
    ) {
      return {
        discardUploadedAudio: true,
        error: "Certains morceaux audio ne sont pas encore disponibles.",
        success: false,
      };
    }

    const { data: activeJob, error: activeJobError } = await supabase
      .from("meeting_processing_jobs")
      .select("id, status")
      .eq("meeting_id", input.meetingId)
      .eq("organization_id", organizationId)
      .in("status", [
        "queued",
        "claimed",
        "transcribing",
        "analyzing",
        "uploading",
        "finalizing",
      ])
      .maybeSingle();
    if (activeJobError) throw activeJobError;
    if (activeJob) {
      return {
        discardUploadedAudio: true,
        error: "Un traitement est déjà en cours pour ce meeting.",
        jobId: activeJob.id,
        success: false,
      };
    }

    let queueFailure: unknown;
    try {
      const { data: jobId, error: queueError } = await supabase.rpc(
        "queue_meeting_processing_job",
        {
          recording_display_name: input.recording.originalFileName,
          recording_manifest: input.recording,
          recording_mime_type: input.recording.mimeType,
          recording_storage_path: paths[0],
          recording_total_bytes: input.recording.totalBytes,
          requested_meeting_id: input.meetingId,
          requested_organization_id: organizationId,
        },
      );
      if (queueError) throw queueError;
      if (typeof jobId !== "string") {
        throw new Error("Le traitement n'a pas retourné de job valide.");
      }

      revalidatePath("/meetings");
      return { jobId, success: true };
    } catch (error) {
      queueFailure = error;
    }

    // A response can be lost after PostgreSQL committed the transaction.
    // Recover that committed job before deciding whether the audio is orphaned.
    try {
      const { data: recoveredAsset, error: assetRecoveryError } = await supabase
        .from("meeting_assets")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("meeting_id", input.meetingId)
        .eq("provider", "supabase-storage")
        .eq("storage_path", paths[0])
        .maybeSingle();
      if (assetRecoveryError) throw assetRecoveryError;

      if (recoveredAsset) {
        const { data: recoveredJob, error: jobRecoveryError } = await supabase
          .from("meeting_processing_jobs")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("meeting_id", input.meetingId)
          .eq("audio_asset_id", recoveredAsset.id)
          .maybeSingle();
        if (jobRecoveryError) throw jobRecoveryError;
        if (recoveredJob?.id) {
          revalidatePath("/meetings");
          return { jobId: recoveredJob.id as string, success: true };
        }
      }

      await supabase.storage
        .from(MEETING_RECORDINGS_BUCKET)
        .remove(paths)
        .catch(() => undefined);
      return {
        discardUploadedAudio: true,
        error: getMeetingNotesErrorMessage(
          queueFailure,
          "Impossible de lancer le traitement.",
        ),
        success: false,
      };
    } catch {
      // Recovery is ambiguous, so preserve the audio for a later retry instead
      // of risking deletion after a successful but unacknowledged commit.
      return {
        error: getMeetingNotesErrorMessage(
          queueFailure,
          "Impossible de confirmer le lancement du traitement.",
        ),
        success: false,
      };
    }
  } catch (error) {
    return {
      discardUploadedAudio: true,
      error:
        error instanceof Error
          ? error.message
          : "Impossible de lancer le traitement.",
      success: false,
    };
  }
}

export async function retryMeetingProcessingAction(rawMeetingId: unknown) {
  try {
    const meetingId = meetingIdSchema.parse(rawMeetingId);
    const { organizationId, supabase, user } =
      await requireMeetingNotesAccess();
    const { data: activeJob, error: activeJobError } = await supabase
      .from("meeting_processing_jobs")
      .select("id")
      .eq("meeting_id", meetingId)
      .eq("organization_id", organizationId)
      .in("status", [
        "queued",
        "claimed",
        "transcribing",
        "analyzing",
        "uploading",
        "finalizing",
      ])
      .maybeSingle();
    if (activeJobError) throw activeJobError;
    if (activeJob) {
      return {
        error: "Un traitement est déjà en cours pour ce meeting.",
        success: false,
      };
    }

    const { data: asset, error: assetError } = await supabase
      .from("meeting_assets")
      .select("id, metadata")
      .eq("meeting_id", meetingId)
      .eq("organization_id", organizationId)
      .eq("kind", "audio-recording")
      .eq("provider", "supabase-storage")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (assetError) throw assetError;
    const manifest = recordingManifestSchema.parse(
      (asset.metadata as { manifest?: unknown } | null)?.manifest,
    );
    const expectedPrefix = `${organizationId}/${meetingId}/`;
    if (
      manifest.chunks.some((chunk) => !chunk.path.startsWith(expectedPrefix))
    ) {
      throw new Error("Le dernier audio ne correspond pas à ce meeting.");
    }

    const { data: job, error: jobError } = await supabase
      .from("meeting_processing_jobs")
      .insert({
        audio_asset_id: asset.id,
        created_by_profile_id: user.id,
        meeting_id: meetingId,
        organization_id: organizationId,
      })
      .select("id")
      .single();
    if (jobError) throw jobError;

    const { error: meetingError } = await supabase
      .from("meetings")
      .update({ status: "queued", updated_at: new Date().toISOString() })
      .eq("id", meetingId)
      .eq("organization_id", organizationId);
    if (meetingError) throw meetingError;

    revalidatePath("/meetings");
    return { jobId: job.id as string, success: true };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Impossible de relancer l'analyse.",
      success: false,
    };
  }
}

export async function retryMeetingDriveArchiveAction(rawMeetingId: unknown) {
  try {
    const meetingId = meetingIdSchema.parse(rawMeetingId);
    const { organizationId, supabase, user } =
      await requireMeetingNotesAccess();
    const [meetingResult, outputResult] = await Promise.all([
      supabase
        .from("meetings")
        .select("id, title, starts_at, company:company_id(name)")
        .eq("id", meetingId)
        .eq("organization_id", organizationId)
        .single(),
      supabase
        .from("meeting_outputs")
        .select("*")
        .eq("meeting_id", meetingId)
        .eq("organization_id", organizationId)
        .order("version", { ascending: false })
        .limit(1)
        .single(),
    ]);
    if (meetingResult.error) throw meetingResult.error;
    if (outputResult.error) throw outputResult.error;

    const meeting = meetingResult.data;
    const output = outputResult.data;
    const reviewRevision = Number(output.review_revision ?? 0);
    const company = firstRelation(meeting.company) as { name?: string } | null;
    const companyName = company?.name?.trim();
    if (!companyName) {
      throw new Error(
        "Renseigne l'entreprise du lead CRM avant de relancer l'archivage Drive.",
      );
    }
    const archive = await archiveMeetingOutput({
      companyName,
      meetingDate: meeting.starts_at,
      meetingId,
      meetingTitle: meeting.title,
      notesMarkdown: output.notes_markdown as string,
      outputVersion: Number(output.version),
      structuredOutput: meetingStructuredOutputSchema.parse(
        output.structured_output ?? {},
      ),
      transcriptSrt: output.transcript_srt as string,
      transcriptText: output.transcript_text as string,
    });
    const archivedFiles = [...archive.files];
    let approvalWarnings = (output.approval_warnings as string[] | null) ?? [];
    if (
      output.review_status === "approved" &&
      typeof output.reviewed_notes_markdown === "string" &&
      reviewRevision > 0
    ) {
      const reviewed = await archiveReviewedMeetingNotes({
        folderId: archive.folderId,
        notesMarkdown: output.reviewed_notes_markdown,
        outputVersion: Number(output.version),
        reviewRevision,
      });
      archivedFiles.push({
        externalId: reviewed.id,
        kind: "meeting-notes",
        mimeType: "text/markdown",
        name: reviewed.name,
        url:
          reviewed.webViewLink ??
          `https://drive.google.com/file/d/${reviewed.id}/view`,
      });
      approvalWarnings = approvalWarnings.filter(
        (warning) => !warning.startsWith("Version relue"),
      );
    }

    const externalIds = archivedFiles
      .map((file) => file.externalId)
      .filter((id): id is string => Boolean(id));
    const { data: existingAssets, error: existingAssetsError } =
      externalIds.length
        ? await supabase
            .from("meeting_assets")
            .select("external_id")
            .eq("meeting_id", meetingId)
            .eq("organization_id", organizationId)
            .in("external_id", externalIds)
        : { data: [], error: null };
    if (existingAssetsError) throw existingAssetsError;
    const existingIds = new Set(
      (existingAssets ?? []).map((asset) => asset.external_id as string),
    );
    const newAssets = archivedFiles
      .filter((file) => !file.externalId || !existingIds.has(file.externalId))
      .map((file) => ({
        created_by_profile_id: user.id,
        display_name: file.name,
        external_id: file.externalId,
        kind: file.kind,
        meeting_id: meetingId,
        mime_type: file.mimeType,
        organization_id: organizationId,
        provider: "google-drive",
        url: file.url,
      }));

    const warnings = ((output.warnings as string[] | null) ?? []).filter(
      (warning) => !warning.startsWith("Archivage Drive différé"),
    );
    const [meetingUpdate, outputUpdate] = await Promise.all([
      supabase
        .from("meetings")
        .update({
          drive_folder_id: archive.folderId,
          drive_folder_url: archive.folderUrl,
          updated_at: new Date().toISOString(),
        })
        .eq("id", meetingId)
        .eq("organization_id", organizationId),
      supabase
        .from("meeting_outputs")
        .update({ approval_warnings: approvalWarnings, warnings })
        .eq("id", output.id)
        .eq("organization_id", organizationId)
        .eq("review_revision", reviewRevision)
        .select("id")
        .maybeSingle(),
    ]);
    if (meetingUpdate.error) throw meetingUpdate.error;
    if (outputUpdate.error) throw outputUpdate.error;
    if (!outputUpdate.data) {
      throw new Error(
        "Une revue plus récente a été enregistrée pendant l'archivage. Recharge le cockpit avant de réessayer.",
      );
    }
    if (newAssets.length) {
      const { error: assetInsertError } = await supabase
        .from("meeting_assets")
        .insert(newAssets);
      if (assetInsertError) throw assetInsertError;
    }

    revalidatePath("/meetings");
    return {
      driveFolderUrl: archive.folderUrl,
      message: "Compte rendu archivé dans le Drive privé Qarizmi.",
      success: true,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Impossible de relancer l'archivage Drive.",
      success: false,
    };
  }
}

export async function approveMeetingOutputAction(rawInput: unknown) {
  try {
    const input = approvalInputSchema.parse(rawInput);
    const { organizationId, supabase, user } =
      await requireMeetingNotesAccess();
    const { data: meeting, error: meetingError } = await supabase
      .from("meetings")
      .select("id, lead_id, drive_folder_id, drive_folder_url, title")
      .eq("id", input.meetingId)
      .eq("organization_id", organizationId)
      .single();
    if (meetingError) throw meetingError;

    const { data: output, error: outputError } = await supabase
      .from("meeting_outputs")
      .select("*")
      .eq("id", input.outputId)
      .eq("meeting_id", input.meetingId)
      .eq("organization_id", organizationId)
      .eq("version", input.outputVersion)
      .single();
    if (outputError) throw outputError;

    const structured = meetingStructuredOutputSchema.parse(
      output.structured_output ?? {},
    );
    const selectedSet = new Set(input.selectedRecommendationIds);
    const selected = structured.actions.filter((action) =>
      selectedSet.has(action.id),
    );
    if (selected.length !== selectedSet.size) {
      return {
        error: "Une recommandation sélectionnée n'existe plus.",
        success: false,
      };
    }

    const applied = new Set<string>(
      (output.applied_recommendation_ids as string[] | null) ?? [],
    );
    let hasUnresolvedActions = false;
    const warnings: string[] = Array.isArray(output.approval_warnings)
      ? (output.approval_warnings as string[]).filter(
          (warning) => !warning.startsWith("Version relue"),
        )
      : [];

    if (
      output.review_status === "approved" &&
      input.notesMarkdown === output.reviewed_notes_markdown &&
      selected.every((action) => applied.has(action.id))
    ) {
      return { success: true, warnings };
    }

    const { data: reviewLockToken, error: reviewLockError } =
      await supabase.rpc("claim_meeting_output_review", {
        expected_review_revision: input.reviewRevision,
        expected_version: input.outputVersion,
        lease_seconds: 900,
        requested_organization_id: organizationId,
        requested_output_id: output.id,
      });
    if (reviewLockError) throw reviewLockError;
    if (typeof reviewLockToken !== "string" || !reviewLockToken) {
      return {
        error:
          "Ce compte rendu a été modifié ou est déjà en cours de validation par un autre cofondateur. Recharge-le avant de réessayer.",
        success: false,
      };
    }

    let reviewFinalized = false;
    try {
      const { data: completedExecutions, error: completedExecutionsError } =
        await supabase
          .from("meeting_action_executions")
          .select("recommendation_id")
          .eq("output_id", output.id)
          .eq("organization_id", organizationId)
          .eq("status", "completed");
      if (completedExecutionsError) throw completedExecutionsError;
      for (const execution of completedExecutions ?? []) {
        if (typeof execution.recommendation_id === "string") {
          applied.add(execution.recommendation_id);
        }
      }

      for (const action of selected) {
        if (applied.has(action.id)) continue;
        const execution = await claimRecommendationExecution({
          action,
          meetingId: input.meetingId,
          organizationId,
          outputId: output.id as string,
          profileId: user.id,
          supabase,
        });
        if (execution.status === "completed") {
          applied.add(action.id);
          continue;
        }
        if (execution.status === "running") {
          hasUnresolvedActions = true;
          pushUnique(
            warnings,
            `${action.title}: exécution déjà en cours, aucune duplication lancée.`,
          );
          continue;
        }

        let externalEffectMayHaveRun = false;
        try {
          await applyRecommendation({
            action,
            actionExecutionId: execution.id,
            driveFolderUrl: meeting.drive_folder_url ?? undefined,
            leadId: meeting.lead_id ?? undefined,
            organizationId,
            profileId: user.id,
            supabase,
          });
          externalEffectMayHaveRun = true;
          const { error: executionError } = await supabase
            .from("meeting_action_executions")
            .update({
              error: null,
              result: { appliedAt: new Date().toISOString() },
              status: "completed",
              updated_at: new Date().toISOString(),
            })
            .eq("id", execution.id)
            .eq("organization_id", organizationId)
            .eq("status", "running");
          if (executionError) throw executionError;
          applied.add(action.id);
        } catch (error) {
          hasUnresolvedActions = true;
          const errorMessage =
            error instanceof Error ? error.message : "action non appliquée";
          const isIdempotentEffect = isIdempotentRecommendation(action.kind);
          if (!externalEffectMayHaveRun || isIdempotentEffect) {
            await supabase
              .from("meeting_action_executions")
              .update({
                error: errorMessage.slice(0, 4000),
                status: "failed",
                updated_at: new Date().toISOString(),
              })
              .eq("id", execution.id)
              .eq("organization_id", organizationId)
              .eq("status", "running");
          }
          pushUnique(
            warnings,
            externalEffectMayHaveRun && !isIdempotentEffect
              ? `${action.title}: résultat technique ambigu; vérifie la destination avant toute relance pour éviter un doublon.`
              : `${action.title}: ${errorMessage}`,
          );
        }
      }

      if (hasUnresolvedActions) {
        await releaseMeetingOutputReview({
          applied,
          organizationId,
          outputId: output.id as string,
          reviewLockToken,
          supabase,
          warnings,
        });
        revalidatePath("/meetings");
        return {
          error:
            "Au moins une action n'a pas été confirmée. Le compte rendu reste à relire pour permettre une reprise sûre.",
          success: false,
          warnings,
        };
      }

      pushUnique(
        warnings,
        meeting.drive_folder_id
          ? REVIEW_ARCHIVE_PENDING
          : REVIEW_ARCHIVE_MISSING_FOLDER,
      );

      const { data: finalized, error: finalizeError } = await supabase.rpc(
        "finalize_meeting_output_review",
        {
          applied_ids: [...applied],
          requested_lock_token: reviewLockToken,
          requested_organization_id: organizationId,
          requested_output_id: output.id,
          review_warnings: warnings,
          reviewed_notes: input.notesMarkdown,
        },
      );
      if (finalizeError) throw finalizeError;
      if (finalized !== true) {
        throw new Error(
          "Le verrou de validation a expiré. Recharge le compte rendu avant de réessayer.",
        );
      }
      reviewFinalized = true;

      const nextReviewRevision = input.reviewRevision + 1;
      if (meeting.drive_folder_id) {
        try {
          const reviewed = await archiveReviewedMeetingNotes({
            folderId: meeting.drive_folder_id,
            notesMarkdown: input.notesMarkdown,
            outputVersion: input.outputVersion,
            reviewRevision: nextReviewRevision,
          });
          const { error: assetError } = await supabase
            .from("meeting_assets")
            .insert({
              created_by_profile_id: user.id,
              display_name: reviewed.name,
              external_id: reviewed.id,
              kind: "meeting-notes",
              meeting_id: meeting.id,
              mime_type: "text/markdown",
              organization_id: organizationId,
              provider: "google-drive",
              url: reviewed.webViewLink,
            });
          if (assetError && assetError.code !== "23505") throw assetError;
          removeReviewArchiveWarnings(warnings);
        } catch (error) {
          removeReviewArchiveWarnings(warnings);
          pushUnique(
            warnings,
            error instanceof Error
              ? `Version relue non archivée: ${error.message}`
              : "Version relue non archivée dans Drive.",
          );
        }
        await persistApprovalWarnings({
          organizationId,
          outputId: output.id as string,
          reviewRevision: nextReviewRevision,
          supabase,
          warnings,
        });
      }

      revalidatePath("/meetings");
      revalidatePath("/dashboard/leads");
      return { success: true, warnings };
    } catch (error) {
      if (reviewFinalized) {
        pushUnique(
          warnings,
          error instanceof Error
            ? `Validation enregistrée, suivi technique requis: ${error.message}`
            : "Validation enregistrée, suivi technique requis.",
        );
        revalidatePath("/meetings");
        return { success: true, warnings };
      }
      await releaseMeetingOutputReview({
        applied,
        organizationId,
        outputId: output.id as string,
        reviewLockToken,
        supabase,
        warnings,
      });
      throw error;
    }
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Impossible de valider le compte rendu.",
      success: false,
    };
  }
}

async function releaseMeetingOutputReview({
  applied,
  organizationId,
  outputId,
  reviewLockToken,
  supabase,
  warnings,
}: {
  applied: Set<string>;
  organizationId: string;
  outputId: string;
  reviewLockToken: string;
  supabase: Awaited<ReturnType<typeof requireMeetingNotesAccess>>["supabase"];
  warnings: string[];
}) {
  const { error } = await supabase.rpc("release_meeting_output_review", {
    applied_ids: [...applied],
    requested_lock_token: reviewLockToken,
    requested_organization_id: organizationId,
    requested_output_id: outputId,
    review_warnings: warnings,
  });
  if (error) throw error;
}

async function archiveReviewedMeetingNotes({
  folderId,
  notesMarkdown,
  outputVersion,
  reviewRevision,
}: {
  folderId: string;
  notesMarkdown: string;
  outputVersion: number;
  reviewRevision: number;
}) {
  const reviewedName = `meeting_notes_v${outputVersion}_review_r${reviewRevision}.md`;
  const existingReviewed = (
    await listDriveFolderFiles(folderId, { maxResults: 1000 })
  ).find((file) => file.name === reviewedName);
  return existingReviewed?.id
    ? updateDriveFileContent({
        content: Buffer.from(notesMarkdown, "utf8"),
        fileId: existingReviewed.id,
        mimeType: "text/markdown",
      })
    : uploadDriveFile({
        content: Buffer.from(notesMarkdown, "utf8"),
        mimeType: "text/markdown",
        name: reviewedName,
        parentFolderId: folderId,
      });
}

async function persistApprovalWarnings({
  organizationId,
  outputId,
  reviewRevision,
  supabase,
  warnings,
}: {
  organizationId: string;
  outputId: string;
  reviewRevision: number;
  supabase: Awaited<ReturnType<typeof requireMeetingNotesAccess>>["supabase"];
  warnings: string[];
}) {
  const { error } = await supabase
    .from("meeting_outputs")
    .update({
      approval_warnings: warnings,
      updated_at: new Date().toISOString(),
    })
    .eq("id", outputId)
    .eq("organization_id", organizationId)
    .eq("review_revision", reviewRevision);
  if (error) throw error;
}

function removeReviewArchiveWarnings(warnings: string[]) {
  for (let index = warnings.length - 1; index >= 0; index -= 1) {
    if (warnings[index]?.startsWith("Version relue")) warnings.splice(index, 1);
  }
}

async function claimRecommendationExecution({
  action,
  meetingId,
  organizationId,
  outputId,
  profileId,
  supabase,
}: {
  action: MeetingStructuredOutput["actions"][number];
  meetingId: string;
  organizationId: string;
  outputId: string;
  profileId: string;
  supabase: Awaited<ReturnType<typeof requireMeetingNotesAccess>>["supabase"];
}): Promise<
  | { id: string; status: "completed" | "running" }
  | { id: string; status: "execute" }
> {
  const { data: inserted, error: insertError } = await supabase
    .from("meeting_action_executions")
    .insert({
      action_kind: action.kind,
      created_by_profile_id: profileId,
      meeting_id: meetingId,
      organization_id: organizationId,
      output_id: outputId,
      recommendation_id: action.id,
      status: "running",
    })
    .select("id")
    .single();
  if (!insertError && inserted) {
    return { id: inserted.id as string, status: "execute" };
  }
  if (!insertError) {
    throw new Error(
      "La réservation de l'action n'a renvoyé aucun identifiant.",
    );
  }
  if (insertError.code !== "23505") throw insertError;

  const { data: existing, error: existingError } = await supabase
    .from("meeting_action_executions")
    .select("id, status, updated_at")
    .eq("output_id", outputId)
    .eq("recommendation_id", action.id)
    .eq("organization_id", organizationId)
    .single();
  if (existingError) throw existingError;
  if (existing.status === "completed") {
    return {
      id: existing.id as string,
      status: "completed",
    };
  }

  if (existing.status === "running") {
    const staleBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    if (
      isIdempotentRecommendation(action.kind) &&
      typeof existing.updated_at === "string" &&
      existing.updated_at < staleBefore
    ) {
      const { data: reclaimed, error: reclaimError } = await supabase
        .from("meeting_action_executions")
        .update({
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .eq("organization_id", organizationId)
        .eq("status", "running")
        .lt("updated_at", staleBefore)
        .select("id")
        .maybeSingle();
      if (reclaimError) throw reclaimError;
      if (reclaimed) {
        return { id: reclaimed.id as string, status: "execute" };
      }
    }
    return { id: existing.id as string, status: "running" };
  }

  const { data: retried, error: retryError } = await supabase
    .from("meeting_action_executions")
    .update({
      error: null,
      status: "running",
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id)
    .eq("organization_id", organizationId)
    .eq("status", "failed")
    .select("id")
    .maybeSingle();
  if (retryError) throw retryError;
  if (!retried) {
    return { id: existing.id as string, status: "running" };
  }
  return { id: retried.id as string, status: "execute" };
}

async function applyRecommendation({
  action,
  actionExecutionId,
  driveFolderUrl,
  leadId,
  organizationId,
  profileId,
  supabase,
}: {
  action: MeetingStructuredOutput["actions"][number];
  actionExecutionId: string;
  driveFolderUrl?: string;
  leadId?: string;
  organizationId: string;
  profileId: string;
  supabase: Awaited<ReturnType<typeof requireMeetingNotesAccess>>["supabase"];
}) {
  if (!leadId && action.kind !== "calendar-follow-up") {
    throw new Error("Ce meeting n'est pas rattaché à un lead CRM.");
  }

  const evidence = action.evidence
    .map((item) =>
      `${item.timestamp ? `[${item.timestamp}] ` : ""}${item.quote}`.trim(),
    )
    .filter(Boolean)
    .join("\n");
  const content = [
    action.title,
    action.detail,
    evidence ? `Preuves transcript:\n${evidence}` : null,
    driveFolderUrl ? `Dossier privé du meeting: ${driveFolderUrl}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  if (action.kind === "crm-note" || action.kind === "proposal-input") {
    const { error } = await supabase.from("crm_lead_notes").insert({
      content,
      created_by_profile_id: profileId,
      lead_id: leadId,
      meeting_action_execution_id: actionExecutionId,
      organization_id: organizationId,
    });
    if (error) {
      if (error.code !== "23505") throw error;
      const { data: existing, error: existingError } = await supabase
        .from("crm_lead_notes")
        .select("id")
        .eq("meeting_action_execution_id", actionExecutionId)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing) throw error;
    }
    return;
  }

  if (action.kind === "task") {
    const { error } = await supabase.from("crm_tasks").insert({
      created_by_profile_id: profileId,
      description: content,
      due_date: action.dueDate ?? null,
      lead_id: leadId,
      meeting_action_execution_id: actionExecutionId,
      organization_id: organizationId,
      status: "todo",
      title: action.title,
    });
    if (error) {
      if (error.code !== "23505") throw error;
      const { data: existing, error: existingError } = await supabase
        .from("crm_tasks")
        .select("id")
        .eq("meeting_action_execution_id", actionExecutionId)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing) throw error;
    }
    return;
  }

  if (action.kind === "crm-next-action") {
    const desiredNextAction = action.detail || action.title;
    const { data: currentLead, error: currentLeadError } = await supabase
      .from("crm_leads")
      .select("next_action, next_action_meeting_execution_id")
      .eq("id", leadId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (currentLeadError) throw currentLeadError;
    if (!currentLead) throw new Error("Le lead CRM n'existe plus.");
    if (currentLead.next_action_meeting_execution_id === actionExecutionId) {
      return;
    }

    let updateQuery = supabase
      .from("crm_leads")
      .update({
        last_updated_at: new Date().toISOString(),
        last_updated_by_profile_id: profileId,
        next_action: desiredNextAction,
        next_action_meeting_execution_id: actionExecutionId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", leadId)
      .eq("organization_id", organizationId);
    updateQuery =
      currentLead.next_action === null
        ? updateQuery.is("next_action", null)
        : updateQuery.eq("next_action", currentLead.next_action);
    updateQuery =
      currentLead.next_action_meeting_execution_id === null
        ? updateQuery.is("next_action_meeting_execution_id", null)
        : updateQuery.eq(
            "next_action_meeting_execution_id",
            currentLead.next_action_meeting_execution_id,
          );
    const { data, error } = await updateQuery.select("id").maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new Error(
        "L'action suivante a été modifiée pendant la validation; aucune valeur n'a été écrasée.",
      );
    }
    return;
  }

  if (action.kind === "crm-status") {
    if (
      !action.suggestedStatus ||
      !(crmLeadStatuses as readonly string[]).includes(action.suggestedStatus)
    ) {
      throw new Error("Statut CRM suggéré invalide.");
    }
    const { data: currentLead, error: currentLeadError } = await supabase
      .from("crm_leads")
      .select("status, status_meeting_execution_id")
      .eq("id", leadId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (currentLeadError) throw currentLeadError;
    if (!currentLead) throw new Error("Le lead CRM n'existe plus.");
    if (currentLead.status_meeting_execution_id === actionExecutionId) {
      return;
    }

    let updateQuery = supabase
      .from("crm_leads")
      .update({
        last_updated_at: new Date().toISOString(),
        last_updated_by_profile_id: profileId,
        status: action.suggestedStatus,
        status_meeting_execution_id: actionExecutionId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", leadId)
      .eq("organization_id", organizationId)
      .eq("status", currentLead.status);
    updateQuery =
      currentLead.status_meeting_execution_id === null
        ? updateQuery.is("status_meeting_execution_id", null)
        : updateQuery.eq(
            "status_meeting_execution_id",
            currentLead.status_meeting_execution_id,
          );
    const { data, error } = await updateQuery.select("id").maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new Error(
        "Le statut CRM a été modifié pendant la validation; aucune valeur n'a été écrasée.",
      );
    }
    return;
  }

  if (action.kind === "calendar-follow-up") {
    if (!action.dueDate) {
      throw new Error("La recommandation Calendar n'a pas de date.");
    }
    await createGoogleCalendarReminder(
      {
        idempotencyKey: actionExecutionId,
        scheduledAt: action.dueDate,
        title: action.title,
      },
      { organizationId, profileId, supabase },
    );
  }
}

function firstRelation(value: unknown) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function pushUnique(target: string[], value: string) {
  if (!target.includes(value)) target.push(value);
}

function isIdempotentRecommendation(kind: string) {
  return [
    "calendar-follow-up",
    "crm-next-action",
    "crm-note",
    "crm-status",
    "proposal-input",
    "task",
  ].includes(kind);
}

function isMissingMeetingSchema(message: string) {
  return /meeting(s|_outputs|_processing_jobs).*does not exist|schema cache/i.test(
    message,
  );
}

function getMeetingNotesErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return fallback;
}
