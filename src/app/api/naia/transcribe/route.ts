export async function POST(request: Request) {
  const apiKey = process.env.GROQ_API_KEY ?? process.env.GROQ_KEY;

  if (!apiKey) {
    return Response.json(
      { mode: "missing-groq-key", transcript: "" },
      { status: 503 },
    );
  }

  try {
    const formData = await request.formData();
    const audio = formData.get("audio");

    if (!(audio instanceof Blob)) {
      return Response.json(
        { mode: "missing-audio", transcript: "" },
        { status: 400 },
      );
    }

    const groqForm = new FormData();
    groqForm.append("file", audio, getAudioFileName(audio));
    groqForm.append(
      "model",
      process.env.GROQ_WHISPER_MODEL ?? "whisper-large-v3-turbo",
    );
    groqForm.append(
      "prompt",
      "Business voice command for Qarizmi OS. The speaker may mix French and English in the same sentence. Preserve the original languages, CRM terms, company names, people names, dates, and times.",
    );
    groqForm.append("response_format", "json");
    groqForm.append("temperature", "0");

    const groqResponse = await fetch(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      {
        body: groqForm,
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        method: "POST",
      },
    );

    if (!groqResponse.ok) {
      const error = await readGroqError(groqResponse);
      return Response.json(
        {
          message: error,
          mode: "groq-error",
          status: groqResponse.status,
          transcript: "",
        },
        { status: 502 },
      );
    }

    const payload = (await groqResponse.json()) as { text?: string };

    return Response.json({
      mode: "groq",
      transcript: payload.text?.trim() ?? "",
    });
  } catch {
    return Response.json(
      { mode: "transcription-error", transcript: "" },
      { status: 500 },
    );
  }
}

async function readGroqError(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: {
        message?: string;
      };
    };
    return payload.error?.message ?? "Groq transcription failed";
  }

  return (await response.text().catch(() => "Groq transcription failed")).slice(
    0,
    500,
  );
}

function getAudioFileName(audio: Blob) {
  if ("name" in audio && typeof audio.name === "string" && audio.name) {
    return audio.name;
  }

  if (audio.type.includes("mp4")) return "naia-command.mp4";
  if (audio.type.includes("mpeg")) return "naia-command.mp3";
  if (audio.type.includes("ogg")) return "naia-command.ogg";
  if (audio.type.includes("wav")) return "naia-command.wav";
  return "naia-command.webm";
}
