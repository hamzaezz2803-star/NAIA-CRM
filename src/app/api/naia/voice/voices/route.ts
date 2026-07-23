type ElevenLabsVoice = {
  category?: string;
  description?: string;
  labels?: Record<string, string>;
  name?: string;
  preview_url?: string;
  voice_id?: string;
};

// "Martin Dupont" — NAIA's default voice when ELEVENLABS_VOICE_ID is unset.
const DEFAULT_ELEVENLABS_VOICE_ID = "a5n9pJUnAhX4fn7lx3uo";
const DEFAULT_FREE_ELEVENLABS_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";

const premadeVoices = [
  {
    voiceId: "a5n9pJUnAhX4fn7lx3uo",
    name: "Martin Dupont (Default)",
    category: "premade",
    labels: {
      accent: "french",
      age: "middle aged",
      gender: "male",
      language: "fr",
    },
  },
  {
    voiceId: "JBFqnCBsd6RMkjVDRZzb",
    name: "George (Recommended)",
    category: "premade",
    labels: {
      accent: "british",
      age: "middle aged",
      gender: "male",
      language: "en",
    },
  },
  {
    voiceId: "21m00Tcm4TlvDq8ikWAM",
    name: "Rachel",
    category: "premade",
    labels: {
      accent: "american",
      age: "young",
      gender: "female",
      language: "en",
    },
  },
  {
    voiceId: "AZnzlk1XvdvUeBnXmlld",
    name: "Domi",
    category: "premade",
    labels: {
      accent: "american",
      age: "young",
      gender: "female",
      language: "en",
    },
  },
  {
    voiceId: "EXAVITQu4vr4xnSDxMaL",
    name: "Bella",
    category: "premade",
    labels: {
      accent: "american",
      age: "young",
      gender: "female",
      language: "en",
    },
  },
  {
    voiceId: "ErXwobaYiN019PkySvjV",
    name: "Antoni",
    category: "premade",
    labels: {
      accent: "american",
      age: "young",
      gender: "male",
      language: "en",
    },
  },
  {
    voiceId: "CYw3moM5B4YCc7G7EyUh",
    name: "Dave",
    category: "premade",
    labels: {
      accent: "american",
      age: "young",
      gender: "male",
      language: "en",
    },
  },
];

export async function GET() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const configuredVoiceId =
    process.env.ELEVENLABS_VOICE_ID?.trim() || DEFAULT_ELEVENLABS_VOICE_ID;

  if (!apiKey) {
    return Response.json({
      activeVoice:
        premadeVoices.find((v) => v.voiceId === configuredVoiceId) ??
        premadeVoices[0],
      configuredVoiceId,
      mode: "premade-fallback",
      recommendedVoiceId: DEFAULT_FREE_ELEVENLABS_VOICE_ID,
      voices: premadeVoices,
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
      return Response.json({
        activeVoice:
          premadeVoices.find((v) => v.voiceId === configuredVoiceId) ??
          premadeVoices[0],
        configuredVoiceId,
        mode: "premade-fallback-on-error",
        recommendedVoiceId: DEFAULT_FREE_ELEVENLABS_VOICE_ID,
        voices: premadeVoices,
      });
    }

    const payload = (await response.json()) as { voices?: ElevenLabsVoice[] };
    const voices = (payload.voices ?? [])
      .filter((voice) => voice.voice_id && voice.name)
      .map((voice) => ({
        category: voice.category ?? "custom",
        description: voice.description ?? "",
        labels: {
          accent: voice.labels?.accent ?? "",
          age: voice.labels?.age ?? "",
          gender: voice.labels?.gender ?? "",
          language: voice.labels?.language ?? "",
        },
        name: voice.name ?? "Voice",
        previewUrl: voice.preview_url ?? "",
        voiceId: voice.voice_id ?? "",
      }));

    if (voices.length === 0) {
      return Response.json({
        activeVoice:
          premadeVoices.find((v) => v.voiceId === configuredVoiceId) ??
          premadeVoices[0],
        configuredVoiceId,
        mode: "premade-fallback-empty",
        recommendedVoiceId: DEFAULT_FREE_ELEVENLABS_VOICE_ID,
        voices: premadeVoices,
      });
    }

    const activeVoice = voices.find(
      (voice) => voice.voiceId === configuredVoiceId,
    );
    const recommendedVoice =
      voices.find((voice) => voice.voiceId === configuredVoiceId) ??
      voices.find(
        (voice) => voice.voiceId === DEFAULT_FREE_ELEVENLABS_VOICE_ID,
      ) ??
      voices.find((voice) => voice.category === "premade");

    return Response.json({
      activeVoice,
      configuredVoiceId,
      mode: "elevenlabs",
      recommendedVoiceId: recommendedVoice?.voiceId ?? configuredVoiceId,
      voices,
    });
  } catch {
    return Response.json({
      activeVoice:
        premadeVoices.find((v) => v.voiceId === configuredVoiceId) ??
        premadeVoices[0],
      configuredVoiceId,
      mode: "premade-fallback-on-catch",
      recommendedVoiceId: DEFAULT_FREE_ELEVENLABS_VOICE_ID,
      voices: premadeVoices,
    });
  }
}
