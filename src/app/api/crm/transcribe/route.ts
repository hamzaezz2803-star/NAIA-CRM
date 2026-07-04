import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { toFile } from "groq-sdk";
import { createServerSupabaseClient } from "@/platform/auth/supabase-server";

export async function POST(req: NextRequest) {
  try {
    // 1. Explicit authentication check
    const supabase = await createServerSupabaseClient();
    if (!supabase) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    // 2. API Key configuration check
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GROQ_API_KEY non configuré" },
        { status: 500 },
      );
    }

    const contentType =
      req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ??
      "audio/webm";
    if (!contentType.startsWith("audio/")) {
      return NextResponse.json(
        { error: "Format audio non supporté" },
        { status: 400 },
      );
    }

    // 3. Size limit check
    const arrayBuffer = await req.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) {
      return NextResponse.json(
        { error: "Fichier audio vide" },
        { status: 400 },
      );
    }

    const MAX_SIZE = 10 * 1024 * 1024; // 10MB
    if (buffer.length > MAX_SIZE) {
      return NextResponse.json(
        { error: "Fichier audio trop volumineux (max 10 Mo)" },
        { status: 400 },
      );
    }

    const groq = new Groq({ apiKey });
    const extension = getAudioExtension(contentType);

    // Transcribe the audio using whisper-large-v3
    const transcription = await groq.audio.transcriptions.create({
      file: await toFile(buffer, `recording.${extension}`, {
        type: contentType,
      }),
      model: "whisper-large-v3",
      prompt:
        "Business CRM note. The speaker may mix French and English. Preserve CRM terms, people names, company names, dates, and times.",
      response_format: "json",
      temperature: 0,
    });

    return NextResponse.json({ text: transcription.text });
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("Error in transcription API:", err);
    return NextResponse.json(
      { error: err.message || "La transcription a échoué" },
      { status: 500 },
    );
  }
}

function getAudioExtension(contentType: string) {
  if (contentType.includes("mp4")) return "mp4";
  if (contentType.includes("mpeg")) return "mp3";
  if (contentType.includes("ogg")) return "ogg";
  if (contentType.includes("wav")) return "wav";
  if (contentType.includes("webm")) return "webm";
  return "webm";
}
