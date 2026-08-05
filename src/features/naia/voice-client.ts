export const VOICE_RECORDING_MAX_MS = 45000;
export const VOICE_SILENCE_STOP_MS = 2200;
export const VOICE_MIN_RECORDING_MS = 700;
export const VOICE_SPEECH_START_THRESHOLD = 0.018;
export const VOICE_SILENCE_THRESHOLD = 0.012;
export const VOICE_TEXT_MAX_LENGTH = 1200;
// Shared speech speed for both ElevenLabs playback (audio.playbackRate) and
// the browser speechSynthesis fallback (utterance.rate).
export const VOICE_PLAYBACK_RATE = 1.25;

type VoiceSilenceDetectorOptions = {
  onSilence: () => void;
  onSpeechStart?: () => void;
  stream: MediaStream;
};

type VoiceSilenceDetector = {
  stop: () => void;
};

declare global {
  interface Window {
    __naiaCurrentAudio?: VoicePlaybackHandle;
    __naiaPrimedAudio?: HTMLAudioElement;
    __naiaVoicePrimed?: boolean;
  }
}

// Tiny silent WAV (16-bit mono PCM, 8 samples). Playing it inside the user
// gesture "blesses" the reusable audio element so WebKit/Safari later allows
// programmatic playback once the ElevenLabs fetch resolves.
const SILENT_AUDIO_DATA_URL =
  "data:audio/wav;base64,UklGRjQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YRAAAAAAAAAAAAAAAAAAAAAAAAAA";

type BrowserVoicePayload = {
  code?: string;
  message?: string;
  mode?: string;
  reason?: string;
  upstreamStatus?: number;
};

export type VoicePlaybackHandle = {
  pause: () => void;
};

export function createVoiceSilenceDetector({
  onSilence,
  onSpeechStart,
  stream,
}: VoiceSilenceDetectorOptions): VoiceSilenceDetector | null {
  const AudioContextConstructor =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioContextConstructor) {
    return null;
  }

  const audioContext = new AudioContextConstructor();
  if (audioContext.state === "suspended") {
    void audioContext.resume();
  }
  const analyser = audioContext.createAnalyser();
  const source = audioContext.createMediaStreamSource(stream);
  analyser.fftSize = 1024;
  const samples = new Uint8Array(analyser.fftSize);
  const startedAt = Date.now();
  let animationFrameId = 0;
  let hasDetectedSpeech = false;
  let isStopped = false;
  let lastSpeechAt = startedAt;

  source.connect(analyser);

  const tick = () => {
    if (isStopped) return;

    analyser.getByteTimeDomainData(samples);
    const level = getRmsLevel(samples);
    const now = Date.now();

    if (level >= VOICE_SPEECH_START_THRESHOLD) {
      if (!hasDetectedSpeech) {
        hasDetectedSpeech = true;
        onSpeechStart?.();
      }
      lastSpeechAt = now;
    }

    if (
      hasDetectedSpeech &&
      now - startedAt >= VOICE_MIN_RECORDING_MS &&
      now - lastSpeechAt >= VOICE_SILENCE_STOP_MS &&
      level <= VOICE_SILENCE_THRESHOLD
    ) {
      onSilence();
      return;
    }

    animationFrameId = window.requestAnimationFrame(tick);
  };

  animationFrameId = window.requestAnimationFrame(tick);

  return {
    stop: () => {
      if (isStopped) return;

      isStopped = true;
      if (animationFrameId) {
        window.cancelAnimationFrame(animationFrameId);
      }
      source.disconnect();
      void audioContext.close();
    },
  };
}

function getRmsLevel(samples: Uint8Array) {
  let sum = 0;

  for (const sample of samples) {
    const centeredSample = (sample - 128) / 128;
    sum += centeredSample * centeredSample;
  }

  return Math.sqrt(sum / samples.length);
}

/**
 * Must be called synchronously from a user gesture (click on Parler, Lancer,
 * Audio...). It creates the session-wide audio element and plays a short
 * silent clip so Safari/WebKit unlocks it for the asynchronous ElevenLabs
 * playback that happens after transcription + orchestration + TTS fetches,
 * long after the gesture's transient activation has expired.
 */
export function primeVoicePlayback() {
  if (typeof window === "undefined" || typeof Audio === "undefined") return;
  if (window.__naiaVoicePrimed) return;

  const audio = window.__naiaPrimedAudio ?? new Audio();
  window.__naiaPrimedAudio = audio;

  // Never interrupt an ongoing NAIA playback with the silent unlock clip.
  if (!audio.paused) return;

  window.__naiaVoicePrimed = true;
  audio.onended = null;
  audio.onerror = null;
  audio.muted = true;
  audio.src = SILENT_AUDIO_DATA_URL;

  try {
    const playAttempt = audio.play();
    void playAttempt
      ?.then(() => {
        if (audio.src === SILENT_AUDIO_DATA_URL) {
          audio.pause();
        }
      })
      .catch(() => {
        window.__naiaVoicePrimed = false;
      });
  } catch {
    window.__naiaVoicePrimed = false;
  }
}

function getReusableVoiceAudioElement() {
  const audio = window.__naiaPrimedAudio ?? new Audio();
  // Keep the element session-wide so any later user gesture unlocks it.
  window.__naiaPrimedAudio = audio;
  return audio;
}

export function buildNaiaVoiceUrl(text: string, voiceId?: string) {
  const params = new URLSearchParams({
    text: text.replace(/\s+/g, " ").slice(0, VOICE_TEXT_MAX_LENGTH),
  });
  if (voiceId) {
    params.set("voiceId", voiceId);
  }

  return `/api/naia/voice?${params.toString()}`;
}

export function playElevenLabsVoice({
  onBlocked,
  onEnded,
  onStarted,
  text,
  voiceId,
}: {
  onBlocked: (message: string) => void;
  onEnded: () => void;
  onStarted: () => void;
  text: string;
  voiceId?: string;
}) {
  let audio: HTMLAudioElement | null = null;
  let objectUrl = "";
  let isCancelled = false;
  let hasEnded = false;
  let hasStarted = false;

  const cleanup = () => {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = "";
    }
  };

  const handle: VoicePlaybackHandle = {
    pause: () => {
      if (hasEnded) return;

      hasEnded = true;
      isCancelled = true;
      audio?.pause();
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      cleanup();
      if (window.__naiaCurrentAudio === handle) {
        window.__naiaCurrentAudio = undefined;
      }
      onEnded();
    },
  };

  const finish = () => {
    if (hasEnded) return;

    hasEnded = true;
    cleanup();
    if (window.__naiaCurrentAudio === handle) {
      window.__naiaCurrentAudio = undefined;
    }
    onEnded();
  };

  const start = () => {
    if (hasStarted) return;

    hasStarted = true;
    onStarted();
  };

  const fallbackToBrowserVoice = (message: string) => {
    if (isCancelled || hasEnded) return;

    if (!("speechSynthesis" in window)) {
      onBlocked(message);
      finish();
      return;
    }

    onBlocked(`${message} Lecture via la voix du navigateur.`);
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "fr-FR";
    utterance.rate = VOICE_PLAYBACK_RATE;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.onstart = start;
    utterance.onend = finish;
    utterance.onerror = () => {
      // Cancelling the fallback (handle.pause) also fires onerror; a real
      // synthesis failure only matters while this playback is still live.
      if (isCancelled || hasEnded) return;

      onBlocked(
        `${getBrowserName()} a bloque la lecture audio. Clique sur Audio ou Parler pour relancer.`,
      );
      finish();
    };
    window.speechSynthesis.speak(utterance);
  };

  const playAudioBlob = async (blob: Blob, fallbackReason?: string) => {
    if (isCancelled) return;

    objectUrl = URL.createObjectURL(blob);
    audio = getReusableVoiceAudioElement();
    audio.muted = false;
    audio.preload = "auto";
    audio.src = objectUrl;
    audio.defaultPlaybackRate = VOICE_PLAYBACK_RATE;
    audio.playbackRate = VOICE_PLAYBACK_RATE;
    audio.onended = finish;
    audio.onerror = () => {
      fallbackToBrowserVoice(
        "ElevenLabs a renvoye un audio illisible pour ce navigateur.",
      );
    };

    try {
      await audio.play();
      start();
      if (fallbackReason) {
        onBlocked(
          "La voix NAIA officielle est indisponible. ElevenLabs utilise la voix de secours configurée.",
        );
      }
    } catch {
      fallbackToBrowserVoice(
        `${getBrowserName()} a bloque la lecture ElevenLabs.`,
      );
    }
  };

  window.__naiaCurrentAudio?.pause();
  window.__naiaCurrentAudio = handle;

  void fetch(buildNaiaVoiceUrl(text, voiceId), { cache: "no-store" })
    .then(async (response) => {
      if (isCancelled) return;

      const contentType = response.headers.get("content-type") ?? "";
      if (response.ok && contentType.startsWith("audio/")) {
        await playAudioBlob(
          await response.blob(),
          response.headers.get("x-naia-voice-fallback") ?? undefined,
        );
        return;
      }

      let payload: BrowserVoicePayload = {};
      if (contentType.includes("application/json")) {
        payload = (await response
          .json()
          .catch(() => ({}))) as BrowserVoicePayload;
      }

      fallbackToBrowserVoice(getVoiceFallbackMessage(payload, response.status));
    })
    .catch(() => {
      fallbackToBrowserVoice(
        "ElevenLabs est indisponible ou non configure sur cet environnement.",
      );
    });

  return handle;
}

function getVoiceFallbackMessage(payload: BrowserVoicePayload, status: number) {
  if (payload.reason === "missing-elevenlabs-config") {
    return "ElevenLabs n'est pas configure sur cet environnement.";
  }

  if (payload.reason === "elevenlabs-error") {
    return payload.message
      ? `ElevenLabs a refuse la synthese (${payload.message}).`
      : `ElevenLabs a refuse la synthese (${payload.code ?? status}).`;
  }

  if (payload.reason === "elevenlabs-network-error") {
    return "ElevenLabs ne repond pas pour le moment.";
  }

  if (payload.reason === "elevenlabs-non-audio-response") {
    return "ElevenLabs n'a pas renvoye de fichier audio.";
  }

  return "Lecture ElevenLabs indisponible.";
}

function getBrowserName() {
  const userAgent = navigator.userAgent;

  if (userAgent.includes("Edg/")) return "Edge";
  if (userAgent.includes("Chrome/") || userAgent.includes("CriOS/")) {
    return "Chrome";
  }
  if (userAgent.includes("Firefox/")) return "Firefox";
  if (userAgent.includes("Safari/")) return "Safari";

  return "Le navigateur";
}
