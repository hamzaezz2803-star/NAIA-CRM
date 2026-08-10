import { isExternalAiProviderEnabled } from "@/platform/ai/external-provider-security";

type ElevenLabsVoice = {
  category?: string;
  description?: string;
  labels?: Record<string, string>;
  name?: string;
  preview_url?: string;
  voice_id?: string;
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

export async function GET() {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const configuredVoiceId = sanitizeVoiceId(process.env.ELEVENLABS_VOICE_ID);

  if (!configuredVoiceId) {
    return createCatalogResponse({
      mode: "browser-fallback-missing-primary",
    });
  }

  const configuredVoice = createConfiguredVoice(configuredVoiceId);

  if (!apiKey || !isExternalAiProviderEnabled("elevenlabs")) {
    return createCatalogResponse({
      mode: apiKey
        ? "external-provider-disabled"
        : "configured-without-provider-catalog",
      voice: configuredVoice,
    });
  }

  try {
    const response = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: {
        "xi-api-key": apiKey,
      },
      method: "GET",
    });

    if (!response.ok) {
      return createCatalogResponse({
        mode: "configured-provider-error",
        voice: configuredVoice,
      });
    }

    const payload = (await response.json()) as { voices?: ElevenLabsVoice[] };
    const providerVoice = (payload.voices ?? []).find(
      (voice) => voice.voice_id === configuredVoiceId && voice.name,
    );
    const activeVoice = providerVoice
      ? mapProviderVoice(providerVoice)
      : configuredVoice;

    return createCatalogResponse({
      mode: providerVoice ? "elevenlabs" : "configured-voice-not-listed",
      voice: activeVoice,
    });
  } catch {
    return createCatalogResponse({
      mode: "configured-provider-unavailable",
      voice: configuredVoice,
    });
  }
}

function createCatalogResponse({
  mode,
  voice,
}: {
  mode: string;
  voice?: VoiceOption;
}) {
  return Response.json({
    ...(voice ? { activeVoice: voice } : {}),
    configuredVoiceId: voice?.voiceId ?? "",
    mode,
    recommendedVoiceId: voice?.voiceId ?? "",
    voices: voice ? [voice] : [],
  });
}

function createConfiguredVoice(voiceId: string): VoiceOption {
  return {
    category: "configured",
    description: "Official NAIA voice configured server-side.",
    labels: {
      accent: "",
      age: "",
      gender: "",
      language: "",
    },
    name: "NAIA",
    previewUrl: "",
    voiceId,
  };
}

function mapProviderVoice(voice: ElevenLabsVoice): VoiceOption {
  return {
    category: voice.category ?? "custom",
    description: voice.description ?? "",
    labels: {
      accent: voice.labels?.accent ?? "",
      age: voice.labels?.age ?? "",
      gender: voice.labels?.gender ?? "",
      language: voice.labels?.language ?? "",
    },
    name: voice.name ?? "NAIA",
    previewUrl: voice.preview_url ?? "",
    voiceId: voice.voice_id ?? "",
  };
}

function sanitizeVoiceId(voiceId: string | null | undefined) {
  const cleanVoiceId = voiceId?.trim();
  if (!cleanVoiceId) return null;
  return /^[A-Za-z0-9_-]{8,80}$/.test(cleanVoiceId) ? cleanVoiceId : null;
}
