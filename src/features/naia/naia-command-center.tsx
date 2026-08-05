/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";

import {
  getNaiaAgent,
  naiaAgents,
  type NaiaAgent,
  type NaiaAgentId,
} from "./agents";
import type { NaiaActionDraft, NaiaOrchestrationResult } from "./orchestrator";

import {
  createVoiceSilenceDetector,
  playElevenLabsVoice,
  primeVoicePlayback,
  VOICE_RECORDING_MAX_MS,
  type VoicePlaybackHandle,
} from "./voice-client";
import { buildFirstClickHandler, shouldTriggerGreeting } from "./greeting";
import { crmLeadStatuses, type CrmLeadDraft } from "@/features/crm/contracts";

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
  description: string;
  labels: {
    accent: string;
    age: string;
    gender: string;
    language: string;
  };
  name: string;
  previewUrl: string;
  voiceId: string;
};

type VoiceCatalog = {
  activeVoice?: VoiceOption;
  configuredVoiceId?: string;
  mode: string;
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

const commandExamples = [
  "Salma, passe Atlas en meeting booked et pr\u00e9pare le pitch",
  "Nora, pr\u00e9vois le cash sur 90 jours et priorise les relances",
  "Ilyas, liste les projets avec risque de retard ce trimestre",
  "Rayan, pr\u00e9pare une spec pour ajouter une nouvelle feature CRM",
];

const crmStatusLabels: Record<string, string> = {
  contacted: "Contact\u00e9",
  "dead-end": "Dead end",
  "lead-to-contact": "\u00c0 contacter",
  "meeting-booked": "Meeting fix\u00e9",
  "proposal-sent": "Propale envoy\u00e9e",
  "to-follow-up": "\u00c0 relancer",
  won: "Gagn\u00e9",
};

export function NaiaCommandCenter() {
  const router = useRouter();
  const [command, setCommand] = useState(commandExamples[0]);
  const [result, setResult] = useState<ApiResult | null>(null);
  const conversationRef = useRef<ConversationMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const isSpeakingRef = useRef(false);
  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);
  const [isApplyingAction, setIsApplyingAction] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [notice, setNotice] = useState("");
  const [voiceCatalog, setVoiceCatalog] = useState<VoiceCatalog | null>(null);
  const [selectedVoiceId, setSelectedVoiceId] = useState("");
  const [forceBrowserSpeech, setForceBrowserSpeech] = useState(false);
  const [userName, setUserName] = useState("");
  const [isProfileLoaded, setIsProfileLoaded] = useState(false);
  const welcomeTriggeredRef = useRef(false);
  // True once the greeting audio has actually started playing (avoids replay on first click)
  const greetingPlayedRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const speechAudioRef = useRef<VoicePlaybackHandle | null>(null);
  const browserFinalTranscriptRef = useRef("");
  const silenceDetectorRef = useRef<{ stop: () => void } | null>(null);
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const audioChunksRef = useRef<Blob[]>([]);

  // â”€â”€â”€ New UI state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [screen, setScreen] = useState<"home" | "cockpit">("home");
  const [selectedRailId, setSelectedRailId] = useState<NaiaAgentId>("naia");
  const [hoveredAgentId, setHoveredAgentId] = useState<NaiaAgentId | null>(
    null,
  );
  const [ringPhase, setRingPhase] = useState(0);
  const ringRafRef = useRef<number | undefined>(undefined);
  const ringLastTRef = useRef(0);
  const heroRef = useRef<HTMLDivElement>(null);

  const selectedVoice =
    voiceCatalog?.voices.find((voice) => voice.voiceId === selectedVoiceId) ??
    voiceCatalog?.activeVoice;

  const canRecordAudio =
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof MediaRecorder !== "undefined";

  useEffect(() => {
    return () => {
      if (recordingTimeoutRef.current) {
        clearTimeout(recordingTimeoutRef.current);
        recordingTimeoutRef.current = null;
      }

      silenceDetectorRef.current?.stop();
      silenceDetectorRef.current = null;

      const recorder = mediaRecorderRef.current;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        if (recorder.state !== "inactive") {
          recorder.stop();
        }
      }

      recognitionRef.current?.stop();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadVoices = async () => {
      try {
        const response = await fetch("/api/naia/voice/voices", {
          cache: "no-store",
        });
        const payload = (await response.json()) as VoiceCatalog;
        if (!isMounted) return;

        const configuredVoiceExists = payload.voices.some(
          (voice) => voice.voiceId === payload.configuredVoiceId,
        );
        const nextVoiceId =
          configuredVoiceExists && payload.configuredVoiceId
            ? payload.configuredVoiceId
            : (payload.activeVoice?.voiceId ?? "");

        setVoiceCatalog(payload);
        setSelectedVoiceId(nextVoiceId);
      } catch {
        if (isMounted) {
          setVoiceCatalog({
            mode: "unavailable",
            voices: [],
          });
        }
      }
    };

    const checkGroq = async () => {
      try {
        const response = await fetch("/api/naia/transcribe");
        if (response.ok) {
          const data = (await response.json()) as { available: boolean };
          if (isMounted && data.available === false) {
            setForceBrowserSpeech(true);
          }
        }
      } catch (err) {
        console.error("Failed to check Groq availability:", err);
      }
    };

    const checkUser = async () => {
      try {
        const response = await fetch("/api/naia/user");
        if (response.ok) {
          const data = (await response.json()) as { name: string };
          if (isMounted && data.name) {
            setUserName(data.name);
          }
        }
      } catch (err) {
        console.error("Failed to load user name:", err);
      } finally {
        // Mark profile as loaded regardless of success so the greeting
        // can fire with whatever name we have (or skip gracefully).
        if (isMounted) setIsProfileLoaded(true);
      }
    };

    void loadVoices();
    void checkGroq();
    void checkUser();

    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const q = params.get("q");
      if (isMounted && q) {
        setCommand(q);
      }
    }

    return () => {
      isMounted = false;
    };
  }, []);

  // Sync rail agent selection when orchestration produces a result
  useEffect(() => {
    if (result?.agent.id) {
      setSelectedRailId(result.agent.id as NaiaAgentId);
    }
  }, [result]);

  // Animated ring — runs only on the home screen (~30fps)
  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (screen !== "home" || prefersReducedMotion) {
      if (ringRafRef.current !== undefined)
        cancelAnimationFrame(ringRafRef.current);
      return;
    }
    const loop = (t: number) => {
      ringRafRef.current = requestAnimationFrame(loop);
      if (document.hidden) return;
      if (t - ringLastTRef.current < 33) return;
      ringLastTRef.current = t;
      setRingPhase(t / 1000);
    };
    ringRafRef.current = requestAnimationFrame(loop);
    return () => {
      if (ringRafRef.current !== undefined)
        cancelAnimationFrame(ringRafRef.current);
    };
  }, [screen]);

  const speakText = useCallback(
    (rawText: string) => {
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
          // Mark greeting as played so the first-click fallback won't replay it.
          greetingPlayedRef.current = true;
        },
        text,
        voiceId: selectedVoiceId,
      });
    },
    [selectedVoiceId],
  );

  // Jarvis welcome greeting on entry.
  // Guards:
  //   1. isProfileLoaded — profile must be fetched first so userName is real.
  //   2. userName       — must be non-empty (avoids greeting with a blank name).
  //   3. selectedVoiceId — voice config must be ready.
  useEffect(() => {
    if (
      shouldTriggerGreeting({
        alreadyTriggered: welcomeTriggeredRef.current,
        isProfileLoaded,
        userName,
        selectedVoiceId,
      })
    ) {
      welcomeTriggeredRef.current = true;
      const greetingText = `Bonjour ${userName}. Système NAIA opérationnel. Prête pour vos commandes.`;

      // Try speaking immediately (may be blocked by browser autoplay policy).
      const timer = setTimeout(() => {
        speakText(greetingText);
      }, 1000);

      // Autoplay blocker bypass: on the very first user interaction, replay
      // the greeting ONLY if it hasn't already started playing.
      const handleFirstClick = buildFirstClickHandler({
        greetingPlayedRef,
        primeVoice: () => primeVoicePlayback(),
        clearTimer: () => clearTimeout(timer),
        speak: () => speakText(greetingText),
        cleanup: () => document.removeEventListener("click", handleFirstClick),
      });

      document.addEventListener("click", handleFirstClick);

      return () => {
        clearTimeout(timer);
        document.removeEventListener("click", handleFirstClick);
      };
    }
  }, [isProfileLoaded, userName, selectedVoiceId, speakText]);

  const runCommand = async (
    nextCommand = command,
    options: { speak?: boolean } = {},
  ) => {
    const cleanCommand = nextCommand.trim();
    if (!cleanCommand) return;

    setCommand(""); // Supprime le message dans l'input
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
      if (options.speak) {
        speakText(payload.response);
      }
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
    setIsApplyingAction(true);
    setNotice("");

    try {
      const approvedCommand = result?.command ?? command;
      const response = await fetch("/api/naia/orchestrate", {
        body: JSON.stringify({
          actionId: action.id,
          approvalToken: action.approvalToken,
          command: approvedCommand,
          execute: true,
          leadInput,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as {
        error?: string;
        lead?: unknown;
        message?: string;
        success?: boolean;
      };

      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? payload.error ?? "Action failed");
      }

      const successMessage = payload.message ?? "Action appliquee.";
      if (action.kind === "crm.createLead") {
        setResult((current) =>
          current
            ? {
                ...current,
                actions: [],
                crmSnapshot: current.crmSnapshot
                  ? {
                      ...current.crmSnapshot,
                      leadCount: current.crmSnapshot.leadCount + 1,
                      openLeadCount: current.crmSnapshot.openLeadCount + 1,
                    }
                  : current.crmSnapshot,
                response: successMessage,
              }
            : current,
        );
        setNotice(successMessage);
        return;
      }

      if (action.kind === "crm.generateFollowUpDraft") {
        setNotice("Redirection vers les brouillons...");
        router.push(
          `/dashboard/leads?leadId=${action.payload.leadId}&generateDraft=true`,
        );
        return;
      }

      if (action.kind === "pitch.generateDraft") {
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
        return;
      }

      await runCommand(approvedCommand);
      setNotice(successMessage);
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
    if (canRecordAudio && !forceBrowserSpeech) {
      void startMediaRecorderControl();
      return;
    }

    startBrowserSpeechControl();
  };

  const stopVoiceControl = () => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
    }
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setIsListening(false);
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
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "fr-FR";
    browserFinalTranscriptRef.current = "";

    let silenceTimer: ReturnType<typeof setTimeout> | null = null;

    const resetSilenceTimer = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        setNotice("Silence détecté, arrêt de l'écoute...");
        recognition.stop();
      }, 3000); // 3 seconds silence threshold
    };

    recognition.onresult = (event) => {
      resetSilenceTimer();

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
      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
      setNotice(
        event.error
          ? `Voix navigateur: ${event.error}`
          : "Voix navigateur interrompue.",
      );
      setIsListening(false);
    };
    recognition.onend = () => {
      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
      const spokenText = browserFinalTranscriptRef.current.trim();
      setIsListening(false);

      if (spokenText) {
        setCommand(spokenText);
        void runCommand(spokenText, { speak: true });
        return;
      }

      setNotice("Aucune phrase detectee. Relance Parler quand tu es pret.");
    };
    recognitionRef.current = recognition;
    setNotice(
      "Je t'ecoute. NAIA transcrira automatiquement apres un silence de 3 secondes.",
    );
    setIsListening(true);
    recognition.start();
    resetSilenceTimer();
  };

  const stopSilenceDetection = () => {
    silenceDetectorRef.current?.stop();
    silenceDetectorRef.current = null;
  };

  const startMediaRecorderControl = async () => {
    if (
      typeof navigator.mediaDevices?.getUserMedia !== "function" ||
      typeof MediaRecorder === "undefined"
    ) {
      setNotice("Reconnaissance vocale indisponible dans ce navigateur.");
      return;
    }

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
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        if (recordingTimeoutRef.current) {
          clearTimeout(recordingTimeoutRef.current);
          recordingTimeoutRef.current = null;
        }
        stopSilenceDetection();

        const audio = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaRecorderRef.current = null;
        mediaStreamRef.current = null;
        setIsListening(false);

        if (!audio.size) {
          setNotice("Aucun audio detecte. Relance la commande vocale.");
          return;
        }

        setTranscript("Transcription NAIA en cours.");
        void transcribeAudioCommand(audio);
      };
      setTranscript("Je t'ecoute. Je detecterai la fin de ta phrase.");
      setNotice(
        "Parle naturellement. NAIA transcrira apres un silence prononce.",
      );
      setIsListening(true);
      recorder.start();
      silenceDetectorRef.current = createVoiceSilenceDetector({
        onSilence: () => {
          if (
            mediaRecorderRef.current === recorder &&
            recorder.state !== "inactive"
          ) {
            setNotice("Silence detecte, transcription en cours.");
            recorder.stop();
          }
        },
        onSpeechStart: () => {
          setTranscript("Je t'ecoute. Termine ta phrase naturellement.");
        },
        stream,
      });
      recordingTimeoutRef.current = setTimeout(() => {
        if (
          mediaRecorderRef.current === recorder &&
          recorder.state !== "inactive"
        ) {
          setNotice("Limite de 45 secondes atteinte, transcription en cours.");
          recorder.stop();
        }
      }, VOICE_RECORDING_MAX_MS);
    } catch {
      if (recordingTimeoutRef.current) {
        clearTimeout(recordingTimeoutRef.current);
        recordingTimeoutRef.current = null;
      }

      setIsListening(false);
      setNotice("Microphone indisponible ou permission refusee.");
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
        status?: number;
        transcript?: string;
      };
      const text = payload.transcript?.trim();

      if (!response.ok || !text) {
        if (payload.mode === "missing-groq-key") {
          setNotice(
            "Groq Whisper n'est pas configure en local. J'active la reconnaissance vocale du navigateur.",
          );
          setForceBrowserSpeech(true);
          startBrowserSpeechControl();
          return;
        }

        if (payload.mode === "groq-error") {
          setNotice(
            payload.message
              ? `Groq Whisper: ${payload.message}`
              : "Groq Whisper n'a pas accepte l'audio. Reessaie ou utilise la console texte.",
          );
          return;
        }

        throw new Error("Transcription failed");
      }

      setCommand(text);
      setTranscript(text);
      await runCommand(text, { speak: true });
    } catch {
      setNotice(
        "Transcription indisponible. Tu peux relancer la voix navigateur ou utiliser la console texte.",
      );
    }
  };

  const speakCurrentAnswer = async () => {
    primeVoicePlayback();
    speakText(result?.response ?? "NAIA est en ligne.");
  };

  const changeVoice = (voiceId: string) => setSelectedVoiceId(voiceId);

  const selectedRailAgent = getNaiaAgent(selectedRailId);

  return (
    <div
      style={{
        fontFamily: "'Helvetica Neue',Helvetica,Arial,sans-serif",
        color: "#3A2E1E",
        background: "#EAE3D3",
        minHeight: "100dvh",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <style>{`
        @keyframes naiaSpin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @keyframes naiaBreath{0%,100%{transform:scale(.985)}50%{transform:scale(1.035)}}
        @keyframes naiaGlow{0%,100%{box-shadow:0 0 0 0 rgba(222,91,43,.38)}50%{box-shadow:0 0 0 16px rgba(222,91,43,0)}}
        @keyframes naiaIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
        @keyframes naiaDot{0%,80%,100%{opacity:.25}40%{opacity:1}}
        @keyframes naiaPillAura{
          0%,100%{box-shadow:0 0 0 3px rgba(222,91,43,.08),0 10px 28px rgba(222,91,43,.16),0 3px 10px rgba(46,36,23,.10)}
          50%{box-shadow:0 0 0 7px rgba(222,91,43,.04),0 14px 36px rgba(222,91,43,.26),0 4px 14px rgba(46,36,23,.14)}
        }
        .naia-pill {
          transition: transform .32s cubic-bezier(0.16,1,0.3,1), border-color .2s ease, background-color .2s ease !important;
          will-change: transform, box-shadow !important;
        }
        .naia-pill:hover,.naia-pill:focus-visible {
          transform: scale(1.04) translateY(-2px) !important;
          border-color: #DE5B2B !important;
          background: rgba(255,255,255,0.98) !important;
          z-index: 20 !important;
          position: relative !important;
          outline:2px solid rgba(222,91,43,.25);
          outline-offset:2px;
        }
        .naia-pill .naia-pill-name {
          transition: color .2s ease !important;
        }
        .naia-pill:hover .naia-pill-name,.naia-pill:focus-visible .naia-pill-name {
          color: #DE5B2B !important;
        }
        .naia-rail-row{transition:background .15s}
        .naia-rail-row:hover{background:rgba(247,243,233,.95)!important}
        .naia-primary-btn{transition:background .2s,color .2s}
        .naia-primary-btn:hover{background:#DE5B2B!important}
        .naia-outline-btn{transition:all .15s}
        .naia-outline-btn:hover{border-color:#DE5B2B!important;color:#DE5B2B!important}
        .naia-main-voice-controls{display:none!important}
        .naia-cockpit-legacy{display:none!important}
        .naia-home-mobile-agents{display:none}
        .naia-mobile-value-chain{display:none}
        .naia-process-card{transition:transform .18s ease,border-color .18s ease,background .18s ease}
        .naia-process-card:hover{transform:translateY(-2px);border-color:#DE5B2B!important;background:#FBF7EC!important}
        .naia-ring-trigger:focus-visible{outline:2px solid #DE5B2B;outline-offset:-8px}
        ::selection{background:#DE5B2B;color:#F4EFE3}
        ::-webkit-scrollbar{width:8px;height:8px}
        ::-webkit-scrollbar-thumb{background:rgba(62,49,32,.16);border-radius:99px}
        ::-webkit-scrollbar-track{background:transparent}
        input::placeholder,textarea::placeholder{color:rgba(62,49,32,.38)}
        @media (prefers-reduced-motion: reduce) {
          .naia-pill,.naia-process-card{transition:none!important}
          .naia-pill:hover,.naia-pill:focus-visible{animation:none!important;transform:none!important}
          [class*="animate-"]{animation-duration:.01ms!important;animation-iteration-count:1!important}
        }
        .naia-form-card {
          background: #F5F0E4 !important;
          border: 1px solid rgba(62,49,32,.16) !important;
          border-radius: 10px;
          padding: 13px;
          width: 100%;
        }
        .naia-form-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 9px;
          gap: 8px;
        }
        .naia-form-badge {
          font-family: ui-monospace, 'SF Mono', Menlo, monospace;
          font-size: 8.5px;
          letter-spacing: .13em;
          color: #7A5715;
          border: 1px solid rgba(168,122,30,.45);
          padding: 2px 8px;
          border-radius: 99px;
          text-transform: uppercase;
          white-space: nowrap;
        }
        .naia-form-title {
          font-size: 12.5px;
          font-weight: 700;
          line-height: 1.4;
          color: #3A2E1E;
        }
        .naia-form-desc {
          font-size: 11.5px;
          color: #6E5F49;
          line-height: 1.55;
          margin-top: 4px;
        }
        .naia-form-label {
          display: block;
          font-size: 11px;
          font-weight: 600;
          color: #4A3B26;
          margin-bottom: 3px;
        }
        .naia-form-input, .naia-form-select, .naia-form-textarea {
          width: 100%;
          min-height: 32px;
          background: #FBF7EC !important;
          border: 1px solid rgba(62,49,32,.18) !important;
          border-radius: 7px;
          padding: 4px 10px;
          font-size: 12px;
          color: #3A2E1E !important;
          outline: none;
          transition: border-color .15s, box-shadow .15s;
        }
        .naia-form-input:focus, .naia-form-select:focus, .naia-form-textarea:focus {
          border-color: #DE5B2B !important;
          box-shadow: 0 0 0 3px rgba(222,91,43,.12);
        }
        .naia-form-checkbox {
          accent-color: #DE5B2B;
          width: 13px;
          height: 13px;
          cursor: pointer;
        }
        .naia-mobile-agent-picker {
          display: none;
        }
        @media (max-width: 767px) {
          .naia-home-shell {
            height:auto!important;
            min-height:100dvh!important;
            overflow:auto!important;
            padding:0 16px!important;
          }
          .naia-home-header {
            padding-top:16px!important;
          }
          .naia-home-orbit {
            display:none!important;
          }
          .naia-home-mobile-agents {
            display:block!important;
            flex:1;
            padding:24px 0 12px;
          }
          .naia-mobile-value-chain {
            display:grid!important;
            gap:16px;
            margin-top:34px;
          }
          .naia-home-footer {
            grid-template-columns:1fr!important;
            padding:16px 0 28px!important;
          }
          .naia-home-footer h1 {
            font-size:42px!important;
          }
          .naia-cockpit-shell {
            height: auto !important;
            min-height: 100dvh !important;
            overflow: auto !important;
          }
          .naia-cockpit-topbar {
            gap: 6px !important;
            padding: 0 10px !important;
          }
          .naia-cockpit-topbar-status {
            display: none !important;
          }
          .naia-cockpit-user {
            margin-left: auto !important;
          }
          .naia-cockpit-grid {
            grid-template-columns: minmax(0, 1fr) !important;
            overflow:auto!important;
          }
          .naia-cockpit-left {
            display: none !important;
          }
          .naia-cockpit-right.is-empty {
            display: none !important;
          }
          .naia-cockpit-right.has-pending {
            max-height: 40dvh;
            border-top: 1px solid rgba(62,49,32,.14);
            border-left: 0 !important;
          }
          .naia-cockpit-audit {
            display: none !important;
          }
          .naia-mobile-agent-picker {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-top: 8px;
          }
          .naia-mobile-agent-picker span {
            flex: 0 0 auto;
            font-family: ui-monospace, 'SF Mono', Menlo, monospace;
            font-size: 9px;
            letter-spacing: .14em;
            color: #6E5F49;
            text-transform: uppercase;
          }
          .naia-mobile-agent-picker select {
            min-width: 0;
            flex: 1;
            border: 1px solid rgba(62,49,32,.2);
            border-radius: 7px;
            background: #F5F0E4;
            color: #3A2E1E;
            padding: 7px 9px;
            font: inherit;
            font-size: 12px;
          }
          .naia-cockpit-agent-header {
            padding: 10px 12px !important;
          }
          .naia-cockpit-response {
            padding: 12px 12px 6px !important;
          }
          .naia-cockpit-input {
            padding: 8px 12px 10px !important;
          }
          .naia-cockpit-suggestions {
            flex-wrap: nowrap !important;
            overflow-x: auto;
            padding-bottom: 4px;
          }
          .naia-cockpit-suggestions button {
            flex: 0 0 auto;
          }
        }
      `}</style>

      {screen === "home" ? (
        <NaiaHomeScreen
          ringPhase={ringPhase}
          heroRef={heroRef}
          hoveredAgentId={hoveredAgentId}
          setHoveredAgentId={setHoveredAgentId}
          onEnterCockpit={() => setScreen("cockpit")}
          onOpenAssistant={() =>
            window.dispatchEvent(new Event("naia:open-assistant"))
          }
          onAgentClick={(id) => {
            const agent = getNaiaAgent(id as NaiaAgentId);
            if (agent.id === "naia") {
              window.dispatchEvent(new Event("naia:open-assistant"));
              return;
            }
            router.push(agent.route);
          }}
          voiceCatalog={voiceCatalog}
          selectedVoiceId={selectedVoiceId}
          onChangeVoice={changeVoice}
        />
      ) : (
        <NaiaCockpitScreen
          selectedRailId={selectedRailId}
          selectedRailAgent={selectedRailAgent}
          setSelectedRailId={setSelectedRailId}
          result={result}
          isRunning={isRunning}
          isListening={isListening}
          isApplyingAction={isApplyingAction}
          command={command}
          setCommand={setCommand}
          transcript={transcript}
          notice={notice}
          userName={userName}
          onGoHome={() => setScreen("home")}
          onRunCommand={(cmd) => void runCommand(cmd)}
          onStartVoice={startVoiceControl}
          onStopVoice={stopVoiceControl}
          onExecuteAction={(action, leadInput) =>
            void executeAction(action, leadInput)
          }
          voiceCatalog={voiceCatalog}
          selectedVoiceId={selectedVoiceId}
          selectedVoice={selectedVoice}
          isSpeaking={isSpeaking}
          onSpeakCurrentAnswer={speakCurrentAnswer}
          onChangeVoice={changeVoice}
        />
      )}
    </div>
  );
}

// OrbitLines and ProcessLabels replaced by NaiaHomeScreen galaxy visualization.

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
    <article className="naia-form-card">
      <div className="flex items-start gap-3">
        <CheckCircle2
          className="mt-0.5 h-4 w-4 shrink-0"
          style={{ color: "#DE5B2B" }}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <h3 className="naia-form-title">{action.label}</h3>
          <p className="naia-form-desc">{action.description}</p>
          {action.kind === "calendar.createReminder" && (
            <div className="mt-3 grid gap-1 rounded-md border border-rgba(62,49,32,.12) bg-[#FBF7EC] p-3 text-sm text-[#3A2E1E] sm:grid-cols-2">
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
                <span style={{ color: "#7A5715" }}>
                  Heure inf\u00e9r\u00e9e, \u00e0 v\u00e9rifier
                </span>
              )}
            </div>
          )}
          <button
            className="naia-primary-btn"
            disabled={disabled}
            onClick={() => onApply()}
            style={{
              marginTop: 12,
              display: "flex",
              alignItems: "center",
              gap: 8,
              font: "inherit",
              fontSize: 12,
              fontWeight: 600,
              background: "#2E2417",
              color: "#F4EFE3",
              border: "none",
              borderRadius: 99,
              padding: "7px 18px",
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.6 : 1,
            }}
            type="button"
          >
            {disabled ? (
              <Loader2
                className="h-3.5 w-3.5 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Valider action
          </button>
        </div>
      </div>
    </article>
  );
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

function LeadDraftActionCard({
  action,
  disabled,
  onApply,
}: {
  action: Extract<SignedNaiaAction, { kind: "crm.createLead" }>;
  disabled?: boolean;
  onApply: (
    leadInput?: Partial<
      CrmLeadDraft & {
        createGoogleDrive?: boolean;
        createGoogleCalendar?: boolean;
      }
    >,
  ) => void;
}) {
  const [draft, setDraft] = useState<CrmLeadDraft>(action.payload);
  const [createDrive, setCreateDrive] = useState(true);
  const [createCalendar, setCreateCalendar] = useState(
    Boolean(action.payload.leadDate),
  );
  const [calendarPreferenceTouched, setCalendarPreferenceTouched] =
    useState(false);

  useEffect(() => {
    setCreateCalendar((current) => {
      if (!draft.leadDate) return false;
      return calendarPreferenceTouched ? current : true;
    });
  }, [calendarPreferenceTouched, draft.leadDate]);

  const updateDraft = (updates: Partial<CrmLeadDraft>) => {
    setDraft((current) => ({ ...current, ...updates }));
  };

  return (
    <article
      className="naia-form-card"
      style={{
        animation: "naiaIn .3s ease",
        border: "none",
        background: "none",
        padding: 0,
      }}
    >
      <div className="flex items-start gap-3">
        <CheckCircle2
          className="mt-0.5 h-4 w-4 shrink-0"
          style={{ color: "#DE5B2B" }}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <h3 className="naia-form-title" style={{ fontSize: 13.5 }}>
            {action.label}
          </h3>
          <p className="naia-form-desc" style={{ fontSize: 12, marginTop: 2 }}>
            {action.description}
          </p>

          <div className="mt-3 grid gap-2.5">
            <LeadField
              label="Projet"
              onChange={(value) => updateDraft({ topic: value })}
              required
              value={draft.topic}
            />
            <div className="grid gap-2 sm:grid-cols-2">
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
                label={"T\u00e9l\u00e9phone"}
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
                label={"Date planifi\u00e9e"}
                onChange={(value) => updateDraft({ leadDate: value })}
                value={draft.leadDate ?? ""}
              />
            </div>
            <LeadField
              label="Action suivante"
              onChange={(value) => updateDraft({ nextAction: value })}
              value={draft.nextAction ?? ""}
            />
            <label className="naia-form-label">
              Statut initial
              <select
                className="naia-form-select"
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
            <label className="naia-form-label">
              Notes & contexte
              <textarea
                className="naia-form-textarea"
                style={{ minHeight: 52, resize: "none" }}
                onChange={(event) => updateDraft({ notes: event.target.value })}
                value={draft.notes ?? ""}
              />
            </label>

            {draft.tags && draft.tags.length > 0 && (
              <div className="mt-1">
                <span className="naia-form-label" style={{ marginBottom: 4 }}>
                  {"Tags d\u00e9tect\u00e9s"}
                </span>
                <div className="flex flex-wrap gap-1">
                  {draft.tags.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1 rounded bg-[#EAE3D3] px-2 py-0.5 text-[10px] font-bold text-[#6E5F49] border border-rgba(62,49,32,.12)"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Google Integrations Checkboxes */}
            <div className="flex flex-col gap-1.5 mt-1 border-t border-rgba(62,49,32,.12) pt-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-[#4A3B26] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={createDrive}
                  onChange={(e) => setCreateDrive(e.target.checked)}
                  className="naia-form-checkbox"
                />
                {
                  "Cr\u00e9er automatiquement un dossier Google Drive pour ce client"
                }
              </label>
              <label
                className={`flex items-center gap-2 text-xs font-semibold text-[#4A3B26] cursor-pointer select-none ${!draft.leadDate ? "opacity-50" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={createCalendar}
                  disabled={!draft.leadDate}
                  onChange={(e) => {
                    setCalendarPreferenceTouched(true);
                    setCreateCalendar(e.target.checked);
                  }}
                  className="naia-form-checkbox"
                />
                {"Planifier l'\u00e9v\u00e9nement sur Google Calendar"}{" "}
                {!draft.leadDate && "(N\u00e9cessite une date planifi\u00e9e)"}
              </label>
            </div>
          </div>

          <button
            className="naia-primary-btn"
            disabled={disabled || !draft.topic.trim()}
            onClick={() =>
              onApply({
                ...draft,
                createGoogleDrive: createDrive,
                createGoogleCalendar: createCalendar && Boolean(draft.leadDate),
              })
            }
            style={{
              marginTop: 12,
              display: "flex",
              alignItems: "center",
              gap: 8,
              font: "inherit",
              fontSize: 12,
              fontWeight: 600,
              background: "#2E2417",
              color: "#F4EFE3",
              border: "none",
              borderRadius: 99,
              padding: "7px 18px",
              cursor:
                disabled || !draft.topic.trim() ? "not-allowed" : "pointer",
              opacity: disabled || !draft.topic.trim() ? 0.6 : 1,
            }}
            type="button"
          >
            {disabled ? (
              <Loader2
                className="h-3.5 w-3.5 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {"Valider et cr\u00e9er le lead"}
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
    <label className="naia-form-label">
      {label}
      {required ? " *" : ""}
      <input
        className="naia-form-input"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}

// Panel and ActionButton replaced by inline-styled components in NaiaHomeScreen / NaiaCockpitScreen.

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// NAIA design components
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const RING_PAL = ["#DE5B2B", "#6E5A41", "#C7BFAC"] as const;

const NAIA_ORBIT_SECTORS: Array<{
  label: string;
  start: number;
  span: number;
  agentIds: NaiaAgentId[];
}> = [
  {
    label: "AVANT-VENTE",
    start: -104,
    span: 130,
    agentIds: ["leads", "crm", "meetings", "proposals"],
  },
  {
    label: "PROJECT MANAGEMENT",
    start: 26,
    span: 100,
    agentIds: ["projects", "automations", "developer"],
  },
  {
    label: "FONCTIONS SUPPORT",
    start: 126,
    span: 130,
    agentIds: ["finance", "hr", "integrations", "settings"],
  },
];

const COCKPIT_POLES: Array<{ label: string; ids: NaiaAgentId[] }> = [
  { label: "ORCHESTRATEUR", ids: ["naia"] },
  {
    label: "AVANT-VENTE",
    ids: ["leads", "crm", "meetings", "proposals"],
  },
  {
    label: "PROJECT MANAGEMENT",
    ids: ["projects", "automations", "developer"],
  },
  {
    label: "FONCTIONS SUPPORT",
    ids: ["finance", "hr", "integrations", "settings"],
  },
];

// â”€â”€â”€ Orbit computation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function computeOrbitNodes(R: number) {
  const RX = R + 66,
    RY = R + 52;
  const out: Array<
    NaiaAgent & { x: number; y: number; ang: number; pole: string }
  > = [];
  for (const s of NAIA_ORBIT_SECTORS) {
    const agents = s.agentIds
      .map((id) => naiaAgents.find((a) => a.id === id))
      .filter(Boolean) as NaiaAgent[];
    const pad = 17,
      usable = s.span - pad * 2;
    agents.forEach((agent, j) => {
      const degA =
        s.start +
        pad +
        (agents.length > 1 ? (usable * j) / (agents.length - 1) : usable / 2);
      const ang = (degA * Math.PI) / 180;
      out.push({
        ...agent,
        x: Math.round(Math.cos(ang) * RX),
        y: Math.round(Math.sin(ang) * RY),
        ang,
        pole: s.label,
      });
    });
  }
  return out;
}

// â”€â”€â”€ NaiaRing â€” animated radial SVG â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function NaiaRing({
  W,
  H,
  phase,
  speed = 36,
}: {
  W: number;
  H: number;
  phase: number;
  speed?: number;
}) {
  const TAU = Math.PI * 2;
  const cx = W / 2,
    cy = H / 2;
  const BX = W / 2 - 12,
    BY = H / 2 - 12;
  const n = Math.max(120, Math.min(230, Math.round((W + H) / 12)));
  const sw = Math.max(1.2, Math.min(W, H) * 0.0062);
  const rot = (phase * TAU) / Math.max(8, speed);
  const lines: React.ReactElement[] = [];

  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rot;
    const w1 =
      Math.sin(a * 3 + 1.1 + phase * 0.8) * 0.055 +
      Math.sin(a * 5 + 3.9 - phase * 0.5) * 0.035;
    const w2 =
      Math.sin(a * 3 + 2.7 - phase * 0.6) * 0.06 +
      Math.sin(a * 7 + 0.6 + phase * 0.9) * 0.03;
    const f1 = 0.56 + w1,
      f2 = 0.92 + w2;
    const d = (i % 2 ? 1 : -1) * (0.05 + 0.018 * Math.sin(phase * 1.3 + a * 4));
    const x1 = cx + Math.cos(a) * BX * f1;
    const y1 = cy + Math.sin(a) * BY * f1;
    const x2 = cx + Math.cos(a + d) * BX * f2;
    const y2 = cy + Math.sin(a + d) * BY * f2;
    const deg = ((a * 360) / TAU + Math.sin(a * 9.3 + i) * 7 + 360) % 360;
    let col: string = RING_PAL[0];
    if (deg >= 80 && deg < 205) col = RING_PAL[2];
    else if (deg >= 205 && deg < 318) col = RING_PAL[1];
    lines.push(
      <line
        key={i}
        x1={x1.toFixed(1)}
        y1={y1.toFixed(1)}
        x2={x2.toFixed(1)}
        y2={y2.toFixed(1)}
        stroke={col}
        strokeWidth={sw}
        strokeLinecap="round"
      />,
    );
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height="100%"
      style={{ display: "block", overflow: "visible" }}
    >
      <g>{lines}</g>
    </svg>
  );
}

// â”€â”€â”€ NaiaMiniOrb â€” 40px ring for the mic button â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function NaiaMiniOrb({ listening }: { listening: boolean }) {
  const size = 40;
  const n = 56;
  const R = size / 2;
  const TAU = Math.PI * 2;
  const lines: React.ReactElement[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const w1 = Math.sin(a * 3 + 1.1) * 0.055 + Math.sin(a * 5 + 3.9) * 0.035;
    const w2 = Math.sin(a * 3 + 2.7) * 0.06 + Math.sin(a * 7 + 0.6) * 0.03;
    const r1 = R * (0.56 + w1),
      r2 = R * (0.92 + w2);
    const d = (i % 2 ? 1 : -1) * 0.05;
    const x1 = R + Math.cos(a) * r1,
      y1 = R + Math.sin(a) * r1;
    const x2 = R + Math.cos(a + d) * r2,
      y2 = R + Math.sin(a + d) * r2;
    const deg = ((a * 360) / TAU + Math.sin(a * 9.3 + i) * 7 + 360) % 360;
    let col: string = RING_PAL[0];
    if (deg >= 80 && deg < 205) col = RING_PAL[2];
    else if (deg >= 205 && deg < 318) col = RING_PAL[1];
    lines.push(
      <line
        key={i}
        x1={x1.toFixed(1)}
        y1={y1.toFixed(1)}
        x2={x2.toFixed(1)}
        y2={y2.toFixed(1)}
        stroke={col}
        strokeWidth={Math.max(1.05, size * 0.0062)}
        strokeLinecap="round"
      />,
    );
  }
  const spd = listening ? "7s" : "36s";
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      style={{ display: "block", overflow: "visible" }}
    >
      <g
        style={{
          transformOrigin: "50% 50%",
          animation: `naiaSpin ${spd} linear infinite`,
        }}
      >
        {lines}
      </g>
    </svg>
  );
}

// â”€â”€â”€ NaiaHomeScreen â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function NaiaHomeScreen({
  ringPhase,
  heroRef,
  hoveredAgentId,
  setHoveredAgentId,
  onEnterCockpit,
  onOpenAssistant,
  onAgentClick,
  voiceCatalog,
  selectedVoiceId,
  onChangeVoice,
}: {
  ringPhase: number;
  heroRef: React.RefObject<HTMLDivElement | null>;
  hoveredAgentId: NaiaAgentId | null;
  setHoveredAgentId: (id: NaiaAgentId | null) => void;
  onEnterCockpit: () => void;
  onOpenAssistant: () => void;
  onAgentClick: (id: string) => void;
  voiceCatalog: VoiceCatalog | null;
  selectedVoiceId: string;
  onChangeVoice: (voiceId: string) => void;
}) {
  const router = useRouter();
  const [heroSize, setHeroSize] = useState({ w: 1280, h: 640 });

  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const update = () => setHeroSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [heroRef]);

  const { w: hw, h: hh } = heroSize;
  const R = Math.max(185, Math.min(hh / 2 - 132, hw / 2 - 215));
  const ringD = R * 2;
  const nodes = computeOrbitNodes(R);
  const RW = R + 122;
  const hoveredNode = hoveredAgentId
    ? nodes.find((nd) => nd.id === hoveredAgentId)
    : null;
  const sectorLabels = NAIA_ORBIT_SECTORS.map((sector) => {
    const midpoint = ((sector.start + sector.span / 2) * Math.PI) / 180;
    return {
      label: sector.label,
      x: Math.cos(midpoint) * R * 0.42,
      y: Math.sin(midpoint) * R * 0.42,
    };
  });

  // Background SVG: wedge sectors + dashed divider lines + spoke lines to agents
  const tints = [
    "rgba(62,49,32,.022)",
    "rgba(62,49,32,.055)",
    "rgba(62,49,32,.038)",
  ];
  const wedges: React.ReactElement[] = [];
  const secLines: React.ReactElement[] = [];
  NAIA_ORBIT_SECTORS.forEach((s, si) => {
    const a0 = (s.start * Math.PI) / 180;
    const a1 = ((s.start + s.span) * Math.PI) / 180;
    wedges.push(
      <path
        key={`w${si}`}
        d={`M0,0 L${(Math.cos(a0) * RW).toFixed(1)},${(Math.sin(a0) * RW).toFixed(1)} A${RW} ${RW} 0 0 1 ${(Math.cos(a1) * RW).toFixed(1)},${(Math.sin(a1) * RW).toFixed(1)} Z`}
        fill={tints[si]}
        stroke="none"
      />,
    );
    secLines.push(
      <line
        key={`sl${si}`}
        x1="0"
        y1="0"
        x2={(Math.cos(a0) * RW).toFixed(1)}
        y2={(Math.sin(a0) * RW).toFixed(1)}
        stroke="rgba(62,49,32,.28)"
        strokeWidth="1"
        strokeDasharray="2 5"
      />,
    );
  });
  const agentLines = nodes.map((nd) => (
    <line
      key={nd.id}
      x1="0"
      y1="0"
      x2={nd.x}
      y2={nd.y}
      stroke={hoveredAgentId === nd.id ? "#DE5B2B" : "rgba(62,49,32,.16)"}
      strokeWidth={hoveredAgentId === nd.id ? "1.4" : "1"}
    />
  ));

  return (
    <div
      className="naia-home-shell"
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        padding: "0 44px",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* ── Header ── */}
      <div
        className="naia-home-header"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          paddingTop: 26,
          fontSize: 11,
          color: "#4A3B26",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontWeight: 600,
              letterSpacing: ".01em",
              fontSize: 14,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/naia-os-q.png"
              alt="Q"
              style={{
                width: 16,
                height: 16,
                display: "block",
                borderRadius: "50%",
              }}
            />
            Qarizmi
          </div>
          <button
            onClick={() => router.push("/dashboard")}
            style={{
              fontFamily: "ui-monospace,'SF Mono',Menlo,monospace",
              fontSize: 10,
              fontWeight: 600,
              color: "#6E5F49",
              background: "rgba(62,49,32,.05)",
              border: "1px solid rgba(62,49,32,.12)",
              borderRadius: 99,
              padding: "4px 10px",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              transition: "all .15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#2E2417";
              e.currentTarget.style.color = "#F4EFE3";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(62,49,32,.05)";
              e.currentTarget.style.color = "#6E5F49";
            }}
          >
            {"\u2190 Dashboard"}
          </button>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
          }}
        >
          <div
            className="naia-main-voice-controls"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              alignItems: "flex-end",
            }}
          >
            <label
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "#6E5F49",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Voix de l&apos;OS
            </label>
            {voiceCatalog?.voices && voiceCatalog.voices.length > 0 ? (
              <select
                value={selectedVoiceId}
                onChange={(e) => onChangeVoice(e.target.value)}
                style={{
                  fontFamily: "inherit",
                  fontSize: 11,
                  fontWeight: 500,
                  color: "#4A3B26",
                  background: "rgba(62,49,32,.05)",
                  border: "1px solid rgba(62,49,32,.15)",
                  borderRadius: 99,
                  padding: "5px 24px 5px 12px",
                  outline: "none",
                  cursor: "pointer",
                  maxWidth: 160,
                  transition: "all .15s",
                  appearance: "none",
                  WebkitAppearance: "none",
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%238A7A5F' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "right 8px center",
                }}
              >
                {voiceCatalog.voices.map((voice) => (
                  <option
                    key={voice.voiceId}
                    value={voice.voiceId}
                    style={{ background: "#EAE3D3", color: "#3A2E1E" }}
                  >
                    {voice.name}
                  </option>
                ))}
              </select>
            ) : (
              <div style={{ fontSize: 11, color: "#6E5F49" }}>
                Chargement...
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Hero zone ── */}
      <div
        className="naia-home-orbit"
        ref={heroRef}
        style={{
          flex: 1,
          position: "relative",
          minHeight: 440,
          margin: "0 -44px",
        }}
      >
        {/* Background SVG */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <svg
            viewBox={`${-hw / 2} ${-hh / 2} ${hw} ${hh}`}
            width="100%"
            height="100%"
            style={{ display: "block", overflow: "visible" }}
          >
            <g>
              {/* Rotating background group */}
              <g transform={`rotate(${(ringPhase * 1.5) % 360})`}>
                {wedges}
                {secLines}
              </g>
              {/* Static lines connecting to agent pills */}
              {agentLines}
            </g>
          </svg>
        </div>

        <div
          aria-hidden="true"
          style={{
            left: "50%",
            pointerEvents: "none",
            position: "absolute",
            top: "50%",
          }}
        >
          {sectorLabels.map((sector) => (
            <span
              key={sector.label}
              style={{
                background: "rgba(244,239,227,.94)",
                border: "1px solid rgba(62,49,32,.1)",
                borderRadius: 99,
                color: "#4A3B26",
                fontFamily: "ui-monospace,'SF Mono',Menlo,monospace",
                fontSize: 9,
                fontWeight: 700,
                left: sector.x,
                letterSpacing: ".08em",
                padding: "4px 7px",
                position: "absolute",
                textTransform: "uppercase",
                top: sector.y,
                transform: "translate(-50%,-50%)",
                whiteSpace: "nowrap",
              }}
            >
              {sector.label}
            </span>
          ))}
        </div>

        {/* Clickable ring */}
        <button
          aria-label="Ouvrir l'assistant généraliste NAIA"
          className="naia-ring-trigger"
          onClick={onOpenAssistant}
          title="Ouvrir l'assistant NAIA"
          style={{
            background: "transparent",
            border: 0,
            cursor: "pointer",
            inset: 0,
            padding: 0,
            position: "absolute",
          }}
          type="button"
        >
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: "translate(-50%,-50%)",
              width: ringD,
              height: ringD,
            }}
          >
            <div
              style={{
                width: "100%",
                height: "100%",
                animation: "naiaBreath 7s ease-in-out infinite",
              }}
            >
              <NaiaRing W={ringD} H={ringD} phase={ringPhase} />
            </div>
          </div>
        </button>

        {/* Agent hover info at ring center */}
        {hoveredNode && (
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: "translate(-50%,-50%)",
              width: 184,
              textAlign: "center",
              pointerEvents: "none",
              animation: "naiaIn .18s ease",
            }}
          >
            <div
              style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-.01em" }}
            >
              {hoveredNode.name}
            </div>
            <div
              style={{
                fontFamily: "ui-monospace,'SF Mono',Menlo,monospace",
                fontSize: 9,
                letterSpacing: ".16em",
                textTransform: "uppercase",
                color: "#6E5F49",
                marginTop: 3,
              }}
            >
              {hoveredNode.role}
            </div>
            <div
              style={{
                fontFamily: "ui-monospace,'SF Mono',Menlo,monospace",
                fontSize: 8.5,
                letterSpacing: ".18em",
                marginTop: 8,
                color: hoveredNode.status === "live" ? "#47602D" : "#7A5715",
              }}
            >
              {hoveredNode.status === "live" ? "\u25cf LIVE" : "\u25cf GUARDED"}
            </div>
          </div>
        )}

        {/* Agent nodes (origin = ring center) */}
        <div style={{ position: "absolute", left: "50%", top: "50%" }}>
          {nodes.map((nd) => (
            <div
              key={nd.id}
              style={{
                position: "absolute",
                left: nd.x,
                top: nd.y,
                transform: "translate(-50%,-50%)",
              }}
            >
              <button
                aria-label={`Ouvrir ${nd.name}, ${nd.role}`}
                className="naia-pill"
                onClick={(e) => {
                  e.stopPropagation();
                  onAgentClick(nd.id);
                }}
                onMouseEnter={() => setHoveredAgentId(nd.id as NaiaAgentId)}
                onMouseLeave={() => setHoveredAgentId(null)}
                onFocus={() => setHoveredAgentId(nd.id as NaiaAgentId)}
                onBlur={() => setHoveredAgentId(null)}
                style={{
                  cursor: "pointer",
                  textAlign: "center",
                  padding: "7px 12px",
                  borderRadius: 9,
                  border: "1px solid rgba(62,49,32,.10)",
                  background: "rgba(237,231,217,.94)",
                  color: "inherit",
                  font: "inherit",
                  minHeight: 44,
                }}
                type="button"
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    justifyContent: "center",
                  }}
                >
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: "50%",
                      flexShrink: 0,
                      background: nd.status === "live" ? "#47602D" : "#7A5715",
                      display: "inline-block",
                    }}
                  />
                  <span
                    className="naia-pill-name"
                    style={{
                      fontSize: 13.5,
                      fontWeight: 600,
                      letterSpacing: "-.01em",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {nd.name}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "#6E5F49",
                    marginTop: 2,
                    letterSpacing: ".02em",
                    whiteSpace: "nowrap",
                  }}
                >
                  {nd.role}
                </div>
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="naia-home-mobile-agents">
        <div
          style={{
            color: "#6E5F49",
            fontFamily: "ui-monospace,'SF Mono',Menlo,monospace",
            fontSize: 10,
            letterSpacing: ".16em",
            marginBottom: 12,
            textTransform: "uppercase",
          }}
        >
          Chaîne de valeur Qarizmi
        </div>
        <label
          style={{
            color: "#4A3B26",
            display: "grid",
            fontSize: 12,
            fontWeight: 600,
            gap: 7,
          }}
        >
          Ouvrir un agent
          <select
            defaultValue=""
            onChange={(event) => {
              if (event.target.value) onAgentClick(event.target.value);
            }}
            style={{
              background: "#F5F0E4",
              border: "1px solid rgba(62,49,32,.2)",
              borderRadius: 7,
              color: "#3A2E1E",
              font: "inherit",
              minHeight: 44,
              padding: "9px 11px",
              width: "100%",
            }}
          >
            <option disabled value="">
              Choisir un module
            </option>
            {NAIA_ORBIT_SECTORS.flatMap((sector) =>
              sector.agentIds.map((id) => {
                const agent = getNaiaAgent(id);
                return (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} · {agent.role}
                  </option>
                );
              }),
            )}
          </select>
        </label>
        <button
          className="naia-primary-btn"
          onClick={onOpenAssistant}
          style={{
            background: "#2E2417",
            border: "none",
            borderRadius: 99,
            color: "#F4EFE3",
            cursor: "pointer",
            font: "inherit",
            fontSize: 13,
            fontWeight: 600,
            marginTop: 14,
            minHeight: 44,
            padding: "10px 18px",
            width: "100%",
          }}
          type="button"
        >
          Parler à NAIA
        </button>
        <div aria-hidden="true" className="naia-mobile-value-chain">
          {NAIA_ORBIT_SECTORS.map((sector, sectorIndex) => (
            <div
              key={sector.label}
              style={{
                borderTop: `2px solid ${RING_PAL[sectorIndex]}`,
                paddingTop: 9,
              }}
            >
              <div
                style={{
                  alignItems: "center",
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span
                  style={{
                    color: "#4A3B26",
                    fontFamily: "ui-monospace,'SF Mono',Menlo,monospace",
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: ".12em",
                  }}
                >
                  {sector.label}
                </span>
                <span
                  style={{
                    color: "#6E5F49",
                    fontSize: 10,
                  }}
                >
                  {sector.agentIds.length} agents
                </span>
              </div>
              <div
                style={{
                  color: "#6E5F49",
                  display: "flex",
                  flexWrap: "wrap",
                  fontSize: 11,
                  gap: "4px 8px",
                  lineHeight: 1.6,
                  marginTop: 5,
                }}
              >
                {sector.agentIds.map((id, index) => (
                  <span key={id}>
                    {getNaiaAgent(id).name}
                    {index < sector.agentIds.length - 1 ? "  →" : ""}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Footer ── */}
      <div
        className="naia-home-footer"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "end",
          gap: 24,
          padding: "6px 2px 36px",
        }}
      >
        <div />
        <div style={{ textAlign: "center" }}>
          <h1
            style={{
              margin: 0,
              fontSize: "clamp(44px,6.5vw,80px)",
              fontWeight: 500,
              letterSpacing: "-.045em",
              lineHeight: 0.95,
              color: "#46351A",
            }}
          >
            Meet NAIA
          </h1>
          <div
            style={{
              marginTop: 20,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <button
              onClick={onEnterCockpit}
              className="naia-primary-btn"
              style={{
                font: "inherit",
                fontSize: 13,
                fontWeight: 600,
                background: "#2E2417",
                color: "#F4EFE3",
                border: "none",
                borderRadius: 99,
                padding: "11px 26px",
                cursor: "pointer",
              }}
            >
              Entrer dans le cockpit
            </button>
          </div>
        </div>
        <div />
      </div>
    </div>
  );
}

// ————————————————————————————————————————————————————————————————————————————

function NaiaCockpitScreen({
  selectedRailId,
  selectedRailAgent,
  setSelectedRailId,
  result,
  isRunning,
  isListening,
  isApplyingAction,
  command,
  setCommand,
  transcript,
  notice,
  userName,
  onGoHome,
  onRunCommand,
  onStartVoice,
  onStopVoice,
  onExecuteAction,
  voiceCatalog,
  selectedVoiceId,
  selectedVoice,
  isSpeaking,
  onSpeakCurrentAnswer,
  onChangeVoice,
}: {
  selectedRailId: NaiaAgentId;
  selectedRailAgent: NaiaAgent;
  setSelectedRailId: (id: NaiaAgentId) => void;
  result: ApiResult | null;
  isRunning: boolean;
  isListening: boolean;
  isApplyingAction: boolean;
  command: string;
  setCommand: (v: string) => void;
  transcript: string;
  notice: string;
  userName: string;
  onGoHome: () => void;
  onRunCommand: (cmd: string) => void;
  onStartVoice: () => void;
  onStopVoice: () => void;
  onExecuteAction: (
    action: SignedNaiaAction,
    leadInput?: Partial<CrmLeadDraft>,
  ) => void;
  voiceCatalog: VoiceCatalog | null;
  selectedVoiceId: string;
  selectedVoice?: VoiceOption;
  isSpeaking: boolean;
  onSpeakCurrentAnswer: () => void;
  onChangeVoice: (v: string) => void;
}) {
  const router = useRouter();
  const hasPending = (result?.actions?.length ?? 0) > 0;
  const [activeLeadAction, setActiveLeadAction] =
    useState<SignedNaiaAction | null>(null);
  const MONO = "ui-monospace,'SF Mono',Menlo,monospace";

  return (
    <div
      className="naia-cockpit-shell"
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#EAE3D3",
        overflow: "hidden",
      }}
    >
      {/* — Topbar — */}
      <div
        className="naia-cockpit-topbar"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 20px",
          minHeight: 54,
          borderBottom: "1px solid rgba(62,49,32,.14)",
          flexShrink: 0,
          flexWrap: "wrap",
        }}
      >
        {/* Left cluster — 2 rows */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            padding: "8px 0",
          }}
        >
          {/* Row 1: nav buttons */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={onGoHome}
              title={"Retour \u00e0 l'accueil"}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                cursor: "pointer",
                background: "none",
                border: "none",
                font: "inherit",
                padding: "4px 8px 4px 4px",
                borderRadius: 6,
                color: "inherit",
                transition: "background .15s",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "rgba(62,49,32,.06)")
              }
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
            >
              <span style={{ fontSize: 16, fontWeight: "bold" }}>
                {"\u2190"}
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/naia-os-q.png"
                alt="Qarizmi"
                style={{
                  width: 24,
                  height: 24,
                  display: "block",
                  borderRadius: "50%",
                }}
              />
              <span
                style={{
                  fontWeight: 700,
                  fontSize: 13.5,
                  letterSpacing: ".02em",
                }}
              >
                NAIA
              </span>
            </button>

            <button
              onClick={() => router.push("/dashboard")}
              style={{
                fontFamily: MONO,
                fontSize: 10,
                fontWeight: 600,
                color: "#6E5F49",
                background: "rgba(62,49,32,.05)",
                border: "1px solid rgba(62,49,32,.12)",
                borderRadius: 99,
                padding: "4px 10px",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                transition: "all .15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#2E2417";
                e.currentTarget.style.color = "#F4EFE3";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(62,49,32,.05)";
                e.currentTarget.style.color = "#6E5F49";
              }}
            >
              {"\u2190 Dashboard"}
            </button>

            <span
              style={{
                fontFamily: MONO,
                fontSize: 8.5,
                letterSpacing: ".2em",
                color: "#6E5F49",
                border: "1px solid rgba(62,49,32,.2)",
                borderRadius: 99,
                padding: "3px 9px",
              }}
            >
              COCKPIT
            </span>
          </div>

          {/* Row 2: Voice dropdown — only when catalog is ready */}
          {voiceCatalog?.voices.length ? (
            <div
              className="naia-main-voice-controls"
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 8.5,
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                  color: "#A2937A",
                  whiteSpace: "nowrap",
                }}
              >
                Voix
              </span>
              <select
                onChange={(e) => onChangeVoice(e.target.value)}
                value={selectedVoiceId}
                title="Choisir la voix de NAIA"
                style={{
                  fontSize: 10.5,
                  fontFamily: "inherit",
                  background: "rgba(62,49,32,.05)",
                  border: "1px solid rgba(62,49,32,.18)",
                  borderRadius: 6,
                  padding: "2px 22px 2px 7px",
                  color: "#4A3B26",
                  cursor: "pointer",
                  maxWidth: 164,
                  outline: "none",
                  appearance: "none",
                  WebkitAppearance: "none",
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%238A7A5F' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "right 6px center",
                }}
              >
                {voiceCatalog.voices.map((v) => (
                  <option key={v.voiceId} value={v.voiceId}>
                    {v.name}
                  </option>
                ))}
              </select>
              <button
                disabled={!selectedVoiceId || isSpeaking}
                onClick={onSpeakCurrentAnswer}
                style={{
                  font: "inherit",
                  fontSize: 9.5,
                  fontWeight: 600,
                  background: "none",
                  border: "1px solid rgba(62,49,32,.20)",
                  borderRadius: 99,
                  padding: "2px 8px",
                  cursor:
                    !selectedVoiceId || isSpeaking ? "not-allowed" : "pointer",
                  color: "#6E5F49",
                  opacity: !selectedVoiceId || isSpeaking ? 0.5 : 1,
                  transition: "all .15s",
                }}
                onMouseEnter={(e) => {
                  if (selectedVoiceId && !isSpeaking) {
                    e.currentTarget.style.borderColor = "#DE5B2B";
                    e.currentTarget.style.color = "#DE5B2B";
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "rgba(62,49,32,.20)";
                  e.currentTarget.style.color = "#6E5F49";
                }}
              >
                {isSpeaking ? "\u25a0 Stop" : "\u25b6 Tester"}
              </button>
            </div>
          ) : null}
        </div>

        <div style={{ flex: 1 }} />

        {/* Right: status dot + username */}
        <div
          className="naia-cockpit-topbar-status"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            fontSize: 11,
            color: "#6E5F49",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#7A5715",
              display: "inline-block",
            }}
          />
          {"CRM connect\u00e9 \u00b7 Gmail en attente (Lina)"}
        </div>
        <div
          className="naia-cockpit-user"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginLeft: 10,
          }}
        >
          <span
            style={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              background: "#2E2417",
              color: "#F4EFE3",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            {userName.charAt(0).toUpperCase()}
          </span>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{userName}</span>
        </div>
      </div>

      {/* â”€â”€ 3-column grid â”€â”€ */}
      <div
        className="naia-cockpit-grid"
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "248px minmax(0,1fr)",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        {/* â”€â”€ Left rail â€” agents â”€â”€ */}
        <div
          className="naia-cockpit-left"
          style={{
            borderRight: "1px solid rgba(62,49,32,.14)",
            overflowY: "auto",
            padding: "12px 10px 18px",
            minHeight: 0,
          }}
        >
          {COCKPIT_POLES.map((pole) => (
            <div key={pole.label}>
              <div
                style={{
                  padding: "12px 8px 5px",
                  fontFamily: MONO,
                  fontSize: 9,
                  letterSpacing: ".2em",
                  color: "#A2937A",
                  textTransform: "uppercase",
                }}
              >
                {pole.label}
              </div>
              {pole.ids.map((id) => {
                const agent = getNaiaAgent(id);
                const isActive = selectedRailId === id;
                return (
                  <button
                    key={id}
                    className="naia-rail-row"
                    onClick={() => {
                      setSelectedRailId(id);
                      if (id === "naia") {
                        window.dispatchEvent(new Event("naia:open-assistant"));
                        return;
                      }
                      router.push(agent.route);
                    }}
                    style={{
                      border: "none",
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      padding: 8,
                      borderRadius: 8,
                      cursor: "pointer",
                      background: isActive
                        ? "rgba(247,243,233,.95)"
                        : "transparent",
                      color: "inherit",
                      font: "inherit",
                      textAlign: "left",
                      width: "100%",
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        flexShrink: 0,
                        background:
                          agent.status === "live" ? "#47602D" : "#7A5715",
                        display: "inline-block",
                      }}
                    />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span
                        style={{
                          display: "block",
                          fontSize: 12.5,
                          fontWeight: 600,
                        }}
                      >
                        {agent.name}
                      </span>
                      <span
                        style={{
                          display: "block",
                          fontSize: 10.5,
                          color: "#6E5F49",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {agent.role}
                      </span>
                    </span>
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: 8,
                        letterSpacing: ".12em",
                        color: agent.status === "live" ? "#47602D" : "#7A5715",
                      }}
                    >
                      {agent.status.toUpperCase()}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}

          {/* Legend */}
          <div
            style={{
              marginTop: 18,
              padding: "12px 8px 0",
              borderTop: "1px solid rgba(62,49,32,.12)",
              fontSize: 10.5,
              lineHeight: 1.7,
              color: "#6E5F49",
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#47602D",
                marginRight: 6,
                verticalAlign: "middle",
              }}
            />
            {"Live \u2014 peut agir directement"}
            <br />
            <span
              style={{
                display: "inline-block",
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#7A5715",
                marginRight: 6,
                verticalAlign: "middle",
              }}
            />
            {"Guarded \u2014 validation humaine"}
          </div>

          {/* ElevenLabs voice selector */}
          <div
            className="naia-main-voice-controls"
            style={{
              marginTop: 18,
              padding: "12px 8px 0",
              borderTop: "1px solid rgba(62,49,32,.12)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 6,
              }}
            >
              <div>
                <div
                  style={{ fontSize: 11, fontWeight: 605, color: "#4A3B26" }}
                >
                  Voix ElevenLabs
                </div>
                <div style={{ fontSize: 9.5, color: "#6E5F49", marginTop: 2 }}>
                  {selectedVoice ? selectedVoice.name : "Chargement..."}
                </div>
              </div>
              <button
                disabled={!selectedVoiceId || isSpeaking}
                onClick={onSpeakCurrentAnswer}
                style={{
                  font: "inherit",
                  fontSize: 10,
                  fontWeight: 600,
                  background: "none",
                  border: "1px solid rgba(62,49,32,.25)",
                  borderRadius: 99,
                  padding: "2px 8px",
                  cursor:
                    !selectedVoiceId || isSpeaking ? "not-allowed" : "pointer",
                }}
              >
                Tester
              </button>
            </div>
            {voiceCatalog?.voices.length ? (
              <select
                onChange={(e) => onChangeVoice(e.target.value)}
                value={selectedVoiceId}
                style={{
                  width: "100%",
                  marginTop: 6,
                  fontSize: 11,
                  background: "#EAE3D3",
                  border: "1px solid rgba(62,49,32,.2)",
                  borderRadius: 6,
                  padding: "3px 6px",
                  color: "inherit",
                }}
              >
                {voiceCatalog.voices.map((v) => (
                  <option key={v.voiceId} value={v.voiceId}>
                    {v.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        </div>

        <div
          style={{
            background: "#EFE9D9",
            minHeight: 0,
            minWidth: 0,
            overflowY: "auto",
            padding: "28px clamp(18px,4vw,54px) 40px",
          }}
        >
          <div
            style={{
              alignItems: "flex-end",
              display: "flex",
              flexWrap: "wrap",
              gap: 16,
              justifyContent: "space-between",
              marginBottom: 30,
            }}
          >
            <div>
              <div
                style={{
                  color: "#A2937A",
                  fontFamily: MONO,
                  fontSize: 9,
                  letterSpacing: ".2em",
                  textTransform: "uppercase",
                }}
              >
                Cockpit opérationnel
              </div>
              <h1
                style={{
                  color: "#3A2E1E",
                  fontSize: "clamp(28px,4vw,48px)",
                  fontWeight: 500,
                  letterSpacing: "-.03em",
                  lineHeight: 1,
                  margin: "8px 0 0",
                }}
              >
                Chaîne de valeur
              </h1>
            </div>
            <button
              className="naia-primary-btn"
              onClick={() =>
                window.dispatchEvent(new Event("naia:open-assistant"))
              }
              style={{
                background: "#2E2417",
                border: "none",
                borderRadius: 99,
                color: "#F4EFE3",
                cursor: "pointer",
                font: "inherit",
                fontSize: 12,
                fontWeight: 600,
                minHeight: 42,
                padding: "9px 18px",
              }}
              type="button"
            >
              Parler à NAIA
            </button>
          </div>

          <label className="naia-mobile-agent-picker">
            <span>Module</span>
            <select
              aria-label="Ouvrir un module NAIA"
              defaultValue=""
              onChange={(event) => {
                if (!event.target.value) return;
                const agent = getNaiaAgent(event.target.value as NaiaAgentId);
                setSelectedRailId(agent.id);
                if (agent.id === "naia") {
                  window.dispatchEvent(new Event("naia:open-assistant"));
                  return;
                }
                router.push(agent.route);
              }}
            >
              <option disabled value="">
                Choisir un agent
              </option>
              {naiaAgents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name} · {agent.role}
                </option>
              ))}
            </select>
          </label>

          <div style={{ display: "grid", gap: 28, marginTop: 20 }}>
            {COCKPIT_POLES.map((pole) => (
              <section key={pole.label}>
                <div
                  style={{
                    alignItems: "center",
                    color: "#6E5F49",
                    display: "flex",
                    fontFamily: MONO,
                    fontSize: 9,
                    gap: 10,
                    letterSpacing: ".18em",
                    marginBottom: 10,
                    textTransform: "uppercase",
                  }}
                >
                  <span>{pole.label}</span>
                  <span
                    style={{
                      background: "rgba(62,49,32,.16)",
                      flex: 1,
                      height: 1,
                    }}
                  />
                </div>
                <div
                  style={{
                    display: "grid",
                    gap: 10,
                    gridTemplateColumns:
                      "repeat(auto-fit,minmax(min(100%,210px),1fr))",
                  }}
                >
                  {pole.ids.map((id) => {
                    const agent = getNaiaAgent(id);
                    return (
                      <button
                        className="naia-process-card"
                        key={agent.id}
                        onClick={() => {
                          setSelectedRailId(agent.id);
                          if (agent.id === "naia") {
                            window.dispatchEvent(
                              new Event("naia:open-assistant"),
                            );
                            return;
                          }
                          router.push(agent.route);
                        }}
                        style={{
                          background: "#F5F0E4",
                          border: "1px solid rgba(62,49,32,.14)",
                          borderRadius: 8,
                          color: "inherit",
                          cursor: "pointer",
                          display: "grid",
                          gap: 8,
                          minHeight: 112,
                          padding: 14,
                          textAlign: "left",
                        }}
                        type="button"
                      >
                        <span
                          style={{
                            alignItems: "center",
                            display: "flex",
                            gap: 8,
                            justifyContent: "space-between",
                          }}
                        >
                          <strong style={{ fontSize: 14 }}>{agent.name}</strong>
                          <span
                            style={{
                              color:
                                agent.status === "live" ? "#47602D" : "#7A5715",
                              fontFamily: MONO,
                              fontSize: 8,
                              letterSpacing: ".12em",
                            }}
                          >
                            {agent.status.toUpperCase()}
                          </span>
                        </span>
                        <span style={{ color: "#6E5F49", fontSize: 11 }}>
                          {agent.role}
                        </span>
                        <span
                          style={{
                            color: "#6E5F49",
                            fontSize: 10.5,
                            lineHeight: 1.45,
                          }}
                        >
                          {agent.mission}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>

        {/* Legacy cockpit interaction surface retained temporarily for state compatibility. */}
        <div
          className="naia-cockpit-center naia-cockpit-legacy"
          style={{
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            minHeight: 0,
            background: "#EFE9D9",
          }}
        >
          {/* Agent header */}
          <div
            className="naia-cockpit-agent-header"
            style={{
              padding: "12px 22px 13px",
              borderBottom: "1px solid rgba(62,49,32,.12)",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 11,
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  letterSpacing: "-.01em",
                }}
              >
                {selectedRailAgent.name}
              </span>
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 9,
                  letterSpacing: ".16em",
                  textTransform: "uppercase",
                  color: "#6E5F49",
                }}
              >
                {selectedRailAgent.role}
              </span>
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 8.5,
                  letterSpacing: ".16em",
                  color:
                    selectedRailAgent.status === "live" ? "#47602D" : "#7A5715",
                }}
              >
                {selectedRailAgent.status.toUpperCase()}
              </span>
            </div>
            <div
              style={{
                fontSize: 11.5,
                color: "#6E5F49",
                lineHeight: 1.5,
                marginTop: 4,
                maxWidth: 680,
              }}
            >
              {selectedRailAgent.mission}
            </div>
            <label className="naia-mobile-agent-picker">
              <span>Agent</span>
              <select
                aria-label="Choisir un agent NAIA"
                onChange={(event) =>
                  setSelectedRailId(event.target.value as NaiaAgentId)
                }
                value={selectedRailId}
              >
                {naiaAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} · {agent.role}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Scrollable response area */}
          <div
            className="naia-cockpit-response"
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "16px 22px 8px",
              minHeight: 0,
            }}
          >
            {/* NAIA response / welcome */}
            <div
              style={{
                display: "flex",
                gap: 10,
                marginBottom: 13,
                animation: "naiaIn .3s ease",
              }}
            >
              <div
                style={{
                  width: 52,
                  flexShrink: 0,
                  textAlign: "right",
                  fontFamily: MONO,
                  fontSize: 9,
                  letterSpacing: ".13em",
                  color: "#A2937A",
                  paddingTop: 3,
                  textTransform: "uppercase",
                }}
              >
                NAIA
              </div>
              <div
                style={{
                  flex: 1,
                  fontSize: 12.5,
                  lineHeight: 1.55,
                  color: "#3A2E1E",
                }}
              >
                {result?.response ??
                  `Bonjour ${userName}. Les 12 agents sont en ligne. Que puis-je pr\u00e9parer ?`}
              </div>
            </div>

            {/* User transcript */}
            {transcript && (
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  marginBottom: 13,
                  animation: "naiaIn .3s ease",
                }}
              >
                <div
                  style={{
                    width: 52,
                    flexShrink: 0,
                    textAlign: "right",
                    fontFamily: MONO,
                    fontSize: 9,
                    letterSpacing: ".13em",
                    color: "#DE5B2B",
                    paddingTop: 3,
                    textTransform: "uppercase",
                  }}
                >
                  VOUS
                </div>
                <div style={{ flex: 1, fontSize: 12.5, lineHeight: 1.55 }}>
                  {transcript}
                </div>
              </div>
            )}

            {/* Thinking animation */}
            {isRunning && (
              <div style={{ display: "flex", gap: 10, marginBottom: 13 }}>
                <div
                  style={{
                    width: 52,
                    flexShrink: 0,
                    textAlign: "right",
                    fontFamily: MONO,
                    fontSize: 9,
                    letterSpacing: ".13em",
                    color: "#A2937A",
                    paddingTop: 3,
                    textTransform: "uppercase",
                  }}
                >
                  NAIA
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 5,
                    alignItems: "center",
                    paddingTop: 8,
                  }}
                >
                  {[0, 0.2, 0.4].map((delay) => (
                    <span
                      key={delay}
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: "50%",
                        background: "#A2937A",
                        display: "inline-block",
                        animation: `naiaDot 1.2s ${delay}s ease-in-out infinite`,
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Notice / alert */}
            {notice && (
              <div
                style={{
                  padding: "8px 12px",
                  background: "rgba(168,122,30,.10)",
                  border: "1px solid rgba(168,122,30,.25)",
                  borderRadius: 8,
                  fontSize: 11.5,
                  color: "#6E5F49",
                  lineHeight: 1.5,
                  marginBottom: 12,
                  animation: "naiaIn .3s ease",
                }}
              >
                <div>{notice}</div>
                {notice.toLowerCase().includes("lead crm cr") && (
                  <button
                    className="naia-primary-btn"
                    onClick={() => router.push("/dashboard/leads")}
                    style={{
                      marginTop: 8,
                      font: "inherit",
                      fontSize: 11,
                      fontWeight: 600,
                      background: "#2E2417",
                      color: "#F4EFE3",
                      border: "none",
                      borderRadius: 99,
                      padding: "4px 12px",
                      cursor: "pointer",
                    }}
                  >
                    {"Voir dans le pipeline"}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* â”€â”€ Bottom input zone â”€â”€ */}
          <div
            className="naia-cockpit-input"
            style={{
              flexShrink: 0,
              borderTop: "1px solid rgba(62,49,32,.12)",
              padding: "10px 22px 14px",
            }}
          >
            {/* Suggestion chips */}
            <div
              className="naia-cockpit-suggestions"
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                marginBottom: 12,
              }}
            >
              {commandExamples.slice(0, 3).map((ex) => (
                <button
                  key={ex}
                  className="naia-outline-btn"
                  disabled={isRunning}
                  onClick={() => {
                    setCommand(ex);
                    onRunCommand(ex);
                  }}
                  style={{
                    font: "inherit",
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: "#6E5F49",
                    background: "none",
                    border: "1px solid rgba(62,49,32,.25)",
                    borderRadius: 99,
                    padding: "4px 12px",
                    cursor: isRunning ? "not-allowed" : "pointer",
                    opacity: isRunning ? 0.6 : 1,
                  }}
                >
                  {ex.length > 38 ? `${ex.slice(0, 38)}...` : ex}
                </button>
              ))}
            </div>

            {/* Input row */}
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {/* Mic / orb button */}
              <button
                onClick={isListening ? onStopVoice : onStartVoice}
                style={{
                  width: 44,
                  height: 44,
                  flexShrink: 0,
                  borderRadius: "50%",
                  border: isListening
                    ? "2px solid #DE5B2B"
                    : "1px solid rgba(62,49,32,.20)",
                  background: "rgba(237,231,217,.94)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 0,
                  animation: isListening
                    ? "naiaGlow 1.4s ease-in-out infinite"
                    : "none",
                  transition: "border .2s",
                }}
              >
                <NaiaMiniOrb listening={isListening} />
              </button>

              {/* Textarea */}
              <div
                style={{
                  flex: 1,
                  borderBottom: "1px solid rgba(62,49,32,.25)",
                  paddingBottom: 4,
                }}
              >
                <textarea
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (command.trim()) onRunCommand(command);
                    }
                  }}
                  placeholder={
                    isListening
                      ? "Je vous \u00e9coute\u2026"
                      : "Parlez ou \u00e9crivez \u00e0 NAIA..."
                  }
                  rows={1}
                  style={{
                    width: "100%",
                    resize: "none",
                    background: "none",
                    border: "none",
                    outline: "none",
                    font: "inherit",
                    fontSize: 12.5,
                    color: "#3A2E1E",
                    lineHeight: 1.55,
                    padding: "4px 0",
                  }}
                />
              </div>

              {/* Send */}
              <button
                disabled={isRunning || !command.trim()}
                onClick={() => {
                  if (command.trim()) onRunCommand(command);
                }}
                style={{
                  width: 36,
                  height: 36,
                  flexShrink: 0,
                  borderRadius: "50%",
                  background: "#2E2417",
                  color: "#F4EFE3",
                  border: "none",
                  cursor:
                    isRunning || !command.trim() ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 16,
                  opacity: isRunning || !command.trim() ? 0.45 : 1,
                  transition: "opacity .2s",
                }}
              >
                {"\u2191"}
              </button>
            </div>

            {/* Disclaimer */}
            <div
              style={{
                fontSize: 9.5,
                color: "#A2937A",
                marginTop: 8,
                lineHeight: 1.5,
              }}
            >
              {
                "NAIA pr\u00e9pare, vous validez \u2014 aucune \u00e9criture CRM, envoi externe ou document sensible sans votre accord."
              }
            </div>
          </div>
        </div>

        {/* â”€â”€ Right panel â€” validations + journal â”€â”€ */}
        <div
          className={`naia-cockpit-right naia-cockpit-legacy ${
            hasPending ? "has-pending" : "is-empty"
          }`}
          style={{
            borderLeft: "1px solid rgba(62,49,32,.14)",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          {/* Validations humaines */}
          <div
            style={{
              flexShrink: 0,
              maxHeight: "44%",
              overflowY: "auto",
              padding: "14px 14px 6px",
              borderBottom: "1px solid rgba(62,49,32,.12)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                paddingBottom: 10,
              }}
            >
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 9,
                  letterSpacing: ".2em",
                  color: "#A2937A",
                  textTransform: "uppercase",
                  flex: 1,
                }}
              >
                Validations humaines
              </span>
              {hasPending && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    background: "#DE5B2B",
                    color: "#F4EFE3",
                    borderRadius: 99,
                    minWidth: 18,
                    height: 18,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "0 5px",
                  }}
                >
                  {result?.actions?.length}
                </span>
              )}
            </div>

            {hasPending ? (
              result?.actions?.map((action) => {
                if (action.kind === "crm.createLead") {
                  return (
                    <div
                      key={action.id}
                      style={{
                        background: "#F5F0E4",
                        border: "1px solid rgba(62,49,32,.16)",
                        borderRadius: 10,
                        padding: 12,
                        marginBottom: 10,
                        animation: "naiaIn .3s ease",
                      }}
                    >
                      <div className="naia-form-header">
                        <span className="naia-form-badge">Action requise</span>
                        <span style={{ fontSize: 10, color: "#6E5F49" }}>
                          CRM
                        </span>
                      </div>
                      <h3
                        className="naia-form-title"
                        style={{ fontSize: 12.5 }}
                      >
                        {action.label}
                      </h3>
                      <p
                        className="naia-form-desc"
                        style={{ fontSize: 11.5, marginTop: 4 }}
                      >
                        {action.description}
                      </p>
                      <button
                        className="naia-primary-btn"
                        onClick={() => setActiveLeadAction(action)}
                        style={{
                          marginTop: 10,
                          width: "100%",
                          font: "inherit",
                          fontSize: 12,
                          fontWeight: 600,
                          background: "#2E2417",
                          color: "#F4EFE3",
                          border: "none",
                          borderRadius: 99,
                          padding: "6px 0",
                          cursor: "pointer",
                        }}
                      >
                        Compl&eacute;ter & Valider
                      </button>
                    </div>
                  );
                }

                return (
                  <div key={action.id} style={{ marginBottom: 10 }}>
                    <ActionCard
                      action={action}
                      disabled={isApplyingAction}
                      onApply={(leadInput) =>
                        onExecuteAction(action, leadInput)
                      }
                    />
                  </div>
                );
              })
            ) : (
              <div
                style={{
                  fontSize: 11,
                  color: "#A2937A",
                  lineHeight: 1.6,
                  paddingBottom: 10,
                }}
              >
                Aucune action en attente. NAIA demandera votre accord avant
                toute action sensible.
              </div>
            )}
          </div>

          {/* Journal d'audit */}
          <div
            className="naia-cockpit-audit"
            style={{ flex: 1, overflowY: "auto", padding: "14px" }}
          >
            <div style={{ paddingBottom: 10 }}>
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 9,
                  letterSpacing: ".2em",
                  color: "#A2937A",
                  textTransform: "uppercase",
                }}
              >
                Journal d&apos;audit
              </span>
            </div>
            <div style={{ fontSize: 11.5, color: "#A2937A", lineHeight: 1.6 }}>
              {
                "Chaque action approuv\u00e9e, refus\u00e9e ou ex\u00e9cut\u00e9e sera trac\u00e9e ici (audit Amine)."
              }
            </div>
          </div>
        </div>
      </div>

      {activeLeadAction && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(46, 36, 23, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            animation: "naiaIn .2s ease",
            padding: "20px 10px",
          }}
          onClick={() => setActiveLeadAction(null)}
        >
          <div
            style={{
              background: "#F5F0E4",
              border: "1px solid rgba(62, 49, 32, 0.16)",
              borderRadius: 12,
              padding: "18px 22px",
              width: "540px",
              maxWidth: "100%",
              maxHeight: "88vh",
              overflowY: "auto",
              position: "relative",
              boxShadow:
                "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: 16,
              }}
            >
              <div>
                <span
                  className="naia-form-badge"
                  style={{ marginBottom: 4, display: "inline-block" }}
                >
                  Validation humaine
                </span>
                <h3 className="naia-form-title" style={{ fontSize: 15 }}>
                  {activeLeadAction.label}
                </h3>
              </div>
              <button
                onClick={() => setActiveLeadAction(null)}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: 18,
                  cursor: "pointer",
                  color: "#6E5F49",
                  padding: 0,
                }}
              >
                &times;
              </button>
            </div>

            {/* Form */}
            <LeadDraftActionCard
              action={
                activeLeadAction as Extract<
                  SignedNaiaAction,
                  { kind: "crm.createLead" }
                >
              }
              disabled={isApplyingAction}
              onApply={(leadInput) => {
                if (activeLeadAction) {
                  onExecuteAction(activeLeadAction, leadInput);
                  setActiveLeadAction(null);
                }
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
