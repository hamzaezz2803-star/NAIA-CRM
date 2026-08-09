"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { crmLeadStatuses } from "@/features/crm/contracts";
import {
  listDriveFolderFiles,
  updateDriveFileContent,
  uploadDriveFile,
} from "@/platform/integrations/google-drive-service";
import {
  createGoogleCalendarReminder,
  listGeminiMeetingNoteMessages,
} from "@/platform/integrations/google-workspace";
import { GOOGLE_MEETING_NOTE_SCOPE } from "@/platform/integrations/google-workspace-scopes";

import { requireMeetingNotesAccess } from "./access";
import {
  MAX_SUPPORT_BYTES,
  MEETING_RECORDINGS_BUCKET,
  type MeetingExternalArtifactSummary,
  type MeetingIntelligenceState,
  type MeetingKnowledgeAnswer,
  type MeetingJobSummary,
  type MeetingOutputSummary,
  type MeetingStructuredOutput,
  type MeetingTranscript,
  type MeetingWorkspace,
  meetingAttendeeSchema,
  meetingStructuredOutputSchema,
  recordingManifestSchema,
} from "./contracts";
import { archiveMeetingOutput } from "./drive";
import {
  matchGeminiNoteToMeeting,
  parseGeminiMeetingNoteMessage,
} from "./gemini-email";

const queueInputSchema = z.object({
  meetingId: z.string().uuid(),
  recording: recordingManifestSchema,
});

const saveCaptureDraftSchema = z.object({
  attendees: z.array(meetingAttendeeSchema).max(40),
  consentConfirmed: z.boolean().optional(),
  liveNotesMarkdown: z.string().max(500_000),
  meetingId: z.string().uuid(),
  recordingState: z.enum(["idle", "recording", "stopped"]).optional(),
  title: z.string().trim().min(1).max(300),
});

const registerSupportSchema = z.object({
  meetingId: z.string().uuid(),
  support: recordingManifestSchema,
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
const linkGeminiArtifactSchema = z.object({
  artifactId: z.string().uuid(),
  meetingId: z.string().uuid(),
});
const syncGeminiInputSchema = z
  .object({ pageToken: z.string().trim().min(1).max(2_048).optional() })
  .default({});
const meetingKnowledgeQuestionSchema = z.object({
  meetingId: z.string().uuid().optional(),
  question: z.string().trim().min(2).max(500),
  scope: z.enum(["meeting", "recent"]).default("meeting"),
});

const REVIEW_ARCHIVE_PENDING = "Version relue en attente d'archivage Drive.";
const REVIEW_ARCHIVE_MISSING_FOLDER =
  "Version relue non archivée: relance d'abord l'archivage Drive depuis le cockpit.";

export async function fetchMeetingIntelligenceAction(): Promise<MeetingIntelligenceState> {
  try {
    const { organizationId, supabase, user } =
      await requireMeetingNotesAccess();
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

    const geminiResult = await supabase
      .from("meeting_external_artifacts")
      .select(
        "id,meeting_id,provider,title,occurred_at,notes_markdown,document_url,document_text,recording_url",
      )
      .eq("organization_id", organizationId)
      .order("occurred_at", { ascending: false, nullsFirst: false })
      .limit(100);
    if (
      geminiResult.error &&
      !isMissingGeminiArtifactSchema(geminiResult.error.message)
    ) {
      throw geminiResult.error;
    }

    const { data: googleConnection } = await supabase
      .from("integration_connections")
      .select("scopes")
      .eq("organization_id", organizationId)
      .eq("provider", "google")
      .eq("connected_by_profile_id", user.id)
      .eq("status", "connected")
      .order("connected_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const googleScopes = Array.isArray(googleConnection?.scopes)
      ? (googleConnection.scopes as string[])
      : [];
    const geminiDocumentAccess = googleScopes.some((scope) =>
      [
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/drive.readonly",
        GOOGLE_MEETING_NOTE_SCOPE,
      ].includes(scope),
    );

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
      const attendees = z
        .array(meetingAttendeeSchema)
        .safeParse(row.attendees ?? []);
      const output = latestOutputByMeeting.get(row.id as string);
      if (output && row.drive_folder_url) {
        output.driveFolderUrl = row.drive_folder_url as string;
      }

      return {
        attendees: attendees.success ? attendees.data : [],
        calendarEventId: row.calendar_event_id ?? undefined,
        calendarEventUrl: row.calendar_event_url ?? undefined,
        companyName: company?.name,
        consentConfirmedAt: row.consent_confirmed_at ?? undefined,
        contactName: contact?.name,
        id: row.id as string,
        job: latestJobByMeeting.get(row.id as string),
        leadId: row.lead_id ?? undefined,
        liveNotesMarkdown: (row.live_notes_markdown as string | null) ?? "",
        organizationId,
        output,
        startsAt: row.starts_at ?? undefined,
        status: row.status as string,
        supportFileName: row.support_file_name ?? undefined,
        title: row.title as string,
        updatedAt: row.updated_at ?? undefined,
      } satisfies MeetingWorkspace;
    });

    const geminiArtifacts = (geminiResult.data ?? []).map(
      (row) =>
        ({
          documentUrl: row.document_url ?? undefined,
          documentTextAvailable: Boolean(row.document_text),
          id: row.id as string,
          meetingId: row.meeting_id ?? undefined,
          notesMarkdown: row.notes_markdown as string,
          occurredAt: row.occurred_at ?? undefined,
          provider: "google-gemini",
          recordingUrl: row.recording_url ?? undefined,
          title: row.title as string,
        }) satisfies MeetingExternalArtifactSummary,
    );

    return {
      configured: true,
      geminiDocumentAccess,
      geminiArtifacts,
      meetings: shaped,
      organizationId,
    };
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

export async function syncGeminiMeetingNotesAction(rawInput: unknown = {}) {
  try {
    const input = syncGeminiInputSchema.parse(rawInput);
    const { organizationId, supabase, user } =
      await requireMeetingNotesAccess();
    const batch = await listGeminiMeetingNoteMessages(
      {
        maxResults: 200,
        newerThanDays: 180,
        pageToken: input.pageToken,
      },
      { organizationId, profileId: user.id, supabase },
    );
    const parsed = batch.messages
      .map(parseGeminiMeetingNoteMessage)
      .filter((note): note is NonNullable<typeof note> => Boolean(note));
    if (!parsed.length) {
      return {
        imported: 0,
        matched: 0,
        nextPageToken: batch.nextPageToken,
        scanned: batch.scanned,
        success: true,
        total: 0,
      };
    }

    const { data: meetings, error: meetingsError } = await supabase
      .from("meetings")
      .select("id,title,starts_at")
      .eq("organization_id", organizationId)
      .order("starts_at", { ascending: false, nullsFirst: false })
      .limit(200);
    if (meetingsError) throw meetingsError;

    const externalMessageIds = parsed.map((note) => note.externalMessageId);
    const { data: existing, error: existingError } = await supabase
      .from("meeting_external_artifacts")
      .select("external_message_id,meeting_id")
      .eq("organization_id", organizationId)
      .eq("provider", "google-gemini")
      .in("external_message_id", externalMessageIds);
    if (existingError) throw existingError;
    const existingMeetingByMessage = new Map(
      (existing ?? []).map((row) => [
        row.external_message_id as string,
        row.meeting_id as string | null,
      ]),
    );
    const meetingCandidates = (meetings ?? []).map((meeting) => ({
      id: meeting.id as string,
      startsAt: meeting.starts_at ?? undefined,
      title: meeting.title as string,
    }));
    const now = new Date().toISOString();
    const rows = parsed.map((note) => {
      const preservedMeeting = existingMeetingByMessage.get(
        note.externalMessageId,
      );
      const matchedMeetingId =
        preservedMeeting ?? matchGeminiNoteToMeeting(note, meetingCandidates);
      return {
        document_file_id: note.documentFileId ?? null,
        document_text: note.documentText ?? null,
        document_url: note.documentUrl ?? null,
        external_message_id: note.externalMessageId,
        external_thread_id: note.externalThreadId ?? null,
        imported_by_profile_id: user.id,
        meeting_id: matchedMeetingId ?? null,
        notes_markdown: note.notesMarkdown,
        occurred_at: note.occurredAt ?? null,
        organization_id: organizationId,
        provider: "google-gemini",
        recording_url: note.recordingUrl ?? null,
        sender_email: note.senderEmail,
        title: note.title,
        updated_at: now,
      };
    });

    const { error: upsertError } = await supabase
      .from("meeting_external_artifacts")
      .upsert(rows, {
        onConflict: "organization_id,provider,external_message_id",
      });
    if (upsertError) throw upsertError;
    revalidatePath("/meetings");

    return {
      imported: rows.filter(
        (row) => !existingMeetingByMessage.has(row.external_message_id),
      ).length,
      matched: rows.filter((row) => Boolean(row.meeting_id)).length,
      nextPageToken: batch.nextPageToken,
      scanned: batch.scanned,
      success: true,
      total: rows.length,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Impossible de synchroniser les notes Gemini.",
      success: false,
    };
  }
}

export async function linkGeminiArtifactToMeetingAction(rawInput: unknown) {
  try {
    const input = linkGeminiArtifactSchema.parse(rawInput);
    const { organizationId, supabase } = await requireMeetingNotesAccess();
    const { data: meeting, error: meetingError } = await supabase
      .from("meetings")
      .select("id")
      .eq("id", input.meetingId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (meetingError) throw meetingError;
    if (!meeting) throw new Error("Meeting introuvable.");

    const { data: artifact, error: artifactError } = await supabase
      .from("meeting_external_artifacts")
      .update({
        meeting_id: input.meetingId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.artifactId)
      .eq("organization_id", organizationId)
      .select("id")
      .maybeSingle();
    if (artifactError) throw artifactError;
    if (!artifact) throw new Error("Note Gemini introuvable.");
    revalidatePath("/meetings");
    return { success: true };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Impossible d'associer cette note Gemini.",
      success: false,
    };
  }
}

export async function askMeetingKnowledgeAction(
  rawInput: unknown,
): Promise<
  | ({ success: true } & MeetingKnowledgeAnswer)
  | { error: string; success: false }
> {
  try {
    const input = meetingKnowledgeQuestionSchema.parse(rawInput);
    if (input.scope === "meeting" && !input.meetingId) {
      throw new Error("Sélectionne un meeting pour limiter la recherche.");
    }
    const { organizationId, supabase } = await requireMeetingNotesAccess();
    let meetingQuery = supabase
      .from("meetings")
      .select("id,title,starts_at")
      .eq("organization_id", organizationId)
      .order("starts_at", { ascending: false, nullsFirst: false })
      .limit(input.scope === "meeting" ? 1 : 50);
    if (input.scope === "meeting" && input.meetingId) {
      meetingQuery = meetingQuery.eq("id", input.meetingId);
    }
    const { data: meetings, error: meetingsError } = await meetingQuery;
    if (meetingsError) throw meetingsError;
    const meetingIds = (meetings ?? []).map((meeting) => meeting.id as string);
    if (!meetingIds.length) {
      return {
        answer: "Aucun meeting privé ne correspond à cette recherche.",
        sources: [],
        success: true,
      };
    }

    const outputFields =
      "id,meeting_id,notes_markdown,reviewed_notes_markdown,transcript_text,created_at";
    const [outputsResult, geminiResult] = await Promise.all([
      supabase
        .from("meeting_outputs")
        .select(outputFields)
        .eq("organization_id", organizationId)
        .in("meeting_id", meetingIds)
        .order("created_at", { ascending: false })
        .limit(input.scope === "meeting" ? 5 : 50),
      supabase
        .from("meeting_external_artifacts")
        .select("id,meeting_id,title,notes_markdown,document_text,occurred_at")
        .eq("organization_id", organizationId)
        .in("meeting_id", meetingIds)
        .order("occurred_at", { ascending: false, nullsFirst: false })
        .limit(input.scope === "meeting" ? 10 : 100),
    ]);
    if (outputsResult.error) throw outputsResult.error;
    if (geminiResult.error) throw geminiResult.error;

    const meetingById = new Map(
      (meetings ?? []).map((meeting) => [
        meeting.id as string,
        {
          startsAt: meeting.starts_at as string | null,
          title: meeting.title as string,
        },
      ]),
    );
    const documents: MeetingKnowledgeDocument[] = [];
    for (const rawOutput of outputsResult.data ?? []) {
      const output = rawOutput as unknown as MeetingKnowledgeOutputRow;
      const meeting = meetingById.get(output.meeting_id as string);
      const label = knowledgeSourceLabel(
        meeting?.title ?? "Meeting",
        meeting?.startsAt ?? undefined,
      );
      documents.push({
        meetingId: output.meeting_id as string,
        sourceId: output.id as string,
        sourceLabel: label,
        sourceType: "meeting-notes",
        text:
          (output.reviewed_notes_markdown as string | null) ??
          (output.notes_markdown as string),
      });
      if (typeof output.transcript_text === "string") {
        documents.push({
          meetingId: output.meeting_id as string,
          sourceId: `${output.id}:transcript`,
          sourceLabel: `${label} · transcript`,
          sourceType: "transcript",
          text: output.transcript_text,
        });
      }
    }
    for (const artifact of geminiResult.data ?? []) {
      documents.push({
        meetingId: artifact.meeting_id as string,
        sourceId: artifact.id as string,
        sourceLabel: `${knowledgeSourceLabel(
          artifact.title as string,
          artifact.occurred_at ?? undefined,
        )} · Gemini`,
        sourceType: "gemini-notes",
        text: artifact.notes_markdown as string,
      });
      if (typeof artifact.document_text === "string") {
        documents.push({
          meetingId: artifact.meeting_id as string,
          sourceId: `${artifact.id}:document`,
          sourceLabel: `${knowledgeSourceLabel(
            artifact.title as string,
            artifact.occurred_at ?? undefined,
          )} · document Gemini`,
          sourceType: "transcript",
          text: artifact.document_text,
        });
      }
    }

    const sources = rankMeetingKnowledge(input.question, documents);
    return {
      answer: sources.length
        ? "Voici les passages les plus pertinents dans les notes privées et transcripts disponibles."
        : "Je n'ai trouvé aucun passage suffisamment proche dans les sources privées disponibles.",
      sources,
      success: true,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Impossible de rechercher dans les meetings.",
      success: false,
    };
  }
}

export async function saveMeetingCaptureDraftAction(rawInput: unknown) {
  try {
    const input = saveCaptureDraftSchema.parse(rawInput);
    const { organizationId, supabase } = await requireMeetingNotesAccess();
    const now = new Date().toISOString();
    const updates: Record<string, unknown> = {
      attendees: input.attendees,
      live_notes_markdown: input.liveNotesMarkdown,
      title: input.title,
      updated_at: now,
    };
    if (input.consentConfirmed) updates.consent_confirmed_at = now;
    if (input.recordingState === "recording") {
      updates.recording_started_at = now;
      updates.recording_ended_at = null;
      updates.status = "recording";
    } else if (input.recordingState === "stopped") {
      updates.recording_ended_at = now;
      updates.status = "uploaded";
    }

    const { data, error } = await supabase
      .from("meetings")
      .update(updates)
      .eq("id", input.meetingId)
      .eq("organization_id", organizationId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Meeting introuvable.");
    return { savedAt: now, success: true };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Impossible d'enregistrer le brouillon du meeting.",
      success: false,
    };
  }
}

export async function registerMeetingSupportAction(rawInput: unknown) {
  try {
    const input = registerSupportSchema.parse(rawInput);
    if (
      input.support.chunks.length !== 1 ||
      input.support.totalBytes > MAX_SUPPORT_BYTES
    ) {
      throw new Error(
        "Le support doit être un fichier unique de 25 Mo maximum.",
      );
    }
    if (!/\.(md|pdf|txt)$/i.test(input.support.originalFileName)) {
      throw new Error("Le support doit être un PDF, TXT ou Markdown.");
    }

    const { organizationId, supabase, user } =
      await requireMeetingNotesAccess();
    const { data: meeting, error: meetingError } = await supabase
      .from("meetings")
      .select("id")
      .eq("id", input.meetingId)
      .eq("organization_id", organizationId)
      .single();
    if (meetingError || !meeting) throw new Error("Meeting introuvable.");

    const chunk = input.support.chunks[0];
    const expectedPrefix = `${organizationId}/${input.meetingId}/`;
    if (!chunk.path.startsWith(expectedPrefix)) {
      throw new Error("Chemin du support invalide.");
    }
    const folder = chunk.path.split("/").slice(0, -1).join("/");
    const { data: storageObjects, error: storageError } = await supabase.storage
      .from(MEETING_RECORDINGS_BUCKET)
      .list(folder, { limit: 5 });
    if (storageError) throw storageError;
    const fileName = chunk.path.split("/").at(-1);
    if (!storageObjects?.some((entry) => entry.name === fileName)) {
      throw new Error(
        "Le support n'est pas encore disponible dans le stockage privé.",
      );
    }

    const { data: existing, error: existingError } = await supabase
      .from("meeting_assets")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("meeting_id", input.meetingId)
      .eq("provider", "supabase-storage")
      .eq("storage_path", chunk.path)
      .maybeSingle();
    if (existingError) throw existingError;

    if (!existing) {
      const { error: insertError } = await supabase
        .from("meeting_assets")
        .insert({
          created_by_profile_id: user.id,
          display_name: input.support.originalFileName,
          kind: "support",
          meeting_id: input.meetingId,
          metadata: { manifest: input.support },
          mime_type: input.support.mimeType,
          organization_id: organizationId,
          provider: "supabase-storage",
          size_bytes: input.support.totalBytes,
          storage_path: chunk.path,
        });
      if (insertError && insertError.code !== "23505") throw insertError;
    }

    const { error: updateError } = await supabase
      .from("meetings")
      .update({
        support_file_name: input.support.originalFileName,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.meetingId)
      .eq("organization_id", organizationId);
    if (updateError) throw updateError;
    return { success: true };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Impossible d'attacher le support au meeting.",
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

      // Preserve every uploaded chunk. A founder can retry the queue safely,
      // and no background path deletes meeting material without approval.
      return {
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

type MeetingKnowledgeDocument = {
  meetingId?: string;
  sourceId: string;
  sourceLabel: string;
  sourceType: MeetingKnowledgeAnswer["sources"][number]["sourceType"];
  text: string;
};

type MeetingKnowledgeOutputRow = {
  created_at?: string;
  id: string;
  meeting_id: string;
  notes_markdown: string;
  reviewed_notes_markdown?: string | null;
  transcript_text?: string | null;
};

function rankMeetingKnowledge(
  question: string,
  documents: MeetingKnowledgeDocument[],
): MeetingKnowledgeAnswer["sources"] {
  const normalizedQuestion = normalizeKnowledgeText(question);
  const tokens = new Set(knowledgeTokens(normalizedQuestion));
  if (/\b(decid|decision|decide|arbitr)/u.test(normalizedQuestion)) {
    ["decision", "decide", "arbitrage"].forEach((token) => tokens.add(token));
  }
  if (/\b(action|suivi|follow|relanc|prochaine)/u.test(normalizedQuestion)) {
    ["action", "suivi", "relance", "prochaine"].forEach((token) =>
      tokens.add(token),
    );
  }
  if (!tokens.size) return [];

  const ranked: Array<
    MeetingKnowledgeAnswer["sources"][number] & {
      score: number;
    }
  > = [];
  for (const document of documents) {
    const passages = document.text
      .slice(0, 350_000)
      .split(/\n{2,}|(?<=\.)\s+(?=[A-ZÀ-ÖØ-Þ])/u)
      .map((passage) => passage.replace(/\s+/g, " ").trim())
      .filter((passage) => passage.length >= 25)
      .slice(0, 2_000);
    for (const passage of passages) {
      const normalizedPassage = normalizeKnowledgeText(passage);
      const passageTokens = new Set(knowledgeTokens(normalizedPassage));
      let score = 0;
      let matched = 0;
      for (const token of tokens) {
        if (!passageTokens.has(token)) continue;
        matched += 1;
        score += token.length >= 7 ? 4 : 2;
      }
      if (normalizedPassage.includes(normalizedQuestion)) score += 12;
      score += (matched / tokens.size) * 8;
      if (score < 3) continue;
      ranked.push({
        excerpt: passage.slice(0, 700),
        meetingId: document.meetingId,
        score,
        sourceId: document.sourceId,
        sourceLabel: document.sourceLabel,
        sourceType: document.sourceType,
      });
    }
  }

  const perSource = new Map<string, number>();
  return ranked
    .sort((left, right) => right.score - left.score)
    .filter((candidate) => {
      const count = perSource.get(candidate.sourceId) ?? 0;
      if (count >= 2) return false;
      perSource.set(candidate.sourceId, count + 1);
      return true;
    })
    .slice(0, 5)
    .map((source) => ({
      excerpt: source.excerpt,
      meetingId: source.meetingId,
      sourceId: source.sourceId,
      sourceLabel: source.sourceLabel,
      sourceType: source.sourceType,
    }));
}

function knowledgeSourceLabel(title: string, startsAt?: string) {
  if (!startsAt) return title;
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return title;
  return `${title} · ${new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeZone: "Africa/Casablanca",
  }).format(date)}`;
}

function normalizeKnowledgeText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("fr")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function knowledgeTokens(value: string) {
  return value
    .split(" ")
    .filter((token) => token.length >= 3 && !KNOWLEDGE_STOP_WORDS.has(token));
}

const KNOWLEDGE_STOP_WORDS = new Set([
  "avec",
  "dans",
  "des",
  "est",
  "les",
  "meeting",
  "nous",
  "pour",
  "que",
  "qui",
  "sur",
  "une",
]);

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

function isMissingGeminiArtifactSchema(message: string) {
  return /meeting_external_artifacts.*does not exist|schema cache/i.test(
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
