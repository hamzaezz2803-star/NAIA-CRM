"use client";

import Link from "next/link";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useMemo,
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
  type LucideIcon,
} from "lucide-react";

import {
  accentClasses,
  getNaiaAgent,
  naiaAgents,
  naiaDelegatedAgents,
} from "./agents";
import type { NaiaActionDraft, NaiaOrchestrationResult } from "./orchestrator";
import WakeSequence from "./vendor/jarvis/WakeSequence";
import {
  buildNaiaVoiceUrl,
  createVoiceSilenceDetector,
  playElevenLabsVoice,
  VOICE_RECORDING_MAX_MS,
} from "./voice-client";
import { crmLeadStatuses, type CrmLeadDraft } from "@/features/crm/contracts";

type NaiaCommandCenterProps = {
  initialCrmStats: {
    leadCount: number;
    openLeadCount: number;
  };
};

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

const bootLines = [
  "NAIA OS ................. ONLINE",
  "voice kernel ............ READY",
  "crm agent SALMA ......... LINKED",
  "cash agent NORA ......... READY",
  "delivery agent ILYAS .... READY",
];

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

export function NaiaCommandCenter({ initialCrmStats }: NaiaCommandCenterProps) {
  const [command, setCommand] = useState(commandExamples[0]);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isApplyingAction, setIsApplyingAction] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [notice, setNotice] = useState("");
  const [manualAudioUrl, setManualAudioUrl] = useState("");
  const [voiceCatalog, setVoiceCatalog] = useState<VoiceCatalog | null>(null);
  const [selectedVoiceId, setSelectedVoiceId] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const speechAudioRef = useRef<HTMLAudioElement | null>(null);
  const browserFinalTranscriptRef = useRef("");
  const silenceDetectorRef = useRef<{ stop: () => void } | null>(null);
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const audioChunksRef = useRef<Blob[]>([]);

  const activeAgentId = result?.agent.id ?? "naia";
  const activeAgent = getNaiaAgent(activeAgentId);
  const crmStats = result?.crmSnapshot ?? initialCrmStats;
  const selectedVoice =
    voiceCatalog?.voices.find((voice) => voice.voiceId === selectedVoiceId) ??
    voiceCatalog?.activeVoice;

  const visibleAgents = useMemo(
    () =>
      naiaDelegatedAgents.map((agent) => ({
        ...agent,
        isActive: agent.id === activeAgentId,
      })),
    [activeAgentId],
  );

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

    void loadVoices();

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
        body: JSON.stringify({ command: cleanCommand }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as ApiResult & { error?: string };

      if (!response.ok || payload.error) {
        throw new Error(payload.error ?? "NAIA orchestration failed");
      }

      setResult(payload);
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

      await runCommand(command);
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

      setNotice("Aucune phrase detectee. Relance Parler quand tu es pret.");
    };
    recognitionRef.current = recognition;
    setNotice(
      "Je t'ecoute. NAIA transcrira automatiquement apres un silence prononce.",
    );
    setIsListening(true);
    recognition.start();
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
    speakText(result?.response ?? "NAIA est en ligne.");
  };

  const changeVoice = (voiceId: string) => {
    setSelectedVoiceId(voiceId);
    window.localStorage.setItem("naia_voice_id", voiceId);
  };

  return (
    <section className="relative min-h-[calc(100dvh-4rem)] overflow-hidden bg-slate-50 text-slate-950 dark:bg-[#020611] dark:text-slate-50">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_46%,transparent_0,transparent_30%,rgba(226,232,240,0.38)_58%,rgba(248,250,252,0.96)_100%)] dark:bg-[radial-gradient(circle_at_50%_46%,transparent_0,transparent_28%,rgba(2,6,17,0.34)_52%,rgba(2,6,17,0.82)_100%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(34,211,238,0.08)_1px,transparent_1px),linear-gradient(0deg,rgba(34,211,238,0.05)_1px,transparent_1px)] bg-[size:72px_72px] opacity-35" />

      <div className="relative z-10 grid min-h-[calc(100dvh-4rem)] gap-6 px-4 py-4 sm:px-6 lg:px-8 xl:grid-cols-[minmax(0,1fr)_400px] xl:items-start">
        <div className="relative min-h-[560px] overflow-hidden rounded-lg border border-slate-200 bg-white/55 shadow-xl shadow-slate-300/50 backdrop-blur-sm dark:border-slate-800 dark:bg-black/10 dark:shadow-2xl dark:shadow-cyan-950/50 xl:min-h-[calc(100dvh-6rem)]">
          <div className="absolute inset-0">
            <WakeSequence
              bootLines={bootLines}
              requireFace={false}
              skippable={false}
              statusLabel="NAIA ACTIVE"
              userName="ALI"
            />
          </div>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-40 p-5 md:p-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="max-w-2xl">
                <div className="inline-flex min-h-9 items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 text-xs font-semibold uppercase text-cyan-100 shadow-lg shadow-cyan-500/10">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  Qarizmi Operating System
                </div>
                <h1 className="sr-only">
                  NAIA orchestre tes agents, ta voix et ton CRM.
                </h1>
              </div>

              <div className="grid gap-2 sm:grid-cols-3 xl:min-w-[360px]">
                <SignalCard
                  label="Leads CRM"
                  value={String(crmStats.leadCount)}
                />
                <SignalCard
                  label="Pipeline actif"
                  value={String(crmStats.openLeadCount)}
                />
                <SignalCard
                  label="Agents"
                  value={String(naiaAgents.length - 1)}
                />
              </div>
            </div>
          </div>

          <div className="relative h-full min-h-[560px] xl:min-h-[calc(100dvh-6rem)]">
            <OrbitLines agents={visibleAgents} />
            <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 hidden -translate-x-1/2 translate-y-[105px] text-center md:block">
              <p className="text-xs font-semibold uppercase text-cyan-100/80">
                Voice orchestrator
              </p>
              <p className="mt-2 text-3xl font-semibold text-slate-50">NAIA</p>
            </div>

            {visibleAgents.map((agent) => {
              const Icon = agent.icon;

              return (
                <Link
                  className={`absolute z-30 hidden min-h-12 -translate-x-1/2 -translate-y-1/2 items-center gap-3 rounded-md border px-3 py-2 text-left shadow-lg backdrop-blur-md transition hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 md:flex ${
                    accentClasses[agent.accent]
                  } ${
                    agent.isActive
                      ? "ring-2 ring-slate-50/70"
                      : "opacity-88 hover:opacity-100"
                  }`}
                  href={agent.route}
                  key={agent.id}
                  style={
                    {
                      left: `${agent.orbit.desktop.x}%`,
                      top: `${agent.orbit.desktop.y}%`,
                    } as CSSProperties
                  }
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-950/5 dark:bg-slate-50/10">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold">
                      {agent.label}
                    </span>
                    <span className="block text-xs text-slate-600 dark:text-slate-100/68">
                      {agent.name} · {agent.role}
                    </span>
                    <span className="mt-1 inline-flex rounded-full border border-slate-900/10 bg-slate-950/5 px-2 py-0.5 text-[11px] font-semibold uppercase text-slate-700 dark:border-slate-50/10 dark:bg-slate-50/8 dark:text-slate-100/72">
                      {agent.status === "guarded" ? "Guarded" : "Live"}
                    </span>
                  </span>
                </Link>
              );
            })}

            <div className="absolute inset-x-4 bottom-4 z-30 grid max-h-[420px] gap-2 overflow-y-auto pr-1 md:hidden">
              {visibleAgents.map((agent) => {
                const Icon = agent.icon;

                return (
                  <Link
                    className={`flex min-h-12 items-center gap-3 rounded-md border px-3 py-2 shadow-lg backdrop-blur-md ${
                      accentClasses[agent.accent]
                    }`}
                    href={agent.route}
                    key={agent.id}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <span className="text-sm font-semibold">
                      {agent.label} · {agent.name}
                      <span className="ml-2 text-xs font-medium uppercase text-slate-600 dark:text-slate-100/58">
                        {agent.status}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
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
                disabled={isListening}
                icon={isListening ? Loader2 : Mic}
                label={isListening ? "J'ecoute..." : "Parler"}
                loading={isListening}
                onClick={startVoiceControl}
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
                      : voiceCatalog?.mode === "missing-elevenlabs-key"
                        ? "Clé manquante"
                        : "Chargement"}
                  </p>
                </div>
                <button
                  className="inline-flex min-h-10 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-900 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50 dark:hover:bg-slate-700 dark:focus-visible:ring-cyan-200"
                  disabled={!selectedVoiceId || isSpeaking}
                  onClick={() =>
                    speakText("Bonjour Ali, je suis NAIA. Je t'ecoute.")
                  }
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

function OrbitLines({
  agents,
}: {
  agents: Array<(typeof naiaDelegatedAgents)[number] & { isActive: boolean }>;
}) {
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
      {agents.map((agent) => (
        <g key={agent.id}>
          <path
            d={`M50 50 C ${50 + (agent.orbit.desktop.x - 50) * 0.32} ${
              50 + (agent.orbit.desktop.y - 50) * 0.2
            }, ${agent.orbit.desktop.x} ${
              50 + (agent.orbit.desktop.y - 50) * 0.45
            }, ${agent.orbit.desktop.x} ${agent.orbit.desktop.y}`}
            fill="none"
            stroke={
              agent.isActive
                ? "rgba(255,255,255,0.76)"
                : "rgba(34,211,238,0.22)"
            }
            strokeWidth={agent.isActive ? 0.28 : 0.16}
          />
          <circle
            cx={agent.orbit.desktop.x}
            cy={agent.orbit.desktop.y}
            fill="url(#naiaNodeGlow)"
            opacity={agent.isActive ? 0.92 : 0.42}
            r={agent.isActive ? 3.2 : 2.2}
          />
        </g>
      ))}
    </svg>
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
          </div>

          <button
            className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md bg-emerald-500 px-3 text-sm font-semibold text-slate-50 transition hover:bg-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-emerald-300 dark:text-emerald-950 dark:hover:bg-emerald-200 dark:focus-visible:ring-emerald-100"
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

function SignalCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white/90 p-3 shadow-lg shadow-slate-300/25 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/52 dark:shadow-black/20">
      <p className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-300">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-slate-950 dark:text-slate-50">
        {value}
      </p>
    </div>
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
