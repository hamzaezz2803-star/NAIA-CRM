type VoicePayload = {
  text?: string;
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
const MAX_VOICE_TEXT_LENGTH = 1200;

// Voices ElevenLabs already refused for plan/availability reasons in this
// server instance. Short-circuiting them avoids a doomed upstream call (and
// the resulting double latency) on every single voice response.
const knownRestrictedVoiceIds = new Set<string>();

export async function GET(request: Request) {
  const url = new URL(request.url);
  return createVoiceResponse({
    rawText: url.searchParams.get("text"),
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
  });
}

async function createVoiceResponse({
  rawText,
}: {
  rawText: string | null | undefined;
}) {
  const text = rawText?.trim().slice(0, MAX_VOICE_TEXT_LENGTH);

  if (!text) {
    return browserVoiceFallback("missing-text", { status: 400 });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const primaryVoiceId = sanitizeVoiceId(process.env.ELEVENLABS_VOICE_ID);

  if (!apiKey || !primaryVoiceId) {
    return browserVoiceFallback("missing-elevenlabs-config", {
      status: 503,
    });
  }

  const configuredFallbackVoiceId = sanitizeVoiceId(
    process.env.ELEVENLABS_FALLBACK_VOICE_ID,
  );
  const fallbackVoiceId =
    configuredFallbackVoiceId && configuredFallbackVoiceId !== primaryVoiceId
      ? configuredFallbackVoiceId
      : null;
  const isUsingCachedFallback =
    fallbackVoiceId !== null && knownRestrictedVoiceIds.has(primaryVoiceId);
  const effectiveVoiceId = isUsingCachedFallback
    ? fallbackVoiceId
    : primaryVoiceId;

  try {
    const elevenResponse = await requestElevenLabsSpeech({
      apiKey,
      text: addVoiceWarmupPause(text),
      voiceId: effectiveVoiceId,
    });

    if (!elevenResponse.ok) {
      const error = await readElevenLabsError(elevenResponse);
      if (
        fallbackVoiceId &&
        effectiveVoiceId !== fallbackVoiceId &&
        shouldTryFallbackVoice(error, elevenResponse.status)
      ) {
        knownRestrictedVoiceIds.add(effectiveVoiceId);
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
      fallbackReason: isUsingCachedFallback
        ? "primary-voice-unavailable"
        : undefined,
      response: elevenResponse,
      voiceId: effectiveVoiceId,
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
  const detailText = [
    error.detail?.code,
    error.detail?.message,
    error.detail?.status,
    error.detail?.type,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("en-US");

  return (
    status === 402 ||
    error.detail?.code === "paid_plan_required" ||
    error.detail?.status === "voice_not_found" ||
    detailText.includes("free users cannot use library voices") ||
    (detailText.includes("library voices") &&
      detailText.includes("subscription"))
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
