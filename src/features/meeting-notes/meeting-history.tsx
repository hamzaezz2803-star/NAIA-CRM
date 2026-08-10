"use client";

import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  FileText,
  LoaderCircle,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import {
  approveMeetingOutputAction,
  fetchMeetingIntelligenceAction,
  retryMeetingDriveArchiveAction,
  retryMeetingProcessingAction,
  syncGeminiMeetingNotesAction,
} from "./actions";
import type { MeetingWorkspace } from "./contracts";
import {
  MeetingKnowledgeSearch,
  ReviewWorkspace,
} from "./meeting-intelligence-workspace";

type HistoryFeedback = {
  error?: string;
  message?: string;
  warnings?: string[];
};

export function MeetingHistory({ meetings }: { meetings: MeetingWorkspace[] }) {
  const [workspaceMeetings, setWorkspaceMeetings] = useState(meetings);
  const historyMeetings = useMemo(
    () =>
      workspaceMeetings
        .filter((meeting) => Boolean(meeting.output || meeting.job))
        .toSorted(
          (left, right) => meetingTimestamp(right) - meetingTimestamp(left),
        ),
    [workspaceMeetings],
  );
  const [selectedMeetingId, setSelectedMeetingId] = useState("");
  const [isMutating, setIsMutating] = useState(false);
  const [isSyncingGemini, setIsSyncingGemini] = useState(false);
  const [geminiNextPageToken, setGeminiNextPageToken] = useState<string>();
  const [feedback, setFeedback] = useState<HistoryFeedback>({});
  const selectedMeeting = historyMeetings.find(
    (meeting) => meeting.id === selectedMeetingId,
  );

  const openMeeting = (meetingId: string) => {
    setSelectedMeetingId(meetingId);
    setFeedback({});
  };

  const closeMeeting = () => {
    setSelectedMeetingId("");
    setFeedback({});
  };

  const refreshHistory = async () => {
    const state = await fetchMeetingIntelligenceAction();
    if (!state.configured && state.error) throw new Error(state.error);
    setWorkspaceMeetings(
      state.meetings.filter((meeting) =>
        Boolean(meeting.output || meeting.job),
      ),
    );
  };

  const approveReview = async (
    notesMarkdown: string,
    selectedRecommendationIds: string[],
    reviewRevision: number,
  ) => {
    if (!selectedMeeting?.output || !notesMarkdown.trim()) return;
    setIsMutating(true);
    setFeedback({});
    try {
      const result = await approveMeetingOutputAction({
        meetingId: selectedMeeting.id,
        notesMarkdown: notesMarkdown.trim(),
        outputId: selectedMeeting.output.id,
        outputVersion: selectedMeeting.output.version,
        reviewRevision,
        selectedRecommendationIds,
      });
      if (!result.success) throw new Error(result.error);
      setFeedback({
        message: "Compte rendu et actions validés.",
        warnings: result.warnings,
      });
      await refreshHistory();
    } catch (error) {
      setFeedback({ error: getErrorMessage(error) });
    } finally {
      setIsMutating(false);
    }
  };

  const retryProcessing = async () => {
    if (!selectedMeeting) return;
    setIsMutating(true);
    setFeedback({});
    try {
      const result = await retryMeetingProcessingAction(selectedMeeting.id);
      if (!result.success) throw new Error(result.error);
      setFeedback({ message: "Analyse relancée avec le dernier audio." });
      await refreshHistory();
    } catch (error) {
      setFeedback({ error: getErrorMessage(error) });
    } finally {
      setIsMutating(false);
    }
  };

  const retryDriveArchive = async () => {
    if (!selectedMeeting) return;
    setIsMutating(true);
    setFeedback({});
    try {
      const result = await retryMeetingDriveArchiveAction(selectedMeeting.id);
      if (!result.success) throw new Error(result.error);
      setFeedback({
        message:
          result.message ?? "Compte rendu archivé dans le Drive privé Qarizmi.",
      });
      await refreshHistory();
    } catch (error) {
      setFeedback({ error: getErrorMessage(error) });
    } finally {
      setIsMutating(false);
    }
  };

  const syncGemini = async () => {
    setIsSyncingGemini(true);
    setFeedback({});
    try {
      const result = await syncGeminiMeetingNotesAction({
        pageToken: geminiNextPageToken,
      });
      if (!result.success) throw new Error(result.error);
      setGeminiNextPageToken(result.nextPageToken);
      setFeedback({
        message: `${result.total} note(s) Gemini synchronisée(s), dont ${result.matched} associée(s).`,
      });
      await refreshHistory();
    } catch (error) {
      setFeedback({ error: getErrorMessage(error) });
    } finally {
      setIsSyncingGemini(false);
    }
  };

  if (selectedMeeting) {
    return (
      <main className="min-h-dvh bg-stone-100 px-4 py-5 text-stone-950 dark:bg-stone-950 dark:text-stone-50 sm:px-6 sm:py-8">
        <article className="mx-auto max-w-4xl overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <header className="border-b border-stone-200 px-5 py-5 dark:border-stone-800 sm:px-8 sm:py-7">
            <button
              className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:hover:bg-stone-800 dark:hover:text-stone-50"
              onClick={closeMeeting}
              type="button"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Tous les comptes rendus
            </button>
            <div className="mt-5">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
                Compte rendu
              </p>
              <h1 className="mt-2 text-2xl font-semibold leading-tight sm:text-3xl">
                {selectedMeeting.title}
              </h1>
              {selectedMeeting.startsAt ? (
                <p className="mt-2 text-sm text-stone-500">
                  {formatMeetingDate(selectedMeeting.startsAt)}
                </p>
              ) : null}
            </div>
          </header>

          <div className="px-5 py-5 sm:px-8 sm:py-7">
            {selectedMeeting.output && selectedMeeting.job ? (
              <MeetingJobNotice
                disabled={isMutating}
                meeting={selectedMeeting}
                onRetry={() => void retryProcessing()}
              />
            ) : null}
            {selectedMeeting.output ? (
              <>
                <ReviewWorkspace
                  disabled={isMutating}
                  key={`${selectedMeeting.output.id}:${selectedMeeting.output.reviewRevision}`}
                  meeting={selectedMeeting}
                  onApprove={(notes, recommendationIds, reviewRevision) =>
                    void approveReview(notes, recommendationIds, reviewRevision)
                  }
                  onRetryArchive={() => void retryDriveArchive()}
                />
                <MeetingKnowledgeSearch meetingId={selectedMeeting.id} />
              </>
            ) : (
              <div className="flex min-h-72 flex-col items-center justify-center px-4 text-center">
                {selectedMeeting.job?.status === "failed" ? (
                  <RefreshCw
                    className="h-7 w-7 text-red-500"
                    aria-hidden="true"
                  />
                ) : (
                  <LoaderCircle
                    className="h-7 w-7 animate-spin text-teal-600 motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                )}
                <h2 className="mt-4 font-semibold">
                  {selectedMeeting.job?.status === "failed"
                    ? "Traitement interrompu"
                    : "Analyse en cours"}
                </h2>
                <p className="mt-1 max-w-md text-sm leading-6 text-stone-500">
                  {selectedMeeting.job?.error ??
                    selectedMeeting.job?.message ??
                    "Le compte rendu est en préparation."}
                </p>
                {selectedMeeting.job?.status === "failed" ? (
                  <button
                    className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full border border-stone-300 px-4 text-sm font-medium transition-colors hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-700 dark:hover:bg-stone-800"
                    disabled={isMutating}
                    onClick={() => void retryProcessing()}
                    type="button"
                  >
                    {isMutating ? (
                      <LoaderCircle
                        className="h-4 w-4 animate-spin motion-reduce:animate-none"
                        aria-hidden="true"
                      />
                    ) : (
                      <RefreshCw className="h-4 w-4" aria-hidden="true" />
                    )}
                    Relancer l’analyse
                  </button>
                ) : null}
              </div>
            )}

            {feedback.error || feedback.message || feedback.warnings?.length ? (
              <HistoryFeedbackBar feedback={feedback} />
            ) : null}
          </div>
        </article>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-stone-100 px-4 py-5 text-stone-950 dark:bg-stone-950 dark:text-stone-50 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-4xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <Link
              aria-label="Retour aux notes de meeting"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-stone-500 transition-colors hover:bg-white hover:text-stone-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:hover:bg-stone-900 dark:hover:text-stone-50"
              href="/meetings"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Link>
            <div className="pt-1.5">
              <h1 className="text-2xl font-semibold leading-tight sm:text-3xl">
                Comptes rendus
              </h1>
              <p className="mt-1 text-sm text-stone-500">
                Revue, traitements et recherche dans les meetings.
              </p>
            </div>
          </div>
          <button
            className="inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-full border border-stone-200 bg-white px-4 text-sm font-medium transition-colors hover:border-stone-300 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-stone-700 dark:hover:bg-stone-800"
            disabled={isSyncingGemini}
            onClick={() => void syncGemini()}
            type="button"
          >
            {isSyncingGemini ? (
              <LoaderCircle
                className="h-4 w-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            )}
            {geminiNextPageToken ? "Continuer Gemini" : "Synchroniser Gemini"}
          </button>
        </header>

        {feedback.error || feedback.message || feedback.warnings?.length ? (
          <HistoryFeedbackBar feedback={feedback} />
        ) : null}

        {historyMeetings.length ? (
          <div className="mt-8 space-y-3">
            {historyMeetings.map((meeting) => (
              <button
                className="group flex min-h-20 w-full cursor-pointer items-center gap-4 rounded-2xl border border-stone-200 bg-white px-4 py-4 text-left shadow-sm transition-colors hover:border-stone-300 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-stone-700 dark:hover:bg-stone-800 sm:px-5"
                key={meeting.id}
                onClick={() => openMeeting(meeting.id)}
                type="button"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-300">
                  <FileText className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-stone-900 dark:text-stone-50">
                    {meeting.title}
                  </span>
                  <span className="mt-1 block text-sm text-stone-500">
                    {meeting.startsAt
                      ? formatMeetingDate(meeting.startsAt)
                      : "Date non renseignée"}
                  </span>
                  <span className="mt-2 block text-xs font-medium text-stone-400">
                    {meetingHistoryStatus(meeting)}
                  </span>
                </span>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-stone-400 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                  aria-hidden="true"
                />
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-8 flex min-h-72 flex-col items-center justify-center rounded-2xl border border-stone-200 bg-white px-6 text-center shadow-sm dark:border-stone-800 dark:bg-stone-900">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-stone-100 text-stone-400 dark:bg-stone-800">
              <BookOpen className="h-5 w-5" aria-hidden="true" />
            </span>
            <h2 className="mt-4 font-semibold">Aucun meeting à suivre</h2>
            <p className="mt-1 max-w-sm text-sm leading-6 text-stone-500">
              Les traitements et comptes rendus apparaîtront ici après un
              meeting.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

function meetingTimestamp(meeting: MeetingWorkspace) {
  const value = meeting.startsAt ?? meeting.updatedAt;
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function formatMeetingDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date non renseignée";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Africa/Casablanca",
  }).format(date);
}

function meetingHistoryStatus(meeting: MeetingWorkspace) {
  if (meeting.job?.status === "failed") return "Traitement interrompu";
  if (meeting.job && isActiveMeetingJob(meeting.job.status)) {
    return meeting.job.message || "Analyse en cours";
  }
  if (meeting.output?.reviewStatus === "approved") return "Validé";
  if (meeting.output) return "À valider";
  return meeting.job?.message || "Analyse en cours";
}

function MeetingJobNotice({
  disabled,
  meeting,
  onRetry,
}: {
  disabled: boolean;
  meeting: MeetingWorkspace;
  onRetry: () => void;
}) {
  if (!meeting.job) return null;
  const failed = meeting.job.status === "failed";
  if (!failed && !isActiveMeetingJob(meeting.job.status)) return null;

  return (
    <div
      className={`mb-5 flex flex-col gap-3 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between ${
        failed
          ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
          : "border-teal-200 bg-teal-50 text-teal-900 dark:border-teal-900/60 dark:bg-teal-950/30 dark:text-teal-100"
      }`}
      role="status"
    >
      <div className="flex items-start gap-2">
        {failed ? (
          <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        ) : (
          <LoaderCircle
            className="mt-0.5 h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        )}
        <p>
          {meeting.job.error ??
            meeting.job.message ??
            (failed ? "Traitement interrompu" : "Analyse en cours")}
        </p>
      </div>
      {failed ? (
        <button
          className="min-h-11 shrink-0 rounded-full border border-current px-4 text-sm font-medium transition-colors hover:bg-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-black/10"
          disabled={disabled}
          onClick={onRetry}
          type="button"
        >
          Relancer l’analyse
        </button>
      ) : null}
    </div>
  );
}

function isActiveMeetingJob(status: string) {
  return [
    "queued",
    "claimed",
    "transcribing",
    "analyzing",
    "uploading",
    "finalizing",
  ].includes(status);
}

function HistoryFeedbackBar({ feedback }: { feedback: HistoryFeedback }) {
  const text = feedback.error ?? feedback.message;
  return (
    <div
      aria-live="polite"
      className={`mt-5 rounded-xl border px-4 py-3 text-sm ${
        feedback.error
          ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
          : "border-teal-200 bg-teal-50 text-teal-900 dark:border-teal-900/60 dark:bg-teal-950/30 dark:text-teal-100"
      }`}
      role={feedback.error ? "alert" : "status"}
    >
      {text ? <p>{text}</p> : null}
      {feedback.warnings?.map((warning) => (
        <p className="mt-1" key={warning}>
          {warning}
        </p>
      ))}
    </div>
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Action impossible.";
}
