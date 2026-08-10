import {
  authorizeExternalAiRequest,
  consumeExternalAiQuota,
  EXTERNAL_AI_POLICIES,
  fetchExternalAi,
  isJsonRequest,
  readBoundedRequestBody,
} from "@/platform/ai/external-provider-security";

type VoicePayload = { text?: unknown };

const DEFAULT_ELEVENLABS_MODEL_ID = "eleven_multilingual_v2";
const MAX_VOICE_TEXT_LENGTH = 1200;
const policy = EXTERNAL_AI_POLICIES.naiaVoice;

export async function GET() {
  return Response.json(
    { mode: "browser", reason: "method-not-allowed" },
    { headers: { Allow: "POST" }, status: 405 },
  );
}

export async function POST(request: Request) {
  const authorization = await authorizeExternalAiRequest(request, policy);
  if (!authorization.allowed) return authorization.response;

  if (!isJsonRequest(request)) {
    return browserVoiceFallback("invalid-content-type", { status: 415 });
  }

  let payload: VoicePayload;
  try {
    const boundedBody = await readBoundedRequestBody(
      request,
      policy.maxBodyBytes,
    );
    if (!boundedBody.ok) return boundedBody.response;
    payload = JSON.parse(
      new TextDecoder().decode(boundedBody.bytes),
    ) as VoicePayload;
  } catch {
    return browserVoiceFallback("invalid-json", { status: 400 });
  }

  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!text) return browserVoiceFallback("missing-text", { status: 400 });
  if (text.length > MAX_VOICE_TEXT_LENGTH) {
    return browserVoiceFallback("text-too-large", { status: 413 });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const voiceId = sanitizeVoiceId(process.env.ELEVENLABS_VOICE_ID);
  if (!apiKey || !voiceId) {
    return browserVoiceFallback("missing-elevenlabs-config", { status: 503 });
  }

  const quotaRejection = await consumeExternalAiQuota(authorization, policy);
  if (quotaRejection) return quotaRejection;

  try {
    const response = await fetchExternalAi(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        body: JSON.stringify({
          model_id:
            process.env.ELEVENLABS_MODEL_ID ?? DEFAULT_ELEVENLABS_MODEL_ID,
          text: addVoiceWarmupPause(text),
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
      policy.timeoutMs,
    );
    if (!response.ok) {
      return browserVoiceFallback("elevenlabs-error", {
        status: 502,
        upstreamStatus: response.status,
      });
    }

    const contentType = response.headers.get("content-type") ?? "";
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
        "X-NAIA-Voice-Provider": "elevenlabs",
      },
    });
  } catch {
    return browserVoiceFallback("elevenlabs-network-error", { status: 502 });
  }
}

function addVoiceWarmupPause(text: string) {
  return text.startsWith("...") ? text : `... ${text}`;
}

function sanitizeVoiceId(voiceId: string | null | undefined) {
  const cleanVoiceId = voiceId?.trim();
  if (!cleanVoiceId) return null;
  return /^[A-Za-z0-9_-]{8,80}$/.test(cleanVoiceId) ? cleanVoiceId : null;
}

function browserVoiceFallback(
  reason: string,
  options: { status?: number; upstreamStatus?: number } = {},
) {
  const { status = 200, ...payload } = options;
  return Response.json({ mode: "browser", reason, ...payload }, { status });
}
