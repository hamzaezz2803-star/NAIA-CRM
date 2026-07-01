"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  FileText,
  Headphones,
  Loader2,
  MailCheck,
  Mic,
  Play,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Users,
  Volume2,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";

import {
  buildNaiaContext,
  cashMonths,
  costs,
  executiveActions,
  formatMad,
  generatedAssets,
  getNaiaSection,
  hiringNeeds,
  approvalQueue,
  integrationHealth,
  leadCompanies,
  naiaSections,
  paymentPlans,
  pipeline,
  projects,
  type NaiaSectionId,
  type RiskLevel,
} from "./operating-data";
import {
  buildNaiaVoiceUrl,
  createVoiceSilenceDetector,
  playElevenLabsVoice,
  VOICE_RECORDING_MAX_MS,
} from "./voice-client";

type NaiaExperienceProps = {
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

export function NaiaExperience({ sectionId }: NaiaExperienceProps) {
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
  const [manualAudioUrl, setManualAudioUrl] = useState("");
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

  const navigateTo = (nextSectionId: NaiaSectionId) => {
    const nextSection = getNaiaSection(nextSectionId);
    setActiveSection(nextSection.id);
    setAssistantOutput(getLocalAnswer(nextSection.id));
    router.push(nextSection.href);
  };

  const generate = async (
    nextSectionId = activeSection,
    promptOverride?: string,
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
      if (payload.mode === "local") {
        setVoiceNotice(
          "Mode local: Groq n'a pas repondu, raisonnement embarque active.",
        );
      }
    } catch {
      setAssistantOutput(getLocalAnswer(nextSection.id));
      setVoiceNotice("Mode local: impossible de joindre l'API IA.");
    } finally {
      setIsGenerating(false);
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
      setVoiceNotice("Reconnaissance vocale indisponible dans ce navigateur.");
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

      setVoiceTranscript(
        `${browserFinalTranscriptRef.current} ${interimTranscript}`.trim(),
      );
    };
    recognition.onerror = (event) => {
      setVoiceNotice(
        event.error ? `Voix: ${event.error}` : "Commande vocale interrompue.",
      );
      setIsListening(false);
    };
    recognition.onend = () => {
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
    await generate(nextSection.id, command);
  };

  const speakCurrentAnswer = async () => {
    const text = assistantOutput.replace(/\s+/g, " ").slice(0, 900);
    speechAudioRef.current?.pause();
    setManualAudioUrl("");
    speechAudioRef.current = playElevenLabsVoice({
      onBlocked: (message) => {
        setVoiceNotice(message);
        setManualAudioUrl(buildNaiaVoiceUrl(text));
      },
      onEnded: () => setIsSpeaking(false),
      onStarted: () => {
        setVoiceNotice("");
        setIsSpeaking(true);
      },
      text,
    });
  };

  return (
    <div className="space-y-6">
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
              disabled={isListening}
              icon={isListening ? Loader2 : Mic}
              label={isListening ? "J'ecoute..." : "Parler"}
              loading={isListening}
              onClick={startVoiceControl}
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

        {manualAudioUrl ? (
          <audio
            className="mt-4 w-full"
            controls
            preload="none"
            src={manualAudioUrl}
          >
            <track kind="captions" />
          </audio>
        ) : null}

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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
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
              onGenerate={(prompt) => void generate("cash-flow", prompt)}
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
                  onClick={() => void handleVoiceCommand(command)}
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
  onGenerate: (prompt: string) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <KpiCard
          detail="Fin novembre"
          icon={CircleDollarSign}
          label="Solde projete"
          value={formatMad(cashMonths[cashMonths.length - 1]?.balance ?? 0)}
        />
        <KpiCard
          detail="Medina + Sahara"
          icon={MailCheck}
          label="Relances"
          value="2 urgentes"
        />
        <KpiCard
          detail="Apres salaires"
          icon={AlertTriangle}
          label="Runway min."
          value="4.1 mois"
        />
      </div>

      <Panel>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-stone-950">
              Cash forecast
            </h2>
            <p className="mt-1 text-sm leading-6 text-stone-600">
              Entrees, sorties et solde previsionnel avec flags de risque.
            </p>
          </div>
          <ActionButton
            icon={WandSparkles}
            label="Optimiser cash"
            onClick={() =>
              onGenerate(
                "Predis le cash flow, priorise les relances et prepare les brouillons d'emails clients.",
              )
            }
            variant="primary"
          />
        </div>
        <div
          className="mt-6 grid min-h-64 grid-cols-5 items-end gap-3"
          role="img"
          aria-label="Prevision de solde cash sur cinq mois"
        >
          {cashMonths.map((row) => (
            <div
              className="flex h-full min-w-0 flex-col justify-end gap-2"
              key={row.month}
            >
              <div className="flex flex-1 items-end rounded-md bg-stone-100 p-2">
                <div
                  className={`w-full rounded-sm ${row.risk === "high" ? "bg-rose-500" : row.risk === "medium" ? "bg-amber-500" : "bg-emerald-500"}`}
                  style={{
                    height: `${Math.max(18, (row.balance / maxBalance) * 100)}%`,
                  }}
                />
              </div>
              <div className="text-center">
                <p className="text-xs font-semibold text-stone-950">
                  {row.month}
                </p>
                <p className="mt-1 text-xs text-stone-500">
                  {formatMad(row.balance)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <ListPanel
          title="Couts a venir"
          items={costs.map(
            (item) =>
              `${item.date} · ${item.name} · ${formatMad(item.amount)} · ${item.type}`,
          )}
        />
        <ListPanel
          title="Plans de paiement"
          items={paymentPlans.map(
            (item) =>
              `${item.client}: ${item.plan}, prochain ${formatMad(item.nextPayment)} le ${item.dueDate}`,
          )}
        />
      </div>
    </div>
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
  const months = ["Juil.", "Aout", "Sept.", "Oct.", "Nov.", "Dec."];

  return (
    <div className="space-y-6">
      <Panel>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-stone-950">
              Gantt delivery
            </h2>
            <p className="mt-1 text-sm leading-6 text-stone-600">
              Vue portefeuille, criticite et mois de derapage probable.
            </p>
          </div>
          <ActionButton
            icon={AlertTriangle}
            label="Analyser risques"
            onClick={() =>
              onGenerate(
                "Analyse les projets en retard, cite les causes et flague les mois critiques.",
              )
            }
            variant="primary"
          />
        </div>
        <div className="mt-6 overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-[190px_repeat(6,1fr)] gap-2 text-xs font-semibold uppercase text-stone-500">
              <div>Projet</div>
              {months.map((month) => (
                <div className="text-center" key={month}>
                  {month}
                </div>
              ))}
            </div>
            <div className="mt-3 grid gap-3">
              {projects.map((project) => (
                <div
                  className="grid grid-cols-[190px_repeat(6,1fr)] items-center gap-2"
                  key={project.project}
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-stone-950">
                      {project.client}
                    </p>
                    <p className="truncate text-sm text-stone-500">
                      {project.project}
                    </p>
                  </div>
                  <div className="col-span-6 grid grid-cols-6">
                    <div
                      className={`h-10 rounded-md border px-3 py-2 text-xs font-semibold ${riskClasses[project.risk]}`}
                      style={{
                        gridColumn: `${project.start + 1} / span ${project.duration}`,
                      }}
                    >
                      {project.progress}% · {project.month}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        {projects.map((project) => (
          <Panel key={project.project}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-stone-500">
                  {project.client}
                </p>
                <h3 className="mt-1 text-lg font-semibold text-stone-950">
                  {project.project}
                </h3>
              </div>
              <span
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${riskClasses[project.risk]}`}
              >
                {riskLabel[project.risk]}
              </span>
            </div>
            <div className="mt-4 h-2 rounded-full bg-stone-100">
              <div
                className="h-2 rounded-full bg-stone-950"
                style={{ width: `${project.progress}%` }}
              />
            </div>
            <p className="mt-3 text-sm leading-6 text-stone-700">
              {project.blocker}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {project.useCases.map((useCase) => (
                <span
                  className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-semibold text-stone-700"
                  key={useCase}
                >
                  {useCase}
                </span>
              ))}
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

function HrPanel({ onGenerate }: { onGenerate: (prompt: string) => void }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <KpiCard
          detail="Aout-Septembre"
          icon={Users}
          label="Capacite manquante"
          value="3.5 ETP"
        />
        <KpiCard
          detail="Next.js + AI Ops"
          icon={FileText}
          label="Tests prets"
          value="2 tests"
        />
        <KpiCard
          detail="Semaine prochaine"
          icon={Send}
          label="Entretiens"
          value="6 creneaux"
        />
      </div>
      <Panel>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-stone-950">
              Plan de recrutement
            </h2>
            <p className="mt-1 text-sm leading-6 text-stone-600">
              Besoins calcules depuis les projets signes et les risques
              delivery.
            </p>
          </div>
          <ActionButton
            icon={Send}
            label="Preparer RH"
            onClick={() =>
              onGenerate(
                "Prepare l'annonce, le test technique et le plan d'entretiens pour validation.",
              )
            }
            variant="primary"
          />
        </div>
        <div className="mt-5 grid gap-3">
          {hiringNeeds.map((need) => (
            <article
              className="rounded-md border border-stone-200 p-4 dark:border-stone-800"
              key={need.role}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-sm font-semibold text-rose-700">
                    {need.when} · {need.load}
                  </p>
                  <h3 className="mt-1 text-lg font-semibold text-stone-950">
                    {need.role}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-stone-700">
                    {need.reason}
                  </p>
                </div>
                <span className="w-fit rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-semibold text-stone-700">
                  {need.status}
                </span>
              </div>
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-white">
      {children}
    </section>
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
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-stone-500">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-stone-950">{value}</p>
        </div>
        <span className="flex h-10 w-10 items-center justify-center rounded-md border border-teal-200 bg-teal-50 text-teal-800">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-3 text-sm text-stone-600">{detail}</p>
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
      className={
        variant === "primary"
          ? "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 disabled:cursor-not-allowed disabled:opacity-60"
          : "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 disabled:cursor-not-allowed disabled:opacity-60"
      }
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <Icon
        className={`h-4 w-4 ${loading || label === "Generation" ? "animate-spin" : ""}`}
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
