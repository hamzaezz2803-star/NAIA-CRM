"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  FileText,
  Headphones,
  Mic,
  Play,
  RefreshCw,
  Search,
  Send,
  SlidersHorizontal,
  Plus,
  Sparkles,
  Users,
  Volume2,
  WandSparkles,
  Square,
  X,
  type LucideIcon,
} from "lucide-react";

import {
  buildNaiaContext,
  cashMonths,
  capexRows,
  clientCashRows,
  clientRelances,
  executiveActions,
  formatMad,
  generatedAssets,
  getNaiaSection,
  hiringNeeds,
  opexRows,
  approvalQueue,
  integrationHealth,
  leadCompanies,
  naiaSections,
  pipeline,
  projectTimelineMonths,
  projects,
  staffingPlan,
  costs,
  paymentPlans,
  type NaiaSectionId,
  type RiskLevel,
} from "./operating-data";
import {
  createVoiceSilenceDetector,
  playElevenLabsVoice,
  primeVoicePlayback,
  type VoicePlaybackHandle,
  VOICE_RECORDING_MAX_MS,
} from "./voice-client";

type NaiaExperienceProps = {
  focusMode?: boolean;
  sectionId: NaiaSectionId;
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
  "NAIA, ouvre le cash flow et predis les 90 prochains jours.",
  "NAIA, trouve les leads industrie entre 30 et 80 MDH au Maroc.",
  "NAIA, quels projets risquent un retard de delivery ?",
  "NAIA, calcule les recrutements pour les deals signes.",
];

const toneClasses = {
  amber:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  blue: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300",
  emerald:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  rose: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300",
  teal: "border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300",
  violet:
    "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300",
};

const riskClasses: Record<RiskLevel, string> = {
  high: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300",
  medium:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  low: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
};

const riskLabel: Record<RiskLevel, string> = {
  high: "Critique",
  medium: "A surveiller",
  low: "Sous controle",
};

const stages = [
  "Lead qualifie",
  "Meeting booked",
  "Propale a envoyer",
  "Negociation",
];

export const formatShortMad = (value: number) =>
  new Intl.NumberFormat("fr-MA", {
    maximumFractionDigits: 0,
    notation: "compact",
  }).format(value);

const sumMonthlyCash = (rows: { monthlyCash: number[] }[]) =>
  cashMonths.map((_, index) =>
    rows.reduce((total, row) => total + (row.monthlyCash[index] ?? 0), 0),
  );

export function NaiaExperience({
  focusMode = false,
  sectionId,
}: NaiaExperienceProps) {
  const router = useRouter();
  const [activeSection, setActiveSection] = useState<NaiaSectionId>(sectionId);
  const [assistantOutput, setAssistantOutput] = useState(
    getLocalAnswer(sectionId),
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceNotice, setVoiceNotice] = useState("");
  const [forceBrowserSpeech, setForceBrowserSpeech] = useState(false);
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

  const section = useMemo(() => getNaiaSection(activeSection), [activeSection]);
  const maxBalance = Math.max(...cashMonths.map((month) => month.balance));
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

    void checkGroq();

    return () => {
      isMounted = false;
    };
  }, []);

  const navigateTo = (nextSectionId: NaiaSectionId) => {
    const nextSection = getNaiaSection(nextSectionId);
    setActiveSection(nextSection.id);
    setAssistantOutput(getLocalAnswer(nextSection.id));
    router.push(nextSection.href);
  };

  const speakText = (rawText: string) => {
    const text = rawText.replace(/\s+/g, " ").slice(0, 900);
    speechAudioRef.current?.pause();
    speechAudioRef.current = playElevenLabsVoice({
      onBlocked: (message) => {
        setVoiceNotice(message);
      },
      onEnded: () => setIsSpeaking(false),
      onStarted: () => {
        setVoiceNotice("");
        setIsSpeaking(true);
      },
      text,
    });
  };

  const generate = async (
    nextSectionId = activeSection,
    promptOverride?: string,
    options: { speak?: boolean } = {},
  ) => {
    const nextSection = getNaiaSection(nextSectionId);
    const prompt = promptOverride ?? nextSection.prompt;
    setActiveSection(nextSection.id);
    setIsGenerating(true);
    setVoiceNotice("");

    try {
      const response = await fetch("/api/naia/complete", {
        body: JSON.stringify({
          context: buildNaiaContext(nextSection.id),
          prompt,
          sectionId: nextSection.id,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      const payload = (await response.json()) as {
        output?: string;
        mode?: string;
      };

      if (!response.ok || !payload.output) {
        throw new Error("NAIA completion failed");
      }

      setAssistantOutput(payload.output);
      if (options.speak) {
        speakText(payload.output);
      }
      if (payload.mode === "local") {
        setVoiceNotice(
          "Mode local: Groq n'a pas repondu, raisonnement embarque active.",
        );
      }
      return payload.output;
    } catch {
      const fallbackOutput = getLocalAnswer(nextSection.id);
      setAssistantOutput(fallbackOutput);
      if (options.speak) {
        speakText(fallbackOutput);
      }
      setVoiceNotice("Mode local: impossible de joindre l'API IA.");
      return fallbackOutput;
    } finally {
      setIsGenerating(false);
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
      setVoiceNotice("Reconnaissance vocale indisponible dans ce navigateur.");
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
        setVoiceNotice("Silence détecté, arrêt de l'écoute...");
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

      setVoiceTranscript(
        `${browserFinalTranscriptRef.current} ${interimTranscript}`.trim(),
      );
    };
    recognition.onerror = (event) => {
      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
      setVoiceNotice(
        event.error ? `Voix: ${event.error}` : "Commande vocale interrompue.",
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
        void handleVoiceCommand(spokenText);
        return;
      }

      setVoiceNotice(
        "Aucune phrase detectee. Relance Parler quand tu es pret.",
      );
    };
    recognitionRef.current = recognition;
    setVoiceNotice(
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
      setVoiceNotice("Reconnaissance vocale indisponible dans ce navigateur.");
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
          setVoiceNotice("Aucun audio detecte. Relance la commande vocale.");
          return;
        }

        setVoiceTranscript("Transcription NAIA en cours.");
        void transcribeAudioCommand(audio);
      };
      setVoiceNotice(
        "Parle naturellement. NAIA transcrira apres un silence prononce.",
      );
      setVoiceTranscript("Je t'ecoute. Je detecterai la fin de ta phrase.");
      setIsListening(true);
      recorder.start();
      silenceDetectorRef.current = createVoiceSilenceDetector({
        onSilence: () => {
          if (
            mediaRecorderRef.current === recorder &&
            recorder.state !== "inactive"
          ) {
            setVoiceNotice("Silence detecte, transcription en cours.");
            recorder.stop();
          }
        },
        onSpeechStart: () => {
          setVoiceTranscript("Je t'ecoute. Termine ta phrase naturellement.");
        },
        stream,
      });
      recordingTimeoutRef.current = setTimeout(() => {
        if (
          mediaRecorderRef.current === recorder &&
          recorder.state !== "inactive"
        ) {
          setVoiceNotice(
            "Limite de 45 secondes atteinte, transcription en cours.",
          );
          recorder.stop();
        }
      }, VOICE_RECORDING_MAX_MS);
    } catch {
      if (recordingTimeoutRef.current) {
        clearTimeout(recordingTimeoutRef.current);
        recordingTimeoutRef.current = null;
      }

      setIsListening(false);
      setVoiceNotice("Microphone indisponible ou permission refusee.");
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
      const transcript = payload.transcript?.trim();

      if (!response.ok || !transcript) {
        if (payload.mode === "missing-groq-key") {
          setVoiceNotice(
            "Groq Whisper n'est pas configure en local. J'active la reconnaissance vocale du navigateur.",
          );
          setForceBrowserSpeech(true);
          startBrowserSpeechControl();
          return;
        }

        if (payload.mode === "groq-error") {
          setVoiceNotice(
            payload.message
              ? `Groq Whisper: ${payload.message}`
              : "Groq Whisper n'a pas accepte l'audio. Reessaie ou utilise la console texte.",
          );
          return;
        }

        throw new Error("Transcription failed");
      }

      setVoiceTranscript(transcript);
      await handleVoiceCommand(transcript);
    } catch {
      setVoiceNotice(
        "Transcription indisponible. Tu peux lancer les commandes ci-dessous.",
      );
    }
  };

  const handleVoiceCommand = async (command: string) => {
    const normalized = command.toLocaleLowerCase("fr-FR");
    const target =
      normalized.includes("lead") || normalized.includes("prospect")
        ? "leads"
        : normalized.includes("cash") ||
            normalized.includes("finance") ||
            normalized.includes("tresorerie")
          ? "cash-flow"
          : normalized.includes("crm") ||
              normalized.includes("propale") ||
              normalized.includes("pitch")
            ? "crm"
            : normalized.includes("projet") ||
                normalized.includes("delivery") ||
                normalized.includes("retard")
              ? "projects"
              : normalized.includes("rh") || normalized.includes("recrut")
                ? "hr"
                : normalized.includes("cockpit") ||
                    normalized.includes("accueil")
                  ? "overview"
                  : activeSection;

    const nextSection = getNaiaSection(target);
    setVoiceTranscript(command);
    router.push(nextSection.href);
    await generate(nextSection.id, command, { speak: true });
  };

  const speakCurrentAnswer = async () => {
    primeVoicePlayback();
    speakText(assistantOutput);
  };

  return (
    <div className={focusMode ? "space-y-3" : "space-y-6"}>
      {focusMode ? null : (
        <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-white">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold uppercase text-teal-800 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  NAIA live
                </span>
                <span
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${toneClasses[section.tone]}`}
                >
                  {section.eyebrow}
                </span>
              </div>
              <h1 className="text-3xl font-semibold leading-tight text-stone-950 md:text-4xl">
                {section.title}
              </h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-stone-600">
                {section.summary}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <ActionButton
                icon={isListening ? Square : Mic}
                label={isListening ? "Arrêter" : "Parler"}
                onClick={isListening ? stopVoiceControl : startVoiceControl}
                variant="secondary"
              />
              <ActionButton
                disabled={isGenerating}
                icon={isGenerating ? RefreshCw : WandSparkles}
                label={isGenerating ? "Generation" : "Lancer NAIA"}
                onClick={() => void generate(activeSection)}
                variant="primary"
              />
              <ActionButton
                disabled={isSpeaking}
                icon={Volume2}
                label={isSpeaking ? "Lecture" : "Audio"}
                onClick={() => void speakCurrentAnswer()}
                variant="secondary"
              />
            </div>
          </div>

          <VoiceActivity
            isListening={isListening}
            isProcessing={isGenerating}
            isSpeaking={isSpeaking}
          />

          <nav
            className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
            aria-label="Navigation NAIA"
          >
            {naiaSections.map((item) => {
              const Icon = item.icon;
              const isActive = item.id === activeSection;

              return (
                <Link
                  className={`flex min-h-14 items-center justify-between rounded-md border px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${
                    isActive
                      ? "border-teal-700 bg-teal-700 text-white"
                      : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50 dark:border-stone-800 dark:bg-white dark:hover:bg-stone-100"
                  }`}
                  href={item.href}
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                >
                  <span className="flex items-center gap-2">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {item.label}
                  </span>
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              );
            })}
          </nav>
        </section>
      )}

      <div
        className={
          focusMode
            ? "grid gap-3"
            : "grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]"
        }
      >
        <section className="min-w-0">
          {activeSection === "overview" ? (
            <OverviewPanel onNavigate={navigateTo} />
          ) : null}
          {activeSection === "leads" ? (
            <LeadsPanel
              onGenerate={(prompt) => void generate("leads", prompt)}
            />
          ) : null}
          {activeSection === "cash-flow" ? (
            <CashPanel
              maxBalance={maxBalance}
              onGenerate={(prompt) => generate("cash-flow", prompt)}
            />
          ) : null}
          {activeSection === "crm" ? (
            <CrmPanel onGenerate={(prompt) => void generate("crm", prompt)} />
          ) : null}
          {activeSection === "projects" ? (
            <ProjectsPanel
              onGenerate={(prompt) => void generate("projects", prompt)}
            />
          ) : null}
          {activeSection === "hr" ? (
            <HrPanel onGenerate={(prompt) => void generate("hr", prompt)} />
          ) : null}
        </section>

        {focusMode ? null : (
          <aside
            className="min-w-0 space-y-4 xl:sticky xl:top-24 xl:self-start"
            aria-label="Assistant NAIA"
          >
            <Panel>
              <div className="flex items-center gap-2 text-sm font-semibold text-stone-950">
                <Headphones
                  className="h-4 w-4 text-stone-500"
                  aria-hidden="true"
                />
                Console vocale
              </div>
              <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-100">
                <p className="text-xs font-semibold uppercase text-stone-500">
                  Transcription
                </p>
                <p className="mt-2 min-h-10 text-sm leading-6 text-stone-700">
                  {voiceTranscript || "En attente d'une commande NAIA."}
                </p>
              </div>
              {voiceNotice ? (
                <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800">
                  {voiceNotice}
                </p>
              ) : null}
              <div className="mt-3 grid gap-2">
                {commandExamples.map((command) => (
                  <button
                    className="flex min-h-11 items-start gap-2 rounded-md border border-stone-200 bg-white px-3 py-2 text-left text-sm leading-5 text-stone-700 transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:border-stone-800"
                    key={command}
                    onClick={() => {
                      primeVoicePlayback();
                      void handleVoiceCommand(command);
                    }}
                    type="button"
                  >
                    <Play
                      className="mt-0.5 h-4 w-4 shrink-0 text-stone-500"
                      aria-hidden="true"
                    />
                    <span>{command}</span>
                  </button>
                ))}
              </div>
            </Panel>

            <section className="rounded-lg border border-stone-900 bg-stone-950 p-4 text-white shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Sparkles
                    className="h-4 w-4 text-teal-300"
                    aria-hidden="true"
                  />
                  Reponse NAIA
                </div>
                {isGenerating ? (
                  <RefreshCw
                    className="h-4 w-4 animate-spin text-teal-200"
                    aria-hidden="true"
                  />
                ) : null}
              </div>
              <p className="mt-4 whitespace-pre-line text-sm leading-6 text-stone-100">
                {assistantOutput}
              </p>
            </section>
          </aside>
        )}
      </div>
    </div>
  );
}

function OverviewPanel({
  onNavigate,
}: {
  onNavigate: (sectionId: NaiaSectionId) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {executiveActions.map((action) => (
          <KpiCard
            detail="Pret pour le cockpit"
            icon={action.icon}
            key={action.label}
            label={action.label}
            value={action.value}
          />
        ))}
      </div>

      <Panel>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-stone-950">
              Parcours executif
            </h2>
            <p className="mt-1 text-sm leading-6 text-stone-600">
              Un parcours client en cinq decisions, pilotable par commandes
              vocales.
            </p>
          </div>
          <span className="inline-flex w-fit items-center rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-semibold text-stone-700">
            12 minutes
          </span>
        </div>
        <div className="mt-5 grid gap-3">
          {naiaSections.slice(1).map((item, index) => (
            <button
              className="flex min-h-16 items-center justify-between rounded-md border border-stone-200 bg-white px-4 py-3 text-left transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 dark:border-stone-800"
              key={item.id}
              onClick={() => onNavigate(item.id)}
              type="button"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-stone-950 text-sm font-semibold text-white">
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold text-stone-950">
                    {item.label}
                  </span>
                  <span className="mt-1 block text-sm leading-5 text-stone-600">
                    {item.summary}
                  </span>
                </span>
              </span>
              <ArrowRight
                className="ml-3 h-4 w-4 shrink-0 text-stone-500"
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        {generatedAssets.map((asset) => (
          <Panel key={asset.title}>
            <div className="flex items-center gap-2">
              <asset.icon
                className="h-5 w-5 text-teal-700"
                aria-hidden="true"
              />
              <h2 className="text-base font-semibold text-stone-950">
                {asset.title}
              </h2>
            </div>
            <p className="mt-3 text-sm leading-6 text-stone-600">
              {asset.body}
            </p>
          </Panel>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <h2 className="text-lg font-semibold text-stone-950">
            Approbations en attente
          </h2>
          <div className="mt-4 grid gap-3">
            {approvalQueue.map((item) => (
              <div
                className="flex items-start justify-between gap-3 rounded-md border border-stone-200 px-3 py-3 dark:border-stone-800"
                key={item.action}
              >
                <div>
                  <p className="font-semibold text-stone-950">{item.action}</p>
                  <p className="mt-1 text-sm text-stone-600">
                    {item.owner} · {item.source}
                  </p>
                </div>
                <span
                  className={`rounded-full border px-2 py-1 text-xs font-semibold ${riskClasses[item.risk]}`}
                >
                  {riskLabel[item.risk]}
                </span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <h2 className="text-lg font-semibold text-stone-950">
            Integration readiness
          </h2>
          <div className="mt-4 grid gap-3">
            {integrationHealth.map((item) => (
              <div
                className="flex items-start justify-between gap-3 rounded-md border border-stone-200 px-3 py-3 dark:border-stone-800"
                key={item.label}
              >
                <div>
                  <p className="font-semibold text-stone-950">{item.label}</p>
                  <p className="mt-1 text-sm text-stone-600">{item.owner}</p>
                </div>
                <span
                  className={`rounded-full border px-2 py-1 text-xs font-semibold ${
                    item.status === "Connecte"
                      ? "border-teal-200 bg-teal-50 text-teal-800"
                      : "border-amber-200 bg-amber-50 text-amber-800"
                  }`}
                >
                  {item.status}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function LeadsPanel({ onGenerate }: { onGenerate: (prompt: string) => void }) {
  const [sector, setSector] = useState("Industrie");
  const [minRevenue, setMinRevenue] = useState("30");
  const [maxRevenue, setMaxRevenue] = useState("80");
  const prompt = `Liste les societes au Maroc dans le secteur ${sector}, entre ${minRevenue} et ${maxRevenue} MDH de CA, avec key people et proximite reseau.`;

  return (
    <div className="space-y-6">
      <Panel>
        <div className="grid gap-4 lg:grid-cols-[1fr_120px_120px_auto] lg:items-end">
          <Field label="Secteur">
            <select
              className="min-h-11 rounded-md border border-stone-300 bg-white px-3 text-sm text-stone-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
              onChange={(event) => setSector(event.target.value)}
              value={sector}
            >
              <option>Industrie</option>
              <option>Sante</option>
              <option>Logistique</option>
              <option>Retail</option>
              <option>Services B2B</option>
            </select>
          </Field>
          <Field label="CA min">
            <input
              className="min-h-11 rounded-md border border-stone-300 px-3 text-sm text-stone-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
              inputMode="numeric"
              onChange={(event) => setMinRevenue(event.target.value)}
              value={minRevenue}
            />
          </Field>
          <Field label="CA max">
            <input
              className="min-h-11 rounded-md border border-stone-300 px-3 text-sm text-stone-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
              inputMode="numeric"
              onChange={(event) => setMaxRevenue(event.target.value)}
              value={maxRevenue}
            />
          </Field>
          <ActionButton
            icon={Search}
            label="Scanner"
            onClick={() => onGenerate(prompt)}
            variant="primary"
          />
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        {leadCompanies.map((lead) => (
          <Panel key={lead.name}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-teal-700">
                  {lead.city} · {lead.sector}
                </p>
                <h2 className="mt-1 text-xl font-semibold text-stone-950">
                  {lead.name}
                </h2>
              </div>
              <span className="rounded-md bg-stone-950 px-3 py-2 text-sm font-semibold text-white">
                {lead.score}
              </span>
            </div>
            <div className="mt-4 grid gap-2 text-sm leading-6 text-stone-700">
              <InfoLine label="CA estime" value={lead.revenue} />
              <InfoLine label="Proximite" value={lead.proximity} />
              <InfoLine label="Signal" value={lead.signal} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {lead.keyPeople.map((person) => (
                <span
                  className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-semibold text-stone-700"
                  key={person}
                >
                  {person}
                </span>
              ))}
            </div>
            <p className="mt-4 rounded-md border border-teal-200 bg-teal-50 p-3 text-sm leading-6 text-teal-900">
              {lead.nextMove}
            </p>
          </Panel>
        ))}
      </div>
    </div>
  );
}

function CashPanel({
  maxBalance,
  onGenerate,
}: {
  maxBalance: number;
  onGenerate: (prompt: string) => Promise<string>;
}) {
  const [cashHorizon, setCashHorizon] = useState<3 | 6 | 12>(6);
  const [isCashAnalysisModalOpen, setIsCashAnalysisModalOpen] = useState(false);
  const [isRelancesModalOpen, setIsRelancesModalOpen] = useState(false);
  const [isCashAnalysisLoading, setIsCashAnalysisLoading] = useState(false);
  const [isRelancesLoading, setIsRelancesLoading] = useState(false);
  const [cashAnalysisResult, setCashAnalysisResult] = useState("");
  const [relancesResult, setRelancesResult] = useState("");
  const [delayedClients, setDelayedClients] = useState<Record<string, boolean>>(
    {},
  );
  const visibleCashMonths = cashMonths.slice(0, cashHorizon);
  const currentMonth = cashMonths[0];
  const lowestBalanceMonth = visibleCashMonths.reduce(
    (lowest, month) => (month.balance < lowest.balance ? month : lowest),
    visibleCashMonths[0],
  );
  const latePaymentCount = paymentPlans.filter(
    (plan) => plan.status === "late",
  ).length;
  const nextPayment =
    paymentPlans.find((plan) => plan.status === "on-track") ?? paymentPlans[0];
  const currentCosts = costs.reduce((total, cost) => total + cost.amount, 0);
  const clientTotals = sumMonthlyCash(clientCashRows);
  const opexTotals = sumMonthlyCash(opexRows);
  const capexTotals = sumMonthlyCash(capexRows);
  const flowScale = Math.max(
    maxBalance,
    ...visibleCashMonths.flatMap((month) => [month.inflow, month.outflow]),
  );
  const visibleNet = visibleCashMonths.reduce(
    (total, month) => total + month.inflow - month.outflow,
    0,
  );
  const cashKpis = [
    {
      dot: "var(--maison-brass)",
      label: `SOLDE PROJETÉ · FIN ${currentMonth.month}`,
      sub: `Creux ${lowestBalanceMonth.month} : ${formatMad(lowestBalanceMonth.balance)}`,
      value: formatMad(currentMonth.balance),
    },
    {
      dot: "#0d9488",
      label: `ENCAISSEMENTS · ${currentMonth.month}`,
      sub: "",
      value: formatMad(currentMonth.inflow),
    },
    {
      dot: "var(--maison-brass)",
      label: `DÉCAISSEMENTS · ${currentMonth.month}`,
      sub: "",
      value: formatMad(currentMonth.outflow),
    },
    {
      dot: "var(--maison-brass)",
      label: "PROCHAIN ENCAISSEMENT",
      sub: `${nextPayment.client} · ${nextPayment.dueDate}`,
      value: formatMad(nextPayment.nextPayment),
    },
  ];

  const generateCashAnalysis = async () => {
    setIsCashAnalysisModalOpen(true);
    setIsCashAnalysisLoading(true);

    try {
      const result = await onGenerate(
        `Analyse les prévisions de trésorerie des ${cashHorizon} prochains mois, les risques et les actions prioritaires. Appuie-toi uniquement sur les données opérationnelles fournies et cite les montants exacts.`,
      );
      setCashAnalysisResult(result);
    } finally {
      setIsCashAnalysisLoading(false);
    }
  };

  const generateRelances = async () => {
    setIsRelancesModalOpen(true);
    setIsRelancesLoading(true);

    try {
      const result = await onGenerate(
        "Priorise les relances cash et prépare les brouillons d'emails clients à partir des factures fournies. Cite les montants exacts et ne prétends ni enregistrer ni envoyer quoi que ce soit sans validation humaine.",
      );
      setRelancesResult(result);
    } finally {
      setIsRelancesLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-end 2xl:justify-between">
        <div>
          <p
            className="text-[10px] font-bold uppercase tracking-[0.15em]"
            style={{ color: "var(--maison-brass)" }}
          >
            FINANCE & TRÉSORERIE
          </p>
          <div className="mt-1 flex items-baseline gap-3">
            <h1
              className="text-4xl font-serif tracking-tight"
              style={{ color: "var(--maison-text-primary)" }}
            >
              Finance OS
            </h1>
            <p
              className="text-sm font-medium"
              style={{ color: "var(--maison-text-secondary)" }}
            >
              Trésorerie nette actuelle :{" "}
              <span className="font-bold text-emerald-600">
                {formatShortMad(currentMonth.balance)}
              </span>{" "}
              · {latePaymentCount} facture{latePaymentCount !== 1 ? "s" : ""} en
              retard
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div
            className="flex items-center rounded-md border p-1"
            style={{
              background: "var(--maison-card)",
              borderColor: "var(--maison-border)",
            }}
          >
            {([3, 6, 12] as const).map((range) => (
              <button
                key={range}
                aria-pressed={cashHorizon === range}
                className={`rounded px-3 py-1 text-xs font-semibold transition ${
                  cashHorizon === range ? "shadow-xs" : ""
                }`}
                onClick={() => setCashHorizon(range)}
                style={{
                  background:
                    cashHorizon === range
                      ? "var(--maison-card)"
                      : "transparent",
                  color:
                    cashHorizon === range
                      ? "var(--maison-text-primary)"
                      : "var(--maison-text-secondary)",
                }}
                type="button"
              >
                {range} mois
              </button>
            ))}
          </div>
          <button
            className="flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-semibold uppercase tracking-wider transition hover:opacity-85 shadow-2xs"
            onClick={() => void generateCashAnalysis()}
            style={{
              background: "var(--maison-card)",
              borderColor: "var(--maison-border)",
              color: "var(--maison-text-primary)",
            }}
            type="button"
          >
            Analyser cash
          </button>
          <button
            className="flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold uppercase tracking-wider transition hover:opacity-90 shadow-2xs text-white"
            onClick={() => void generateRelances()}
            style={{
              background: "var(--maison-sidebar)",
            }}
            type="button"
          >
            <WandSparkles className="h-4 w-4 text-[#e0c07a]" />
            Préparer relances
          </button>
        </div>
      </div>

      {/* Modal Analyse Cash */}
      {isCashAnalysisModalOpen && (
        <div
          aria-labelledby="cash-analysis-title"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-md transition-all"
          role="dialog"
          style={{ background: "rgba(20, 41, 60, 0.55)" }}
          onClick={() => setIsCashAnalysisModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-2xl rounded-2xl border p-6 shadow-2xl space-y-5 max-h-[85vh] overflow-y-auto"
            style={{
              background: "#f6f3ec",
              borderColor: "#e0d8c8",
            }}
          >
            <div
              className="flex items-center justify-between border-b pb-3"
              style={{ borderColor: "#e0d8c8" }}
            >
              <div>
                <p
                  className="text-[10px] font-bold uppercase tracking-wider"
                  style={{ color: "#b08d4f" }}
                >
                  FINANCE & CASH FORECAST
                </p>
                <h2
                  id="cash-analysis-title"
                  className="text-xl font-bold tracking-tight"
                  style={{
                    fontFamily: "var(--font-playfair), Georgia, serif",
                    color: "#14293c",
                  }}
                >
                  Analyse Prévisionnelle de Trésorerie ({cashHorizon} Mois)
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsCashAnalysisModalOpen(false)}
                className="rounded-full border p-1 text-[#14293c] hover:opacity-70"
                style={{ background: "#fcfbf7", borderColor: "#e0d8c8" }}
                aria-label="Fermer l'analyse de trésorerie"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div
                className="rounded-xl border p-3.5"
                style={{ background: "#fcfbf7", borderColor: "#e0d8c8" }}
              >
                <p className="text-[9px] font-bold uppercase tracking-wider text-[#5c6b7a]">
                  Solde Actuel
                </p>
                <p className="mt-1 text-lg font-bold text-emerald-700">
                  {formatMad(currentMonth.balance)}
                </p>
              </div>
              <div
                className="rounded-xl border p-3.5"
                style={{ background: "#fcfbf7", borderColor: "#e0d8c8" }}
              >
                <p className="text-[9px] font-bold uppercase tracking-wider text-[#5c6b7a]">
                  Flux Net Cumulé
                </p>
                <p className="mt-1 text-lg font-bold text-[#14293c]">
                  {visibleNet >= 0 ? "+" : ""}
                  {formatShortMad(visibleNet)}
                </p>
              </div>
              <div
                className="rounded-xl border p-3.5"
                style={{ background: "#fcfbf7", borderColor: "#e0d8c8" }}
              >
                <p className="text-[9px] font-bold uppercase tracking-wider text-[#5c6b7a]">
                  Point Bas Estimé
                </p>
                <p className="mt-1 text-lg font-bold text-[#14293c]">
                  {formatMad(lowestBalanceMonth.balance)} (
                  {lowestBalanceMonth.month})
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-[#e0d8c8] bg-[#fcfbf7] p-4 text-xs space-y-2 text-[#14293c]">
              <p className="font-bold uppercase text-[10px] text-[#b08d4f]">
                Analyse NAIA
              </p>
              {isCashAnalysisLoading ? (
                <p className="flex items-center gap-2 py-2">
                  <RefreshCw
                    className="h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                  NAIA analyse les prévisions…
                </p>
              ) : (
                <p className="whitespace-pre-line leading-6">
                  {cashAnalysisResult}
                </p>
              )}
            </div>

            <div
              className="flex justify-end pt-3 border-t"
              style={{ borderColor: "#e0d8c8" }}
            >
              <div className="flex flex-wrap justify-end gap-3">
                <button
                  type="button"
                  onClick={() => void generateCashAnalysis()}
                  className="rounded-xl border px-4 py-2.5 text-xs font-semibold uppercase tracking-wider"
                  disabled={isCashAnalysisLoading}
                  style={{
                    background: "#fcfbf7",
                    borderColor: "#e0d8c8",
                    color: "#14293c",
                  }}
                >
                  Régénérer
                </button>
                <button
                  type="button"
                  onClick={() => setIsCashAnalysisModalOpen(false)}
                  className="rounded-xl px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-2xs"
                  style={{ background: "#14293c" }}
                >
                  FERMER LE DIAGNOSTIC
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Préparer Relances */}
      {isRelancesModalOpen && (
        <div
          aria-labelledby="cash-relances-title"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-md transition-all"
          role="dialog"
          style={{ background: "rgba(20, 41, 60, 0.55)" }}
          onClick={() => setIsRelancesModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-2xl rounded-2xl border p-6 shadow-2xl space-y-5 max-h-[85vh] overflow-y-auto"
            style={{
              background: "#f6f3ec",
              borderColor: "#e0d8c8",
            }}
          >
            <div
              className="flex items-center justify-between border-b pb-3"
              style={{ borderColor: "#e0d8c8" }}
            >
              <div>
                <p
                  className="text-[10px] font-bold uppercase tracking-wider"
                  style={{ color: "#b08d4f" }}
                >
                  RECOUVREMENT & FACTURATION
                </p>
                <h2
                  id="cash-relances-title"
                  className="text-xl font-bold tracking-tight"
                  style={{
                    fontFamily: "var(--font-playfair), Georgia, serif",
                    color: "#14293c",
                  }}
                >
                  Brouillons de Relances Client ({clientRelances.length}{" "}
                  Factures)
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsRelancesModalOpen(false)}
                className="rounded-full border p-1 text-[#14293c] hover:opacity-70"
                style={{ background: "#fcfbf7", borderColor: "#e0d8c8" }}
                aria-label="Fermer les brouillons de relance"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              {clientRelances.map((relance) => (
                <div
                  key={relance.client}
                  className="rounded-xl border p-4 shadow-2xs space-y-2"
                  style={{ background: "#fcfbf7", borderColor: "#e0d8c8" }}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-bold text-[#14293c]">
                        {relance.client}
                      </h4>
                      <p className="text-xs text-[#5c6b7a]">
                        Échéance : {relance.dueDate} ·{" "}
                        <span className="font-bold text-rose-700">
                          {formatMad(relance.amount)}
                        </span>
                      </p>
                    </div>
                    <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-[10px] font-bold text-rose-800">
                      À RELANCER
                    </span>
                  </div>
                  <p className="text-xs bg-[#f6f3ec] p-3 rounded-lg border border-[#e0d8c8] text-[#14293c] italic">
                    &quot;{relance.reason}&quot;
                  </p>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-[#e0d8c8] bg-[#fcfbf7] p-4 text-xs space-y-2 text-[#14293c]">
              <p className="font-bold uppercase text-[10px] text-[#b08d4f]">
                Réponse NAIA à valider
              </p>
              {isRelancesLoading ? (
                <p className="flex items-center gap-2 py-2">
                  <RefreshCw
                    className="h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                  NAIA prépare les brouillons à valider…
                </p>
              ) : (
                <p className="whitespace-pre-line leading-6">
                  {relancesResult}
                </p>
              )}
              <p className="border-t border-[#e0d8c8] pt-2 text-[10px] font-semibold uppercase tracking-wider text-[#5c6b7a]">
                Aucun email n&apos;est enregistré ni envoyé depuis cette
                fenêtre.
              </p>
            </div>

            <div
              className="flex justify-end gap-3 pt-3 border-t"
              style={{ borderColor: "#e0d8c8" }}
            >
              <button
                type="button"
                onClick={() => void generateRelances()}
                disabled={isRelancesLoading}
                className="rounded-xl border px-4 py-2.5 text-xs font-semibold uppercase tracking-wider"
                style={{
                  background: "#fcfbf7",
                  borderColor: "#e0d8c8",
                  color: "#14293c",
                }}
              >
                RÉGÉNÉRER
              </button>
              <button
                type="button"
                onClick={() => setIsRelancesModalOpen(false)}
                className="rounded-xl px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-2xs"
                style={{ background: "#14293c" }}
              >
                FERMER
              </button>
            </div>
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
        {cashKpis.map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-xl border p-3.5 sm:p-4 shadow-xs"
            style={{
              background: "var(--maison-card)",
              borderColor: "var(--maison-border)",
            }}
          >
            <p
              className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-2"
              style={{ color: "var(--maison-brass)" }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: kpi.dot }}
              />
              {kpi.label}
            </p>
            <h3
              className="mt-1 text-xl font-bold tracking-tight"
              style={{ color: "var(--maison-text-primary)" }}
            >
              {kpi.value}
            </h3>
            {kpi.sub && (
              <p
                className="mt-1 text-[11px] font-medium"
                style={{ color: "var(--maison-text-secondary)" }}
              >
                {kpi.sub}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Middle Grid */}
      <div className="grid gap-4 2xl:grid-cols-3">
        {/* Chart */}
        <div
          className="min-w-0 rounded-xl border p-6 shadow-sm lg:col-span-2"
          style={{
            background: "var(--maison-card)",
            borderColor: "var(--maison-border)",
          }}
        >
          <div className="flex items-center justify-between mb-8">
            <h3
              className="text-[11px] font-bold uppercase tracking-wider"
              style={{ color: "var(--maison-text-secondary)" }}
            >
              FLUX PRÉVISIONNELS · {visibleCashMonths[0].month} ➔{" "}
              {visibleCashMonths.at(-1)?.month}
            </h3>
            <div
              className="flex items-center gap-4 text-[10px] font-bold uppercase"
              style={{ color: "var(--maison-text-secondary)" }}
            >
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: "#14b8a6" }}
                />{" "}
                Encaissements
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: "#d6d3d1" }}
                />{" "}
                Décaissements
              </span>
            </div>
          </div>

          <div className="h-48 flex items-end justify-between px-4">
            {visibleCashMonths.map((m) => {
              const inHeight = (m.inflow / flowScale) * 100;
              const outHeight = (m.outflow / flowScale) * 100;
              const net = m.inflow - m.outflow;

              return (
                <div
                  key={m.month}
                  className="flex flex-col items-center gap-3 w-16"
                >
                  <div className="flex items-end gap-1.5 h-32 w-full justify-center">
                    <div
                      className="w-3 rounded-t-sm transition-all"
                      style={{ height: `${inHeight}%`, background: "#14b8a6" }}
                    />
                    <div
                      className="w-3 rounded-t-sm transition-all"
                      style={{ height: `${outHeight}%`, background: "#d6d3d1" }}
                    />
                  </div>
                  <div className="text-center">
                    <p
                      className="text-[11px] font-bold uppercase"
                      style={{ color: "var(--maison-text-primary)" }}
                    >
                      {m.month}
                    </p>
                    <p
                      className={`text-[10px] font-bold mt-1 ${net >= 0 ? "text-emerald-600" : "text-rose-600"}`}
                    >
                      {net >= 0 ? "+" : ""}
                      {net / 1000} k
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          <div
            className="mt-4 border-t pt-3 text-[10px]"
            style={{
              borderColor: "var(--maison-border)",
              color: "var(--maison-text-secondary)",
            }}
          >
            Net = encaissements - décaissements · cumul {cashHorizon} mois :{" "}
            {visibleNet >= 0 ? "+" : ""}
            {formatShortMad(visibleNet)}
          </div>
        </div>

        {/* Sorties */}
        <div
          className="min-w-0 rounded-xl border p-6 shadow-sm"
          style={{
            background: "var(--maison-card)",
            borderColor: "var(--maison-border)",
          }}
        >
          <div
            className="flex items-center justify-between border-b pb-3 mb-4"
            style={{ borderColor: "var(--maison-border)" }}
          >
            <h3
              className="text-[11px] font-bold uppercase tracking-wider"
              style={{ color: "var(--maison-text-secondary)" }}
            >
              SORTIES · {currentMonth.month}
            </h3>
            <span
              className="text-[11px] font-bold"
              style={{ color: "var(--maison-text-primary)" }}
            >
              {formatMad(currentCosts)}
            </span>
          </div>
          <div className="space-y-4">
            {costs.map((c) => (
              <div key={c.name} className="flex items-center justify-between">
                <div>
                  <p
                    className="text-sm font-bold"
                    style={{ color: "var(--maison-text-primary)" }}
                  >
                    {c.name}
                  </p>
                  <p
                    className="text-[10px] font-semibold uppercase mt-0.5"
                    style={{ color: "var(--maison-text-secondary)" }}
                  >
                    {c.type} · {c.date}
                  </p>
                </div>
                <span
                  className="text-sm font-semibold"
                  style={{ color: "var(--maison-text-primary)" }}
                >
                  {formatMad(c.amount).replace(" MAD", "")}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tables Bottom */}
      <div className="grid gap-4 2xl:grid-cols-2">
        {/* Plans de paiement */}
        <div
          className="min-w-0 rounded-xl border p-6 shadow-sm"
          style={{
            background: "var(--maison-card)",
            borderColor: "var(--maison-border)",
          }}
        >
          <div className="overflow-x-auto">
            <div className="min-w-[620px]">
              <div
                className="grid border-b pb-3 mb-4 text-[10px] font-bold uppercase tracking-wider"
                style={{
                  gridTemplateColumns: "3fr 2fr 2fr 1fr 1fr",
                  borderColor: "var(--maison-border)",
                  color: "var(--maison-text-secondary)",
                }}
              >
                <div>PLANS DE PAIEMENT</div>
                <div>PLAN</div>
                <div className="text-right">PROCHAIN</div>
                <div className="text-right">ÉCHÉANCE</div>
                <div className="text-right">STATUT</div>
              </div>
              <div className="space-y-4">
                {paymentPlans.map((p) => (
                  <div
                    key={p.client}
                    className="grid items-center text-sm"
                    style={{ gridTemplateColumns: "3fr 2fr 2fr 1fr 1fr" }}
                  >
                    <div>
                      <p
                        className="font-bold"
                        style={{ color: "var(--maison-text-primary)" }}
                      >
                        {p.client}
                      </p>
                      <p
                        className="text-[10px]"
                        style={{ color: "var(--maison-text-secondary)" }}
                      >
                        {p.project}
                      </p>
                    </div>
                    <div
                      className="text-xs font-semibold"
                      style={{ color: "var(--maison-text-secondary)" }}
                    >
                      {p.plan}
                    </div>
                    <div
                      className="text-right font-bold"
                      style={{ color: "var(--maison-text-primary)" }}
                    >
                      {formatMad(p.nextPayment).replace(" MAD", "")}
                    </div>
                    <div
                      className="text-right text-xs"
                      style={{ color: "var(--maison-text-secondary)" }}
                    >
                      {p.dueDate}
                    </div>
                    <div className="text-right">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          p.status === "on-track"
                            ? "bg-emerald-50 text-emerald-700"
                            : p.status === "late"
                              ? "bg-rose-50 text-rose-700"
                              : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {p.status === "on-track"
                          ? "À l'heure"
                          : p.status === "late"
                            ? "En retard"
                            : "À risque"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Détail du cash */}
        <div
          className="flex min-w-0 flex-col overflow-hidden rounded-xl border p-6 shadow-sm"
          style={{
            background: "var(--maison-card)",
            borderColor: "var(--maison-border)",
          }}
        >
          <div
            className="flex flex-col sm:flex-row sm:items-center justify-between border-b pb-3 mb-4 gap-2"
            style={{ borderColor: "var(--maison-border)" }}
          >
            <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-wider flex-wrap">
              <span style={{ color: "var(--maison-text-secondary)" }}>
                DÉTAIL · {currentMonth.month}
              </span>
              <span className="text-emerald-600">
                +{formatShortMad(currentMonth.inflow)}
              </span>
              <span className="text-rose-600">
                -{formatShortMad(currentMonth.outflow)}
              </span>
              <span style={{ color: "var(--maison-text-primary)" }}>net</span>
              <span
                className={
                  currentMonth.inflow - currentMonth.outflow >= 0
                    ? "text-emerald-600"
                    : "text-rose-600"
                }
              >
                {currentMonth.inflow - currentMonth.outflow >= 0 ? "+" : ""}
                {formatShortMad(currentMonth.inflow - currentMonth.outflow)}
              </span>
            </div>
            <div className="flex gap-2">
              <span
                className="rounded-full border px-2 py-0.5 text-[10px] font-bold"
                style={{
                  borderColor: "#14b8a6",
                  color: "#0f766e",
                  background: "#f0fdfa",
                }}
              >
                CA clients
              </span>
              <span
                className="rounded-full border px-2 py-0.5 text-[10px] font-bold"
                style={{
                  borderColor: "var(--maison-border)",
                  color: "var(--maison-text-secondary)",
                }}
              >
                OPEX
              </span>
              <span
                className="rounded-full border px-2 py-0.5 text-[10px] font-bold"
                style={{
                  borderColor: "var(--maison-border)",
                  color: "var(--maison-text-secondary)",
                }}
              >
                CAPEX
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 flex-1 min-h-0">
            {/* Col 1 */}
            <div
              className="space-y-4 sm:border-r sm:pr-4"
              style={{ borderColor: "var(--maison-border)" }}
            >
              <div className="flex justify-between items-center text-[10px] font-bold uppercase mb-2">
                <span
                  className="flex items-center gap-1.5"
                  style={{ color: "var(--maison-text-primary)" }}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{" "}
                  CA CLIENTS
                </span>
                <span className="text-emerald-600">
                  +{formatShortMad(clientTotals[0])}
                </span>
              </div>
              {clientCashRows.slice(0, 3).map((c) => (
                <div
                  key={c.client}
                  className="flex justify-between items-start text-xs"
                >
                  <div className="min-w-0 pr-2">
                    <p
                      className="font-bold truncate"
                      style={{ color: "var(--maison-text-primary)" }}
                    >
                      {c.client}
                    </p>
                    <p
                      className="text-[10px] truncate"
                      style={{ color: "var(--maison-text-secondary)" }}
                    >
                      {c.status}
                    </p>
                  </div>
                  <span className="text-emerald-600 font-semibold whitespace-nowrap">
                    {c.monthlyCash[0]
                      ? `+${formatMad(c.monthlyCash[0]).replace(" MAD", "").replace(" 000", "k")}`
                      : "-"}
                  </span>
                </div>
              ))}
            </div>
            {/* Col 2 */}
            <div
              className="space-y-4 sm:border-r sm:pr-4"
              style={{ borderColor: "var(--maison-border)" }}
            >
              <div className="flex justify-between items-center text-[10px] font-bold uppercase mb-2">
                <span
                  className="flex items-center gap-1.5"
                  style={{ color: "var(--maison-text-primary)" }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: "var(--maison-brass)" }}
                  />{" "}
                  OPEX
                </span>
                <span className="text-rose-600">
                  -{formatShortMad(opexTotals[0])}
                </span>
              </div>
              {costs.slice(0, 3).map((c) => (
                <div
                  key={c.name}
                  className="flex justify-between items-start text-xs"
                >
                  <div className="min-w-0 pr-2">
                    <p
                      className="font-bold truncate"
                      style={{ color: "var(--maison-text-primary)" }}
                    >
                      {c.name}
                    </p>
                    <p
                      className="text-[10px] truncate"
                      style={{ color: "var(--maison-text-secondary)" }}
                    >
                      {c.type}
                    </p>
                  </div>
                  <span className="text-rose-600 font-semibold whitespace-nowrap">
                    -
                    {formatMad(c.amount)
                      .replace(" MAD", "")
                      .replace(" 000", "k")}
                  </span>
                </div>
              ))}
            </div>
            {/* Col 3 */}
            <div className="space-y-4">
              <div className="flex justify-between items-center text-[10px] font-bold uppercase mb-2">
                <span
                  className="flex items-center gap-1.5"
                  style={{ color: "var(--maison-text-primary)" }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: "var(--maison-brass)" }}
                  />{" "}
                  CAPEX
                </span>
                <span className="text-rose-600">
                  -{formatShortMad(capexTotals[0])}
                </span>
              </div>
              {capexRows.slice(0, 2).map((c) => (
                <div
                  key={c.label}
                  className="flex justify-between items-start text-xs"
                >
                  <div className="min-w-0 pr-2">
                    <p
                      className="font-bold truncate"
                      style={{ color: "var(--maison-text-primary)" }}
                    >
                      {c.label}
                    </p>
                  </div>
                  <span className="text-rose-600 font-semibold whitespace-nowrap">
                    -
                    {formatMad(c.monthlyCash[0] || 0)
                      .replace(" MAD", "")
                      .replace(" 000", "k")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2
                className="text-lg font-semibold"
                style={{ color: "var(--maison-text-primary)" }}
              >
                Détail 12 mois
              </h2>
              <p
                className="mt-1 text-xs"
                style={{ color: "var(--maison-text-secondary)" }}
              >
                Déplie chaque ligne pour retrouver les hypothèses clients, OPEX
                et CAPEX.
              </p>
            </div>
          </div>
          <div className="mt-4 overflow-x-auto">
            <div className="min-w-[1180px]">
              <div
                className="grid items-center gap-2 border-b pb-2 text-xs font-semibold uppercase"
                style={{
                  borderColor: "var(--maison-border)",
                  color: "var(--maison-text-secondary)",
                  gridTemplateColumns: "190px repeat(12, minmax(70px, 1fr))",
                }}
              >
                <div>Ligne</div>
                {cashMonths.map((month) => (
                  <div className="text-right" key={month.month}>
                    {month.month}
                  </div>
                ))}
              </div>
              <div className="mt-2 space-y-2">
                <CashGroup
                  detailRows={clientCashRows.map((row) => ({
                    label: row.client,
                    monthlyCash: row.monthlyCash,
                    note: delayedClients[row.client]
                      ? "Encaissement décalé"
                      : `${row.owner} · ${row.status}`,
                  }))}
                  label="Clients (revenus)"
                  monthlyCash={clientTotals}
                  tone="revenue"
                />
                <CashGroup
                  detailRows={opexRows}
                  label="OPEX"
                  monthlyCash={opexTotals}
                  tone="cost"
                />
                <CashGroup
                  detailRows={capexRows}
                  label="CAPEX"
                  monthlyCash={capexTotals}
                  tone="cost"
                />
              </div>
            </div>
          </div>
        </Panel>

        <Panel>
          <div
            className="flex items-center justify-between gap-3 pb-3 border-b"
            style={{ borderColor: "var(--maison-border)" }}
          >
            <h2
              className="text-base font-semibold tracking-tight"
              style={{
                fontFamily: "var(--font-playfair), Georgia, serif",
                color: "var(--maison-text-primary)",
              }}
            >
              Clients à relancer
            </h2>
            <span
              className="rounded-full border px-2.5 py-0.5 text-xs font-bold shadow-2xs"
              style={{
                background: "rgba(176,141,79,0.12)",
                borderColor: "var(--maison-border)",
                color: "var(--maison-brass)",
              }}
            >
              {clientRelances.length}
            </span>
          </div>
          <div
            className="divide-y"
            style={{ borderColor: "var(--maison-border)" }}
          >
            {clientRelances.map((relance) => (
              <div
                className="py-3 transition-colors hover:bg-[rgba(176,141,79,0.03)] px-1 rounded-lg"
                key={relance.client}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p
                      className="font-semibold text-sm tracking-tight"
                      style={{
                        fontFamily: "var(--font-playfair), Georgia, serif",
                        color: "var(--maison-text-primary)",
                      }}
                    >
                      {relance.client}
                    </p>
                    <p
                      className="mt-0.5 text-xs font-bold"
                      style={{ color: "#b91c1c" }}
                    >
                      {formatMad(relance.amount)} · {relance.dueDate}
                    </p>
                  </div>
                  <button
                    className="rounded-lg border px-2.5 py-1 text-xs font-semibold transition hover:opacity-80 shadow-2xs"
                    onClick={() =>
                      setDelayedClients((current) => ({
                        ...current,
                        [relance.client]: !current[relance.client],
                      }))
                    }
                    style={{
                      background: "var(--maison-page)",
                      borderColor: "var(--maison-border)",
                      color: "var(--maison-text-secondary)",
                    }}
                    type="button"
                  >
                    {delayedClients[relance.client] ? "Rétablir" : "Décaler"}
                  </button>
                </div>
                <p
                  className="mt-1.5 text-xs leading-relaxed"
                  style={{ color: "var(--maison-text-secondary)" }}
                >
                  {relance.reason}
                </p>
                <MiniButton
                  onClick={() =>
                    onGenerate(
                      `Prépare une relance cash pour ${relance.client}, montant ${formatMad(relance.amount)}, échéance ${relance.dueDate}, sans l'envoyer sans validation.`,
                    )
                  }
                >
                  Préparer relance
                </MiniButton>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

export function CashGroup({
  detailRows,
  label,
  monthlyCash,
  tone,
}: {
  detailRows: { label: string; monthlyCash: number[]; note?: string }[];
  label: string;
  monthlyCash: number[];
  tone: "cost" | "revenue";
}) {
  const signedValue = (value: number) => (tone === "cost" ? -value : value);

  return (
    <details className="group" open>
      <summary
        className="grid cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-2 text-xs font-bold"
        style={{
          background: "var(--maison-border-subtle)",
          color: "var(--maison-text-primary)",
          gridTemplateColumns: "190px repeat(12, minmax(70px, 1fr))",
        }}
      >
        <div>{label}</div>
        {monthlyCash.map((val, idx) => (
          <div
            className={`text-right font-mono text-xs ${
              tone === "revenue" ? "text-emerald-700" : "text-rose-700"
            }`}
            key={`${label}-${idx}`}
          >
            {val !== 0 ? formatShortMad(signedValue(val)) : "-"}
          </div>
        ))}
      </summary>
      <div
        className="divide-y divide-[var(--maison-border-subtle)] border-t"
        style={{ borderColor: "var(--maison-border)" }}
      >
        {detailRows.map((row) => (
          <div
            className="grid items-center gap-2 py-1.5 px-2 text-xs transition-colors hover:bg-[rgba(176,141,79,0.02)]"
            key={row.label}
            style={{
              gridTemplateColumns: "190px repeat(12, minmax(70px, 1fr))",
            }}
          >
            <div className="min-w-0 pr-2">
              <p
                className="font-medium truncate"
                style={{ color: "var(--maison-text-primary)" }}
              >
                {row.label}
              </p>
              {row.note ? (
                <p
                  className="truncate text-[10px]"
                  style={{ color: "var(--maison-text-secondary)" }}
                >
                  {row.note}
                </p>
              ) : null}
            </div>
            {row.monthlyCash.map((val, idx) => (
              <div
                className="text-right font-mono text-[11px]"
                style={{ color: "var(--maison-text-secondary)" }}
                key={`${row.label}-${idx}`}
              >
                {val !== 0 ? formatShortMad(signedValue(val)) : "-"}
              </div>
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}

function CrmPanel({ onGenerate }: { onGenerate: (prompt: string) => void }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-4">
        {stages.map((stage) => (
          <Panel key={stage}>
            <h2 className="text-sm font-semibold text-stone-950">{stage}</h2>
            <div className="mt-4 grid gap-3">
              {pipeline
                .filter((lead) => lead.stage === stage)
                .map((lead) => (
                  <article
                    className="rounded-md border border-stone-200 p-3 dark:border-stone-800"
                    key={lead.company}
                  >
                    <p className="font-semibold text-stone-950">
                      {lead.company}
                    </p>
                    <p className="mt-1 text-sm text-stone-500">
                      {lead.owner} · {formatMad(lead.value)}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-stone-700">
                      {lead.action}
                    </p>
                    {stage === "Lead qualifie" ? (
                      <MiniButton
                        onClick={() =>
                          onGenerate(
                            `Cree un pitch meeting pour ${lead.company}, oriente CEO/CFO.`,
                          )
                        }
                      >
                        Creer pitch
                      </MiniButton>
                    ) : null}
                    {stage === "Meeting booked" ? (
                      <MiniButton
                        onClick={() =>
                          onGenerate(
                            `Cree une propale synthetique pour ${lead.company}.`,
                          )
                        }
                      >
                        Creer propale
                      </MiniButton>
                    ) : null}
                  </article>
                ))}
            </div>
          </Panel>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ListPanel
          title="Pitch genere"
          items={[
            "Enjeu client: cash + delivery",
            "Angle CEO: decisions moins aveugles",
            "Commande vocale + action CRM",
          ]}
        />
        <ListPanel
          title="Propale generee"
          items={[
            "Scope: cockpit, CRM, relances, delivery",
            "Planning: diagnostic 1 semaine, build 4 semaines",
            "Paiement: 30% / 40% / 30%",
          ]}
        />
      </div>
    </div>
  );
}

function ProjectsPanel({
  onGenerate,
}: {
  onGenerate: (prompt: string) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterRisk, setFilterRisk] = useState("all");
  const [showFilters, setShowFilters] = useState(false);

  const filteredProjects = projects.filter((p) => {
    const matchesSearch =
      p.project.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.client.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRisk = filterRisk === "all" || p.risk === filterRisk;
    return matchesSearch && matchesRisk;
  });
  const highRiskProjectCount = projects.filter(
    (project) => project.risk === "high",
  ).length;
  const averageProgress = Math.round(
    projects.reduce((total, project) => total + project.progress, 0) /
      projects.length,
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-end 2xl:justify-between">
        <div>
          <p
            className="text-[10px] font-bold uppercase tracking-[0.15em]"
            style={{ color: "var(--maison-brass)" }}
          >
            PROJETS
          </p>
          <div className="mt-1 flex items-baseline gap-3">
            <h1
              className="text-4xl font-serif tracking-tight"
              style={{ color: "var(--maison-text-primary)" }}
            >
              Delivery
            </h1>
            <p
              className="text-sm font-medium"
              style={{ color: "var(--maison-text-secondary)" }}
            >
              {projects.length} projets ·{" "}
              <span className="font-bold text-rose-700">
                {highRiskProjectCount} à risque élevé
              </span>{" "}
              · progression moy. {averageProgress} %
            </p>
          </div>
        </div>
        <div className="relative flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher un projet..."
              className="w-64 pl-9 pr-4 py-2 text-sm rounded-md border focus:outline-none focus:ring-1 focus:ring-stone-300"
              style={{
                background: "var(--maison-card)",
                borderColor: "var(--maison-border)",
                color: "var(--maison-text-primary)",
              }}
            />
          </div>
          <button
            className="flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-semibold transition"
            onClick={() => setShowFilters(!showFilters)}
            style={{
              background: "var(--maison-card)",
              borderColor: "var(--maison-border)",
              color: "var(--maison-text-secondary)",
            }}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filtres
          </button>

          {showFilters && (
            <div
              className="absolute right-0 top-12 z-50 w-56 rounded-md border p-4 shadow-lg"
              style={{
                borderColor: "var(--maison-border)",
                background: "var(--maison-card)",
                color: "var(--maison-text-primary)",
              }}
            >
              <h3
                className="text-xs font-bold uppercase mb-3 tracking-wider"
                style={{ color: "var(--maison-brass)" }}
              >
                Filtrer par risque
              </h3>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer hover:opacity-80">
                  <input
                    type="radio"
                    checked={filterRisk === "all"}
                    onChange={() => setFilterRisk("all")}
                    className="accent-rose-700"
                  />{" "}
                  Tous
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer hover:opacity-80">
                  <input
                    type="radio"
                    checked={filterRisk === "high"}
                    onChange={() => setFilterRisk("high")}
                    className="accent-rose-700"
                  />{" "}
                  Risque élevé
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer hover:opacity-80">
                  <input
                    type="radio"
                    checked={filterRisk === "medium"}
                    onChange={() => setFilterRisk("medium")}
                    className="accent-rose-700"
                  />{" "}
                  À surveiller
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer hover:opacity-80">
                  <input
                    type="radio"
                    checked={filterRisk === "low"}
                    onChange={() => setFilterRisk("low")}
                    className="accent-rose-700"
                  />{" "}
                  Sécurisé
                </label>
              </div>
            </div>
          )}

          <button
            className="flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-semibold transition hover:opacity-80"
            onClick={() =>
              onGenerate(
                "Analyse les projets en retard, cite les causes, les use cases concernés et les mois critiques.",
              )
            }
            style={{
              background: "var(--maison-card)",
              borderColor: "var(--maison-border)",
              color: "var(--maison-text-primary)",
            }}
            type="button"
          >
            <AlertTriangle className="h-4 w-4" />
            Analyser risques
          </button>

          <Link
            href="/dashboard/leads"
            className="flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition text-white hover:opacity-90 shadow-sm"
            style={{
              background: "var(--maison-text-primary)",
            }}
          >
            <Plus className="h-4 w-4" />
            Nouveau projet
          </Link>
        </div>
      </div>

      {/* Gantt Table */}
      <div
        className="rounded-xl border shadow-sm overflow-hidden"
        style={{
          background: "var(--maison-card)",
          borderColor: "var(--maison-border)",
        }}
      >
        <div className="w-full overflow-x-auto">
          <div className="min-w-[900px]">
            {/* Table Header */}
            <div
              className="grid border-b text-[10px] font-bold uppercase tracking-wider px-6 py-4"
              style={{
                gridTemplateColumns: `minmax(180px, 2fr) repeat(${projectTimelineMonths.length}, minmax(40px, 1fr)) minmax(180px, 2fr)`,
                borderColor: "var(--maison-border)",
                color: "var(--maison-text-secondary)",
              }}
            >
              <div>PROJET · CLIENT</div>
              {projectTimelineMonths.map((month) => (
                <div className="text-center" key={month}>
                  {month}
                </div>
              ))}
              <div className="text-right">RISQUE · BLOCAGE</div>
            </div>

            {/* Table Body */}
            <div
              className="divide-y divide-stone-200"
              style={{ borderColor: "var(--maison-border)" }}
            >
              {filteredProjects.map((project) => (
                <div
                  className="grid items-center px-6 py-5 relative"
                  key={project.project}
                  style={{
                    gridTemplateColumns: `minmax(180px, 2fr) repeat(${projectTimelineMonths.length}, minmax(40px, 1fr)) minmax(180px, 2fr)`,
                  }}
                >
                  {/* Column: Projet / Client */}
                  <div className="min-w-0 pr-4">
                    <h3
                      className="truncate text-[15px] font-bold"
                      style={{ color: "var(--maison-text-primary)" }}
                    >
                      {project.project}
                    </h3>
                    <p
                      className="truncate text-xs font-medium mt-0.5"
                      style={{ color: "var(--maison-text-secondary)" }}
                    >
                      {project.client}
                    </p>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {project.useCases?.map((uc) => (
                        <span
                          key={uc}
                          className="rounded border px-2 py-0.5 text-[10px] font-semibold"
                          style={{
                            background: "var(--maison-page)",
                            borderColor: "var(--maison-border)",
                            color: "var(--maison-text-secondary)",
                          }}
                        >
                          {uc}
                        </span>
                      ))}
                    </div>
                    <details className="relative z-20 mt-2 text-xs">
                      <summary
                        className="cursor-pointer font-semibold"
                        style={{ color: "var(--maison-brass)" }}
                      >
                        Détail des use cases
                      </summary>
                      <div className="mt-2 grid gap-1.5">
                        {project.useCaseDetails.map((useCase) => (
                          <div
                            className="rounded border px-2 py-1.5"
                            key={useCase.name}
                            style={{
                              background: "var(--maison-page)",
                              borderColor: "var(--maison-border)",
                            }}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span
                                className="truncate font-semibold"
                                style={{ color: "var(--maison-text-primary)" }}
                              >
                                {useCase.name}
                              </span>
                              <span
                                className="shrink-0"
                                style={{
                                  color: "var(--maison-text-secondary)",
                                }}
                              >
                                {useCase.progress}%
                              </span>
                            </div>
                            <p
                              className="mt-0.5 truncate text-[10px]"
                              style={{ color: "var(--maison-text-secondary)" }}
                            >
                              {useCase.startDate} - {useCase.endDate}
                            </p>
                          </div>
                        ))}
                      </div>
                    </details>
                  </div>

                  {/* Column: Gantt Background Lines */}
                  <div
                    className="absolute inset-y-0 pointer-events-none grid"
                    style={{
                      left: 0,
                      right: 0,
                      paddingLeft: "1.5rem", // matching px-6
                      paddingRight: "1.5rem",
                      gridTemplateColumns: `minmax(180px, 2fr) repeat(${projectTimelineMonths.length}, minmax(40px, 1fr)) minmax(180px, 2fr)`,
                    }}
                  >
                    <div /> {/* Skip first column (projet) */}
                    {projectTimelineMonths.map((_, i) => (
                      <div
                        key={i}
                        className="border-l h-full"
                        style={{
                          borderColor: "var(--maison-border)",
                          opacity: 0.5,
                        }}
                      />
                    ))}
                    <div /> {/* Skip last column (risk) */}
                  </div>

                  {/* Column: Gantt Bar */}
                  <div
                    className="grid relative z-10"
                    style={{
                      gridColumn: `2 / span ${projectTimelineMonths.length}`,
                      gridTemplateColumns: `repeat(${projectTimelineMonths.length}, minmax(40px, 1fr))`,
                    }}
                  >
                    <div
                      className="flex h-7 items-center justify-end rounded-full px-3 text-[10px] font-bold transition-all"
                      style={{
                        gridColumn: `${project.start + 1} / span ${project.duration}`,
                        background:
                          project.risk === "high"
                            ? "#a05252"
                            : project.risk === "medium"
                              ? "#c69243"
                              : "#0d9488",
                        color: "white",
                      }}
                    >
                      {project.progress} %
                    </div>
                  </div>

                  {/* Column: Risk / Blocker */}
                  <div className="pl-6 text-right flex flex-col items-end">
                    <div
                      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold"
                      style={{
                        color:
                          project.risk === "high"
                            ? "#a05252"
                            : project.risk === "medium"
                              ? "#c69243"
                              : "#0d9488",
                      }}
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{
                          background:
                            project.risk === "high"
                              ? "#a05252"
                              : project.risk === "medium"
                                ? "#c69243"
                                : "#0d9488",
                        }}
                      />
                      {riskLabel[project.risk]} · {project.month}
                    </div>
                    <p
                      className="mt-1 text-xs truncate max-w-full"
                      style={{ color: "var(--maison-text-secondary)" }}
                    >
                      {project.blocker}
                    </p>
                  </div>
                </div>
              ))}
              {filteredProjects.length === 0 ? (
                <div
                  className="px-6 py-12 text-center text-sm"
                  style={{ color: "var(--maison-text-secondary)" }}
                >
                  Aucun projet ne correspond aux filtres.
                </div>
              ) : null}
            </div>
          </div>

          {/* Footer legend */}
          <div
            className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-4 text-[10px] font-bold tracking-wider"
            style={{
              borderColor: "var(--maison-border)",
              color: "var(--maison-text-secondary)",
            }}
          >
            <div className="flex items-center gap-5">
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-600" />{" "}
                Maîtrisé
              </span>
              <span className="flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: "#c69243" }}
                />{" "}
                À surveiller
              </span>
              <span className="flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: "#a05252" }}
                />{" "}
                Risque élevé
              </span>
            </div>
            <div>
              ⚑ mois où la livraison peut glisser - barre pleine = progression
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function HrPanel({ onGenerate }: { onGenerate: (prompt: string) => void }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-3">
        <KpiCard
          detail="Août – Septembre"
          icon={Users}
          label="Capacité manquante"
          value="3.5 ETP"
        />
        <KpiCard
          detail="Next.js + AI Ops"
          icon={FileText}
          label="Tests prêts"
          value="2 tests"
        />
        <KpiCard
          detail="Semaine prochaine"
          icon={Send}
          label="Entretiens prévus"
          value="6 créneaux"
        />
      </div>
      <Panel>
        <div
          className="flex flex-col gap-2 pb-3 border-b md:flex-row md:items-center md:justify-between"
          style={{ borderColor: "var(--maison-border)" }}
        >
          <div>
            <p
              className="text-[10px] font-bold uppercase tracking-[0.08em]"
              style={{ color: "var(--maison-brass)" }}
            >
              Recrutement & Staffing
            </p>
            <h2
              className="mt-0.5 text-lg font-semibold tracking-tight"
              style={{
                fontFamily: "var(--font-playfair), Georgia, serif",
                color: "var(--maison-text-primary)",
              }}
            >
              Plan de recrutement
            </h2>
            <p
              className="text-xs"
              style={{ color: "var(--maison-text-secondary)" }}
            >
              Besoins stratégiques calculés depuis les projets signés et les
              risques de delivery.
            </p>
          </div>
          <ActionButton
            icon={Send}
            label="Préparer RH"
            onClick={() =>
              onGenerate(
                "Prépare l'annonce, le test technique et le plan d'entretiens pour validation.",
              )
            }
            variant="primary"
          />
        </div>

        <div
          className="divide-y"
          style={{ borderColor: "var(--maison-border)" }}
        >
          {hiringNeeds.map((need) => (
            <div
              className="py-2.5 px-2 transition-colors hover:bg-[rgba(176,141,79,0.03)] rounded-lg"
              key={need.role}
            >
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-rose-500" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700">
                      {need.when} · {need.load}
                    </span>
                  </div>
                  <h3
                    className="text-sm font-semibold tracking-tight"
                    style={{ color: "var(--maison-text-primary)" }}
                  >
                    {need.role}
                  </h3>
                  <p
                    className="text-xs max-w-2xl"
                    style={{ color: "var(--maison-text-secondary)" }}
                  >
                    {need.reason}
                  </p>
                </div>
                <span
                  className="w-fit self-start md:self-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold tracking-wide shadow-2xs"
                  style={{
                    background: "rgba(176, 141, 79, 0.08)",
                    borderColor: "var(--maison-border)",
                    color: "var(--maison-text-primary)",
                  }}
                >
                  ● {need.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel>
        <div
          className="flex flex-col gap-2 pb-3 border-b md:flex-row md:items-center md:justify-between"
          style={{ borderColor: "var(--maison-border)" }}
        >
          <div>
            <p
              className="text-[10px] font-bold uppercase tracking-[0.08em]"
              style={{ color: "var(--maison-brass)" }}
            >
              Planning équipes
            </p>
            <h2
              className="mt-0.5 text-lg font-semibold tracking-tight"
              style={{
                fontFamily: "var(--font-playfair), Georgia, serif",
                color: "var(--maison-text-primary)",
              }}
            >
              Staffing projets
            </h2>
            <p
              className="text-xs"
              style={{ color: "var(--maison-text-secondary)" }}
            >
              Charge par projet, personnes staffées et alertes liées au plan de
              recrutement.
            </p>
          </div>
          <ActionButton
            icon={Users}
            label="Recalculer staffing"
            onClick={() =>
              onGenerate(
                "Recalcule le staffing depuis les projets signes, les futurs deals CRM et les besoins de recrutement.",
              )
            }
            variant="secondary"
          />
        </div>
        <div className="mt-3 overflow-x-auto">
          <div className="min-w-[1180px]">
            <div
              className="grid gap-2 border-b pb-2 text-[10px] font-bold uppercase tracking-wider"
              style={{
                borderColor: "var(--maison-border)",
                color: "var(--maison-brass)",
                gridTemplateColumns: `240px repeat(${projectTimelineMonths.length}, minmax(70px, 1fr))`,
              }}
            >
              <div>Projet / staffing</div>
              {projectTimelineMonths.map((month) => (
                <div className="text-center" key={month}>
                  {month}
                </div>
              ))}
            </div>
            <div className="mt-2 grid gap-1.5">
              {staffingPlan.map((staffing) => (
                <div
                  className="grid items-center gap-2 py-0.5"
                  key={`${staffing.project}-${staffing.person}`}
                  style={{
                    gridTemplateColumns: `240px repeat(${projectTimelineMonths.length}, minmax(70px, 1fr))`,
                  }}
                >
                  <div className="min-w-0">
                    <p
                      className="truncate text-xs font-semibold"
                      style={{ color: "var(--maison-text-primary)" }}
                    >
                      {staffing.project}
                    </p>
                    <p
                      className="truncate text-[10px]"
                      style={{ color: "var(--maison-text-secondary)" }}
                    >
                      {staffing.person} · {staffing.role}
                    </p>
                  </div>
                  <div
                    className="grid"
                    style={{
                      gridColumn: `2 / span ${projectTimelineMonths.length}`,
                      gridTemplateColumns: `repeat(${projectTimelineMonths.length}, minmax(70px, 1fr))`,
                    }}
                  >
                    <div
                      className={`flex h-7 items-center justify-between rounded-md border px-2.5 text-xs font-semibold shadow-2xs ${
                        staffing.needsRecruitment
                          ? "border-rose-300 bg-rose-50/80 text-rose-900"
                          : "border-emerald-300 bg-emerald-50/80 text-emerald-900"
                      }`}
                      style={{
                        gridColumn: `${staffing.start + 1} / span ${staffing.duration}`,
                      }}
                    >
                      <span className="truncate">{staffing.person}</span>
                      {staffing.needsRecruitment ? (
                        <span
                          className="ml-2 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-rose-600 text-[9px] font-bold text-white shadow-2xs"
                          title={staffing.linkedNeed}
                        >
                          !
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {staffingPlan
            .filter((staffing) => staffing.needsRecruitment)
            .map((staffing) => (
              <div
                className="rounded-lg border border-rose-200/80 bg-rose-50/50 p-2.5 text-xs text-rose-950 shadow-2xs"
                key={staffing.linkedNeed}
              >
                <p className="font-bold uppercase tracking-wider text-[9px] text-rose-700">
                  Recrutement requis
                </p>
                <p className="mt-0.5 font-semibold leading-tight text-xs">
                  {staffing.project}: {staffing.linkedNeed}
                </p>
              </div>
            ))}
        </div>
      </Panel>
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <section
      className="min-w-0 rounded-xl border p-4 shadow-xs transition-all dark:border-stone-800 dark:bg-stone-950"
      style={{
        background: "var(--maison-card)",
        borderColor: "var(--maison-border)",
      }}
    >
      {children}
    </section>
  );
}

function VoiceActivity({
  isListening,
  isProcessing,
  isSpeaking,
}: {
  isListening: boolean;
  isProcessing: boolean;
  isSpeaking: boolean;
}) {
  if (!isListening && !isProcessing && !isSpeaking) return null;

  const label = isListening
    ? "Écoute active"
    : isSpeaking
      ? "NAIA répond"
      : "Traitement vocal";
  const tone = isListening
    ? "border-cyan-200 bg-cyan-50 text-cyan-800"
    : isSpeaking
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : "border-violet-200 bg-violet-50 text-violet-800";

  return (
    <div
      className={`mt-4 flex min-h-12 items-center justify-between gap-3 rounded-md border px-3 ${tone}`}
      aria-live="polite"
    >
      <span className="text-xs font-semibold uppercase">{label}</span>
      <span className="flex h-8 items-end gap-1.5" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((index) => (
          <span
            className="block w-1.5 rounded-full bg-current opacity-80 motion-safe:animate-pulse"
            key={index}
            style={{
              animationDelay: `${index * 110}ms`,
              height: `${10 + ((index + 1) % 3) * 6}px`,
            }}
          />
        ))}
      </span>
    </div>
  );
}

function KpiCard({
  detail,
  icon: Icon,
  label,
  value,
}: {
  detail: string;
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <Panel>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p
            className="text-[10px] font-bold uppercase tracking-[0.08em]"
            style={{ color: "var(--maison-brass)" }}
          >
            {label}
          </p>
          <p
            className="mt-1 text-xl font-bold tracking-tight"
            style={{ color: "var(--maison-text-primary)" }}
          >
            {value}
          </p>
        </div>
        <span
          className="flex h-7.5 w-7.5 items-center justify-center rounded-lg shadow-2xs"
          style={{
            background: "rgba(176, 141, 79, 0.12)",
            color: "var(--maison-brass)",
          }}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>
      <p
        className="mt-2 text-[11px] font-medium"
        style={{ color: "var(--maison-text-secondary)" }}
      >
        {detail}
      </p>
    </Panel>
  );
}

function ActionButton({
  disabled,
  icon: Icon,
  label,
  loading,
  onClick,
  variant,
}: {
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  loading?: boolean;
  onClick: () => void;
  variant: "primary" | "secondary";
}) {
  return (
    <button
      className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold uppercase tracking-wider shadow-sm transition hover:opacity-90 active:scale-98 disabled:cursor-not-allowed disabled:opacity-60"
      style={
        variant === "primary"
          ? { background: "var(--maison-sidebar)", color: "#FFFFFF" }
          : {
              background: "var(--maison-page)",
              borderColor: "var(--maison-border)",
              borderWidth: "1px",
              color: "var(--maison-text-primary)",
            }
      }
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <Icon
        className={`h-3.5 w-3.5 ${loading || label === "Generation" ? "animate-spin" : ""}`}
        aria-hidden="true"
      />
      {label}
    </button>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold text-stone-700">
      {label}
      {children}
    </label>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="font-semibold text-stone-950">{label}: </span>
      {value}
    </p>
  );
}

function ListPanel({ items, title }: { items: string[]; title: string }) {
  return (
    <Panel>
      <h2 className="text-lg font-semibold text-stone-950">{title}</h2>
      <div className="mt-4 grid gap-3">
        {items.map((item) => (
          <div
            className="flex gap-3 rounded-md border border-stone-200 px-3 py-3 text-sm leading-6 text-stone-700 dark:border-stone-800"
            key={item}
          >
            <CheckCircle2
              className="mt-1 h-4 w-4 shrink-0 text-teal-700"
              aria-hidden="true"
            />
            <span>{item}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function MiniButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-stone-800 transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
      onClick={onClick}
      type="button"
    >
      {children}
      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
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

function getLocalAnswer(sectionId: NaiaSectionId) {
  const answers: Record<NaiaSectionId, string> = {
    overview:
      "Synthese: 4 comptes a prioriser, 2 relances cash urgentes, 2 projets critiques et 3 roles RH a ouvrir.\n\nAction recommandee: commencer par la voix, montrer CRM -> pitch -> propale, puis terminer sur cash et delivery.",
    leads:
      "Top leads: Atlas Process, Medina Health et Sahara Logistics.\n\nAngle: intro reseau, diagnostic NAIA de 30 minutes et promesse claire sur cash, CRM et delivery.",
    "cash-flow":
      "Cash: octobre est le mois a risque si Medina et Sahara glissent.\n\nActions: relancer Medina aujourd'hui, securiser Sahara avant le 22/07 et avancer un acompte Atlas contre un livrable CFO.",
    crm: "CRM: Meeting booked genere un pitch oriente CEO/CFO. Propale a envoyer genere scope, planning, jalons et payment plan.\n\nProchain move: deplacer Atlas, puis Medina.",
    projects:
      "Delivery: Medina Health et Sahara Logistics sont critiques. Mois a flagger: septembre pour Medina, octobre pour Sahara, aout pour Atlas si l'ERP glisse.",
    hr: "RH: ouvrir un AI Delivery Lead en juillet, deux Full-stack Next.js en aout, puis QA automation en septembre.\n\nAction: preparer annonce, test workflow CRM -> propale, et six creneaux d'entretiens a valider.",
  };

  return answers[sectionId];
}
