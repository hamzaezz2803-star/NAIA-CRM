/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowRight,
  CheckCircle2,
  Headphones,
  Loader2,
  Mic,
  Play,
  Route,
  ShieldCheck,
  Sparkles,
  Volume2,
  WandSparkles,
  Square,
  type LucideIcon,
} from "lucide-react";

import {
  accentClasses,
  getNaiaAgent,
  naiaDelegatedAgents,
  type NaiaAgentId,
} from "./agents";
import type { NaiaActionDraft, NaiaOrchestrationResult } from "./orchestrator";
import WakeSequence from "./vendor/jarvis/WakeSequence";
import {
  buildNaiaVoiceUrl,
  createVoiceSilenceDetector,
  playElevenLabsVoice,
  primeVoicePlayback,
  VOICE_RECORDING_MAX_MS,
  type VoicePlaybackHandle,
} from "./voice-client";
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
  "Salma, passe Atlas en meeting booked et prepare le pitch",
  "Nora, prevois le cash sur 90 jours et priorise les relances",
  "Ilyas, liste les projets avec risque de retard ce trimestre",
  "Rayan, prepare une spec pour ajouter une nouvelle feature CRM",
];

const crmStatusLabels: Record<string, string> = {
  contacted: "Contacté",
  "dead-end": "Dead end",
  "lead-to-contact": "À contacter",
  "meeting-booked": "Meeting fixé",
  "proposal-sent": "Propale envoyée",
  "to-follow-up": "À relancer",
  won: "Gagné",
};

const fieldClassName =
  "mt-1 min-h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-950/78 dark:text-slate-50 dark:placeholder:text-slate-500 dark:focus:border-cyan-200 dark:focus:ring-cyan-200/40";

const emeraldFieldClassName =
  "mt-1 min-h-10 w-full rounded-md border border-emerald-200 bg-white px-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-950/78 dark:text-slate-50 dark:placeholder:text-slate-500 dark:focus:border-emerald-200 dark:focus:ring-emerald-200/40";

const bootLines = [
  "NAIA OS ................. ONLINE",
  "voice kernel ............ READY",
  "crm agent SALMA ......... LINKED",
  "calendar agent ADAM ..... GUARDED",
  "docs agent MAYA ......... GUARDED",
];

type AgentGroupId = "preSales" | "projectManagement" | "support";

const agentGroupById: Partial<Record<NaiaAgentId, AgentGroupId>> = {
  automations: "projectManagement",
  crm: "preSales",
  developer: "support",
  finance: "support",
  hr: "support",
  integrations: "support",
  leads: "preSales",
  meetings: "preSales",
  projects: "projectManagement",
  proposals: "preSales",
  settings: "support",
};

const groupStyles: Record<
  AgentGroupId,
  {
    card: string;
    label: string;
    node: string;
    stroke: string;
  }
> = {
  preSales: {
    card: "border-cyan-300/60 bg-cyan-300/12 text-cyan-50 shadow-cyan-500/25",
    label: "border-cyan-300/35 bg-cyan-300/10 text-cyan-100",
    node: "rgba(103,232,249,0.92)",
    stroke: "rgba(34,211,238,0.28)",
  },
  projectManagement: {
    card: "border-violet-300/60 bg-violet-300/12 text-violet-50 shadow-violet-500/25",
    label: "border-violet-300/35 bg-violet-300/10 text-violet-100",
    node: "rgba(196,181,253,0.92)",
    stroke: "rgba(167,139,250,0.28)",
  },
  support: {
    card: "border-emerald-300/55 bg-emerald-300/12 text-emerald-50 shadow-emerald-500/22",
    label: "border-emerald-300/35 bg-emerald-300/10 text-emerald-100",
    node: "rgba(110,231,183,0.9)",
    stroke: "rgba(52,211,153,0.27)",
  },
};

const processLabels: Array<{
  className: string;
  groupId: AgentGroupId;
  label: string;
}> = [
  {
    className: "left-[9%] top-[18%]",
    groupId: "preSales",
    label: "Avant vente",
  },
  {
    className: "bottom-[11%] left-1/2 -translate-x-1/2",
    groupId: "projectManagement",
    label: "Project management",
  },
  {
    className: "right-[16%] top-[18%]",
    groupId: "support",
    label: "Fonctions support",
  },
];

const agentStats = [
  {
    label: "Agents",
    value: naiaDelegatedAgents.length,
  },
  {
    label: "Live",
    value: naiaDelegatedAgents.filter((agent) => agent.status === "live")
      .length,
  },
  {
    label: "Guarded",
    value: naiaDelegatedAgents.filter((agent) => agent.status === "guarded")
      .length,
  },
  {
    label: "Orchestrateur",
    value: 1,
  },
];

export function NaiaCommandCenter() {
  const router = useRouter();
  const [command, setCommand] = useState(commandExamples[0]);
  const [result, setResult] = useState<ApiResult | null>(null);
  const conversationRef = useRef<ConversationMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isApplyingAction, setIsApplyingAction] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [notice, setNotice] = useState("");
  const [manualAudioUrl, setManualAudioUrl] = useState("");
  const [voiceCatalog, setVoiceCatalog] = useState<VoiceCatalog | null>(null);
  const [selectedVoiceId, setSelectedVoiceId] = useState("");
  const [forceBrowserSpeech, setForceBrowserSpeech] = useState(false);
  const [userName, setUserName] = useState("Ali");
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

  const activeAgentId = result?.agent.id ?? "naia";
  const activeAgent = getNaiaAgent(activeAgentId);
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

        const storedVoiceId = window.localStorage.getItem("naia_voice_id");
        const storedVoiceExists = payload.voices.some(
          (voice) => voice.voiceId === storedVoiceId,
        );
        const configuredVoiceExists = payload.voices.some(
          (voice) => voice.voiceId === payload.configuredVoiceId,
        );
        const recommendedVoiceExists = payload.voices.some(
          (voice) => voice.voiceId === payload.recommendedVoiceId,
        );
        const nextVoiceId =
          storedVoiceExists && storedVoiceId
            ? storedVoiceId
            : recommendedVoiceExists && payload.recommendedVoiceId
              ? payload.recommendedVoiceId
              : configuredVoiceExists && payload.configuredVoiceId
                ? payload.configuredVoiceId
                : (payload.voices[0]?.voiceId ?? "");

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

  const runCommand = async (
    nextCommand = command,
    options: { speak?: boolean } = {},
  ) => {
    const cleanCommand = nextCommand.trim();
    if (!cleanCommand) return;

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

  const speakText = (rawText: string) => {
    const text = rawText.replace(/\s+/g, " ").slice(0, 900);
    speechAudioRef.current?.pause();
    setManualAudioUrl("");
    speechAudioRef.current = playElevenLabsVoice({
      onBlocked: (message) => {
        setNotice(message);
        setManualAudioUrl(buildNaiaVoiceUrl(text, selectedVoiceId));
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

  const speakCurrentAnswer = async () => {
    primeVoicePlayback();
    speakText(result?.response ?? "NAIA est en ligne.");
  };

  const changeVoice = (voiceId: string) => {
    setSelectedVoiceId(voiceId);
    window.localStorage.setItem("naia_voice_id", voiceId);
  };

  return (
    <section className="relative min-h-dvh overflow-hidden bg-[#020611] text-slate-50">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_46%,transparent_0,transparent_28%,rgba(2,6,17,0.34)_52%,rgba(2,6,17,0.82)_100%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(34,211,238,0.08)_1px,transparent_1px),linear-gradient(0deg,rgba(34,211,238,0.05)_1px,transparent_1px)] bg-[size:72px_72px] opacity-35" />

      <div className="relative min-h-dvh overflow-hidden bg-black/10 shadow-2xl shadow-cyan-950/50 backdrop-blur-sm">
        <div className="absolute inset-0">
          <WakeSequence
            bootLines={bootLines}
            requireFace={false}
            skippable={false}
            statusLabel="NAIA ACTIVE"
            userName="ALI"
          />
        </div>

        <div className="pointer-events-none absolute left-4 top-4 z-40">
          <div className="inline-flex min-h-9 items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 text-xs font-semibold uppercase text-cyan-100 shadow-lg shadow-cyan-500/10">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Qarizmi Operating System
          </div>
          <div className="mt-3 hidden max-w-[360px] grid-cols-4 gap-2 md:grid">
            {agentStats.map((stat) => (
              <div
                className="min-h-14 rounded-md border border-slate-50/10 bg-slate-950/50 px-3 py-2 shadow-lg shadow-slate-950/30 backdrop-blur-md"
                key={stat.label}
              >
                <p className="text-lg font-semibold leading-none text-slate-50">
                  {stat.value}
                </p>
                <p className="mt-1 text-[10px] font-semibold uppercase text-slate-300">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
          <h1 className="sr-only">
            NAIA orchestre les agents Qarizmi autour de la sphere.
          </h1>
        </div>

        <div className="relative h-full min-h-dvh">
          <OrbitLines />
          <ProcessLabels />
          <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 hidden -translate-x-1/2 translate-y-[105px] text-center md:block">
            <p className="text-xs font-semibold uppercase text-cyan-100/80">
              Voice orchestrator
            </p>
            <p className="mt-2 text-3xl font-semibold text-slate-50">NAIA</p>
          </div>

          {naiaDelegatedAgents.map((agent) => {
            const Icon = agent.icon;
            const group = getAgentGroup(agent.id);

            return (
              <Link
                className={`absolute z-30 hidden min-h-12 w-[156px] -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-md border px-3 py-2 text-left shadow-lg backdrop-blur-md transition hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 md:flex ${groupStyles[group].card}`}
                href={agent.route}
                key={agent.id}
                style={
                  {
                    left: `${agent.orbit.desktop.x}%`,
                    top: `${agent.orbit.desktop.y}%`,
                  } as CSSProperties
                }
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-50/10">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">
                    {agent.label}
                  </span>
                  <span className="block truncate text-xs text-slate-100/68">
                    {agent.name}
                  </span>
                  <span className="mt-1 inline-flex rounded-full border border-slate-50/10 bg-slate-50/8 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-100/72">
                    {agent.status === "guarded" ? "Guarded" : "Live"}
                  </span>
                </span>
              </Link>
            );
          })}

          <div className="absolute inset-x-4 bottom-24 z-30 grid max-h-[420px] gap-2 overflow-y-auto pr-1 md:hidden">
            {naiaDelegatedAgents.map((agent) => {
              const Icon = agent.icon;
              const group = getAgentGroup(agent.id);

              return (
                <Link
                  className={`flex min-h-12 items-center gap-3 rounded-md border px-3 py-2 shadow-lg backdrop-blur-md ${groupStyles[group].card}`}
                  href={agent.route}
                  key={agent.id}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  <span className="min-w-0 text-sm font-semibold">
                    {agent.label}
                    <span className="ml-2 text-xs font-medium uppercase text-slate-600 dark:text-slate-100/58">
                      {agent.status}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>

        <aside className="space-y-4">
          <Panel>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-cyan-700 dark:text-cyan-100">
                  Agent actif
                </p>
                <h2 className="mt-1 text-2xl font-semibold text-slate-950 dark:text-slate-50">
                  {activeAgent.name}
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-300">
                  {activeAgent.role}
                </p>
              </div>
              <span
                className={`flex h-11 w-11 items-center justify-center rounded-md border shadow-lg ${
                  accentClasses[activeAgent.accent]
                }`}
              >
                <activeAgent.icon className="h-5 w-5" aria-hidden="true" />
              </span>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-700 dark:text-slate-200">
              {activeAgent.mission}
            </p>
            <Link
              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-50 dark:hover:bg-slate-800 dark:focus-visible:ring-cyan-200"
              href={activeAgent.route}
            >
              Ouvrir le module
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Panel>

          <Panel>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-950 dark:text-slate-50">
              <Route className="h-4 w-4 text-cyan-200" aria-hidden="true" />
              Console NAIA
            </div>
            <label className="mt-4 block text-sm font-semibold text-slate-700 dark:text-slate-200">
              Commande
              <textarea
                className="mt-2 min-h-24 w-full resize-none rounded-md border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-950/78 dark:text-slate-50 dark:placeholder:text-slate-500 dark:focus:border-cyan-200 dark:focus:ring-cyan-200/40"
                onChange={(event) => setCommand(event.target.value)}
                value={command}
              />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <ActionButton
                disabled={isListening || isRunning}
                icon={isRunning ? Loader2 : WandSparkles}
                label={isRunning ? "Orchestration" : "Lancer"}
                loading={isRunning}
                onClick={() => void runCommand(command)}
                tone="primary"
              />
              <ActionButton
                icon={isListening ? Square : Mic}
                label={isListening ? "Arrêter" : "Parler"}
                onClick={isListening ? stopVoiceControl : startVoiceControl}
                tone="secondary"
              />
              <ActionButton
                disabled={isSpeaking}
                icon={Volume2}
                label={isSpeaking ? "Lecture" : "Audio"}
                onClick={() => void speakCurrentAnswer()}
                tone="secondary"
              />
            </div>

            {manualAudioUrl ? (
              <audio
                className="mt-3 w-full"
                controls
                preload="none"
                src={manualAudioUrl}
              >
                <track kind="captions" />
              </audio>
            ) : null}

            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-900/70">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-950 dark:text-slate-50">
                    <Headphones
                      className="h-4 w-4 text-cyan-200"
                      aria-hidden="true"
                    />
                    Voix ElevenLabs
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
                    {selectedVoice
                      ? selectedVoice.name
                      : !voiceCatalog
                        ? "Chargement..."
                        : voiceCatalog.mode === "missing-elevenlabs-key"
                          ? "Clé ElevenLabs manquante"
                          : voiceCatalog.mode === "elevenlabs-permissions-error"
                            ? "Permissions API clé insuffisantes (voices_read)"
                            : voiceCatalog.mode === "elevenlabs-error"
                              ? "Erreur ElevenLabs (Clé invalide ?)"
                              : voiceCatalog.mode === "elevenlabs-network-error"
                                ? "Erreur réseau ElevenLabs"
                                : "Moteur ElevenLabs indisponible"}
                  </p>
                </div>
                <button
                  className="inline-flex min-h-10 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-900 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50 dark:hover:bg-slate-700 dark:focus-visible:ring-cyan-200"
                  disabled={!selectedVoiceId || isSpeaking}
                  onClick={() => {
                    primeVoicePlayback();
                    speakText(
                      `Bonjour ${userName}, je suis NAIA. Je t'ecoute.`,
                    );
                  }}
                  type="button"
                >
                  Tester
                </button>
              </div>
              {voiceCatalog?.voices.length ? (
                <label className="mt-3 block">
                  <span className="sr-only">Choisir la voix ElevenLabs</span>
                  <select
                    className={fieldClassName}
                    onChange={(event) => changeVoice(event.target.value)}
                    value={selectedVoiceId}
                  >
                    {voiceCatalog.voices.map((voice) => (
                      <option key={voice.voiceId} value={voice.voiceId}>
                        {voice.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {selectedVoice ? (
                <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                  {[
                    selectedVoice.category,
                    selectedVoice.labels.gender,
                    selectedVoice.labels.accent,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              ) : null}
            </div>

            <div className="mt-4 grid gap-2">
              {commandExamples.map((example) => (
                <button
                  className="flex min-h-11 items-start gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-sm leading-5 text-slate-800 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200 dark:hover:bg-slate-800 dark:focus-visible:ring-cyan-200"
                  disabled={isRunning}
                  key={example}
                  onClick={() => {
                    setCommand(example);
                    void runCommand(example);
                  }}
                  type="button"
                >
                  <Play
                    className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200"
                    aria-hidden="true"
                  />
                  <span>{example}</span>
                </button>
              ))}
            </div>
          </Panel>

          <Panel>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-950 dark:text-slate-50">
                <ShieldCheck
                  className="h-4 w-4 text-emerald-200"
                  aria-hidden="true"
                />
                Decision
              </div>
              {result ? (
                <div className="flex flex-wrap justify-end gap-2">
                  <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-1 text-xs font-semibold text-cyan-800 dark:border-slate-700 dark:bg-slate-900/70 dark:text-cyan-100">
                    {Math.round(result.confidence * 100)}%
                  </span>
                  {result.mode ? (
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200">
                      {result.mode === "groq-orchestrated" ? "Groq" : "Local"}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>

            <p className="mt-4 min-h-20 whitespace-pre-line text-sm leading-6 text-slate-700 dark:text-slate-200">
              {result?.response ??
                "NAIA attend une instruction vocale ou texte pour router vers le bon agent."}
            </p>

            {transcript ? (
              <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300">
                {transcript}
              </p>
            ) : null}

            {result?.actions.length ? (
              <div className="mt-4 space-y-2">
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

            {notice ? (
              <p className="mt-4 rounded-md border border-amber-300/40 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900 dark:border-amber-300/25 dark:bg-amber-300/10 dark:text-amber-100">
                {notice}
              </p>
            ) : null}
          </Panel>
        </aside>
      </div>
    </section>
  );
}

function OrbitLines() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 hidden h-full w-full md:block"
      preserveAspectRatio="none"
      viewBox="0 0 100 100"
    >
      <defs>
        <radialGradient id="naiaNodeGlow">
          <stop offset="0%" stopColor="rgba(255,255,255,0.88)" />
          <stop offset="100%" stopColor="rgba(34,211,238,0)" />
        </radialGradient>
      </defs>
      {naiaDelegatedAgents.map((agent) => (
        <g key={agent.id}>
          <path
            d={`M50 50 C ${50 + (agent.orbit.desktop.x - 50) * 0.22} ${
              50 + (agent.orbit.desktop.y - 50) * 0.18
            }, ${agent.orbit.desktop.x} ${
              50 + (agent.orbit.desktop.y - 50) * 0.42
            }, ${agent.orbit.desktop.x} ${agent.orbit.desktop.y}`}
            fill="none"
            stroke={groupStyles[getAgentGroup(agent.id)].stroke}
            strokeWidth={0.16}
          />
          <circle
            cx={agent.orbit.desktop.x}
            cy={agent.orbit.desktop.y}
            fill={groupStyles[getAgentGroup(agent.id)].node}
            opacity={agent.status === "live" ? 0.52 : 0.34}
            r={agent.status === "live" ? 2.3 : 1.9}
          />
        </g>
      ))}
    </svg>
  );
}

function ProcessLabels() {
  return (
    <>
      {processLabels.map((item) => (
        <div
          className={`pointer-events-none absolute z-20 hidden rounded-full border px-3 py-1.5 text-xs font-semibold uppercase md:block ${groupStyles[item.groupId].label} ${item.className}`}
          key={item.label}
        >
          {item.label}
        </div>
      ))}
    </>
  );
}

function getAgentGroup(agentId: NaiaAgentId): AgentGroupId {
  return agentGroupById[agentId] ?? "support";
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
            <div className="mt-3 grid gap-1 rounded-md border border-emerald-200 bg-white/75 p-3 text-sm text-emerald-950 dark:border-emerald-200/20 dark:bg-slate-950/60 dark:text-emerald-50 sm:grid-cols-2">
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
            className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md bg-emerald-500 px-3 text-sm font-semibold text-slate-50 transition hover:bg-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-emerald-300 dark:text-emerald-950 dark:hover:bg-emerald-200 dark:focus-visible:ring-emerald-100"
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
                className="mt-1 min-h-20 w-full resize-none rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm leading-5 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-950/78 dark:text-slate-50 dark:placeholder:text-slate-500 dark:focus:border-emerald-200 dark:focus:ring-emerald-200/40"
                onChange={(event) => updateDraft({ notes: event.target.value })}
                value={draft.notes ?? ""}
              />
            </label>

            {draft.tags && draft.tags.length > 0 && (
              <div className="mt-2">
                <span className="block text-xs font-semibold text-emerald-900 dark:text-emerald-50 mb-1">
                  Tags détectés
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {draft.tags.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1 rounded bg-teal-100 dark:bg-teal-900/35 px-2 py-0.5 text-[10px] font-bold text-teal-850 dark:text-teal-350 border border-teal-200/50 dark:border-teal-800/30"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Google Integrations Checkboxes */}
            <div className="flex flex-col gap-2.5 mt-2 border-t border-emerald-200/30 pt-3">
              <label className="flex items-center gap-2 text-xs font-semibold text-emerald-900 dark:text-emerald-50 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={createDrive}
                  onChange={(e) => setCreateDrive(e.target.checked)}
                  className="rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500/40 dark:border-slate-700 dark:bg-slate-950"
                />
                Créer automatiquement un dossier Google Drive pour ce client
              </label>
              <label
                className={`flex items-center gap-2 text-xs font-semibold text-emerald-900 dark:text-emerald-50 cursor-pointer select-none ${!draft.leadDate ? "opacity-50" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={createCalendar}
                  disabled={!draft.leadDate}
                  onChange={(e) => {
                    setCalendarPreferenceTouched(true);
                    setCreateCalendar(e.target.checked);
                  }}
                  className="rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500/40 dark:border-slate-700 dark:bg-slate-950 disabled:opacity-50"
                />
                {"Planifier l'événement sur Google Calendar"}{" "}
                {!draft.leadDate && "(Nécessite une date planifiée)"}
              </label>
            </div>
          </div>

          <button
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-md bg-emerald-500 px-3 text-sm font-semibold text-slate-50 transition hover:bg-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-emerald-300 dark:text-emerald-950 dark:hover:bg-emerald-200 dark:focus-visible:ring-emerald-100"
            disabled={disabled || !draft.topic.trim()}
            onClick={() =>
              onApply({
                ...draft,
                createGoogleDrive: createDrive,
                createGoogleCalendar: createCalendar && Boolean(draft.leadDate),
              })
            }
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

function Panel({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white/92 p-4 shadow-xl shadow-slate-200/70 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/72 dark:shadow-2xl dark:shadow-black/30">
      {children}
    </section>
  );
}

function ActionButton({
  disabled,
  icon: Icon,
  label,
  loading,
  onClick,
  tone,
}: {
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  loading?: boolean;
  onClick: () => void;
  tone: "primary" | "secondary";
}) {
  return (
    <button
      className={
        tone === "primary"
          ? "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-cyan-200 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50 disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:ring-cyan-100"
          : "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-50 dark:hover:bg-slate-800 dark:focus-visible:ring-cyan-200"
      }
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <Icon
        className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
        aria-hidden="true"
      />
      {label}
    </button>
  );
}
