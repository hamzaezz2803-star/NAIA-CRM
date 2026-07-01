type VoicePayload = {
  text?: string;
  voiceId?: string;
};

type ElevenLabsError = {
  detail?: {
    code?: string;
    message?: string;
    status?: string;
    type?: string;
  };
};

const DEFAULT_ELEVENLABS_MODEL_ID = "eleven_multilingual_v2";
const DEFAULT_FREE_ELEVENLABS_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
const MAX_VOICE_TEXT_LENGTH = 1200;

export async function GET(request: Request) {
  const url = new URL(request.url);
  return createVoiceResponse({
    rawText: url.searchParams.get("text"),
    requestedVoiceId: url.searchParams.get("voiceId"),
  });
}

export async function POST(request: Request) {
  let payload: VoicePayload;

  try {
    payload = (await request.json()) as VoicePayload;
  } catch {
    return Response.json(
      { mode: "browser", reason: "invalid-json" },
      { status: 400 },
    );
  }

  return createVoiceResponse({
    rawText: payload.text,
    requestedVoiceId: payload.voiceId,
  });
}

async function createVoiceResponse({
  rawText,
  requestedVoiceId,
}: {
  rawText: string | null | undefined;
  requestedVoiceId?: string | null;
}) {
  const text = rawText?.trim().slice(0, MAX_VOICE_TEXT_LENGTH);
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const requestedCleanVoiceId = sanitizeVoiceId(requestedVoiceId);
  const voiceId = requestedCleanVoiceId ?? process.env.ELEVENLABS_VOICE_ID;
  const fallbackVoiceId =
    sanitizeVoiceId(process.env.ELEVENLABS_FALLBACK_VOICE_ID) ??
    DEFAULT_FREE_ELEVENLABS_VOICE_ID;

  if (!text) {
    return browserVoiceFallback("missing-text", { status: 400 });
  }

  if (!apiKey || !voiceId) {
    return browserVoiceFallback("missing-elevenlabs-config", {
      status: 503,
    });
  }

  try {
    const elevenResponse = await requestElevenLabsSpeech({
      apiKey,
      text: addVoiceWarmupPause(text),
      voiceId,
    });

    if (!elevenResponse.ok) {
      const error = await readElevenLabsError(elevenResponse);
      if (
        fallbackVoiceId !== voiceId &&
        shouldTryFallbackVoice(error, elevenResponse.status)
      ) {
        const fallbackResponse = await requestElevenLabsSpeech({
          apiKey,
          text: addVoiceWarmupPause(text),
          voiceId: fallbackVoiceId,
        });

        if (fallbackResponse.ok) {
          return createAudioResponse({
            fallbackReason: error.detail?.code ?? "voice-unavailable",
            response: fallbackResponse,
            voiceId: fallbackVoiceId,
          });
        }
      }

      return browserVoiceFallback("elevenlabs-error", {
        code: error.detail?.code,
        message: error.detail?.message,
        status: 502,
        upstreamStatus: elevenResponse.status,
      });
    }

    return createAudioResponse({
      response: elevenResponse,
      voiceId,
    });
  } catch {
    return browserVoiceFallback("elevenlabs-network-error", { status: 502 });
  }
}

function addVoiceWarmupPause(text: string) {
  return text.startsWith("...") ? text : `... ${text}`;
}

async function requestElevenLabsSpeech({
  apiKey,
  text,
  voiceId,
}: {
  apiKey: string;
  text: string;
  voiceId: string;
}) {
  return fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      body: JSON.stringify({
        model_id:
          process.env.ELEVENLABS_MODEL_ID ?? DEFAULT_ELEVENLABS_MODEL_ID,
        text,
        voice_settings: {
          similarity_boost: 0.72,
          stability: 0.42,
          style: 0.25,
          use_speaker_boost: true,
        },
      }),
      headers: {
        Accept: "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      method: "POST",
    },
  );
}

function createAudioResponse({
  fallbackReason,
  response,
  voiceId,
}: {
  fallbackReason?: string;
  response: Response;
  voiceId: string;
}) {
  const contentType = response.headers.get("content-type") ?? "audio/mpeg";
  if (!contentType.startsWith("audio/")) {
    return browserVoiceFallback("elevenlabs-non-audio-response", {
      status: 502,
      upstreamStatus: response.status,
    });
  }

  return new Response(response.body, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": contentType,
      ...(fallbackReason ? { "X-NAIA-Voice-Fallback": fallbackReason } : {}),
      "X-NAIA-Voice-Provider": "elevenlabs",
      "X-NAIA-Voice-Id": voiceId,
    },
  });
}

function shouldTryFallbackVoice(error: ElevenLabsError, status: number) {
  return (
    status === 402 ||
    error.detail?.code === "paid_plan_required" ||
    error.detail?.status === "voice_not_found"
  );
}

function sanitizeVoiceId(voiceId: string | null | undefined) {
  const cleanVoiceId = voiceId?.trim();
  if (!cleanVoiceId) return null;
  return /^[A-Za-z0-9_-]{8,80}$/.test(cleanVoiceId) ? cleanVoiceId : null;
}

function browserVoiceFallback(
  reason: string,
  options: {
    code?: string;
    message?: string;
    status?: number;
    upstreamStatus?: number;
  } = {},
) {
  const { status = 200, ...payload } = options;
  return Response.json(
    {
      mode: "browser",
      reason,
      ...payload,
    },
    { status },
  );
}

async function readElevenLabsError(
  response: Response,
): Promise<ElevenLabsError> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await response.json().catch(() => ({}))) as ElevenLabsError;
  }

  const message = await response.text().catch(() => "");
  return {
    detail: {
      message: message.slice(0, 500),
    },
  };
}
