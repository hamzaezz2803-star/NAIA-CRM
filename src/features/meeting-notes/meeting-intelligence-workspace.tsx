"use client";

import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileAudio,
  FileUp,
  LoaderCircle,
  Paperclip,
  Pause,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  Users,
} from "lucide-react";
import Link from "next/link";
import {
  type ChangeEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { createBrowserSupabaseClient } from "@/platform/auth/supabase-client";
import type { GoogleCalendarEventSummary } from "@/platform/integrations/google-workspace";

import {
  approveMeetingOutputAction,
  askMeetingKnowledgeAction,
  fetchMeetingIntelligenceAction,
  fetchMeetingTranscriptAction,
  linkGeminiArtifactToMeetingAction,
  openMeetingWorkspaceAction,
  queueMeetingProcessingAction,
  registerMeetingSupportAction,
  retryMeetingDriveArchiveAction,
  retryMeetingProcessingAction,
  saveMeetingCaptureDraftAction,
  syncGeminiMeetingNotesAction,
} from "./actions";
import { isMeetingOnDay } from "./calendar-day";
import {
  MAX_RECORDING_BYTES,
  MAX_RECORDING_CHUNKS,
  MAX_SUPPORT_BYTES,
  MEETING_RECORDINGS_BUCKET,
  type MeetingAttendee,
  type MeetingKnowledgeAnswer,
  type MeetingIntelligenceState,
  type MeetingStructuredOutput,
  type MeetingWorkspace,
  type RecordingManifest,
} from "./contracts";
import {
  appendMeetingRecordingChunk,
  finalizeMeetingRecordingRecovery,
  loadLatestMeetingRecording,
  markMeetingRecordingProcessed,
  type RecoveredMeetingRecording,
  startMeetingRecordingRecovery,
} from "./recording-recovery";

const AUDIO_CHUNK_BYTES = 5 * 1024 * 1024;
const POLLING_INTERVAL_MS = 5_000;
const GOOGLE_MEETING_NOTES_AUTH_URL =
  "/api/integrations/google/auth?intent=meeting-notes";
const ACTIVE_JOB_STATUSES = new Set([
  "queued",
  "claimed",
  "processing",
  "transcribing",
  "analyzing",
  "uploading",
  "finalizing",
]);

type CaptureMode = "idle" | "paused" | "recording" | "uploading";
type DraftSaveState = "idle" | "saving" | "saved" | "error";
type MeetingRecommendation = MeetingStructuredOutput["actions"][number];
type ReviewTab = "notes" | "transcript";

type LocalMeetingDraft = {
  consentConfirmed: boolean;
  liveNotesMarkdown: string;
  participantsText: string;
  title: string;
  updatedAt: string;
};

type ActionFeedback = {
  error?: string;
  message?: string;
  warnings?: string[];
};

export function MeetingIntelligenceWorkspace({
  calendarEvents = [],
  calendarUnavailable = false,
  initialState,
  variant = "full",
}: {
  calendarEvents?: GoogleCalendarEventSummary[];
  calendarUnavailable?: boolean;
  initialState: MeetingIntelligenceState;
  variant?: "focus" | "full";
}) {
  const isFocusMode = variant === "focus";
  const initialMeeting =
    variant === "full"
      ? (initialState.meetings.find((meeting) => meeting.leadId) ??
        initialState.meetings[0])
      : undefined;
  const [workspaceState, setWorkspaceState] = useState(initialState);
  const [selectedMeetingId, setSelectedMeetingId] = useState(
    () => initialMeeting?.id ?? "",
  );
  const [captureMode, setCaptureMode] = useState<CaptureMode>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isOpeningMeeting, setIsOpeningMeeting] = useState(false);
  const [focusSelection, setFocusSelection] = useState("");
  const [isApproving, setIsApproving] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isUploadingSupport, setIsUploadingSupport] = useState(false);
  const [isSyncingGemini, setIsSyncingGemini] = useState(false);
  const [isLinkingGemini, setIsLinkingGemini] = useState(false);
  const [isAuthorizingGeminiDocuments, setIsAuthorizingGeminiDocuments] =
    useState(false);
  const [geminiNextPageToken, setGeminiNextPageToken] = useState<string>();
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >(() =>
    typeof window !== "undefined" && "Notification" in window
      ? window.Notification.permission
      : "unsupported",
  );
  const [meetingTitle, setMeetingTitle] = useState(initialMeeting?.title ?? "");
  const [participantsText, setParticipantsText] = useState(() =>
    formatAttendees(initialMeeting?.attendees ?? []),
  );
  const [liveNotesMarkdown, setLiveNotesMarkdown] = useState(
    initialMeeting?.liveNotesMarkdown ?? "",
  );
  const [consentConfirmed, setConsentConfirmed] = useState(
    Boolean(initialMeeting?.consentConfirmedAt),
  );
  const [draftMeetingId, setDraftMeetingId] = useState(
    initialMeeting?.id ?? "",
  );
  const [draftSaveState, setDraftSaveState] = useState<DraftSaveState>("idle");
  const [recoveredRecording, setRecoveredRecording] =
    useState<RecoveredMeetingRecording>();
  const [feedback, setFeedback] = useState<ActionFeedback>({});

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioPartsRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef(0);
  const recordingPausedAtRef = useRef(0);
  const recordingPausedDurationRef = useRef(0);
  const recoveryWriteRef = useRef<Promise<void>>(Promise.resolve());
  const captureDraftRef = useRef({
    liveNotesMarkdown: initialMeeting?.liveNotesMarkdown ?? "",
    participantsText: formatAttendees(initialMeeting?.attendees ?? []),
    title: initialMeeting?.title ?? "",
  });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const supportFileInputRef = useRef<HTMLInputElement | null>(null);
  const disposedRef = useRef(false);
  const hydratedMeetingIdRef = useRef("");
  const googleAuthPopupRef = useRef<Window | null>(null);
  const googleAuthPopupTimerRef = useRef<number | null>(null);

  const crmMeetings = useMemo(
    () => workspaceState.meetings.filter((meeting) => meeting.leadId),
    [workspaceState.meetings],
  );
  const selectableMeetings = isFocusMode
    ? workspaceState.meetings
    : crmMeetings;
  const selectedMeeting = useMemo(
    () =>
      selectableMeetings.find((meeting) => meeting.id === selectedMeetingId) ??
      (isFocusMode ? undefined : crmMeetings[0]),
    [crmMeetings, isFocusMode, selectableMeetings, selectedMeetingId],
  );
  const todayCalendarEvents = useMemo(
    () => calendarEvents.filter((event) => isMeetingOnDay(event.start)),
    [calendarEvents],
  );
  const matchedCalendarEvent = useMemo(
    () => matchCalendarEvent(selectedMeeting, calendarEvents),
    [calendarEvents, selectedMeeting],
  );
  const selectedGeminiArtifacts = useMemo(
    () =>
      (workspaceState.geminiArtifacts ?? []).filter(
        (artifact) => artifact.meetingId === selectedMeeting?.id,
      ),
    [selectedMeeting?.id, workspaceState.geminiArtifacts],
  );
  const unmatchedGeminiArtifacts = useMemo(
    () =>
      (workspaceState.geminiArtifacts ?? []).filter(
        (artifact) => !artifact.meetingId,
      ),
    [workspaceState.geminiArtifacts],
  );

  const isBusy =
    captureMode !== "idle" ||
    isApproving ||
    isRetrying ||
    isUploadingSupport ||
    isSyncingGemini ||
    isLinkingGemini;
  const hasActiveJobs = workspaceState.meetings.some((meeting) =>
    meeting.job ? ACTIVE_JOB_STATUSES.has(meeting.job.status) : false,
  );

  useEffect(() => {
    captureDraftRef.current = {
      liveNotesMarkdown,
      participantsText,
      title: meetingTitle,
    };
  }, [liveNotesMarkdown, meetingTitle, participantsText]);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      else mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (notificationPermission !== "granted" || !calendarEvents.length) return;
    const notifyUpcomingMeetings = () => {
      const now = Date.now();
      for (const event of calendarEvents) {
        if (!event.start) continue;
        const start = new Date(event.start).getTime();
        const minutesUntil = (start - now) / 60_000;
        if (minutesUntil < 0 || minutesUntil > 10) continue;
        const storageKey = `naia:meeting-reminder:${event.id}:${event.start}`;
        if (window.localStorage.getItem(storageKey)) continue;
        try {
          new window.Notification(
            `Meeting dans ${Math.max(1, Math.ceil(minutesUntil))} min`,
            {
              body: event.title,
              tag: storageKey,
            },
          );
          window.localStorage.setItem(storageKey, new Date().toISOString());
        } catch {
          // Browser/OS notification failures never interrupt note taking.
        }
      }
    };
    notifyUpcomingMeetings();
    const timer = window.setInterval(notifyUpcomingMeetings, 60_000);
    return () => window.clearInterval(timer);
  }, [calendarEvents, notificationPermission]);

  useEffect(() => {
    if (
      !selectedMeeting ||
      hydratedMeetingIdRef.current === selectedMeeting.id
    ) {
      return;
    }
    hydratedMeetingIdRef.current = selectedMeeting.id;

    const storedDraft = readLocalMeetingDraft(selectedMeeting.id);
    const localDraft = isLocalDraftNewer(storedDraft, selectedMeeting.updatedAt)
      ? storedDraft
      : undefined;
    const calendarAttendees = (matchedCalendarEvent?.attendees ?? [])
      .map((attendee) => ({
        displayName: attendee.displayName,
        email: attendee.email,
        responseStatus: attendee.responseStatus,
      }))
      .filter((attendee) => attendee.displayName || attendee.email);
    const attendees = selectedMeeting.attendees.length
      ? selectedMeeting.attendees
      : calendarAttendees;

    setMeetingTitle(localDraft?.title ?? selectedMeeting.title);
    setParticipantsText(
      localDraft?.participantsText ?? formatAttendees(attendees),
    );
    setLiveNotesMarkdown(
      localDraft?.liveNotesMarkdown ?? selectedMeeting.liveNotesMarkdown,
    );
    setConsentConfirmed(
      Boolean(selectedMeeting.consentConfirmedAt) ||
        Boolean(localDraft?.consentConfirmed),
    );
    setDraftMeetingId(selectedMeeting.id);
    setDraftSaveState("idle");
    setRecoveredRecording(undefined);

    let cancelled = false;
    void loadLatestMeetingRecording(selectedMeeting.id)
      .then((recording) => {
        if (!cancelled && !disposedRef.current)
          setRecoveredRecording(recording);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isFocusMode, matchedCalendarEvent, selectedMeeting]);

  useEffect(() => {
    if (
      !selectedMeeting ||
      draftMeetingId !== selectedMeeting.id ||
      !meetingTitle.trim()
    ) {
      return;
    }

    const meetingId = selectedMeeting.id;
    const attendees = parseAttendees(participantsText);
    const localDraft: LocalMeetingDraft = {
      consentConfirmed,
      liveNotesMarkdown,
      participantsText,
      title: meetingTitle,
      updatedAt: new Date().toISOString(),
    };
    const localTimer = window.setTimeout(() => {
      writeLocalMeetingDraft(meetingId, localDraft);
    }, 150);
    const serverTimer = window.setTimeout(() => {
      setDraftSaveState("saving");
      void saveMeetingCaptureDraftAction({
        attendees,
        consentConfirmed,
        liveNotesMarkdown,
        meetingId,
        title: meetingTitle.trim(),
      })
        .then((result) => {
          if (
            disposedRef.current ||
            hydratedMeetingIdRef.current !== meetingId
          ) {
            return;
          }
          setDraftSaveState(result.success ? "saved" : "error");
        })
        .catch(() => {
          if (!disposedRef.current) setDraftSaveState("error");
        });
    }, 1_200);

    return () => {
      window.clearTimeout(localTimer);
      window.clearTimeout(serverTimer);
    };
  }, [
    consentConfirmed,
    draftMeetingId,
    liveNotesMarkdown,
    meetingTitle,
    participantsText,
    selectedMeeting,
  ]);

  useEffect(() => {
    if (captureMode !== "recording" && captureMode !== "paused") return;

    const updateElapsed = () => {
      const effectiveNow =
        captureMode === "paused" && recordingPausedAtRef.current
          ? recordingPausedAtRef.current
          : Date.now();
      setElapsedSeconds(
        Math.max(
          0,
          Math.floor(
            (effectiveNow -
              recordingStartedAtRef.current -
              recordingPausedDurationRef.current) /
              1000,
          ),
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
    const handleGoogleAuthMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "GOOGLE_AUTH_SUCCESS") return;

      if (googleAuthPopupTimerRef.current) {
        window.clearInterval(googleAuthPopupTimerRef.current);
        googleAuthPopupTimerRef.current = null;
      }
      googleAuthPopupRef.current?.close();
      googleAuthPopupRef.current = null;
      setIsAuthorizingGeminiDocuments(false);
      setGeminiNextPageToken(undefined);
      setFeedback({
        message:
          "Autorisation Google reçue. Vérification de l’accès aux documents Meet…",
      });
      void refreshWorkspace(true);
    };

    window.addEventListener("message", handleGoogleAuthMessage);
    return () => {
      window.removeEventListener("message", handleGoogleAuthMessage);
      if (googleAuthPopupTimerRef.current) {
        window.clearInterval(googleAuthPopupTimerRef.current);
        googleAuthPopupTimerRef.current = null;
      }
    };
  }, [refreshWorkspace]);

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
      const recordingStorage = supabase.storage.from(MEETING_RECORDINGS_BUCKET);

      for (let index = 0; index < chunkCount; index += 1) {
        const start = index * AUDIO_CHUNK_BYTES;
        const chunk = audio.slice(start, start + AUDIO_CHUNK_BYTES, mimeType);
        const path = `${workspaceState.organizationId}/${meeting.id}/${sessionId}/chunk-${String(index).padStart(4, "0")}.${extension}`;
        const sha256 = await sha256Hex(chunk);
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
          sha256,
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

      const result = await queueMeetingProcessingAction(meeting.id, manifest);
      const actionFeedback = readActionFeedback(result);
      if (actionFeedback.error) throw new Error(actionFeedback.error);

      setFeedback({
        message:
          actionFeedback.message ??
          "Audio reçu. Le traitement démarrera dès que le companion local sera disponible.",
        warnings: actionFeedback.warnings,
      });
      await refreshWorkspace(true);
    },
    [refreshWorkspace, workspaceState.organizationId],
  );

  const startRecording = async () => {
    if (!selectedMeeting) return;
    if (!meetingTitle.trim()) {
      setFeedback({ error: "Donne un titre au meeting avant de démarrer." });
      return;
    }
    if (!isFocusMode && !consentConfirmed) {
      setFeedback({
        error:
          "Confirme que les participants ont été informés avant d'enregistrer.",
      });
      return;
    }
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
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      const preferredMimeType = getPreferredAudioMimeType();
      const recorder = new MediaRecorder(
        stream,
        preferredMimeType ? { mimeType: preferredMimeType } : undefined,
      );
      const meetingAtStart = selectedMeeting;
      const sessionId = crypto.randomUUID();
      const mimeType = recorder.mimeType || preferredMimeType || "audio/webm";
      const startedAt = new Date().toISOString();
      const originalFileName = `meeting-${meetingAtStart.id}.${getAudioExtension("", mimeType)}`;

      const recoveryEnabled = await startMeetingRecordingRecovery({
        id: sessionId,
        meetingId: meetingAtStart.id,
        mimeType,
        originalFileName,
        startedAt,
      })
        .then(() => true)
        .catch(() => false);
      const draftResult = await saveMeetingCaptureDraftAction({
        attendees: parseAttendees(participantsText),
        consentConfirmed: true,
        liveNotesMarkdown,
        meetingId: meetingAtStart.id,
        recordingState: "recording",
        title: meetingTitle.trim(),
      });
      if (!draftResult.success) {
        setDraftSaveState("error");
        setFeedback({
          message:
            "L'enregistrement reste protégé localement; la synchronisation du brouillon sera retentée.",
        });
      }

      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      audioPartsRef.current = [];
      recordingStartedAtRef.current = Date.now();
      recordingPausedAtRef.current = 0;
      recordingPausedDurationRef.current = 0;
      recoveryWriteRef.current = Promise.resolve();
      setElapsedSeconds(0);

      recorder.ondataavailable = (event) => {
        if (event.data.size <= 0) return;
        const index = audioPartsRef.current.length;
        audioPartsRef.current.push(event.data);
        if (recoveryEnabled) {
          recoveryWriteRef.current = recoveryWriteRef.current
            .then(() =>
              appendMeetingRecordingChunk(sessionId, index, event.data),
            )
            .catch(() => undefined);
        }
      };
      recorder.onstop = () => {
        void (async () => {
          const durationSeconds = Math.max(
            1,
            Math.round(
              (Date.now() -
                recordingStartedAtRef.current -
                recordingPausedDurationRef.current -
                (recordingPausedAtRef.current
                  ? Date.now() - recordingPausedAtRef.current
                  : 0)) /
                1000,
            ),
          );
          const audio = new Blob(audioPartsRef.current, { type: mimeType });
          mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
          mediaRecorderRef.current = null;
          mediaStreamRef.current = null;
          recordingPausedAtRef.current = 0;
          recordingPausedDurationRef.current = 0;
          audioPartsRef.current = [];

          await recoveryWriteRef.current;
          if (recoveryEnabled) {
            await finalizeMeetingRecordingRecovery(
              sessionId,
              durationSeconds,
            ).catch(() => undefined);
          }
          if (disposedRef.current) return;

          setCaptureMode("uploading");
          const currentDraft = captureDraftRef.current;
          await saveMeetingCaptureDraftAction({
            attendees: parseAttendees(currentDraft.participantsText),
            consentConfirmed: true,
            liveNotesMarkdown: currentDraft.liveNotesMarkdown,
            meetingId: meetingAtStart.id,
            recordingState: "stopped",
            title: currentDraft.title.trim(),
          }).catch(() => undefined);

          try {
            await uploadAndQueue({
              audio,
              durationSeconds,
              meeting: meetingAtStart,
              originalFileName,
            });
            if (recoveryEnabled) {
              await markMeetingRecordingProcessed(sessionId).catch(
                () => undefined,
              );
            }
            setRecoveredRecording(undefined);
          } catch (error) {
            setRecoveredRecording(
              await loadLatestMeetingRecording(meetingAtStart.id).catch(
                () => undefined,
              ),
            );
            setFeedback({ error: getErrorMessage(error) });
          } finally {
            if (!disposedRef.current) setCaptureMode("idle");
          }
        })();
      };

      recorder.start(1_000);
      setCaptureMode("recording");
      setFeedback(
        isFocusMode
          ? {}
          : {
              message: recoveryEnabled
                ? "Enregistrement discret en cours. Les notes et l'audio sont sauvegardés au fil du meeting."
                : "Enregistrement en cours. La reprise audio locale est indisponible dans ce navigateur; garde cette page ouverte.",
            },
      );
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

  const toggleRecordingPause = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    if (recorder.state === "recording") {
      recorder.pause();
      recordingPausedAtRef.current = Date.now();
      setCaptureMode("paused");
      setFeedback({
        message: "Capture en pause. Les notes restent sauvegardées.",
      });
      return;
    }
    if (recorder.state === "paused") {
      if (recordingPausedAtRef.current) {
        recordingPausedDurationRef.current +=
          Date.now() - recordingPausedAtRef.current;
      }
      recordingPausedAtRef.current = 0;
      recorder.resume();
      setCaptureMode("recording");
      setFeedback({ message: "Capture reprise." });
    }
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

  const processRecoveredRecording = async () => {
    if (!selectedMeeting || !recoveredRecording) return;

    try {
      setFeedback({ message: "Reprise de l'envoi audio local sécurisé…" });
      await uploadAndQueue({
        audio: recoveredRecording.audio,
        durationSeconds: recoveredRecording.durationSeconds,
        meeting: selectedMeeting,
        originalFileName: recoveredRecording.originalFileName,
      });
      await markMeetingRecordingProcessed(recoveredRecording.id).catch(
        () => undefined,
      );
      setRecoveredRecording(undefined);
    } catch (error) {
      setFeedback({ error: getErrorMessage(error) });
    } finally {
      if (!disposedRef.current) setCaptureMode("idle");
    }
  };

  const importSupport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selectedMeeting) return;
    if (!isSupportedMeetingDocument(file)) {
      setFeedback({
        error: "Ajoute un PDF, un fichier texte ou Markdown (25 Mo maximum).",
      });
      return;
    }
    if (file.size > MAX_SUPPORT_BYTES) {
      setFeedback({ error: "Le support dépasse la limite de 25 Mo." });
      return;
    }
    if (!workspaceState.organizationId) {
      setFeedback({ error: "Organisation introuvable pour ce support." });
      return;
    }

    const supabase = createBrowserSupabaseClient();
    if (!supabase) {
      setFeedback({
        error: "Supabase n'est pas configuré dans ce navigateur.",
      });
      return;
    }

    setIsUploadingSupport(true);
    setFeedback({ message: "Ajout du support dans l'espace privé…" });
    try {
      const extension = getSupportExtension(file.name);
      const sessionId = crypto.randomUUID();
      const path = `${workspaceState.organizationId}/${selectedMeeting.id}/${sessionId}/chunk-0000.${extension}`;
      const mimeType =
        file.type ||
        (extension === "pdf"
          ? "application/pdf"
          : extension === "md"
            ? "text/markdown"
            : "text/plain");
      const sha256 = await sha256Hex(file);
      const { error: uploadError } = await supabase.storage
        .from(MEETING_RECORDINGS_BUCKET)
        .upload(path, file, {
          cacheControl: "3600",
          contentType: mimeType,
          upsert: false,
        });
      if (uploadError) {
        throw new Error(`Ajout du support interrompu: ${uploadError.message}`);
      }

      const support: RecordingManifest = {
        chunks: [{ path, sha256, sizeBytes: file.size }],
        mimeType,
        originalFileName: safeOriginalFileName(file.name, extension),
        totalBytes: file.size,
      };
      const result = await registerMeetingSupportAction({
        meetingId: selectedMeeting.id,
        support,
      });
      const actionFeedback = readActionFeedback(result);
      if (actionFeedback.error) throw new Error(actionFeedback.error);
      setFeedback({
        message:
          "Support ajouté. Il sera utilisé comme contexte, jamais comme source de vérité.",
      });
      await refreshWorkspace(true);
    } catch (error) {
      setFeedback({ error: getErrorMessage(error) });
    } finally {
      if (!disposedRef.current) setIsUploadingSupport(false);
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

  const enableMeetingReminders = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setNotificationPermission("unsupported");
      setFeedback({
        error: "Les notifications ne sont pas disponibles dans ce navigateur.",
      });
      return;
    }
    try {
      const permission = await window.Notification.requestPermission();
      setNotificationPermission(permission);
      setFeedback({
        message:
          permission === "granted"
            ? "Rappels activés: NAIA te préviendra 10 minutes avant les meetings tant que l'app est ouverte."
            : "Notifications non autorisées. Tu peux les réactiver dans les réglages du navigateur.",
      });
    } catch (error) {
      setFeedback({ error: getErrorMessage(error) });
    }
  };

  const authorizeGeminiDocuments = () => {
    const width = 520;
    const height = 680;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;
    const popup = window.open(
      GOOGLE_MEETING_NOTES_AUTH_URL,
      "GoogleMeetingNotesAuth",
      `width=${width},height=${height},left=${left},top=${top},status=no,resizable=yes,scrollbars=yes`,
    );

    if (!popup) {
      window.open(GOOGLE_MEETING_NOTES_AUTH_URL, "_self");
      return;
    }

    if (googleAuthPopupTimerRef.current) {
      window.clearInterval(googleAuthPopupTimerRef.current);
    }
    googleAuthPopupRef.current = popup;
    setIsAuthorizingGeminiDocuments(true);
    setFeedback({
      message: "Autorisation Google des documents Meet en cours…",
    });
    googleAuthPopupTimerRef.current = window.setInterval(() => {
      if (!popup.closed) return;
      if (googleAuthPopupTimerRef.current) {
        window.clearInterval(googleAuthPopupTimerRef.current);
        googleAuthPopupTimerRef.current = null;
      }
      googleAuthPopupRef.current = null;
      setIsAuthorizingGeminiDocuments(false);
      setFeedback({ message: "Autorisation Google annulée." });
    }, 500);
  };

  const syncGeminiNotes = async () => {
    setIsSyncingGemini(true);
    setFeedback({});
    try {
      const result = await syncGeminiMeetingNotesAction({
        pageToken: geminiNextPageToken,
      });
      if (!result.success) throw new Error(result.error);
      setGeminiNextPageToken(result.nextPageToken);
      const scanSummary = `${result.scanned} message(s) Gmail analysé(s).`;
      const backfillSummary = result.nextPageToken
        ? " D’autres messages sont disponibles pour le backfill."
        : " Backfill Gemini à jour.";
      setFeedback({
        message:
          result.total === 0
            ? `Aucune nouvelle note Gemini trouvée. ${scanSummary}${backfillSummary}`
            : `${result.total} note(s) Gemini synchronisée(s), dont ${result.matched} associée(s) automatiquement. ${scanSummary}${backfillSummary}`,
      });
      await refreshWorkspace(true);
    } catch (error) {
      setFeedback({ error: getErrorMessage(error) });
    } finally {
      if (!disposedRef.current) setIsSyncingGemini(false);
    }
  };

  const linkGeminiArtifact = async (artifactId: string) => {
    if (!selectedMeeting) return;
    setIsLinkingGemini(true);
    setFeedback({});
    try {
      const result = await linkGeminiArtifactToMeetingAction({
        artifactId,
        meetingId: selectedMeeting.id,
      });
      if (!result.success) throw new Error(result.error);
      setFeedback({ message: "Note Gemini associée à ce meeting." });
      await refreshWorkspace(true);
    } catch (error) {
      setFeedback({ error: getErrorMessage(error) });
    } finally {
      if (!disposedRef.current) setIsLinkingGemini(false);
    }
  };

  const installFocusedMeeting = (meeting: MeetingWorkspace) => {
    hydratedMeetingIdRef.current = "";
    setWorkspaceState((current) => {
      const existing = current.meetings.find(
        (candidate) => candidate.id === meeting.id,
      );
      const focusedMeeting = {
        ...existing,
        ...meeting,
        // Opening a Calendar workspace only refreshes the meeting row. Keep the
        // already-loaded processing state so an active job cannot disappear
        // from the client while the founder switches into the focused view.
        job: meeting.job ?? existing?.job,
        output: meeting.output ?? existing?.output,
      } satisfies MeetingWorkspace;

      return {
        ...current,
        meetings: [
          focusedMeeting,
          ...current.meetings.filter(
            (candidate) => candidate.id !== meeting.id,
          ),
        ],
      };
    });
    setSelectedMeetingId(meeting.id);
  };

  const flushCurrentLocalDraft = () => {
    if (
      !selectedMeeting ||
      draftMeetingId !== selectedMeeting.id ||
      !meetingTitle.trim()
    ) {
      return;
    }

    writeLocalMeetingDraft(selectedMeeting.id, {
      consentConfirmed,
      liveNotesMarkdown,
      participantsText,
      title: meetingTitle,
      updatedAt: new Date().toISOString(),
    });
  };

  const selectFocusedMeeting = async (value: string) => {
    if (captureMode === "recording" || captureMode === "paused") return;
    flushCurrentLocalDraft();
    // Detach the previous workspace before pre-filling or awaiting Google.
    // This cancels its autosave timers and prevents cross-meeting writes when
    // the provider response is slow.
    hydratedMeetingIdRef.current = "";
    setSelectedMeetingId("");
    setDraftMeetingId("");
    setFocusSelection(value);
    setFeedback({});

    if (!value) {
      return;
    }
    if (value === "manual") {
      setMeetingTitle("");
      setParticipantsText("");
      setLiveNotesMarkdown("");
      setConsentConfirmed(false);
      setDraftSaveState("idle");
      return;
    }

    const event = todayCalendarEvents.find(
      (candidate) => candidate.id === value,
    );
    if (!event) {
      setFocusSelection("");
      setFeedback({ error: "Ce meeting n'est plus disponible dans Calendar." });
      return;
    }

    setMeetingTitle(event.title);
    setLiveNotesMarkdown("");
    setParticipantsText(
      formatAttendees(
        (event.attendees ?? [])
          .map((attendee) => ({
            displayName: attendee.displayName,
            email: attendee.email,
            responseStatus: attendee.responseStatus,
          }))
          .filter((attendee) => attendee.displayName || attendee.email),
      ),
    );
    setIsOpeningMeeting(true);
    try {
      const result = await openMeetingWorkspaceAction({
        calendarEventId: event.id,
        source: "google-calendar",
      });
      const meeting = "meeting" in result ? result.meeting : undefined;
      if (!result.success || !meeting) {
        throw new Error(
          "error" in result ? result.error : "Impossible d'ouvrir le meeting.",
        );
      }
      installFocusedMeeting(meeting);
    } catch (error) {
      setFocusSelection("");
      setSelectedMeetingId("");
      setFeedback({ error: getErrorMessage(error) });
    } finally {
      if (!disposedRef.current) setIsOpeningMeeting(false);
    }
  };

  const createManualMeeting = async () => {
    if (!meetingTitle.trim()) {
      setFeedback({ error: "Donne un titre au meeting pour commencer." });
      return;
    }

    setIsOpeningMeeting(true);
    setFeedback({});
    try {
      const result = await openMeetingWorkspaceAction({
        attendees: parseAttendees(participantsText),
        source: "manual",
        title: meetingTitle.trim(),
      });
      const meeting = "meeting" in result ? result.meeting : undefined;
      if (!result.success || !meeting) {
        throw new Error(
          "error" in result ? result.error : "Impossible de créer le meeting.",
        );
      }
      installFocusedMeeting(meeting);
    } catch (error) {
      setFeedback({ error: getErrorMessage(error) });
    } finally {
      if (!disposedRef.current) setIsOpeningMeeting(false);
    }
  };

  if (!workspaceState.configured) {
    if (isFocusMode) {
      return (
        <section className="min-h-dvh bg-stone-100 px-3 py-3 text-stone-950 dark:bg-stone-950 dark:text-stone-50 sm:px-6 sm:py-5">
          <div className="mx-auto flex min-h-[calc(100dvh-1.5rem)] max-w-5xl flex-col sm:min-h-[calc(100dvh-2.5rem)]">
            <Link
              aria-label="Quitter le mode meeting"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-stone-500 transition-colors hover:bg-white hover:text-stone-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:hover:bg-stone-900 dark:hover:text-stone-50"
              href="/dashboard"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Link>
            <div className="mt-3 flex flex-1 items-center justify-center">
              <div className="flex max-w-md items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
                <AlertCircle
                  className="mt-0.5 h-5 w-5 shrink-0"
                  aria-hidden="true"
                />
                <p>
                  {workspaceState.error ??
                    "L'intelligence meeting n'est pas encore configurée."}
                </p>
              </div>
            </div>
          </div>
        </section>
      );
    }

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

  if (isFocusMode) {
    const isActive = captureMode === "recording" || captureMode === "paused";
    const canProcessRecovered = Boolean(
      recoveredRecording && selectedMeeting && captureMode === "idle",
    );
    const selectedCalendarEvent = todayCalendarEvents.find(
      (event) => event.id === focusSelection,
    );

    return (
      <section
        aria-labelledby="meeting-focus-title"
        className="min-h-dvh bg-stone-100 px-3 py-3 text-stone-950 dark:bg-stone-950 dark:text-stone-50 sm:px-6 sm:py-5"
      >
        <div className="mx-auto flex min-h-[calc(100dvh-1.5rem)] max-w-5xl flex-col sm:min-h-[calc(100dvh-2.5rem)]">
          <header className="flex min-h-12 items-center gap-2 sm:gap-3">
            <Link
              aria-label="Quitter le mode meeting"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-stone-500 transition-colors hover:bg-white hover:text-stone-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:hover:bg-stone-900 dark:hover:text-stone-50"
              href="/dashboard"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Link>
            {!isActive && captureMode !== "uploading" ? (
              <Link
                aria-label="Ouvrir les comptes rendus"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-stone-500 transition-colors hover:bg-white hover:text-stone-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:hover:bg-stone-900 dark:hover:text-stone-50"
                href="/meetings/history"
                title="Comptes rendus"
              >
                <BookOpen className="h-4 w-4" aria-hidden="true" />
              </Link>
            ) : null}
            <h1 id="meeting-focus-title" className="sr-only">
              Notes de meeting
            </h1>

            <label className="min-w-0 flex-1" htmlFor="meeting-focus-select">
              <span className="sr-only">Meeting du jour</span>
              <select
                aria-label="Meeting du jour"
                className="h-11 w-full rounded-full border border-stone-200 bg-white px-4 text-sm font-medium text-stone-900 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-teal-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-50"
                disabled={
                  isActive || captureMode === "uploading" || isOpeningMeeting
                }
                id="meeting-focus-select"
                onChange={(event) =>
                  void selectFocusedMeeting(event.target.value)
                }
                value={focusSelection}
              >
                <option value="">
                  {calendarUnavailable
                    ? "Calendar indisponible · vérifier Google"
                    : todayCalendarEvents.length
                      ? "Choisir un meeting du jour"
                      : "Aucun meeting Calendar aujourd'hui"}
                </option>
                {todayCalendarEvents.map((event) => (
                  <option key={event.id} value={event.id}>
                    {formatCalendarEventOption(event)}
                  </option>
                ))}
                <option value="manual">Nouveau meeting</option>
              </select>
            </label>

            <button
              aria-label={
                isActive ? "Capture active" : "Démarrer la capture du meeting"
              }
              className="inline-flex h-11 w-14 shrink-0 items-center justify-center gap-1.5 rounded-full border border-stone-200 bg-white transition-colors hover:border-stone-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-stone-700"
              disabled={
                !selectedMeeting ||
                isActive ||
                captureMode === "uploading" ||
                isOpeningMeeting ||
                hasActiveJob(selectedMeeting)
              }
              onClick={() => void startRecording()}
              type="button"
            >
              <span
                className={`h-2.5 w-2.5 rounded-full bg-orange-400 transition-[opacity,box-shadow] duration-200 motion-reduce:transition-none ${
                  isActive
                    ? "opacity-100 shadow-[0_0_0_5px_rgba(251,146,60,0.14),0_0_14px_rgba(251,146,60,0.65)] motion-safe:animate-pulse"
                    : "opacity-25"
                }`}
                aria-hidden="true"
              />
              <span
                className={`h-2.5 w-2.5 rounded-full bg-emerald-500 transition-opacity duration-200 motion-reduce:transition-none ${
                  isActive ? "opacity-25" : "opacity-100"
                }`}
                aria-hidden="true"
              />
            </button>

            {isActive || canProcessRecovered || captureMode === "uploading" ? (
              <Button
                aria-label={
                  canProcessRecovered
                    ? "Traiter la capture récupérée"
                    : "Traiter le meeting"
                }
                className="h-11 shrink-0 rounded-full px-4"
                disabled={captureMode === "uploading"}
                onClick={() =>
                  void (canProcessRecovered
                    ? processRecoveredRecording()
                    : stopRecording())
                }
              >
                {captureMode === "uploading" ? (
                  <LoaderCircle
                    className="h-4 w-4 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : (
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                )}
                <span>Traiter</span>
              </Button>
            ) : null}
          </header>

          <div className="relative mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
            {isOpeningMeeting ? (
              <div
                aria-label="Ouverture du meeting"
                className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 backdrop-blur-sm dark:bg-stone-900/80"
                role="status"
              >
                <LoaderCircle
                  className="h-5 w-5 animate-spin text-stone-500 motion-reduce:animate-none"
                  aria-hidden="true"
                />
              </div>
            ) : null}

            {focusSelection === "manual" && !selectedMeeting ? (
              <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-5 py-10 sm:px-10">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
                  Nouveau meeting
                </p>
                <label className="mt-6" htmlFor="meeting-focus-manual-title">
                  <span className="sr-only">Titre du meeting</span>
                  <input
                    autoFocus
                    className="h-14 w-full border-0 border-b border-stone-200 bg-transparent px-0 text-2xl font-semibold outline-none placeholder:text-stone-300 focus:border-teal-600 focus:ring-0 dark:border-stone-700 dark:placeholder:text-stone-600"
                    id="meeting-focus-manual-title"
                    maxLength={300}
                    onChange={(event) => setMeetingTitle(event.target.value)}
                    placeholder="Titre du meeting"
                    value={meetingTitle}
                  />
                </label>
                <label
                  className="mt-6"
                  htmlFor="meeting-focus-manual-participants"
                >
                  <span className="sr-only">Participants</span>
                  <input
                    className="h-12 w-full rounded-lg border border-stone-200 bg-transparent px-3 text-sm outline-none placeholder:text-stone-400 focus-visible:ring-2 focus-visible:ring-teal-600 dark:border-stone-700"
                    id="meeting-focus-manual-participants"
                    maxLength={4_000}
                    onChange={(event) =>
                      setParticipantsText(event.target.value)
                    }
                    placeholder="Participants (noms ou emails)"
                    value={participantsText}
                  />
                </label>
                <Button
                  className="mt-8 h-11 self-start rounded-full px-5"
                  disabled={isOpeningMeeting || !meetingTitle.trim()}
                  onClick={() => void createManualMeeting()}
                >
                  Commencer
                </Button>
              </div>
            ) : selectedMeeting ? (
              <div className="flex min-h-0 flex-1 flex-col px-5 pb-5 pt-6 sm:px-10 sm:pb-8 sm:pt-9">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <label
                    className="min-w-0 flex-1"
                    htmlFor="meeting-focus-title-input"
                  >
                    <span className="sr-only">Titre du meeting</span>
                    <input
                      className="w-full border-0 bg-transparent p-0 text-2xl font-semibold leading-tight outline-none placeholder:text-stone-300 focus:ring-0 sm:text-3xl dark:placeholder:text-stone-600"
                      id="meeting-focus-title-input"
                      maxLength={300}
                      onChange={(event) => setMeetingTitle(event.target.value)}
                      value={meetingTitle}
                    />
                  </label>
                  <span
                    aria-live="polite"
                    className="shrink-0 text-xs text-stone-400 sm:mt-1"
                  >
                    {draftSaveLabel(draftSaveState)}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-stone-500">
                  {(selectedCalendarEvent?.start ??
                  selectedMeeting.startsAt) ? (
                    <span>
                      {formatMeetingDate(
                        selectedCalendarEvent?.start ??
                          selectedMeeting.startsAt,
                      )}
                    </span>
                  ) : null}
                  {selectedCalendarEvent?.conferenceUrl ? (
                    <a
                      className="font-medium text-teal-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:text-teal-300"
                      href={selectedCalendarEvent.conferenceUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Rejoindre
                    </a>
                  ) : null}
                </div>

                <label className="mt-5" htmlFor="meeting-focus-participants">
                  <span className="sr-only">Participants</span>
                  <input
                    aria-label="Participants"
                    className="h-10 w-full rounded-lg border-0 bg-stone-50 px-3 text-sm text-stone-600 outline-none placeholder:text-stone-400 focus-visible:ring-2 focus-visible:ring-teal-600 dark:bg-stone-950 dark:text-stone-300"
                    id="meeting-focus-participants"
                    maxLength={4_000}
                    onChange={(event) =>
                      setParticipantsText(event.target.value)
                    }
                    placeholder="Participants"
                    value={participantsText}
                  />
                </label>

                <label
                  className="mt-5 flex min-h-0 flex-1 flex-col"
                  htmlFor="meeting-focus-notes"
                >
                  <span className="sr-only">Notes</span>
                  <textarea
                    autoFocus
                    aria-label="Notes"
                    className="min-h-[50vh] flex-1 resize-none border-0 bg-transparent p-0 text-base leading-7 outline-none placeholder:text-stone-300 focus:ring-0 sm:min-h-[56vh] dark:placeholder:text-stone-600"
                    id="meeting-focus-notes"
                    maxLength={500_000}
                    onChange={(event) =>
                      setLiveNotesMarkdown(event.target.value)
                    }
                    placeholder="Prends tes notes ici…"
                    value={liveNotesMarkdown}
                  />
                </label>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center px-6 py-16 text-center">
                <p className="max-w-sm text-sm leading-6 text-stone-400">
                  Choisis un meeting du jour ou crée un nouveau meeting.
                </p>
              </div>
            )}
          </div>

          {feedback.error || feedback.warnings?.length ? (
            <div className="mt-3">
              <FeedbackBar
                feedback={{
                  error: feedback.error,
                  warnings: feedback.warnings,
                }}
              />
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  const operationalStatus = selectedMeeting
    ? getOperationalStatus(selectedMeeting)
    : undefined;
  const displayedAttendees = parseAttendees(participantsText);
  const qarizmiAttendees = displayedAttendees.filter(isQarizmiAttendee);
  const clientAttendees = displayedAttendees.filter(
    (attendee) => !isQarizmiAttendee(attendee),
  );
  const meetingDate = matchedCalendarEvent?.start ?? selectedMeeting?.startsAt;
  const calendarAttachments = matchedCalendarEvent?.attachments ?? [];

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

        <div className="flex self-end gap-1 sm:self-auto">
          <Button
            aria-label={
              geminiNextPageToken
                ? "Continuer le backfill Gemini"
                : "Synchroniser les notes Gemini depuis Gmail"
            }
            className="h-11"
            disabled={isBusy}
            onClick={() => void syncGeminiNotes()}
            title={
              geminiNextPageToken
                ? "Analyser la page suivante des messages Gemini"
                : "Lecture Gmail en accès restreint, sans modifier les emails"
            }
            variant="ghost"
          >
            {isSyncingGemini ? (
              <LoaderCircle
                className="h-4 w-4 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            )}
            <span className="hidden sm:inline">
              {geminiNextPageToken ? "Continuer le backfill Gemini" : "Gemini"}
            </span>
          </Button>
          <Button
            aria-label="Activer les rappels avant meeting"
            className="h-11"
            disabled={notificationPermission === "denied"}
            onClick={() => void enableMeetingReminders()}
            title="Rappel navigateur 10 minutes avant le meeting"
            variant="ghost"
          >
            <Bell className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">
              {notificationPermission === "granted"
                ? "Rappels actifs"
                : "Rappels"}
            </span>
          </Button>
          <Button
            aria-label="Actualiser les meetings"
            className="h-11 w-11 px-0"
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
        </div>
      </header>

      <div
        className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        style={{ borderColor: "var(--maison-border)" }}
      >
        {workspaceState.geminiDocumentAccess ? (
          <div className="flex items-start gap-2" role="status">
            <CheckCircle2
              className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-300"
              aria-hidden="true"
            />
            <div>
              <p
                className="text-sm font-medium"
                style={{ color: "var(--maison-text-primary)" }}
              >
                Documents et transcripts Gemini actifs
              </p>
              <p
                className="mt-0.5 text-xs"
                style={{ color: "var(--maison-text-muted)" }}
              >
                Les documents Meet liés peuvent enrichir les imports Gmail.
              </p>
            </div>
          </div>
        ) : workspaceState.googleWorkspaceReconnectRequired ? (
          <>
            <div className="flex items-start gap-2" role="alert">
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300"
                aria-hidden="true"
              />
              <div>
                <p
                  className="text-sm font-medium"
                  style={{ color: "var(--maison-text-primary)" }}
                >
                  Connexion Google à revoir
                </p>
                <p
                  className="mt-0.5 text-xs"
                  style={{ color: "var(--maison-text-muted)" }}
                >
                  Une ancienne autorisation Drive trop large a été bloquée.
                  Révoquez cet accès depuis Intégrations, puis reconnectez
                  Google avec les droits minimaux.
                </p>
              </div>
            </div>
            <a
              className={buttonVariants({
                className: "h-10 shrink-0",
                variant: "outline",
              })}
              href="/integrations"
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              Révoquer et reconnecter Google
            </a>
          </>
        ) : (
          <>
            <div className="flex items-start gap-2">
              <ShieldCheck
                className="mt-0.5 h-4 w-4 shrink-0 text-violet-600 dark:text-violet-300"
                aria-hidden="true"
              />
              <div>
                <p
                  className="text-sm font-medium"
                  style={{ color: "var(--maison-text-primary)" }}
                >
                  Accès documents Meet à autoriser
                </p>
                <p
                  className="mt-0.5 text-xs"
                  style={{ color: "var(--maison-text-muted)" }}
                >
                  Réservé aux cofondateurs. La synchronisation des résumés Gmail
                  reste disponible sans cette autorisation.
                </p>
              </div>
            </div>
            <Button
              className="h-10 shrink-0"
              disabled={isAuthorizingGeminiDocuments}
              onClick={authorizeGeminiDocuments}
              variant="outline"
            >
              {isAuthorizingGeminiDocuments ? (
                <LoaderCircle
                  className="h-4 w-4 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              )}
              Autoriser les documents Meet
            </Button>
          </>
        )}
      </div>

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
        <div>
          <div className="px-4 py-5 sm:px-6 sm:py-6">
            <div className="mx-auto max-w-4xl">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <label
                  className="min-w-0 flex-1 text-sm font-medium"
                  htmlFor="meeting-intelligence-select"
                >
                  <span style={{ color: "var(--maison-text-secondary)" }}>
                    Meeting CRM
                  </span>
                  <select
                    id="meeting-intelligence-select"
                    className="mt-2 h-11 w-full rounded-md border px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-teal-600"
                    disabled={
                      captureMode === "recording" || captureMode === "paused"
                    }
                    onChange={(event) =>
                      setSelectedMeetingId(event.target.value)
                    }
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
                </label>
                {operationalStatus ? (
                  <div className="flex h-11 items-center">
                    <StatusPill status={operationalStatus} />
                  </div>
                ) : null}
              </div>

              {selectedMeeting ? (
                <>
                  <div className="mt-4 flex items-center justify-between gap-4">
                    <p
                      className="text-xs font-medium"
                      style={{ color: "var(--maison-text-muted)" }}
                    >
                      {captureMode === "recording"
                        ? `Capture en cours · ${formatDuration(elapsedSeconds)}`
                        : captureMode === "paused"
                          ? `Capture en pause · ${formatDuration(elapsedSeconds)}`
                          : "Capture prête"}
                    </p>
                    <button
                      aria-label={
                        captureMode === "recording"
                          ? "Mettre l'enregistrement en pause"
                          : captureMode === "paused"
                            ? "Reprendre l'enregistrement"
                            : "Démarrer l'enregistrement"
                      }
                      className="inline-flex h-10 items-center gap-1.5 rounded-full border px-3 transition hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-stone-800"
                      disabled={
                        captureMode === "uploading" ||
                        (captureMode === "idle" &&
                          (isBusy || hasActiveJob(selectedMeeting)))
                      }
                      onClick={() =>
                        void (captureMode === "idle"
                          ? startRecording()
                          : toggleRecordingPause())
                      }
                      title="Contrôle discret: démarrer, mettre en pause ou reprendre"
                      type="button"
                    >
                      <span
                        className={`h-2.5 w-2.5 rounded-full bg-orange-500 transition-opacity ${
                          captureMode === "recording"
                            ? "opacity-100"
                            : "opacity-25"
                        }`}
                        aria-hidden="true"
                      />
                      <span
                        className={`h-2.5 w-2.5 rounded-full bg-emerald-500 transition-opacity ${
                          captureMode === "recording"
                            ? "opacity-25"
                            : "opacity-100"
                        }`}
                        aria-hidden="true"
                      />
                      {captureMode === "recording" ? (
                        <Pause
                          className="ml-1 h-3.5 w-3.5"
                          aria-hidden="true"
                        />
                      ) : (
                        <Play className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
                      )}
                    </button>
                  </div>

                  {matchedCalendarEvent ? (
                    <div
                      className="mt-4 flex flex-col gap-3 rounded-md border px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                      style={{
                        background: "var(--maison-page)",
                        borderColor: "var(--maison-border)",
                      }}
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <CalendarDays
                          aria-hidden="true"
                          className="mt-0.5 h-5 w-5 shrink-0 text-teal-700 dark:text-teal-300"
                        />
                        <div className="min-w-0">
                          <p
                            className="truncate text-sm font-semibold"
                            style={{ color: "var(--maison-text-primary)" }}
                          >
                            {matchedCalendarEvent.title}
                          </p>
                          <p
                            className="mt-0.5 text-xs"
                            style={{ color: "var(--maison-text-muted)" }}
                          >
                            Calendar associé · aucun enregistrement automatique
                            {matchedCalendarEvent.start
                              ? ` · ${formatMeetingDate(matchedCalendarEvent.start)}`
                              : ""}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {matchedCalendarEvent.conferenceUrl ? (
                          <a
                            className="inline-flex h-11 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:hover:bg-stone-800"
                            href={matchedCalendarEvent.conferenceUrl}
                            rel="noreferrer"
                            target="_blank"
                          >
                            Rejoindre Meet
                            <ExternalLink
                              className="h-4 w-4"
                              aria-hidden="true"
                            />
                          </a>
                        ) : null}
                        {matchedCalendarEvent.htmlLink ? (
                          <a
                            aria-label="Ouvrir l'événement Google Calendar"
                            className="inline-flex h-11 w-11 items-center justify-center rounded-md border transition hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:hover:bg-stone-800"
                            href={matchedCalendarEvent.htmlLink}
                            rel="noreferrer"
                            target="_blank"
                          >
                            <CalendarDays
                              className="h-4 w-4"
                              aria-hidden="true"
                            />
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <label
                      className="text-sm font-medium"
                      htmlFor="meeting-capture-title"
                    >
                      <span style={{ color: "var(--maison-text-secondary)" }}>
                        Titre du meeting
                      </span>
                      <input
                        id="meeting-capture-title"
                        className="mt-2 h-11 w-full rounded-md border px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-teal-600"
                        maxLength={300}
                        onChange={(event) =>
                          setMeetingTitle(event.target.value)
                        }
                        style={{
                          background: "var(--maison-page)",
                          borderColor: "var(--maison-border)",
                          color: "var(--maison-text-primary)",
                        }}
                        value={meetingTitle}
                      />
                    </label>
                    <div className="text-sm font-medium">
                      <span style={{ color: "var(--maison-text-secondary)" }}>
                        Date
                      </span>
                      <div
                        className="mt-2 flex h-11 items-center rounded-md border px-3 text-sm"
                        style={{
                          background: "var(--maison-page)",
                          borderColor: "var(--maison-border)",
                          color: "var(--maison-text-primary)",
                        }}
                      >
                        {meetingDate
                          ? formatMeetingDate(meetingDate)
                          : "Date à confirmer"}
                      </div>
                    </div>
                  </div>

                  <div
                    className="mt-4 rounded-md border px-3 py-3"
                    style={{
                      background: "var(--maison-page)",
                      borderColor: "var(--maison-border)",
                    }}
                  >
                    <p
                      className="text-xs font-medium uppercase tracking-wide"
                      style={{ color: "var(--maison-text-muted)" }}
                    >
                      Objet du meeting
                    </p>
                    <p
                      className="mt-1 text-sm font-semibold"
                      style={{ color: "var(--maison-text-primary)" }}
                    >
                      {matchedCalendarEvent?.title ?? meetingTitle}
                    </p>
                  </div>

                  <div className="mt-4">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4" aria-hidden="true" />
                      <p
                        className="text-sm font-medium"
                        style={{ color: "var(--maison-text-secondary)" }}
                      >
                        Participants
                      </p>
                    </div>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      <AttendeeGroup
                        attendees={qarizmiAttendees}
                        emptyLabel="Aucun participant Qarizmi identifié"
                        label="Qarizmi"
                      />
                      <AttendeeGroup
                        attendees={clientAttendees}
                        emptyLabel="Aucun participant client identifié"
                        label="Client"
                      />
                    </div>
                    <label
                      className="mt-3 block text-xs font-medium"
                      htmlFor="meeting-capture-participants"
                      style={{ color: "var(--maison-text-muted)" }}
                    >
                      Ajuster les participants
                      <input
                        aria-label="Participants"
                        id="meeting-capture-participants"
                        className="mt-2 h-11 w-full rounded-md border px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-teal-600"
                        maxLength={4_000}
                        onChange={(event) =>
                          setParticipantsText(event.target.value)
                        }
                        placeholder="Noms ou emails, séparés par une virgule"
                        style={{
                          background: "var(--maison-page)",
                          borderColor: "var(--maison-border)",
                          color: "var(--maison-text-primary)",
                        }}
                        value={participantsText}
                      />
                    </label>
                  </div>

                  <div
                    className="mt-4 flex flex-col gap-3 rounded-md border px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                    style={{ borderColor: "var(--maison-border)" }}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Paperclip
                        aria-hidden="true"
                        className="h-5 w-5 shrink-0"
                        style={{ color: "var(--maison-text-muted)" }}
                      />
                      <div className="min-w-0">
                        <p
                          className="truncate text-sm font-medium"
                          style={{ color: "var(--maison-text-primary)" }}
                        >
                          {selectedMeeting.supportFileName ??
                            calendarAttachments[0]?.title ??
                            "Supports du meeting"}
                        </p>
                        <p
                          className="text-xs"
                          style={{ color: "var(--maison-text-muted)" }}
                        >
                          {calendarAttachments.length
                            ? `${calendarAttachments.length} document(s) prérempli(s) depuis Calendar/Drive`
                            : "PDF, TXT ou Markdown · 25 Mo max"}
                        </p>
                        {calendarAttachments.length ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {calendarAttachments
                              .slice(0, 5)
                              .map((attachment) =>
                                attachment.fileUrl ? (
                                  <a
                                    className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 underline-offset-2 hover:underline dark:text-teal-300"
                                    href={attachment.fileUrl}
                                    key={
                                      attachment.fileId ?? attachment.fileUrl
                                    }
                                    rel="noreferrer"
                                    target="_blank"
                                  >
                                    {attachment.title ?? "Document Drive"}
                                    <ExternalLink
                                      className="h-3 w-3"
                                      aria-hidden="true"
                                    />
                                  </a>
                                ) : null,
                              )}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <Button
                      className="h-11 shrink-0"
                      disabled={isBusy || hasActiveJob(selectedMeeting)}
                      onClick={() => supportFileInputRef.current?.click()}
                      variant="outline"
                    >
                      {isUploadingSupport ? (
                        <LoaderCircle
                          className="h-4 w-4 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <FileUp className="h-4 w-4" aria-hidden="true" />
                      )}
                      {selectedMeeting.supportFileName
                        ? "Remplacer"
                        : "Ajouter"}
                    </Button>
                    <input
                      ref={supportFileInputRef}
                      accept="application/pdf,text/plain,text/markdown,.pdf,.txt,.md"
                      className="sr-only"
                      onChange={(event) => void importSupport(event)}
                      tabIndex={-1}
                      type="file"
                    />
                  </div>

                  {selectedGeminiArtifacts.length ||
                  unmatchedGeminiArtifacts.length ? (
                    <div
                      className="mt-4 rounded-md border px-3 py-3"
                      style={{ borderColor: "var(--maison-border)" }}
                    >
                      <div className="flex items-center gap-2">
                        <Sparkles
                          className="h-4 w-4 text-violet-600 dark:text-violet-300"
                          aria-hidden="true"
                        />
                        <p
                          className="text-sm font-semibold"
                          style={{ color: "var(--maison-text-primary)" }}
                        >
                          Notes Gemini
                        </p>
                      </div>
                      {selectedGeminiArtifacts.map((artifact) => (
                        <details
                          className="mt-3 rounded-md bg-stone-50 px-3 py-2 text-sm dark:bg-stone-900/50"
                          key={artifact.id}
                        >
                          <summary className="cursor-pointer font-medium">
                            {artifact.title}
                            {artifact.occurredAt
                              ? ` · ${formatMeetingDate(artifact.occurredAt)}`
                              : ""}
                            {artifact.documentTextAvailable
                              ? " · document/transcript indexé"
                              : ""}
                          </summary>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                            {artifact.notesMarkdown.slice(0, 4_000)}
                            {artifact.notesMarkdown.length > 4_000 ? "…" : ""}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-3 text-xs font-medium">
                            {artifact.documentUrl ? (
                              <a
                                className="text-teal-700 hover:underline dark:text-teal-300"
                                href={artifact.documentUrl}
                                rel="noreferrer"
                                target="_blank"
                              >
                                Ouvrir les notes Google
                              </a>
                            ) : null}
                            {artifact.recordingUrl ? (
                              <a
                                className="text-teal-700 hover:underline dark:text-teal-300"
                                href={artifact.recordingUrl}
                                rel="noreferrer"
                                target="_blank"
                              >
                                {"Ouvrir l'enregistrement"}
                              </a>
                            ) : null}
                          </div>
                        </details>
                      ))}
                      {unmatchedGeminiArtifacts.length ? (
                        <div
                          className="mt-3 border-t pt-3"
                          style={{ borderColor: "var(--maison-border)" }}
                        >
                          <p
                            className="text-xs"
                            style={{ color: "var(--maison-text-muted)" }}
                          >
                            {unmatchedGeminiArtifacts.length} note(s) à associer
                            manuellement
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {unmatchedGeminiArtifacts
                              .slice(0, 5)
                              .map((artifact) => (
                                <Button
                                  className="h-9"
                                  disabled={isLinkingGemini || isBusy}
                                  key={artifact.id}
                                  onClick={() =>
                                    void linkGeminiArtifact(artifact.id)
                                  }
                                  title={`Associer “${artifact.title}” au meeting sélectionné`}
                                  variant="outline"
                                >
                                  <BookOpen
                                    className="h-3.5 w-3.5"
                                    aria-hidden="true"
                                  />
                                  {artifact.title.slice(0, 44)}
                                </Button>
                              ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <label
                    className="mt-5 block text-sm font-medium"
                    htmlFor="meeting-capture-notes"
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span style={{ color: "var(--maison-text-secondary)" }}>
                        Notes en direct
                      </span>
                      <span
                        aria-live="polite"
                        className="text-xs font-normal"
                        style={{ color: "var(--maison-text-muted)" }}
                      >
                        {draftSaveLabel(draftSaveState)}
                      </span>
                    </span>
                    <textarea
                      id="meeting-capture-notes"
                      className="mt-2 min-h-56 w-full resize-y rounded-md border px-4 py-3 text-base leading-7 outline-none transition focus-visible:ring-2 focus-visible:ring-teal-600"
                      maxLength={500_000}
                      onChange={(event) =>
                        setLiveNotesMarkdown(event.target.value)
                      }
                      placeholder="Prends tes notes ici. Elles sont sauvegardées automatiquement et enrichiront le compte rendu final."
                      style={{
                        background: "var(--maison-page)",
                        borderColor: "var(--maison-border)",
                        color: "var(--maison-text-primary)",
                      }}
                      value={liveNotesMarkdown}
                    />
                  </label>

                  <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-md px-1 py-2 text-sm">
                    <input
                      checked={consentConfirmed}
                      className="mt-0.5 h-5 w-5 shrink-0 accent-teal-700 focus-visible:ring-2 focus-visible:ring-teal-600"
                      disabled={
                        captureMode === "recording" || captureMode === "paused"
                      }
                      onChange={(event) =>
                        setConsentConfirmed(event.target.checked)
                      }
                      type="checkbox"
                    />
                    <span style={{ color: "var(--maison-text-secondary)" }}>
                      {
                        "Je confirme que les participants ont été informés de l'enregistrement."
                      }
                    </span>
                  </label>

                  {recoveredRecording ? (
                    <div className="mt-3 flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
                      <ShieldCheck
                        className="mt-0.5 h-5 w-5 shrink-0"
                        aria-hidden="true"
                      />
                      <p>
                        {
                          "Un audio interrompu a été retrouvé sur ce Mac. Il reste local jusqu'à la reprise de l'envoi."
                        }
                      </p>
                    </div>
                  ) : null}

                  <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                    {captureMode === "recording" || captureMode === "paused" ? (
                      <Button
                        className="h-12 min-w-56"
                        onClick={stopRecording}
                        title="Terminer l'enregistrement et lancer le traitement"
                        variant="outline"
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-full bg-red-500"
                          aria-hidden="true"
                        />
                        Terminer et traiter · {formatDuration(elapsedSeconds)}
                      </Button>
                    ) : recoveredRecording ? (
                      <Button
                        className="h-12 min-w-56"
                        disabled={isBusy || hasActiveJob(selectedMeeting)}
                        onClick={() => void processRecoveredRecording()}
                        title="Reprendre l'envoi local et lancer le traitement"
                      >
                        {captureMode === "uploading" ? (
                          <LoaderCircle
                            className="h-4 w-4 animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          <UploadCloud className="h-4 w-4" aria-hidden="true" />
                        )}
                        {captureMode === "uploading"
                          ? "Envoi en cours…"
                          : "Reprendre et traiter"}
                      </Button>
                    ) : null}

                    <Button
                      className="h-12"
                      disabled={isBusy || hasActiveJob(selectedMeeting)}
                      onClick={() => fileInputRef.current?.click()}
                      title="Importer un enregistrement existant"
                      variant="outline"
                    >
                      <FileUp className="h-4 w-4" aria-hidden="true" />
                      Importer un audio
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

                  <p
                    className="mt-3 text-xs leading-5"
                    style={{ color: "var(--maison-text-muted)" }}
                  >
                    {
                      "Capture micro uniquement. Le navigateur conserve son témoin système; l'audio et les notes restent dans l'espace privé Qarizmi."
                    }
                  </p>

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
                          className="mt-3 h-11"
                          disabled={isBusy}
                          onClick={() => void retryProcessing()}
                          variant="outline"
                        >
                          <RefreshCw className="h-4 w-4" aria-hidden="true" />
                          {"Relancer l'analyse"}
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>

          <div
            className="min-w-0 border-t p-4 sm:p-6"
            style={{ borderColor: "var(--maison-border)" }}
          >
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
            {selectedMeeting ? (
              <MeetingKnowledgeSearch meetingId={selectedMeeting.id} />
            ) : null}
          </div>
        </div>
      )}

      {feedback.error || feedback.message || feedback.warnings?.length ? (
        <FeedbackBar feedback={feedback} />
      ) : null}
    </section>
  );
}

function AttendeeGroup({
  attendees,
  emptyLabel,
  label,
}: {
  attendees: MeetingAttendee[];
  emptyLabel: string;
  label: string;
}) {
  return (
    <div
      className="min-h-24 rounded-md border px-3 py-3"
      style={{
        background: "var(--maison-page)",
        borderColor: "var(--maison-border)",
      }}
    >
      <p
        className="text-xs font-semibold uppercase tracking-wide"
        style={{ color: "var(--maison-text-muted)" }}
      >
        {label}
      </p>
      {attendees.length ? (
        <ul className="mt-2 space-y-1">
          {attendees.map((attendee, index) => (
            <li
              className="text-sm"
              key={`${attendee.email ?? attendee.displayName ?? attendee.name ?? "participant"}-${index}`}
              style={{ color: "var(--maison-text-primary)" }}
            >
              {attendee.displayName || attendee.name || attendee.email}
              {(attendee.displayName || attendee.name) && attendee.email ? (
                <span
                  className="ml-1 text-xs"
                  style={{ color: "var(--maison-text-muted)" }}
                >
                  {attendee.email}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p
          className="mt-2 text-xs"
          style={{ color: "var(--maison-text-muted)" }}
        >
          {emptyLabel}
        </p>
      )}
    </div>
  );
}

export function MeetingKnowledgeSearch({ meetingId }: { meetingId: string }) {
  const [question, setQuestion] = useState("");
  const [scope, setScope] = useState<"meeting" | "recent">("meeting");
  const [result, setResult] = useState<MeetingKnowledgeAnswer>();
  const [error, setError] = useState<string>();
  const [isSearching, setIsSearching] = useState(false);

  const searchKnowledge = async () => {
    if (question.trim().length < 2) return;
    setIsSearching(true);
    setError(undefined);
    try {
      const response = await askMeetingKnowledgeAction({
        meetingId: scope === "meeting" ? meetingId : undefined,
        question: question.trim(),
        scope,
      });
      if (!response.success) throw new Error(response.error);
      setResult({ answer: response.answer, sources: response.sources });
    } catch (searchError) {
      setError(getErrorMessage(searchError));
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div
      className="mt-6 rounded-lg border px-4 py-4"
      style={{
        background: "var(--maison-page)",
        borderColor: "var(--maison-border)",
      }}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-200">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <p
            className="text-sm font-semibold"
            style={{ color: "var(--maison-text-primary)" }}
          >
            Ask NAIA
          </p>
          <p
            className="mt-0.5 text-xs"
            style={{ color: "var(--maison-text-muted)" }}
          >
            Recherche sourcée dans les notes, transcripts et imports Gemini
            privés. Aucune API IA payante.
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="meeting-knowledge-question">
          Question sur les meetings
        </label>
        <input
          id="meeting-knowledge-question"
          className="h-11 min-w-0 flex-1 rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-violet-600"
          maxLength={500}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void searchKnowledge();
            }
          }}
          placeholder="Qu'avons-nous décidé sur le calendrier de lancement ?"
          value={question}
        />
        <select
          aria-label="Périmètre de recherche"
          className="h-11 rounded-md border px-3 text-sm"
          onChange={(event) =>
            setScope(event.target.value as "meeting" | "recent")
          }
          value={scope}
        >
          <option value="meeting">Ce meeting</option>
          <option value="recent">50 meetings récents</option>
        </select>
        <Button
          className="h-11"
          disabled={isSearching || question.trim().length < 2}
          onClick={() => void searchKnowledge()}
        >
          {isSearching ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Search className="h-4 w-4" aria-hidden="true" />
          )}
          Rechercher
        </Button>
      </div>
      {error ? (
        <p className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>
      ) : null}
      {result ? (
        <div className="mt-4 space-y-3" aria-live="polite">
          <p
            className="text-sm"
            style={{ color: "var(--maison-text-secondary)" }}
          >
            {result.answer}
          </p>
          {result.sources.map((source) => (
            <blockquote
              className="rounded-md border-l-2 border-violet-400 px-3 py-2 text-sm"
              key={`${source.sourceId}:${source.excerpt}`}
            >
              <p className="leading-6">{source.excerpt}</p>
              <footer
                className="mt-1 text-xs"
                style={{ color: "var(--maison-text-muted)" }}
              >
                {source.sourceLabel}
              </footer>
            </blockquote>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ReviewWorkspace({
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

function formatCalendarEventOption(event: GoogleCalendarEventSummary) {
  if (!event.start) return event.title;
  if (/^\d{4}-\d{2}-\d{2}$/.test(event.start)) {
    return `Toute la journée · ${event.title}`;
  }
  const date = new Date(event.start);
  if (Number.isNaN(date.getTime())) return event.title;
  const time = new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Casablanca",
  }).format(date);
  return `${time} · ${event.title}`;
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

function isSupportedMeetingDocument(file: File) {
  return file.size > 0 && /\.(md|pdf|txt)$/i.test(file.name);
}

function getSupportExtension(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "md" || extension === "txt") return extension;
  return "pdf";
}

function safeOriginalFileName(fileName: string, extension: string) {
  const cleaned =
    fileName.split(/[\\/]/).at(-1)?.trim() || `support.${extension}`;
  const suffix = `.${extension}`;
  const base = cleaned.replace(/\.[^.]+$/, "").trim() || "support";
  return `${base.slice(0, 240 - suffix.length)}${suffix}`;
}

function formatAttendees(attendees: MeetingAttendee[]) {
  return attendees
    .map((attendee) => {
      const name = attendee.displayName || attendee.name;
      if (name && attendee.email) return `${name} <${attendee.email}>`;
      return name || attendee.email || "";
    })
    .filter(Boolean)
    .join(", ");
}

function isQarizmiAttendee(attendee: MeetingAttendee) {
  if (attendee.email?.trim().toLocaleLowerCase("en").endsWith("@qarizmi.com")) {
    return true;
  }
  const name = (attendee.displayName ?? attendee.name ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("fr");
  return ["ali el abbassy", "nabil jamal eddine"].some((founder) =>
    name.includes(founder),
  );
}

function parseAttendees(value: string): MeetingAttendee[] {
  const seen = new Set<string>();
  const attendees: MeetingAttendee[] = [];
  for (const rawEntry of value.split(/[,;\n]/)) {
    const entry = rawEntry.trim();
    if (!entry) continue;
    const bracketMatch = entry.match(/^(.+?)\s*<([^<>\s]+@[^<>\s]+)>$/);
    const attendee = bracketMatch
      ? { displayName: bracketMatch[1].trim(), email: bracketMatch[2].trim() }
      : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry)
        ? { email: entry }
        : { name: entry };
    const key = (attendee.email ?? attendee.displayName ?? attendee.name ?? "")
      .toLocaleLowerCase("fr")
      .trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    attendees.push(attendee);
    if (attendees.length >= 40) break;
  }
  return attendees;
}

function matchCalendarEvent(
  meeting: MeetingWorkspace | undefined,
  events: GoogleCalendarEventSummary[],
) {
  if (!meeting) return undefined;
  if (meeting.calendarEventId) {
    const exact = events.find((event) => event.id === meeting.calendarEventId);
    if (exact) return exact;
  }

  const meetingTitle = normalizeMatchText(meeting.title);
  const companyName = normalizeMatchText(meeting.companyName ?? "");
  const contactName = normalizeMatchText(meeting.contactName ?? "");
  const meetingStart = meeting.startsAt
    ? new Date(meeting.startsAt).getTime()
    : Number.NaN;

  return events
    .map((event) => {
      const eventTitle = normalizeMatchText(event.title);
      const eventStart = event.start
        ? new Date(event.start).getTime()
        : Number.NaN;
      const timeDistance =
        Number.isFinite(meetingStart) && Number.isFinite(eventStart)
          ? Math.abs(meetingStart - eventStart)
          : Number.POSITIVE_INFINITY;
      const titleMatches =
        Boolean(meetingTitle) &&
        (eventTitle === meetingTitle ||
          eventTitle.includes(meetingTitle) ||
          meetingTitle.includes(eventTitle));
      const contextMatches = [companyName, contactName].some(
        (value) => value.length >= 3 && eventTitle.includes(value),
      );
      const eligible =
        titleMatches ||
        (contextMatches && timeDistance <= 12 * 60 * 60 * 1_000);
      const score =
        (titleMatches ? 10 : 0) +
        (contextMatches ? 4 : 0) +
        (timeDistance <= 2 * 60 * 60 * 1_000 ? 3 : 0);
      return { eligible, event, score, timeDistance };
    })
    .filter((candidate) => candidate.eligible)
    .sort(
      (left, right) =>
        right.score - left.score || left.timeDistance - right.timeDistance,
    )[0]?.event;
}

function normalizeMatchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function draftSaveLabel(state: DraftSaveState) {
  if (state === "saving") return "Sauvegarde…";
  if (state === "saved") return "Sauvegardé";
  if (state === "error") return "Sauvegardé localement · synchro à reprendre";
  return "Sauvegarde automatique";
}

function readLocalMeetingDraft(
  meetingId: string,
): LocalMeetingDraft | undefined {
  try {
    const raw = window.localStorage.getItem(localDraftKey(meetingId));
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Partial<LocalMeetingDraft>;
    if (
      typeof value.title !== "string" ||
      typeof value.participantsText !== "string" ||
      typeof value.liveNotesMarkdown !== "string"
    ) {
      return undefined;
    }
    return {
      consentConfirmed: value.consentConfirmed === true,
      liveNotesMarkdown: value.liveNotesMarkdown.slice(0, 500_000),
      participantsText: value.participantsText.slice(0, 4_000),
      title: value.title.slice(0, 300),
      updatedAt:
        typeof value.updatedAt === "string"
          ? value.updatedAt
          : new Date(0).toISOString(),
    };
  } catch {
    return undefined;
  }
}

function writeLocalMeetingDraft(meetingId: string, draft: LocalMeetingDraft) {
  try {
    window.localStorage.setItem(
      localDraftKey(meetingId),
      JSON.stringify(draft),
    );
  } catch {
    // The server autosave remains active if browser storage is unavailable.
  }
}

function localDraftKey(meetingId: string) {
  return `naia:meeting-draft:${meetingId}`;
}

function isLocalDraftNewer(
  draft: LocalMeetingDraft | undefined,
  serverUpdatedAt: string | undefined,
) {
  if (!draft) return false;
  if (!serverUpdatedAt) return true;
  const draftTime = Date.parse(draft.updatedAt);
  const serverTime = Date.parse(serverUpdatedAt);
  if (!Number.isFinite(draftTime)) return false;
  if (!Number.isFinite(serverTime)) return true;
  return draftTime > serverTime;
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
