"use client";

import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileAudio,
  FileUp,
  LoaderCircle,
  Mic,
  RefreshCw,
  Square,
  UploadCloud,
  Users,
} from "lucide-react";
import {
  type ChangeEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { createBrowserSupabaseClient } from "@/platform/auth/supabase-client";

import {
  approveMeetingOutputAction,
  fetchMeetingIntelligenceAction,
  fetchMeetingTranscriptAction,
  queueMeetingProcessingAction,
  retryMeetingDriveArchiveAction,
  retryMeetingProcessingAction,
} from "./actions";
import {
  MAX_RECORDING_BYTES,
  MAX_RECORDING_CHUNKS,
  MEETING_RECORDINGS_BUCKET,
  type MeetingIntelligenceState,
  type MeetingStructuredOutput,
  type MeetingWorkspace,
  type RecordingManifest,
} from "./contracts";

const AUDIO_CHUNK_BYTES = 5 * 1024 * 1024;
const POLLING_INTERVAL_MS = 5_000;
const ACTIVE_JOB_STATUSES = new Set([
  "queued",
  "claimed",
  "processing",
  "transcribing",
  "analyzing",
  "uploading",
  "finalizing",
]);

type CaptureMode = "idle" | "recording" | "uploading";
type MeetingRecommendation = MeetingStructuredOutput["actions"][number];
type ReviewTab = "notes" | "transcript";

type ActionFeedback = {
  discardUploadedAudio?: boolean;
  error?: string;
  message?: string;
  warnings?: string[];
};

export function MeetingIntelligenceWorkspace({
  initialState,
}: {
  initialState: MeetingIntelligenceState;
}) {
  const [workspaceState, setWorkspaceState] = useState(initialState);
  const [selectedMeetingId, setSelectedMeetingId] = useState(
    () => initialState.meetings.find((meeting) => meeting.leadId)?.id ?? "",
  );
  const [captureMode, setCaptureMode] = useState<CaptureMode>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [feedback, setFeedback] = useState<ActionFeedback>({});

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioPartsRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const disposedRef = useRef(false);

  const crmMeetings = useMemo(
    () => workspaceState.meetings.filter((meeting) => meeting.leadId),
    [workspaceState.meetings],
  );
  const selectedMeeting = useMemo(
    () =>
      crmMeetings.find((meeting) => meeting.id === selectedMeetingId) ??
      crmMeetings[0],
    [crmMeetings, selectedMeetingId],
  );

  const isBusy = captureMode !== "idle" || isApproving || isRetrying;
  const hasActiveJobs = crmMeetings.some((meeting) =>
    meeting.job ? ACTIVE_JOB_STATUSES.has(meeting.job.status) : false,
  );

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      const recorder = mediaRecorderRef.current;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        if (recorder.state !== "inactive") recorder.stop();
      }
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (captureMode !== "recording") return;

    const updateElapsed = () => {
      setElapsedSeconds(
        Math.max(
          0,
          Math.floor((Date.now() - recordingStartedAtRef.current) / 1000),
        ),
      );
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1_000);
    return () => window.clearInterval(timer);
  }, [captureMode]);

  useEffect(() => {
    if (captureMode === "idle") return;
    const protectCapture = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectCapture);
    return () => window.removeEventListener("beforeunload", protectCapture);
  }, [captureMode]);

  const refreshWorkspace = useCallback(async (silent = false) => {
    if (!silent) setIsRefreshing(true);
    try {
      const nextState = await fetchMeetingIntelligenceAction();
      if (!disposedRef.current) {
        setWorkspaceState(nextState);
        setFeedback((current) => ({ ...current, error: undefined }));
      }
    } catch (error) {
      if (!disposedRef.current && !silent) {
        setFeedback({ error: getErrorMessage(error) });
      }
    } finally {
      if (!disposedRef.current && !silent) setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!hasActiveJobs) return;

    const timer = window.setInterval(() => {
      void refreshWorkspace(true);
    }, POLLING_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [hasActiveJobs, refreshWorkspace]);

  const uploadAndQueue = useCallback(
    async ({
      audio,
      durationSeconds,
      meeting,
      originalFileName,
    }: {
      audio: Blob;
      durationSeconds?: number;
      meeting: MeetingWorkspace;
      originalFileName: string;
    }) => {
      if (!workspaceState.organizationId) {
        throw new Error("Organisation introuvable pour cet enregistrement.");
      }
      if (!audio.size) throw new Error("Le fichier audio est vide.");
      if (audio.size > MAX_RECORDING_BYTES) {
        throw new Error("L'audio dépasse la limite de 1 Go.");
      }

      const chunkCount = Math.ceil(audio.size / AUDIO_CHUNK_BYTES);
      if (chunkCount > MAX_RECORDING_CHUNKS) {
        throw new Error("L'audio contient trop de segments à envoyer.");
      }

      const supabase = createBrowserSupabaseClient();
      if (!supabase) {
        throw new Error("Supabase n'est pas configuré dans ce navigateur.");
      }

      setCaptureMode("uploading");
      setUploadProgress(0);
      setFeedback({ message: "Envoi sécurisé de l'audio…" });

      const sessionId = crypto.randomUUID();
      const mimeType = audio.type || "audio/webm";
      const extension = getAudioExtension(originalFileName, mimeType);
      const uploadedChunks: RecordingManifest["chunks"] = [];
      let queueRequestStarted = false;
      const recordingStorage = supabase.storage.from(MEETING_RECORDINGS_BUCKET);

      try {
        for (let index = 0; index < chunkCount; index += 1) {
          const start = index * AUDIO_CHUNK_BYTES;
          const chunk = audio.slice(start, start + AUDIO_CHUNK_BYTES, mimeType);
          const path = `${workspaceState.organizationId}/${meeting.id}/${sessionId}/chunk-${String(index).padStart(4, "0")}.${extension}`;
          const { error } = await recordingStorage.upload(path, chunk, {
            cacheControl: "3600",
            contentType: mimeType,
            upsert: false,
          });

          if (error) {
            throw new Error(`Envoi audio interrompu: ${error.message}`);
          }
          uploadedChunks.push({
            path,
            sha256: await sha256Hex(chunk),
            sizeBytes: chunk.size,
          });
          setUploadProgress(Math.round(((index + 1) / chunkCount) * 100));
        }

        const manifest: RecordingManifest = {
          chunks: uploadedChunks,
          ...(durationSeconds !== undefined ? { durationSeconds } : {}),
          mimeType,
          originalFileName: (originalFileName || "meeting-audio.webm").slice(
            0,
            240,
          ),
          totalBytes: audio.size,
        };

        queueRequestStarted = true;
        const result = await queueMeetingProcessingAction(meeting.id, manifest);
        const actionFeedback = readActionFeedback(result);
        if (actionFeedback.error) {
          if (actionFeedback.discardUploadedAudio) {
            await recordingStorage.remove(
              uploadedChunks.map((chunk) => chunk.path),
            );
            uploadedChunks.splice(0);
          }
          throw new Error(actionFeedback.error);
        }

        setFeedback({
          message:
            actionFeedback.message ??
            "Audio reçu. Le traitement démarrera dès que le companion local sera disponible.",
          warnings: actionFeedback.warnings,
        });
        await refreshWorkspace(true);
      } catch (error) {
        const uploadedPaths = uploadedChunks.map((chunk) => chunk.path);
        if (!queueRequestStarted && uploadedPaths.length) {
          await recordingStorage.remove(uploadedPaths).catch(() => undefined);
        }
        throw error;
      }
    },
    [refreshWorkspace, workspaceState.organizationId],
  );

  const startRecording = async () => {
    if (!selectedMeeting) return;
    if (
      typeof navigator.mediaDevices?.getUserMedia !== "function" ||
      typeof MediaRecorder === "undefined"
    ) {
      setFeedback({
        error:
          "L'enregistrement audio n'est pas disponible dans ce navigateur.",
      });
      return;
    }

    try {
      setFeedback({});
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredMimeType = getPreferredAudioMimeType();
      const recorder = new MediaRecorder(
        stream,
        preferredMimeType ? { mimeType: preferredMimeType } : undefined,
      );
      const meetingAtStart = selectedMeeting;

      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      audioPartsRef.current = [];
      recordingStartedAtRef.current = Date.now();
      setElapsedSeconds(0);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioPartsRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const durationSeconds = Math.max(
          1,
          Math.round((Date.now() - recordingStartedAtRef.current) / 1000),
        );
        const mimeType = recorder.mimeType || "audio/webm";
        const audio = new Blob(audioPartsRef.current, { type: mimeType });
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaRecorderRef.current = null;
        mediaStreamRef.current = null;
        audioPartsRef.current = [];

        if (disposedRef.current) return;
        void uploadAndQueue({
          audio,
          durationSeconds,
          meeting: meetingAtStart,
          originalFileName: `meeting-${meetingAtStart.id}.${getAudioExtension("", mimeType)}`,
        })
          .catch((error) => setFeedback({ error: getErrorMessage(error) }))
          .finally(() => {
            if (!disposedRef.current) setCaptureMode("idle");
          });
      };

      recorder.start(1_000);
      setCaptureMode("recording");
    } catch (error) {
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaRecorderRef.current = null;
      mediaStreamRef.current = null;
      setCaptureMode("idle");
      setFeedback({ error: getErrorMessage(error) });
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  };

  const importAudio = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selectedMeeting) return;

    if (!isAudioFile(file)) {
      setFeedback({ error: "Sélectionne un fichier audio reconnu." });
      return;
    }

    try {
      setFeedback({});
      await uploadAndQueue({
        audio: file,
        meeting: selectedMeeting,
        originalFileName: file.name,
      });
    } catch (error) {
      setFeedback({ error: getErrorMessage(error) });
    } finally {
      if (!disposedRef.current) setCaptureMode("idle");
    }
  };

  const approveReview = async (
    notesMarkdown: string,
    selectedRecommendationIds: string[],
    reviewRevision: number,
  ) => {
    if (!selectedMeeting?.output || !notesMarkdown.trim()) return;

    setIsApproving(true);
    setFeedback({});
    try {
      const result = await approveMeetingOutputAction({
        meetingId: selectedMeeting.id,
        notesMarkdown: notesMarkdown.trim(),
        outputId: selectedMeeting.output.id,
        reviewRevision,
        outputVersion: selectedMeeting.output.version,
        selectedRecommendationIds,
      });
      const actionFeedback = readActionFeedback(result);
      if (actionFeedback.error) throw new Error(actionFeedback.error);
      setFeedback({
        message: actionFeedback.message ?? "Compte rendu et actions validés.",
        warnings: actionFeedback.warnings,
      });
      await refreshWorkspace(true);
    } catch (error) {
      setFeedback({ error: getErrorMessage(error) });
    } finally {
      if (!disposedRef.current) setIsApproving(false);
    }
  };

  const retryProcessing = async () => {
    if (!selectedMeeting) return;
    setIsRetrying(true);
    setFeedback({});
    try {
      const result = await retryMeetingProcessingAction(selectedMeeting.id);
      const actionFeedback = readActionFeedback(result);
      if (actionFeedback.error) throw new Error(actionFeedback.error);
      setFeedback({
        message: "Analyse relancée avec le dernier audio sécurisé.",
      });
      await refreshWorkspace(true);
    } catch (error) {
      setFeedback({ error: getErrorMessage(error) });
    } finally {
      if (!disposedRef.current) setIsRetrying(false);
    }
  };

  const retryDriveArchive = async () => {
    if (!selectedMeeting) return;
    setIsRetrying(true);
    setFeedback({});
    try {
      const result = await retryMeetingDriveArchiveAction(selectedMeeting.id);
      const actionFeedback = readActionFeedback(result);
      if (actionFeedback.error) throw new Error(actionFeedback.error);
      setFeedback({
        message:
          actionFeedback.message ??
          "Compte rendu archivé dans le Drive privé Qarizmi.",
      });
      await refreshWorkspace(true);
    } catch (error) {
      setFeedback({ error: getErrorMessage(error) });
    } finally {
      if (!disposedRef.current) setIsRetrying(false);
    }
  };

  if (!workspaceState.configured) {
    return (
      <section
        className="rounded-lg border px-4 py-3"
        style={{
          background: "var(--maison-card)",
          borderColor: "var(--maison-border)",
        }}
      >
        <div className="flex items-center gap-3 text-sm">
          <AlertCircle
            className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-300"
            aria-hidden="true"
          />
          <p style={{ color: "var(--maison-text-secondary)" }}>
            {workspaceState.error ??
              "L'intelligence meeting n'est pas encore configurée."}
          </p>
        </div>
      </section>
    );
  }

  const operationalStatus = selectedMeeting
    ? getOperationalStatus(selectedMeeting)
    : undefined;

  return (
    <section
      aria-labelledby="meeting-intelligence-title"
      className="overflow-hidden rounded-lg border shadow-sm"
      style={{
        background: "var(--maison-card)",
        borderColor: "var(--maison-border)",
      }}
    >
      <header
        className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        style={{ borderColor: "var(--maison-border)" }}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2
              id="meeting-intelligence-title"
              className="text-base font-semibold"
              style={{ color: "var(--maison-text-primary)" }}
            >
              Intelligence meeting
            </h2>
            <span className="rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-800 dark:border-teal-900/50 dark:bg-teal-950/40 dark:text-teal-200">
              Privé cofondateurs
            </span>
          </div>
          <p
            className="mt-1 text-sm"
            style={{ color: "var(--maison-text-muted)" }}
          >
            Capture, traitement local et validation opérationnelle.
          </p>
        </div>

        <Button
          aria-label="Actualiser les meetings"
          className="h-11 w-11 self-end px-0 sm:self-auto"
          disabled={isRefreshing}
          onClick={() => void refreshWorkspace()}
          title="Actualiser"
          variant="ghost"
        >
          <RefreshCw
            className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
        </Button>
      </header>

      {crmMeetings.length === 0 ? (
        <div className="flex min-h-36 items-center justify-center px-4 py-8 text-center">
          <div>
            <CalendarEmptyIcon />
            <p
              className="mt-3 text-sm font-medium"
              style={{ color: "var(--maison-text-primary)" }}
            >
              Aucun meeting CRM à traiter
            </p>
          </div>
        </div>
      ) : (
        <div className="grid xl:grid-cols-[minmax(20rem,0.85fr)_minmax(0,1.35fr)]">
          <div
            className="border-b p-4 xl:border-r xl:border-b-0"
            style={{ borderColor: "var(--maison-border)" }}
          >
            <label
              className="text-xs font-semibold uppercase"
              htmlFor="meeting-intelligence-select"
              style={{ color: "var(--maison-text-muted)" }}
            >
              Meeting CRM
            </label>
            <select
              id="meeting-intelligence-select"
              className="mt-2 h-11 w-full rounded-md border px-3 text-sm outline-none transition focus:ring-2 focus:ring-teal-600"
              disabled={captureMode === "recording"}
              onChange={(event) => setSelectedMeetingId(event.target.value)}
              style={{
                background: "var(--maison-page)",
                borderColor: "var(--maison-border)",
                color: "var(--maison-text-primary)",
              }}
              value={selectedMeeting?.id ?? ""}
            >
              {crmMeetings.map((meeting) => (
                <option key={meeting.id} value={meeting.id}>
                  {formatMeetingOption(meeting)}
                </option>
              ))}
            </select>

            {selectedMeeting ? (
              <>
                <div className="mt-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p
                      className="truncate text-sm font-semibold"
                      title={selectedMeeting.title}
                      style={{ color: "var(--maison-text-primary)" }}
                    >
                      {selectedMeeting.companyName ?? selectedMeeting.title}
                    </p>
                    <p
                      className="mt-1 text-sm"
                      style={{ color: "var(--maison-text-secondary)" }}
                    >
                      {[
                        selectedMeeting.contactName,
                        formatMeetingDate(selectedMeeting.startsAt),
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Contexte CRM disponible"}
                    </p>
                  </div>
                  {operationalStatus ? (
                    <StatusPill status={operationalStatus} />
                  ) : null}
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  {captureMode === "recording" ? (
                    <Button
                      className="h-11 min-w-36 border-red-700 bg-red-700 text-white hover:bg-red-800"
                      onClick={stopRecording}
                      title="Arrêter l'enregistrement"
                    >
                      <Square
                        className="h-4 w-4 fill-current"
                        aria-hidden="true"
                      />
                      Arrêter {formatDuration(elapsedSeconds)}
                    </Button>
                  ) : (
                    <Button
                      className="h-11 min-w-36"
                      disabled={isBusy || hasActiveJob(selectedMeeting)}
                      onClick={() => void startRecording()}
                      title="Enregistrer ce meeting"
                    >
                      <Mic className="h-4 w-4" aria-hidden="true" />
                      Enregistrer
                    </Button>
                  )}

                  <Button
                    className="h-11"
                    disabled={isBusy || hasActiveJob(selectedMeeting)}
                    onClick={() => fileInputRef.current?.click()}
                    title="Importer un fichier audio"
                    variant="outline"
                  >
                    <FileUp className="h-4 w-4" aria-hidden="true" />
                    Importer
                  </Button>
                  <input
                    ref={fileInputRef}
                    accept="audio/*,.m4a,.mp3,.mp4,.wav,.webm,.ogg,.aac,.flac"
                    className="sr-only"
                    onChange={(event) => void importAudio(event)}
                    tabIndex={-1}
                    type="file"
                  />
                </div>

                {captureMode === "uploading" ? (
                  <ProgressBlock
                    icon={
                      <UploadCloud className="h-4 w-4" aria-hidden="true" />
                    }
                    label="Envoi audio sécurisé"
                    progress={uploadProgress}
                  />
                ) : selectedMeeting.job ? (
                  <>
                    <JobProgress job={selectedMeeting.job} />
                    {selectedMeeting.job.status === "failed" ? (
                      <Button
                        className="mt-3 h-10"
                        disabled={isBusy}
                        onClick={() => void retryProcessing()}
                        variant="outline"
                      >
                        <RefreshCw className="h-4 w-4" aria-hidden="true" />
                        {"Relancer l'analyse"}
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <p
                    className="mt-4 text-xs"
                    style={{ color: "var(--maison-text-muted)" }}
                  >
                    Audio conservé dans le stockage privé Qarizmi.
                  </p>
                )}
              </>
            ) : null}
          </div>

          <div className="min-w-0 p-4">
            {selectedMeeting?.output ? (
              <ReviewWorkspace
                disabled={isApproving}
                key={`${selectedMeeting.output.id}:${selectedMeeting.output.reviewRevision}`}
                meeting={selectedMeeting}
                onApprove={(notesMarkdown, recommendationIds, reviewRevision) =>
                  void approveReview(
                    notesMarkdown,
                    recommendationIds,
                    reviewRevision,
                  )
                }
                onRetryArchive={() => void retryDriveArchive()}
              />
            ) : (
              <PendingWorkspace meeting={selectedMeeting} />
            )}
          </div>
        </div>
      )}

      {feedback.error || feedback.message || feedback.warnings?.length ? (
        <FeedbackBar feedback={feedback} />
      ) : null}
    </section>
  );
}

function ReviewWorkspace({
  disabled,
  meeting,
  onApprove,
  onRetryArchive,
}: {
  disabled: boolean;
  meeting: MeetingWorkspace;
  onApprove: (
    notesMarkdown: string,
    recommendationIds: string[],
    reviewRevision: number,
  ) => void;
  onRetryArchive: () => void;
}) {
  const output = meeting.output;
  if (!output) return null;
  return (
    <ReviewEditor
      disabled={disabled}
      key={`${output.id}:${output.reviewRevision}`}
      meeting={meeting}
      onApprove={onApprove}
      onRetryArchive={onRetryArchive}
      output={output}
    />
  );
}

function ReviewEditor({
  disabled,
  meeting,
  onApprove,
  onRetryArchive,
  output,
}: {
  disabled: boolean;
  meeting: MeetingWorkspace;
  onApprove: (
    notesMarkdown: string,
    recommendationIds: string[],
    reviewRevision: number,
  ) => void;
  onRetryArchive: () => void;
  output: NonNullable<MeetingWorkspace["output"]>;
}) {
  const [notes, setNotes] = useState(
    output.reviewedNotesMarkdown ?? output.notesMarkdown,
  );
  const [activeTab, setActiveTab] = useState<ReviewTab>("notes");
  const [selectedRecommendationIds, setSelectedRecommendationIds] = useState<
    string[]
  >([]);
  const [transcript, setTranscript] = useState<string>();
  const [transcriptError, setTranscriptError] = useState<string>();
  const [isLoadingTranscript, setIsLoadingTranscript] = useState(false);
  const outputWarnings = [
    ...output.warnings,
    ...output.approvalWarnings,
  ].filter((warning, index, all) => warning && all.indexOf(warning) === index);
  const needsArchiveRetry =
    !output.driveFolderUrl ||
    output.warnings.some((warning) =>
      warning.startsWith("Archivage Drive différé"),
    ) ||
    output.approvalWarnings.some((warning) =>
      warning.startsWith("Version relue"),
    );

  const selectReviewTab = async (tab: ReviewTab) => {
    setActiveTab(tab);
    if (tab !== "transcript" || transcript || isLoadingTranscript) return;
    setIsLoadingTranscript(true);
    setTranscriptError(undefined);
    try {
      const result = await fetchMeetingTranscriptAction({
        meetingId: meeting.id,
        outputId: output.id,
        outputVersion: output.version,
      });
      if (!result.success) throw new Error(result.error);
      setTranscript(result.transcriptText);
    } catch (error) {
      setTranscriptError(getErrorMessage(error));
    } finally {
      setIsLoadingTranscript(false);
    }
  };

  const toggleRecommendation = (recommendationId: string) => {
    setSelectedRecommendationIds((current) =>
      current.includes(recommendationId)
        ? current.filter((id) => id !== recommendationId)
        : [...current, recommendationId],
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3
              className="text-sm font-semibold"
              style={{ color: "var(--maison-text-primary)" }}
            >
              Revue du compte rendu
            </h3>
            <span
              className="text-xs"
              style={{ color: "var(--maison-text-muted)" }}
            >
              Version {output.version}
            </span>
          </div>
          <p
            className="mt-1 text-sm"
            style={{ color: "var(--maison-text-secondary)" }}
          >
            {output.structured.executiveSummary || "Analyse prête à relire."}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {needsArchiveRetry ? (
            <Button
              className="h-11"
              disabled={disabled}
              onClick={onRetryArchive}
              variant="outline"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Réessayer Drive
            </Button>
          ) : null}
          {output.driveFolderUrl ? (
            <a
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-medium transition hover:bg-[var(--maison-border-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
              href={output.driveFolderUrl}
              rel="noreferrer"
              style={{
                borderColor: "var(--maison-border)",
                color: "var(--maison-text-primary)",
              }}
              target="_blank"
            >
              Ouvrir Drive
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          ) : null}
        </div>
      </div>

      {outputWarnings.length ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
          <div className="flex items-start gap-2">
            <AlertCircle
              className="mt-0.5 h-4 w-4 shrink-0"
              aria-hidden="true"
            />
            <div>
              {outputWarnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div
            aria-label="Contenu du compte rendu"
            className="inline-flex w-fit rounded-md border p-1"
            role="tablist"
            style={{ borderColor: "var(--maison-border)" }}
          >
            <ReviewTabButton
              active={activeTab === "notes"}
              id="notes"
              onSelect={(tab) => void selectReviewTab(tab)}
            >
              Notes
            </ReviewTabButton>
            <ReviewTabButton
              active={activeTab === "transcript"}
              id="transcript"
              onSelect={(tab) => void selectReviewTab(tab)}
            >
              Transcript
            </ReviewTabButton>
          </div>
          {activeTab === "transcript" ? (
            <span
              className="text-xs font-medium"
              style={{ color: "var(--maison-text-muted)" }}
            >
              Source de vérité · lecture seule
            </span>
          ) : null}
        </div>

        {activeTab === "notes" ? (
          <div
            aria-labelledby="meeting-review-tab-notes"
            className="mt-2"
            id="meeting-review-panel-notes"
            role="tabpanel"
          >
            <label className="sr-only" htmlFor={`meeting-notes-${meeting.id}`}>
              Notes de réunion
            </label>
            <textarea
              id={`meeting-notes-${meeting.id}`}
              className="min-h-64 w-full resize-y rounded-md border p-3 text-sm leading-6 outline-none transition focus:ring-2 focus:ring-teal-600"
              onChange={(event) => setNotes(event.target.value)}
              spellCheck="true"
              style={{
                background: "var(--maison-page)",
                borderColor: "var(--maison-border)",
                color: "var(--maison-text-primary)",
              }}
              value={notes}
            />
          </div>
        ) : (
          <div
            aria-label="Transcript source de vérité"
            aria-labelledby="meeting-review-tab-transcript"
            className="mt-2 min-h-64 max-h-[32rem] overflow-y-auto whitespace-pre-wrap rounded-md border p-3 text-sm leading-6"
            id="meeting-review-panel-transcript"
            role="tabpanel"
            style={{
              background: "var(--maison-page)",
              borderColor: "var(--maison-border)",
              color: "var(--maison-text-secondary)",
            }}
            tabIndex={0}
          >
            {isLoadingTranscript ? (
              <span className="flex items-center gap-2">
                <LoaderCircle
                  className="h-4 w-4 animate-spin"
                  aria-hidden="true"
                />
                Chargement du transcript…
              </span>
            ) : transcriptError ? (
              <span className="text-red-700 dark:text-red-200">
                {transcriptError}
              </span>
            ) : (
              (transcript ?? "Transcript indisponible.")
            )}
          </div>
        )}
      </div>

      <fieldset>
        <legend
          className="text-xs font-semibold uppercase"
          style={{ color: "var(--maison-text-muted)" }}
        >
          Actions à appliquer
        </legend>
        {output.structured.actions.length ? (
          <div
            className="mt-2 divide-y rounded-md border"
            style={{ borderColor: "var(--maison-border)" }}
          >
            {output.structured.actions.map((recommendation) => (
              <RecommendationRow
                checked={selectedRecommendationIds.includes(recommendation.id)}
                key={recommendation.id}
                onToggle={() => toggleRecommendation(recommendation.id)}
                recommendation={recommendation}
              />
            ))}
          </div>
        ) : (
          <p
            className="mt-2 text-sm"
            style={{ color: "var(--maison-text-secondary)" }}
          >
            Aucune action recommandée.
          </p>
        )}
      </fieldset>

      <div
        className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between"
        style={{ borderColor: "var(--maison-border)" }}
      >
        <p className="text-xs" style={{ color: "var(--maison-text-muted)" }}>
          {selectedRecommendationIds.length} action
          {selectedRecommendationIds.length === 1 ? "" : "s"} sélectionnée
          {selectedRecommendationIds.length === 1 ? "" : "s"}
        </p>
        <Button
          className="h-11 sm:min-w-52"
          disabled={disabled || !notes.trim()}
          onClick={() =>
            onApprove(notes, selectedRecommendationIds, output.reviewRevision)
          }
        >
          {disabled ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="h-4 w-4" aria-hidden="true" />
          )}
          {output.reviewStatus === "approved"
            ? "Mettre à jour"
            : output.reviewStatus === "reviewing"
              ? "Reprendre la validation"
              : "Valider la revue"}
        </Button>
      </div>
    </div>
  );
}

function RecommendationRow({
  checked,
  onToggle,
  recommendation,
}: {
  checked: boolean;
  onToggle: () => void;
  recommendation: MeetingRecommendation;
}) {
  const becomesVisibleToCrm =
    recommendation.kind === "crm-note" ||
    recommendation.kind === "proposal-input";

  return (
    <label className="flex cursor-pointer items-start gap-3 px-3 py-3 transition hover:bg-[var(--maison-border-subtle)]">
      <input
        checked={checked}
        className="mt-1 h-4 w-4 rounded border-stone-300 text-teal-700 focus:ring-teal-600"
        onChange={onToggle}
        type="checkbox"
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span
            className="text-sm font-semibold"
            style={{ color: "var(--maison-text-primary)" }}
          >
            {recommendation.title}
          </span>
          <span className={confidenceClassName(recommendation.confidence)}>
            {confidenceLabel(recommendation.confidence)}
          </span>
        </span>
        {recommendation.detail ? (
          <span
            className="mt-1 block text-sm leading-5"
            style={{ color: "var(--maison-text-secondary)" }}
          >
            {recommendation.detail}
          </span>
        ) : null}
        <span
          className="mt-2 block text-xs font-medium"
          style={{ color: "var(--maison-text-muted)" }}
        >
          Effet après validation : {recommendationEffectLabel(recommendation)}
        </span>
        {recommendation.suggestedStatus ? (
          <span
            className="mt-1 block text-xs"
            style={{ color: "var(--maison-text-muted)" }}
          >
            Statut CRM proposé : {recommendation.suggestedStatus}
          </span>
        ) : null}
        {recommendation.dueDate ? (
          <span
            className="mt-1 flex items-center gap-1 text-xs"
            style={{ color: "var(--maison-text-muted)" }}
          >
            <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
            {formatMeetingDate(recommendation.dueDate)}
          </span>
        ) : null}
        {recommendation.evidence.length ? (
          <span className="mt-2 block space-y-1">
            {recommendation.evidence.map((evidence, index) => (
              <span
                className="block rounded border px-2 py-1 text-xs leading-5"
                key={`${evidence.timestamp ?? "source"}-${index}`}
                style={{
                  borderColor: "var(--maison-border)",
                  color: "var(--maison-text-secondary)",
                }}
              >
                {evidence.timestamp ? `[${evidence.timestamp}] ` : ""}
                {evidence.quote || "Extrait transcript non renseigné"}
              </span>
            ))}
          </span>
        ) : null}
        {becomesVisibleToCrm ? (
          <span className="mt-2 flex w-fit items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-medium text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-100">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            {"Visible par l'équipe CRM après validation"}
          </span>
        ) : null}
      </span>
    </label>
  );
}

function ReviewTabButton({
  active,
  children,
  id,
  onSelect,
}: {
  active: boolean;
  children: ReactNode;
  id: ReviewTab;
  onSelect: (tab: ReviewTab) => void;
}) {
  return (
    <button
      aria-controls={`meeting-review-panel-${id}`}
      aria-selected={active}
      className={`h-9 rounded px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${
        active
          ? "bg-stone-950 text-white shadow-sm dark:bg-stone-50 dark:text-stone-950"
          : "text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
      }`}
      id={`meeting-review-tab-${id}`}
      onClick={() => onSelect(id)}
      role="tab"
      type="button"
    >
      {children}
    </button>
  );
}

function PendingWorkspace({ meeting }: { meeting?: MeetingWorkspace }) {
  const status = meeting ? getOperationalStatus(meeting) : undefined;
  const isError = status?.tone === "error";

  return (
    <div className="flex min-h-64 items-center justify-center text-center">
      <div className="max-w-sm">
        {isError ? (
          <AlertCircle
            className="mx-auto h-8 w-8 text-red-600 dark:text-red-300"
            aria-hidden="true"
          />
        ) : meeting?.job && ACTIVE_JOB_STATUSES.has(meeting.job.status) ? (
          <LoaderCircle
            className="mx-auto h-8 w-8 animate-spin text-teal-700 dark:text-teal-300"
            aria-hidden="true"
          />
        ) : (
          <FileAudio
            className="mx-auto h-8 w-8"
            style={{ color: "var(--maison-text-muted)" }}
            aria-hidden="true"
          />
        )}
        <p
          className="mt-3 text-sm font-semibold"
          style={{ color: "var(--maison-text-primary)" }}
        >
          {isError
            ? "Traitement interrompu"
            : meeting?.job && ACTIVE_JOB_STATUSES.has(meeting.job.status)
              ? "Analyse en cours"
              : "Aucun compte rendu pour ce meeting"}
        </p>
        <p
          className="mt-1 text-sm leading-6"
          style={{ color: "var(--maison-text-secondary)" }}
        >
          {meeting?.job?.error ??
            meeting?.job?.message ??
            "Enregistre le meeting ou importe son audio pour lancer le traitement local."}
        </p>
      </div>
    </div>
  );
}

function JobProgress({ job }: { job: NonNullable<MeetingWorkspace["job"]> }) {
  const status = getJobStatus(job.status);
  const progress = Math.min(100, Math.max(0, job.progress));

  if (status.tone === "error") {
    return (
      <div className="mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{job.error ?? job.message}</span>
      </div>
    );
  }

  return (
    <ProgressBlock
      icon={
        status.tone === "success" ? (
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        ) : (
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
        )
      }
      label={job.message || status.label}
      progress={progress}
    />
  );
}

function ProgressBlock({
  icon,
  label,
  progress,
}: {
  icon: ReactNode;
  label: string;
  progress: number;
}) {
  return (
    <div className="mt-4" role="status">
      <div className="flex items-center justify-between gap-3 text-xs font-medium">
        <span
          className="flex min-w-0 items-center gap-2"
          style={{ color: "var(--maison-text-secondary)" }}
        >
          {icon}
          <span className="truncate">{label}</span>
        </span>
        <span
          className="tabular-nums"
          style={{ color: "var(--maison-text-muted)" }}
        >
          {progress}%
        </span>
      </div>
      <div
        aria-label={label}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={progress}
        className="mt-2 h-1.5 overflow-hidden rounded-full"
        role="progressbar"
        style={{ background: "var(--maison-border-subtle)" }}
      >
        <div
          className="h-full rounded-full bg-teal-600 transition-[width] duration-200 dark:bg-teal-400"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

function FeedbackBar({ feedback }: { feedback: ActionFeedback }) {
  const isError = Boolean(feedback.error);
  const warnings = feedback.warnings?.filter(Boolean) ?? [];
  const text = feedback.error ?? feedback.message;

  return (
    <div
      aria-live="polite"
      className={`flex items-start gap-2 border-t px-4 py-3 text-sm ${
        isError
          ? "bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-200"
          : "bg-teal-50 text-teal-900 dark:bg-teal-950/30 dark:text-teal-100"
      }`}
      style={{ borderColor: "var(--maison-border)" }}
    >
      {isError ? (
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      ) : (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      )}
      <div>
        {text ? <p>{text}</p> : null}
        {warnings.map((warning) => (
          <p className="mt-1" key={warning}>
            {warning}
          </p>
        ))}
      </div>
    </div>
  );
}

type OperationalStatus = {
  label: string;
  tone: "idle" | "progress" | "success" | "error";
};

function getOperationalStatus(meeting: MeetingWorkspace): OperationalStatus {
  if (meeting.output?.reviewStatus === "approved") {
    return { label: "Validé", tone: "success" };
  }
  if (meeting.output?.reviewStatus === "reviewing") {
    return { label: "Validation en cours", tone: "progress" };
  }
  if (meeting.output) return { label: "À relire", tone: "success" };
  if (meeting.job) return getJobStatus(meeting.job.status);
  return { label: "À traiter", tone: "idle" };
}

function getJobStatus(status: string): OperationalStatus {
  switch (status) {
    case "queued":
      return { label: "En attente du Mac", tone: "progress" };
    case "claimed":
    case "processing":
      return { label: "Traitement", tone: "progress" };
    case "transcribing":
      return { label: "Transcription", tone: "progress" };
    case "analyzing":
      return { label: "Analyse", tone: "progress" };
    case "uploading":
      return { label: "Archivage", tone: "progress" };
    case "finalizing":
      return { label: "Finalisation", tone: "progress" };
    case "completed":
    case "review-ready":
      return { label: "À relire", tone: "success" };
    case "failed":
    case "error":
      return { label: "Erreur", tone: "error" };
    default:
      return { label: "À traiter", tone: "idle" };
  }
}

function StatusPill({ status }: { status: OperationalStatus }) {
  const className = {
    error:
      "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200",
    idle: "border-stone-200 bg-stone-50 text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200",
    progress:
      "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200",
    success:
      "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200",
  }[status.tone];

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-1 text-xs font-semibold ${className}`}
    >
      {status.label}
    </span>
  );
}

function CalendarEmptyIcon() {
  return (
    <FileAudio
      className="mx-auto h-8 w-8"
      style={{ color: "var(--maison-text-muted)" }}
      aria-hidden="true"
    />
  );
}

function hasActiveJob(meeting: MeetingWorkspace) {
  return meeting.job ? ACTIVE_JOB_STATUSES.has(meeting.job.status) : false;
}

function formatMeetingOption(meeting: MeetingWorkspace) {
  const label = meeting.companyName ?? meeting.title;
  const date = formatMeetingDate(meeting.startsAt);
  return date ? `${label} · ${date}` : label;
}

function formatMeetingDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Casablanca",
  }).format(date);
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getPreferredAudioMimeType() {
  if (typeof MediaRecorder === "undefined") return undefined;
  return [
    "audio/mp4",
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
}

function getAudioExtension(fileName: string, mimeType: string) {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (
    extension &&
    ["aac", "flac", "m4a", "mp3", "mp4", "ogg", "wav", "webm"].includes(
      extension,
    )
  ) {
    return extension;
  }
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("flac")) return "flac";
  if (mimeType.includes("aac")) return "aac";
  return "webm";
}

function isAudioFile(file: File) {
  if (file.type.startsWith("audio/")) return true;
  return /\.(aac|flac|m4a|mp3|mp4|ogg|wav|webm)$/i.test(file.name);
}

function confidenceLabel(confidence: MeetingRecommendation["confidence"]) {
  if (confidence === "high") return "Confiance haute";
  if (confidence === "low") return "À confirmer";
  return "Confiance moyenne";
}

function confidenceClassName(confidence: MeetingRecommendation["confidence"]) {
  if (confidence === "high") {
    return "rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200";
  }
  if (confidence === "low") {
    return "rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-200";
  }
  return "rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700 dark:bg-stone-800 dark:text-stone-200";
}

function recommendationEffectLabel(recommendation: MeetingRecommendation) {
  switch (recommendation.kind) {
    case "crm-note":
      return "ajouter une note au lead CRM";
    case "crm-next-action":
      return "modifier la prochaine action du lead CRM";
    case "crm-status":
      return `passer le lead au statut ${recommendation.suggestedStatus ?? "proposé"}`;
    case "task":
      return "créer une tâche CRM";
    case "calendar-follow-up":
      return "créer un rappel dans ton Google Calendar";
    case "proposal-input":
      return "ajouter un input de proposition aux notes CRM";
  }
}

function readActionFeedback(value: unknown): ActionFeedback {
  if (!value || typeof value !== "object") return {};
  const result = value as Record<string, unknown>;
  return {
    discardUploadedAudio:
      result.discardUploadedAudio === true ? true : undefined,
    error: typeof result.error === "string" ? result.error : undefined,
    message: typeof result.message === "string" ? result.message : undefined,
    warnings: Array.isArray(result.warnings)
      ? result.warnings.filter(
          (warning): warning is string => typeof warning === "string",
        )
      : undefined,
  };
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "Une erreur inattendue a interrompu l'opération.";
}

async function sha256Hex(blob: Blob) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await blob.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
