type ElevenLabsVoice = {
  category?: string;
  description?: string;
  labels?: Record<string, string>;
  name?: string;
  preview_url?: string;
  voice_id?: string;
};

const DEFAULT_FREE_ELEVENLABS_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";

export async function GET() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const configuredVoiceId = process.env.ELEVENLABS_VOICE_ID ?? "";

  if (!apiKey) {
    return Response.json(
      {
        configuredVoiceId,
        mode: "missing-elevenlabs-key",
        voices: [],
      },
      { status: 503 },
    );
  }

  try {
    const response = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: {
        "xi-api-key": apiKey,
      },
      method: "GET",
    });

    if (!response.ok) {
      let errorDetail: {
        detail?: { status?: string; message?: string };
      } | null = null;
      try {
        errorDetail = (await response.json()) as {
          detail?: { status?: string; message?: string };
        };
      } catch {}

      const isPermissionError =
        errorDetail?.detail?.status === "missing_permissions" ||
        (typeof errorDetail?.detail?.message === "string" &&
          errorDetail.detail.message.includes("permission"));

      return Response.json(
        {
          configuredVoiceId,
          mode: isPermissionError
            ? "elevenlabs-permissions-error"
            : "elevenlabs-error",
          status: response.status,
          voices: [],
        },
        { status: 502 },
      );
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
    const activeVoice = voices.find(
      (voice) => voice.voiceId === configuredVoiceId,
    );
    const recommendedVoice =
      voices.find(
        (voice) =>
          voice.voiceId === configuredVoiceId && voice.category === "premade",
      ) ??
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
    return Response.json(
      {
        configuredVoiceId,
        mode: "elevenlabs-network-error",
        voices: [],
      },
      { status: 502 },
    );
  }
}
