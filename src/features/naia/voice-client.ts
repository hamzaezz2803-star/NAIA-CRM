export const VOICE_RECORDING_MAX_MS = 45000;
export const VOICE_SILENCE_STOP_MS = 2200;
export const VOICE_MIN_RECORDING_MS = 700;
export const VOICE_SPEECH_START_THRESHOLD = 0.018;
export const VOICE_SILENCE_THRESHOLD = 0.012;
export const VOICE_TEXT_MAX_LENGTH = 1200;

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
    __naiaCurrentAudio?: HTMLAudioElement;
  }
}

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
  const audio = new Audio(buildNaiaVoiceUrl(text, voiceId));
  audio.preload = "auto";
  window.__naiaCurrentAudio = audio;
  audio.onended = () => {
    if (window.__naiaCurrentAudio === audio) {
      window.__naiaCurrentAudio = undefined;
    }
    onEnded();
  };
  audio.onerror = () => {
    if (window.__naiaCurrentAudio === audio) {
      window.__naiaCurrentAudio = undefined;
    }
    onEnded();
    onBlocked(
      "ElevenLabs n'a pas pu lire l'audio. Verifie la voix configuree et les credits.",
    );
  };

  onStarted();
  const playPromise = audio.play();
  if (playPromise) {
    playPromise.catch(() => {
      onEnded();
      onBlocked(
        "Safari a bloque la lecture audio. Clique une fois dans la page puis relance Audio.",
      );
    });
  }

  return audio;
}
