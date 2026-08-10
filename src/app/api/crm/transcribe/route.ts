import {
  authorizeExternalAiRequest,
  consumeExternalAiQuota,
  EXTERNAL_AI_POLICIES,
  fetchExternalAi,
  isAllowedAudioMimeType,
  readBoundedRequestBody,
} from "@/platform/ai/external-provider-security";

const policy = EXTERNAL_AI_POLICIES.crmTranscription;

export async function POST(request: Request) {
  const authorization = await authorizeExternalAiRequest(request, policy);
  if (!authorization.allowed) return authorization.response;

  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  const audioMimeType = contentType ?? "";
  if (!isAllowedAudioMimeType(audioMimeType)) {
    return Response.json(
      { error: "Format audio non supporté" },
      { status: 415 },
    );
  }

  let buffer: Buffer;
  try {
    const boundedBody = await readBoundedRequestBody(
      request,
      policy.maxBodyBytes,
    );
    if (!boundedBody.ok) return boundedBody.response;
    buffer = Buffer.from(boundedBody.bytes);
  } catch {
    return Response.json({ error: "Audio illisible" }, { status: 400 });
  }
  if (buffer.length === 0) {
    return Response.json({ error: "Fichier audio vide" }, { status: 400 });
  }
  if (buffer.length > policy.maxBodyBytes) {
    return Response.json(
      { error: "Fichier audio trop volumineux" },
      { status: 413 },
    );
  }

  const apiKey =
    process.env.GROQ_API_KEY?.trim() || process.env.GROQ_KEY?.trim();
  if (!apiKey) {
    return Response.json({ error: "Groq non configuré" }, { status: 503 });
  }

  const quotaRejection = await consumeExternalAiQuota(authorization, policy);
  if (quotaRejection) return quotaRejection;

  const groqForm = new FormData();
  groqForm.append(
    "file",
    new Blob([new Uint8Array(buffer)], { type: audioMimeType }),
    `recording.${getAudioExtension(audioMimeType)}`,
  );
  groqForm.append("model", "whisper-large-v3");
  const language = getTranscriptionLanguage();
  if (language) groqForm.append("language", language);
  groqForm.append(
    "prompt",
    "Note CRM business. Transcris exactement ce qui est dit et conserve la langue, les termes CRM, les noms, les dates et les heures.",
  );
  groqForm.append("response_format", "json");
  groqForm.append("temperature", "0");

  try {
    const response = await fetchExternalAi(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      {
        body: groqForm,
        headers: { Authorization: `Bearer ${apiKey}` },
        method: "POST",
      },
      policy.timeoutMs,
    );
    if (!response.ok) {
      return Response.json(
        { error: "La transcription a échoué" },
        { status: 502 },
      );
    }

    const payload = (await response.json()) as { text?: unknown };
    return Response.json({
      text: typeof payload.text === "string" ? payload.text.trim() : "",
    });
  } catch {
    return Response.json(
      { error: "La transcription a échoué" },
      { status: 502 },
    );
  }
}

function getAudioExtension(contentType: string) {
  if (contentType.includes("mp4") || contentType.includes("m4a")) return "m4a";
  if (contentType.includes("mpeg")) return "mp3";
  if (contentType.includes("ogg")) return "ogg";
  if (contentType.includes("wav")) return "wav";
  return "webm";
}

function getTranscriptionLanguage() {
  const language = process.env.GROQ_WHISPER_LANGUAGE?.trim().toLowerCase();
  if (language === "auto") return undefined;
  return language || "fr";
}
