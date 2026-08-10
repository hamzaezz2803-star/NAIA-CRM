import {
  authorizeExternalAiRequest,
  consumeExternalAiQuota,
  EXTERNAL_AI_POLICIES,
  fetchExternalAi,
  isAllowedAudioMimeType,
  isExternalAiProviderEnabled,
  readBoundedRequestBody,
} from "@/platform/ai/external-provider-security";

const policy = EXTERNAL_AI_POLICIES.naiaTranscription;

export async function GET() {
  const apiKey =
    process.env.GROQ_API_KEY?.trim() || process.env.GROQ_KEY?.trim();
  return Response.json({
    available: Boolean(
      apiKey && isExternalAiProviderEnabled("groq", "founder-route"),
    ),
  });
}

export async function POST(request: Request) {
  const authorization = await authorizeExternalAiRequest(request, policy);
  if (!authorization.allowed) return authorization.response;

  if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) {
    return transcriptionError("invalid-content-type", 415);
  }

  let formData: FormData;
  try {
    const boundedBody = await readBoundedRequestBody(
      request,
      policy.maxBodyBytes,
    );
    if (!boundedBody.ok) return boundedBody.response;
    formData = await new Request(request.url, {
      body: boundedBody.bytes.buffer,
      headers: request.headers,
      method: "POST",
    }).formData();
  } catch {
    return transcriptionError("invalid-form-data", 400);
  }
  const audio = formData.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return transcriptionError("missing-audio", 400);
  }
  if (audio.size > policy.maxBodyBytes) {
    return transcriptionError("request-too-large", 413);
  }
  if (!isAllowedAudioMimeType(audio.type)) {
    return transcriptionError("unsupported-audio-type", 415);
  }

  const apiKey =
    process.env.GROQ_API_KEY?.trim() || process.env.GROQ_KEY?.trim();
  if (!apiKey) return transcriptionError("missing-groq-key", 503);

  const quotaRejection = await consumeExternalAiQuota(authorization, policy);
  if (quotaRejection) return quotaRejection;

  const groqForm = new FormData();
  groqForm.append("file", audio, getAudioFileName(audio.type));
  groqForm.append(
    "model",
    process.env.GROQ_WHISPER_MODEL ?? "whisper-large-v3-turbo",
  );
  const language = getTranscriptionLanguage();
  if (language) groqForm.append("language", language);
  groqForm.append(
    "prompt",
    "Commande vocale business pour Qarizmi OS. Transcris exactement ce qui est dit et conserve la langue, les termes CRM, les noms, les dates et les heures.",
  );
  groqForm.append("response_format", "json");
  groqForm.append("temperature", "0");

  try {
    const groqResponse = await fetchExternalAi(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      {
        body: groqForm,
        headers: { Authorization: `Bearer ${apiKey}` },
        method: "POST",
      },
      policy.timeoutMs,
    );
    if (!groqResponse.ok) return transcriptionError("groq-error", 502);

    const payload = (await groqResponse.json()) as { text?: unknown };
    return Response.json({
      mode: "groq",
      transcript: typeof payload.text === "string" ? payload.text.trim() : "",
    });
  } catch {
    return transcriptionError("transcription-error", 502);
  }
}

function transcriptionError(mode: string, status: number) {
  return Response.json({ mode, transcript: "" }, { status });
}

function getAudioFileName(mimeType: string) {
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) {
    return "naia-command.m4a";
  }
  if (mimeType.includes("mpeg")) return "naia-command.mp3";
  if (mimeType.includes("ogg")) return "naia-command.ogg";
  if (mimeType.includes("wav")) return "naia-command.wav";
  return "naia-command.webm";
}

function getTranscriptionLanguage() {
  const language = process.env.GROQ_WHISPER_LANGUAGE?.trim().toLowerCase();
  if (language === "auto") return undefined;
  return language || "fr";
}
