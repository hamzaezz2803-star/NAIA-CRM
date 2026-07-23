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

// ── NAIA theme tokens ──────────────────────────────────────────────────────────
const T = {
  bg: "#EAE3D3", // page background
  card: "#F5F0E4", // card surface
  cardAlt: "#FBF7EC", // input / lighter card
  border: "rgba(62,49,32,.16)",
  borderLight: "rgba(62,49,32,.10)",
  text: "#3A2E1E", // primary text
  textMid: "#4A3B26", // secondary text
  textSub: "#6E5F49", // sub text
  textMuted: "#8A7A5F", // muted / placeholder
  textFaint: "#A2937A", // faint / mono labels
  accent: "#DE5B2B", // terracotta accent
  brass: "#A87A1E", // brass / amber
  dark: "#2E2417", // dark button bg
  light: "#F4EFE3", // light button text
  green: "#5C7A3B", // live status
  MONO: "ui-monospace,'SF Mono',Menlo,monospace",
} as const;

const BUBBLE_SIZE = 48;
const PANEL_WIDTH = 440;
const PANEL_HEIGHT = 640;

const crmStatusLabels: Record<string, string> = {
  contacted: "Contact\u00e9",
  "dead-end": "Dead end",
  "lead-to-contact": "\u00c0 contacter",
  "meeting-booked": "Meeting fix\u00e9",
  "proposal-sent": "Propale envoy\u00e9e",
  "to-follow-up": "\u00c0 relancer",
  won: "Gagn\u00e9",
};

// ── CSS injected once ─────────────────────────────────────────────────────────
const PANEL_CSS = `
  @keyframes naiaFaIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
  .naia-fa-panel{animation:naiaFaIn .25s cubic-bezier(.16,1,.3,1)}
  .naia-fa-input{
    width:100%;background:${T.cardAlt};border:1px solid ${T.border};
    border-radius:8px;padding:10px 12px;font-size:13px;color:${T.text};
    outline:none;resize:none;transition:border-color .15s,box-shadow .15s;
    font-family:inherit;line-height:1.55;
  }
  .naia-fa-input:focus{border-color:${T.accent};box-shadow:0 0 0 3px rgba(222,91,43,.10);}
  .naia-fa-input::placeholder{color:${T.textMuted};}
  .naia-fa-btn-parler{
    flex:1;display:inline-flex;align-items:center;justify-content:center;gap:7px;
    min-height:38px;border:1px solid ${T.border};background:${T.card};
    color:${T.textMid};border-radius:8px;font-size:12.5px;font-weight:600;
    cursor:pointer;transition:background .15s,border-color .15s,color .15s;font-family:inherit;
  }
  .naia-fa-btn-parler:hover{border-color:${T.accent};color:${T.accent};background:${T.cardAlt};}
  .naia-fa-btn-parler:disabled{opacity:.55;cursor:not-allowed;}
  .naia-fa-btn-send{
    flex:1;display:inline-flex;align-items:center;justify-content:center;gap:7px;
    min-height:38px;background:${T.dark};color:${T.light};
    border:none;border-radius:8px;font-size:12.5px;font-weight:600;
    cursor:pointer;transition:background .15s;font-family:inherit;
  }
  .naia-fa-btn-send:hover{background:${T.accent};}
  .naia-fa-btn-send:disabled{opacity:.5;cursor:not-allowed;}
  .naia-fa-label{display:block;font-size:11px;font-weight:600;color:${T.textMid};margin-bottom:3px;}
  .naia-fa-field{
    width:100%;min-height:30px;background:${T.cardAlt};border:1px solid ${T.border};
    border-radius:6px;padding:4px 9px;font-size:12px;color:${T.text};outline:none;
    transition:border-color .15s,box-shadow .15s;font-family:inherit;
  }
  .naia-fa-field:focus{border-color:${T.accent};box-shadow:0 0 0 3px rgba(222,91,43,.10);}
  .naia-fa-validate-btn{
    margin-top:10px;display:inline-flex;align-items:center;gap:6px;
    background:${T.dark};color:${T.light};border:none;border-radius:99px;
    padding:7px 16px;font-size:12px;font-weight:600;cursor:pointer;
    font-family:inherit;transition:background .15s;
  }
  .naia-fa-validate-btn:hover{background:${T.accent};}
  .naia-fa-validate-btn:disabled{opacity:.55;cursor:not-allowed;}
  .naia-fa-close-btn{
    display:flex;align-items:center;justify-content:center;
    width:30px;height:30px;border-radius:6px;border:1px solid ${T.borderLight};
    background:none;color:${T.textSub};cursor:pointer;transition:background .15s,color .15s;
  }
  .naia-fa-close-btn:hover{background:rgba(222,91,43,.08);color:${T.accent};border-color:${T.accent};}
`;

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
  // Ref to scroll result into view after voice command
  const resultRef = useRef<HTMLDivElement | null>(null);

  const canRecordAudio =
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof MediaRecorder !== "undefined";

  const activityMessage = isListening
    ? "\u00c9coute en cours\u2026"
    : isRunning
      ? "NAIA pr\u00e9pare la r\u00e9ponse\u2026"
      : isSpeaking
        ? "Lecture audio en cours\u2026"
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

  // Auto-scroll result into view when it appears
  useEffect(() => {
    if (result && resultRef.current) {
      setTimeout(() => {
        resultRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      }, 100);
    }
  }, [result]);

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

      const successMessage = payload.message ?? "Action appliqu\u00e9e.";
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

      setNotice(
        "Aucune phrase d\u00e9tect\u00e9e. Relance Parler quand tu es pr\u00eat.",
      );
    };
    recognitionRef.current = recognition;
    setNotice("Je t'\u00e9coute.");
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
          setNotice("Aucun audio d\u00e9tect\u00e9.");
          return;
        }

        setTranscript("Transcription NAIA en cours\u2026");
        void transcribeAudioCommand(audio);
      };
      setTranscript("Je t'\u00e9coute. Termine ta phrase naturellement.");
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
        onSpeechStart: () => setTranscript("Je t'\u00e9coute."),
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
      setNotice("Microphone indisponible ou permission refus\u00e9e.");
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
            "Groq Whisper n'est pas configur\u00e9. J'active la voix navigateur.",
          );
          startBrowserSpeechControl();
          return;
        }

        throw new Error(payload.message ?? "Transcription failed");
      }

      setCommand(text);
      setTranscript(text);
      // Run command and speak — result will auto-scroll into view via useEffect
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
      <style>{PANEL_CSS}</style>

      {isOpen ? (
        <section
          className="naia-fa-panel"
          style={{
            position: "fixed",
            zIndex: 70,
            overflowY: "auto",
            borderRadius: 14,
            border: `1px solid ${T.border}`,
            background: T.bg,
            boxShadow:
              "0 24px 48px rgba(46,36,23,.22), 0 4px 12px rgba(46,36,23,.10)",
            padding: "14px 16px",
            fontFamily: "'Helvetica Neue',Helvetica,Arial,sans-serif",
            color: T.text,
            WebkitFontSmoothing: "antialiased",
            ...panelStyle,
          }}
          aria-label="Assistant NAIA"
        >
          {/* ── Header ── */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              marginBottom: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <MessageCircle
                style={{ width: 16, height: 16, color: T.brass, flexShrink: 0 }}
                aria-hidden="true"
              />
              <span
                style={{
                  fontFamily: T.MONO,
                  fontSize: 10,
                  letterSpacing: ".18em",
                  textTransform: "uppercase",
                  fontWeight: 600,
                  color: T.textFaint,
                }}
              >
                NAIA
              </span>
            </div>
            <button
              aria-label="Fermer NAIA"
              className="naia-fa-close-btn"
              onClick={() => setIsOpen(false)}
              type="button"
            >
              <X style={{ width: 14, height: 14 }} aria-hidden="true" />
            </button>
          </div>

          {/* Thin separator */}
          <div style={{ height: 1, background: T.border, marginBottom: 12 }} />

          {/* ── Command form ── */}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              primeVoicePlayback();
              void runCommand(command, { speak: true });
            }}
          >
            <label
              style={{
                display: "block",
                fontSize: 10.5,
                fontWeight: 600,
                color: T.textSub,
                marginBottom: 6,
                letterSpacing: ".04em",
              }}
              htmlFor="naia-fa-command"
            >
              Commande
            </label>
            <textarea
              autoFocus
              className="naia-fa-input"
              style={{ minHeight: 90 }}
              id="naia-fa-command"
              onChange={(event) => setCommand(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  primeVoicePlayback();
                  void runCommand(command, { speak: true });
                }
              }}
              placeholder="Exécute une commande vocale ou texte…"
              value={command}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button
                className="naia-fa-btn-parler"
                disabled={isListening || isRunning}
                onClick={startVoiceControl}
                type="button"
              >
                {isListening ? (
                  <Loader2
                    style={{ width: 15, height: 15 }}
                    className="animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Mic style={{ width: 15, height: 15 }} aria-hidden="true" />
                )}
                {isListening ? "J'\u00e9coute\u2026" : "Parler"}
              </button>
              <button
                className="naia-fa-btn-send"
                disabled={isRunning || !command.trim()}
                type="submit"
              >
                {isRunning ? (
                  <Loader2
                    style={{ width: 15, height: 15 }}
                    className="animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Send style={{ width: 15, height: 15 }} aria-hidden="true" />
                )}
                Lancer
              </button>
            </div>
          </form>

          {/* ── Activity indicator ── */}
          {activityMessage ? (
            <div
              style={{
                marginTop: 10,
                padding: "7px 11px",
                background: "rgba(168,122,30,.08)",
                border: `1px solid rgba(168,122,30,.22)`,
                borderRadius: 8,
                fontSize: 11.5,
                color: T.brass,
                fontWeight: 500,
              }}
              aria-live="polite"
            >
              {activityMessage}
            </div>
          ) : null}

          {/* ── Transcript pill (when listening) ── */}
          {transcript && transcript !== command ? (
            <div
              style={{
                marginTop: 8,
                padding: "6px 11px",
                background: T.cardAlt,
                border: `1px solid ${T.borderLight}`,
                borderRadius: 8,
                fontSize: 11.5,
                color: T.textSub,
                lineHeight: 1.5,
                fontStyle: "italic",
              }}
            >
              {transcript}
            </div>
          ) : null}

          {/* ── Notice / error ── */}
          {notice ? (
            <div
              style={{
                marginTop: 10,
                padding: "7px 11px",
                background: "rgba(222,91,43,.06)",
                border: `1px solid rgba(222,91,43,.20)`,
                borderRadius: 8,
                fontSize: 11.5,
                color: T.accent,
                lineHeight: 1.5,
              }}
            >
              {notice}
            </div>
          ) : null}

          {/* ── Result: agent response + action cards ── */}
          {result ? (
            <div
              ref={resultRef}
              style={{
                marginTop: 12,
                borderRadius: 10,
                border: `1px solid ${T.border}`,
                background: T.card,
                overflow: "hidden",
                animation: "naiaFaIn .3s ease",
              }}
            >
              {/* Agent header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 12px 8px",
                  borderBottom:
                    result.response || result.actions.length
                      ? `1px solid ${T.borderLight}`
                      : "none",
                }}
              >
                <span
                  style={{
                    fontSize: 12.5,
                    fontWeight: 700,
                    color: T.text,
                  }}
                >
                  {result.agent.name}
                </span>
                <span
                  style={{
                    fontFamily: T.MONO,
                    fontSize: 9,
                    letterSpacing: ".13em",
                    border: `1px solid rgba(168,122,30,.45)`,
                    color: T.brass,
                    borderRadius: 99,
                    padding: "2px 8px",
                    textTransform: "uppercase",
                  }}
                >
                  {Math.round(result.confidence * 100)}%
                </span>
              </div>

              {/* NAIA response */}
              {result.response ? (
                <p
                  style={{
                    padding: "10px 12px",
                    fontSize: 12.5,
                    lineHeight: 1.6,
                    color: T.textMid,
                    margin: 0,
                    whiteSpace: "pre-line",
                    borderBottom: result.actions.length
                      ? `1px solid ${T.borderLight}`
                      : "none",
                  }}
                >
                  {result.response}
                </p>
              ) : null}

              {/* Action cards */}
              {result.actions.length ? (
                <div style={{ padding: "10px 12px", display: "grid", gap: 8 }}>
                  <div
                    style={{
                      fontFamily: T.MONO,
                      fontSize: 9,
                      letterSpacing: ".18em",
                      textTransform: "uppercase",
                      color: T.textFaint,
                      marginBottom: 4,
                    }}
                  >
                    Validation requise
                  </div>
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
            </div>
          ) : null}

          {/* Disclaimer */}
          <div
            style={{
              marginTop: 10,
              fontSize: 9.5,
              color: T.textFaint,
              lineHeight: 1.5,
              textAlign: "center",
            }}
          >
            NAIA prépare — vous validez. Aucune action sans accord.
          </div>
        </section>
      ) : null}

      {/* ── Floating orb bubble ── */}
      <button
        aria-label={isOpen ? "Fermer NAIA" : "Ouvrir NAIA"}
        style={{
          position: "fixed",
          zIndex: 80,
          display: "flex",
          cursor: "grab",
          touchAction: "none",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "50%",
          border: `1px solid rgba(255, 255, 255, 0.35)`,
          boxShadow:
            "0 8px 24px rgba(176, 141, 79, 0.40), 0 2px 6px rgba(0, 0, 0, 0.12)",
          background: "linear-gradient(135deg, #c69243 0%, #b08d4f 100%)",
          color: "#FFFFFF",
          height: BUBBLE_SIZE,
          left: position.x,
          top: position.y,
          width: BUBBLE_SIZE,
          transition: "transform .18s, box-shadow .18s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "scale(1.08)";
          e.currentTarget.style.boxShadow =
            "0 10px 28px rgba(176, 141, 79, 0.55)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "scale(1)";
          e.currentTarget.style.boxShadow =
            "0 8px 24px rgba(176, 141, 79, 0.40)";
        }}
        onPointerDown={handleBubblePointerDown}
        onPointerMove={handleBubblePointerMove}
        onPointerUp={handleBubblePointerUp}
        type="button"
      >
        {isOpen ? (
          <X style={{ width: 22, height: 22 }} aria-hidden="true" />
        ) : (
          <MessageCircle style={{ width: 22, height: 22 }} aria-hidden="true" />
        )}
      </button>
    </>
  );
}

// ── ActionCard ─────────────────────────────────────────────────────────────────

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
    <article
      style={{
        background: T.cardAlt,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        padding: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <CheckCircle2
          style={{
            width: 14,
            height: 14,
            color: T.accent,
            flexShrink: 0,
            marginTop: 2,
          }}
          aria-hidden="true"
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3
            style={{
              fontSize: 12.5,
              fontWeight: 700,
              color: T.text,
              margin: 0,
            }}
          >
            {action.label}
          </h3>
          <p
            style={{
              fontSize: 11.5,
              color: T.textSub,
              lineHeight: 1.5,
              marginTop: 3,
            }}
          >
            {action.description}
          </p>
          {action.kind === "calendar.createReminder" && (
            <div
              style={{
                marginTop: 8,
                padding: "8px 10px",
                background: T.card,
                border: `1px solid ${T.borderLight}`,
                borderRadius: 6,
                fontSize: 11.5,
                color: T.textMid,
                display: "grid",
                gap: 3,
              }}
            >
              <span>
                <strong>Rappel:</strong> {action.payload.title}
              </span>
              <span>
                <strong>Date:</strong>{" "}
                {action.payload.scheduledAt ?? "\u00c0 pr\u00e9ciser"}
              </span>
              <span>
                <strong>Fuseau:</strong> {action.payload.timeZone}
              </span>
              {action.payload.timeWasInferred && (
                <span style={{ color: T.brass }}>
                  Heure inférée, à vérifier
                </span>
              )}
            </div>
          )}
          <button
            className="naia-fa-validate-btn"
            disabled={disabled}
            onClick={() => onApply()}
            type="button"
          >
            {disabled ? (
              <Loader2
                style={{ width: 13, height: 13 }}
                className="animate-spin"
                aria-hidden="true"
              />
            ) : (
              <ShieldCheck
                style={{ width: 13, height: 13 }}
                aria-hidden="true"
              />
            )}
            Valider action
          </button>
        </div>
      </div>
    </article>
  );
}

// ── LeadDraftActionCard ────────────────────────────────────────────────────────

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
    <article
      style={{
        background: T.cardAlt,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        padding: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <CheckCircle2
          style={{
            width: 14,
            height: 14,
            color: T.accent,
            flexShrink: 0,
            marginTop: 2,
          }}
          aria-hidden="true"
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3
            style={{
              fontSize: 12.5,
              fontWeight: 700,
              color: T.text,
              margin: 0,
            }}
          >
            {action.label}
          </h3>
          <p
            style={{
              fontSize: 11.5,
              color: T.textSub,
              lineHeight: 1.5,
              marginTop: 3,
            }}
          >
            {action.description}
          </p>

          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            <LeadField
              label="Projet"
              onChange={(value) => updateDraft({ topic: value })}
              required
              value={draft.topic}
            />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
              }}
            >
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
            <label className="naia-fa-label">
              Statut initial
              <select
                className="naia-fa-field"
                style={{ marginTop: 3 }}
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
            <label className="naia-fa-label">
              Notes &amp; contexte
              <textarea
                className="naia-fa-field"
                style={{ marginTop: 3, minHeight: 56, resize: "none" }}
                onChange={(event) => updateDraft({ notes: event.target.value })}
                value={draft.notes ?? ""}
              />
            </label>
          </div>

          <button
            className="naia-fa-validate-btn"
            disabled={disabled || !draft.topic.trim()}
            onClick={() => onApply(draft)}
            type="button"
          >
            {disabled ? (
              <Loader2
                style={{ width: 13, height: 13 }}
                className="animate-spin"
                aria-hidden="true"
              />
            ) : (
              <ShieldCheck
                style={{ width: 13, height: 13 }}
                aria-hidden="true"
              />
            )}
            Valider et créer le lead
          </button>
        </div>
      </div>
    </article>
  );
}

// ── LeadField ──────────────────────────────────────────────────────────────────

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
    <label className="naia-fa-label">
      {label}
      {required ? " *" : ""}
      <input
        className="naia-fa-field"
        style={{ marginTop: 3 }}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

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
