"use client";

import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CheckCircle2,
  Loader2,
  MessageCircle,
  Mic,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";

import { crmLeadStatuses, type CrmLeadDraft } from "@/features/crm/contracts";
import type { NaiaActionDraft, NaiaOrchestrationResult } from "./orchestrator";
import {
  createVoiceSilenceDetector,
  playElevenLabsVoice,
  primeVoicePlayback,
  type VoicePlaybackHandle,
  VOICE_RECORDING_MAX_MS,
} from "./voice-client";

type ApiResult = Omit<NaiaOrchestrationResult, "actions"> & {
  actions: SignedNaiaAction[];
  crmSnapshot?: {
    leadCount: number;
    openLeadCount: number;
  };
  mode?: string;
};

type SignedNaiaAction = NaiaActionDraft & {
  approvalToken: string;
};

type ConversationMessage = {
  content: string;
  role: "assistant" | "user";
};

type VoiceOption = {
  category: string;
  name: string;
  voiceId: string;
};

type VoiceCatalog = {
  activeVoice?: VoiceOption;
  configuredVoiceId?: string;
  recommendedVoiceId?: string;
  voices: VoiceOption[];
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      [index: number]: {
        transcript: string;
      };
    };
  };
};

type FloatingPosition = {
  x: number;
  y: number;
};

const BUBBLE_SIZE = 48;
const PANEL_WIDTH = 420;
const PANEL_HEIGHT = 620;

const crmStatusLabels: Record<string, string> = {
  contacted: "Contacté",
  "dead-end": "Dead end",
  "lead-to-contact": "À contacter",
  "meeting-booked": "Meeting fixé",
  "proposal-sent": "Propale envoyée",
  "to-follow-up": "À relancer",
  won: "Gagné",
};

const emeraldFieldClassName =
  "mt-1 min-h-10 w-full rounded-md border border-emerald-200 bg-white px-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-950/78 dark:text-slate-50 dark:placeholder:text-slate-500 dark:focus:border-emerald-200 dark:focus:ring-emerald-200/40";

export function NaiaFloatingAssistant() {
  const [command, setCommand] = useState("");
  const [result, setResult] = useState<ApiResult | null>(null);
  const conversationRef = useRef<ConversationMessage[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isApplyingAction, setIsApplyingAction] = useState(false);
  const [notice, setNotice] = useState("");
  const [position, setPosition] = useState<FloatingPosition | null>(null);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | undefined>();
  const [transcript, setTranscript] = useState("");
  const [viewport, setViewport] = useState({ height: 760, width: 1200 });
  const audioChunksRef = useRef<Blob[]>([]);
  const browserFinalTranscriptRef = useRef("");
  const dragRef = useRef<{
    moved: boolean;
    pointerX: number;
    pointerY: number;
    startX: number;
    startY: number;
  } | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const silenceDetectorRef = useRef<{ stop: () => void } | null>(null);
  const speechAudioRef = useRef<VoicePlaybackHandle | null>(null);

  const canRecordAudio =
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof MediaRecorder !== "undefined";
  const activityMessage = isListening
    ? "Écoute en cours."
    : isRunning
      ? "NAIA prépare la réponse."
      : isSpeaking
        ? "Lecture audio en cours."
        : "";

  useEffect(() => {
    const syncViewport = () => {
      setViewport({ height: window.innerHeight, width: window.innerWidth });
      setPosition((current) =>
        current
          ? clampPosition(current, window.innerWidth, window.innerHeight)
          : (readStoredPosition() ??
            getDefaultPosition(window.innerWidth, window.innerHeight)),
      );
    };

    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => window.removeEventListener("resize", syncViewport);
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadVoice = async () => {
      try {
        const response = await fetch("/api/naia/voice/voices", {
          cache: "no-store",
        });
        const payload = (await response.json()) as VoiceCatalog;
        if (!isMounted) return;
        setSelectedVoiceId(pickDefaultVoice(payload));
      } catch {
        if (isMounted) setSelectedVoiceId(undefined);
      }
    };

    void loadVoice();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (recordingTimeoutRef.current) {
        clearTimeout(recordingTimeoutRef.current);
        recordingTimeoutRef.current = null;
      }

      silenceDetectorRef.current?.stop();
      recognitionRef.current?.stop();
      speechAudioRef.current?.pause();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const panelStyle = useMemo<CSSProperties>(() => {
    if (!position) return {};

    const panelWidth = Math.min(PANEL_WIDTH, viewport.width - 24);
    const panelHeight = Math.min(PANEL_HEIGHT, viewport.height - 32);
    const opensAbove = position.y > viewport.height * 0.52;
    const left = clamp(
      position.x - panelWidth + BUBBLE_SIZE,
      12,
      viewport.width - panelWidth - 12,
    );
    const top = opensAbove
      ? clamp(
          position.y - panelHeight - 12,
          12,
          viewport.height - panelHeight - 12,
        )
      : clamp(
          position.y + BUBBLE_SIZE + 12,
          12,
          viewport.height - panelHeight - 12,
        );

    return {
      left,
      maxHeight: panelHeight,
      top,
      width: panelWidth,
    };
  }, [position, viewport.height, viewport.width]);

  const runCommand = async (
    nextCommand = command,
    options: { speak?: boolean } = { speak: true },
  ) => {
    const cleanCommand = nextCommand.trim();
    if (!cleanCommand) return;

    setCommand(cleanCommand);
    setIsOpen(true);
    setIsRunning(true);
    setNotice("");
    setTranscript(cleanCommand);

    try {
      const response = await fetch("/api/naia/orchestrate", {
        body: JSON.stringify({
          command: cleanCommand,
          history: conversationRef.current.slice(-8),
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as ApiResult & { error?: string };

      if (!response.ok || payload.error) {
        throw new Error(payload.error ?? "NAIA orchestration failed");
      }

      setResult(payload);
      conversationRef.current = [
        ...conversationRef.current,
        { content: cleanCommand, role: "user" as const },
        { content: payload.response, role: "assistant" as const },
      ].slice(-8);
      if (options.speak) speakText(payload.response);
    } catch {
      setNotice("NAIA n'a pas pu terminer l'orchestration.");
    } finally {
      setIsRunning(false);
    }
  };

  const executeAction = async (
    action: SignedNaiaAction,
    leadInput?: Partial<CrmLeadDraft>,
  ) => {
    primeVoicePlayback();
    setIsApplyingAction(true);
    setNotice("");

    try {
      const response = await fetch("/api/naia/orchestrate", {
        body: JSON.stringify({
          actionId: action.id,
          approvalToken: action.approvalToken,
          command,
          execute: true,
          leadInput,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as {
        error?: string;
        message?: string;
        success?: boolean;
      };

      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? payload.error ?? "Action failed");
      }

      const successMessage = payload.message ?? "Action appliquée.";
      setResult((current) =>
        current
          ? {
              ...current,
              actions: current.actions.filter(
                (candidate) => candidate.id !== action.id,
              ),
              response: successMessage,
            }
          : current,
      );
      setNotice(successMessage);
      speakText(successMessage);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Impossible d'appliquer l'action.",
      );
    } finally {
      setIsApplyingAction(false);
    }
  };

  const startVoiceControl = () => {
    primeVoicePlayback();
    setIsOpen(true);
    if (canRecordAudio) {
      void startMediaRecorderControl();
      return;
    }

    startBrowserSpeechControl();
  };

  const startBrowserSpeechControl = () => {
    const browserWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const Recognition =
      browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;

    if (!Recognition) {
      setNotice("Reconnaissance vocale indisponible dans ce navigateur.");
      return;
    }

    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "fr-FR";
    browserFinalTranscriptRef.current = "";
    recognition.onresult = (event) => {
      let interimTranscript = "";

      for (
        let index = event.resultIndex;
        index < event.results.length;
        index += 1
      ) {
        const resultTranscript = event.results[index][0].transcript;
        if (event.results[index].isFinal) {
          browserFinalTranscriptRef.current =
            `${browserFinalTranscriptRef.current} ${resultTranscript}`.trim();
        } else {
          interimTranscript += resultTranscript;
        }
      }

      setTranscript(
        `${browserFinalTranscriptRef.current} ${interimTranscript}`.trim(),
      );
    };
    recognition.onerror = (event) => {
      setNotice(
        event.error
          ? `Voix navigateur: ${event.error}`
          : "Voix navigateur interrompue.",
      );
      setIsListening(false);
    };
    recognition.onend = () => {
      const spokenText = browserFinalTranscriptRef.current.trim();
      setIsListening(false);

      if (spokenText) {
        setCommand(spokenText);
        void runCommand(spokenText, { speak: true });
        return;
      }

      setNotice("Aucune phrase détectée. Relance Parler quand tu es prêt.");
    };
    recognitionRef.current = recognition;
    setNotice("Je t'écoute.");
    setIsListening(true);
    recognition.start();
  };

  const startMediaRecorderControl = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getPreferredAudioMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        if (recordingTimeoutRef.current) {
          clearTimeout(recordingTimeoutRef.current);
          recordingTimeoutRef.current = null;
        }
        silenceDetectorRef.current?.stop();
        silenceDetectorRef.current = null;

        const audio = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaRecorderRef.current = null;
        mediaStreamRef.current = null;
        setIsListening(false);

        if (!audio.size) {
          setNotice("Aucun audio détecté.");
          return;
        }

        setTranscript("Transcription NAIA en cours.");
        void transcribeAudioCommand(audio);
      };
      setTranscript("Je t'écoute.");
      setNotice("");
      setIsListening(true);
      recorder.start();
      silenceDetectorRef.current = createVoiceSilenceDetector({
        onSilence: () => {
          if (
            mediaRecorderRef.current === recorder &&
            recorder.state !== "inactive"
          ) {
            recorder.stop();
          }
        },
        onSpeechStart: () => setTranscript("Je t'écoute."),
        stream,
      });
      recordingTimeoutRef.current = setTimeout(() => {
        if (
          mediaRecorderRef.current === recorder &&
          recorder.state !== "inactive"
        ) {
          recorder.stop();
        }
      }, VOICE_RECORDING_MAX_MS);
    } catch {
      setIsListening(false);
      setNotice("Microphone indisponible ou permission refusée.");
    }
  };

  const transcribeAudioCommand = async (audio: Blob) => {
    const formData = new FormData();
    formData.append("audio", audio, getAudioFileName(audio.type));

    try {
      const response = await fetch("/api/naia/transcribe", {
        body: formData,
        method: "POST",
      });
      const payload = (await response.json()) as {
        message?: string;
        mode?: string;
        transcript?: string;
      };
      const text = payload.transcript?.trim();

      if (!response.ok || !text) {
        if (payload.mode === "missing-groq-key") {
          setNotice(
            "Groq Whisper n'est pas configure. J'active la voix navigateur.",
          );
          startBrowserSpeechControl();
          return;
        }

        throw new Error(payload.message ?? "Transcription failed");
      }

      setCommand(text);
      setTranscript(text);
      await runCommand(text, { speak: true });
    } catch {
      setNotice(
        "Transcription indisponible. Utilise le texte ou relance Parler.",
      );
    }
  };

  const speakText = (rawText: string) => {
    const text = rawText.replace(/\s+/g, " ").slice(0, 900);
    speechAudioRef.current?.pause();
    speechAudioRef.current = playElevenLabsVoice({
      onBlocked: (message) => {
        setNotice(message);
      },
      onEnded: () => setIsSpeaking(false),
      onStarted: () => {
        setNotice("");
        setIsSpeaking(true);
      },
      text,
      voiceId: selectedVoiceId,
    });
  };

  const handleBubblePointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (!position) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      moved: false,
      pointerX: event.clientX,
      pointerY: event.clientY,
      startX: position.x,
      startY: position.y,
    };
  };

  const handleBubblePointerMove = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const drag = dragRef.current;
    if (!drag) return;

    const dx = event.clientX - drag.pointerX;
    const dy = event.clientY - drag.pointerY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;

    setPosition(
      clampPosition(
        { x: drag.startX + dx, y: drag.startY + dy },
        viewport.width,
        viewport.height,
      ),
    );
  };

  const handleBubblePointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;

    if (!drag) return;
    if (!drag.moved) {
      setIsOpen((current) => !current);
      return;
    }

    if (position) {
      window.localStorage.setItem(
        "naia_floating_position",
        JSON.stringify(position),
      );
    }
  };

  if (!position) return null;

  return (
    <>
      {isOpen ? (
        <section
          className="fixed z-[70] overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 text-slate-950 shadow-2xl shadow-slate-950/18 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
          style={panelStyle}
          aria-label="Assistant NAIA"
        >
          <div className="flex items-center justify-between gap-3">
            <div
              className="flex items-center gap-2 text-sm font-semibold"
              style={{ color: "var(--maison-text-primary)" }}
            >
              <MessageCircle
                className="h-4 w-4"
                style={{ color: "var(--maison-brass)" }}
                aria-hidden="true"
              />
              NAIA
            </div>
            <button
              aria-label="Fermer NAIA"
              className="flex h-9 w-9 items-center justify-center rounded-md border text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 dark:text-slate-200 dark:hover:bg-slate-900"
              style={{
                borderColor: "var(--maison-border)",
              }}
              onClick={() => setIsOpen(false)}
              type="button"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <form
            className="mt-3"
            onSubmit={(event) => {
              event.preventDefault();
              primeVoicePlayback();
              void runCommand(command, { speak: true });
            }}
          >
            <label className="sr-only" htmlFor="naia-command">
              Commande NAIA
            </label>
            <textarea
              autoFocus
              className="min-h-28 w-full resize-none rounded-md border px-3 py-3 text-sm leading-6 outline-none transition"
              style={{
                borderColor: "var(--maison-border)",
                background: "var(--maison-page)",
                color: "var(--maison-text-primary)",
              }}
              id="naia-command"
              onChange={(event) => setCommand(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  primeVoicePlayback();
                  void runCommand(command, { speak: true });
                }
              }}
              placeholder="Demande à NAIA..."
              value={command}
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
                style={{
                  borderColor: "var(--maison-border)",
                  background: "var(--maison-card)",
                  color: "var(--maison-text-primary)",
                }}
                disabled={isListening || isRunning}
                onClick={startVoiceControl}
                type="button"
              >
                {isListening ? (
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Mic className="h-4 w-4" aria-hidden="true" />
                )}
                {isListening ? "J'écoute" : "Parler"}
              </button>
              <button
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
                style={{
                  background: "var(--maison-brass)",
                  color: "var(--maison-brass-text)",
                }}
                disabled={isRunning || !command.trim()}
                type="submit"
              >
                {isRunning ? (
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Send className="h-4 w-4" aria-hidden="true" />
                )}
                Lancer
              </button>
            </div>
          </form>

          {activityMessage ? (
            <p
              className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
              aria-live="polite"
            >
              {activityMessage}
            </p>
          ) : null}

          {transcript && transcript !== command ? (
            <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              {transcript}
            </p>
          ) : null}

          {result ? (
            <section className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-950 dark:text-slate-50">
                  {result.agent.name}
                </p>
                <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-1 text-xs font-semibold text-cyan-800 dark:border-slate-700 dark:bg-slate-950 dark:text-cyan-100">
                  {Math.round(result.confidence * 100)}%
                </span>
              </div>
              <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-700 dark:text-slate-200">
                {result.response}
              </p>
              {result.actions.length ? (
                <div className="mt-3 grid gap-2">
                  {result.actions.map((action) => (
                    <ActionCard
                      action={action}
                      disabled={isApplyingAction}
                      key={action.id}
                      onApply={(leadInput) =>
                        void executeAction(action, leadInput)
                      }
                    />
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {notice ? (
            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900 dark:border-amber-300/25 dark:bg-amber-300/10 dark:text-amber-100">
              {notice}
            </p>
          ) : null}
        </section>
      ) : null}

      <button
        aria-label={isOpen ? "Fermer NAIA" : "Ouvrir NAIA"}
        className="fixed z-[80] flex cursor-grab touch-none items-center justify-center rounded-full border shadow-2xl transition hover:scale-105 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2"
        style={{
          background: "var(--maison-brass)",
          color: "var(--maison-brass-text)",
          borderColor: "var(--maison-border)",
          height: BUBBLE_SIZE,
          left: position.x,
          top: position.y,
          width: BUBBLE_SIZE,
        }}
        onPointerDown={handleBubblePointerDown}
        onPointerMove={handleBubblePointerMove}
        onPointerUp={handleBubblePointerUp}
        type="button"
      >
        {isOpen ? (
          <X className="h-6 w-6" aria-hidden="true" />
        ) : (
          <MessageCircle className="h-6 w-6" aria-hidden="true" />
        )}
      </button>
    </>
  );
}

function ActionCard({
  action,
  disabled,
  onApply,
}: {
  action: SignedNaiaAction;
  disabled?: boolean;
  onApply: (leadInput?: Partial<CrmLeadDraft>) => void;
}) {
  if (action.kind === "crm.createLead") {
    return (
      <LeadDraftActionCard
        action={action}
        disabled={disabled}
        onApply={onApply}
      />
    );
  }

  return (
    <article className="rounded-md border border-emerald-300/45 bg-emerald-50 p-3 dark:border-emerald-300/25 dark:bg-emerald-300/10">
      <div className="flex items-start gap-3">
        <CheckCircle2
          className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-200"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-emerald-950 dark:text-slate-50">
            {action.label}
          </h3>
          <p className="mt-1 text-sm leading-5 text-emerald-800 dark:text-emerald-50/82">
            {action.description}
          </p>
          {action.kind === "calendar.createReminder" && (
            <div className="mt-3 grid gap-1 rounded-md border border-emerald-200 bg-white/75 p-3 text-sm text-emerald-950 dark:border-emerald-200/20 dark:bg-slate-950/60 dark:text-emerald-50">
              <span>
                <strong>Rappel:</strong> {action.payload.title}
              </span>
              <span>
                <strong>Date:</strong>{" "}
                {action.payload.scheduledAt ?? "À préciser"}
              </span>
              <span>
                <strong>Fuseau:</strong> {action.payload.timeZone}
              </span>
              {action.payload.timeWasInferred && (
                <span className="text-amber-700 dark:text-amber-200">
                  Heure inférée, à vérifier
                </span>
              )}
            </div>
          )}
          <button
            className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md bg-emerald-500 px-3 text-sm font-semibold text-slate-50 transition hover:bg-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-emerald-300 dark:text-emerald-950 dark:hover:bg-emerald-200"
            disabled={disabled}
            onClick={() => onApply()}
            type="button"
          >
            {disabled ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            )}
            Valider action
          </button>
        </div>
      </div>
    </article>
  );
}

function LeadDraftActionCard({
  action,
  disabled,
  onApply,
}: {
  action: Extract<SignedNaiaAction, { kind: "crm.createLead" }>;
  disabled?: boolean;
  onApply: (leadInput?: Partial<CrmLeadDraft>) => void;
}) {
  const [draft, setDraft] = useState<CrmLeadDraft>(action.payload);

  const updateDraft = (updates: Partial<CrmLeadDraft>) => {
    setDraft((current) => ({ ...current, ...updates }));
  };

  return (
    <article className="rounded-md border border-emerald-300/45 bg-emerald-50 p-3 dark:border-emerald-300/25 dark:bg-emerald-300/10">
      <div className="flex items-start gap-3">
        <CheckCircle2
          className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-200"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-emerald-950 dark:text-slate-50">
            {action.label}
          </h3>
          <p className="mt-1 text-sm leading-5 text-emerald-800 dark:text-emerald-50/82">
            {action.description}
          </p>

          <div className="mt-3 grid gap-3">
            <LeadField
              label="Projet"
              onChange={(value) => updateDraft({ topic: value })}
              required
              value={draft.topic}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <LeadField
                label="Entreprise"
                onChange={(value) => updateDraft({ companyName: value })}
                value={draft.companyName ?? ""}
              />
              <LeadField
                label="Contact"
                onChange={(value) => updateDraft({ contactName: value })}
                value={draft.contactName ?? ""}
              />
              <LeadField
                label="Fonction / poste"
                onChange={(value) => updateDraft({ contactJobTitle: value })}
                value={draft.contactJobTitle ?? ""}
              />
              <LeadField
                label="Email"
                onChange={(value) => updateDraft({ contactEmail: value })}
                value={draft.contactEmail ?? ""}
              />
              <LeadField
                label="Téléphone"
                onChange={(value) => updateDraft({ contactPhone: value })}
                value={draft.contactPhone ?? ""}
              />
              <LeadField
                label="LinkedIn"
                onChange={(value) => updateDraft({ contactLinkedinUrl: value })}
                value={draft.contactLinkedinUrl ?? ""}
              />
              <LeadField
                label="Source"
                onChange={(value) => updateDraft({ source: value })}
                value={draft.source ?? ""}
              />
              <LeadField
                label="Date planifiée"
                onChange={(value) => updateDraft({ leadDate: value })}
                value={draft.leadDate ?? ""}
              />
            </div>
            <LeadField
              label="Action suivante"
              onChange={(value) => updateDraft({ nextAction: value })}
              value={draft.nextAction ?? ""}
            />
            <label className="block text-xs font-semibold text-emerald-900 dark:text-emerald-50">
              Statut initial
              <select
                className={emeraldFieldClassName}
                onChange={(event) =>
                  updateDraft({ status: event.target.value })
                }
                value={draft.status}
              >
                {crmLeadStatuses.map((status) => (
                  <option key={status} value={status}>
                    {crmStatusLabels[status] ?? status}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-semibold text-emerald-900 dark:text-emerald-50">
              Notes & contexte
              <textarea
                className="mt-1 min-h-20 w-full resize-none rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm leading-5 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-950/78 dark:text-slate-50 dark:placeholder:text-slate-500 dark:focus:border-emerald-200"
                onChange={(event) => updateDraft({ notes: event.target.value })}
                value={draft.notes ?? ""}
              />
            </label>
          </div>

          <button
            className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md bg-emerald-500 px-3 text-sm font-semibold text-slate-50 transition hover:bg-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-emerald-300 dark:text-emerald-950 dark:hover:bg-emerald-200"
            disabled={disabled || !draft.topic.trim()}
            onClick={() => onApply(draft)}
            type="button"
          >
            {disabled ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            )}
            Valider et créer le lead
          </button>
        </div>
      </div>
    </article>
  );
}

function LeadField({
  label,
  onChange,
  required,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  required?: boolean;
  value: string;
}) {
  return (
    <label className="block text-xs font-semibold text-emerald-900 dark:text-emerald-50">
      {label}
      {required ? " *" : ""}
      <input
        className={emeraldFieldClassName}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}

function pickDefaultVoice(payload: VoiceCatalog) {
  return payload.configuredVoiceId || undefined;
}

function getAudioFileName(contentType: string) {
  if (contentType.includes("mp4")) return "naia-command.mp4";
  if (contentType.includes("mpeg")) return "naia-command.mp3";
  if (contentType.includes("ogg")) return "naia-command.ogg";
  if (contentType.includes("wav")) return "naia-command.wav";
  return "naia-command.webm";
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

function readStoredPosition() {
  try {
    const stored = window.localStorage.getItem("naia_floating_position");
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<FloatingPosition>;
    if (typeof parsed.x !== "number" || typeof parsed.y !== "number") {
      return null;
    }
    return clampPosition(
      parsed as FloatingPosition,
      window.innerWidth,
      window.innerHeight,
    );
  } catch {
    return null;
  }
}

function getDefaultPosition(width: number, height: number) {
  return clampPosition({ x: width - 86, y: height - 86 }, width, height);
}

function clampPosition(
  position: FloatingPosition,
  width: number,
  height: number,
) {
  return {
    x: clamp(position.x, 16, width - BUBBLE_SIZE - 28),
    y: clamp(position.y, 16, height - BUBBLE_SIZE - 28),
  };
}

function clamp(value: number, min: number, max: number) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}
