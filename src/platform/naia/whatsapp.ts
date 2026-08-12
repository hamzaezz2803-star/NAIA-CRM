import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { isExternalAiProviderEnabled } from "@/platform/ai/external-provider-security";

// WhatsApp Business Cloud API helper for the NAIA bridge. Server-only: it
// holds the permanent access token, verifies Meta webhook signatures, and
// maps sender phone numbers to Qarizmi OS emails via WHATSAPP_USER_MAP.

const WHATSAPP_GRAPH_BASE_URL = "https://graph.facebook.com/v21.0";
const GROQ_TRANSCRIPTION_URL =
  "https://api.groq.com/openai/v1/audio/transcriptions";

// Cloud API hard limits.
export const WHATSAPP_TEXT_BODY_LIMIT = 4096;
export const WHATSAPP_INTERACTIVE_BODY_LIMIT = 1024;
export const WHATSAPP_BUTTON_TITLE_LIMIT = 20;
export const WHATSAPP_BUTTON_ID_LIMIT = 256;
export const WHATSAPP_MAX_BUTTONS = 3;
export const WHATSAPP_MAX_AUDIO_BYTES = 10 * 1024 * 1024;

// Meta signs every webhook delivery with
// `sha256=HMAC_SHA256(app_secret, raw_body)` in X-Hub-Signature-256. The raw
// body must be read as text before any JSON.parse, and compared timing-safe.
export function verifyWhatsAppSignature({
  appSecret = process.env.WHATSAPP_APP_SECRET?.trim(),
  body,
  signature,
}: {
  appSecret?: string;
  body: string;
  signature: string | null;
}): boolean {
  if (!appSecret || !signature) return false;

  const cleanAppSecret = appSecret.trim();
  const cleanSignature = signature.trim();

  const expected = `sha256=${createHmac("sha256", cleanAppSecret)
    .update(body, "utf8")
    .digest("hex")}`;
  const signatureBuffer = Buffer.from(cleanSignature);
  const expectedBuffer = Buffer.from(expected);

  return (
    signatureBuffer.length === expectedBuffer.length &&
    timingSafeEqual(signatureBuffer, expectedBuffer)
  );
}

// WHATSAPP_USER_MAP format: "212661234567:ali@qarizmi.com,33612345678:nabil@qarizmi.com".
// Numbers use the international Cloud API `from` format (digits only, no `+`
// or spaces); the parser still tolerates `+`, spaces, dashes, and empty
// entries so a hand-edited env value keeps working. A number mapped to two
// DIFFERENT emails is a misconfiguration and fails closed: the number is
// removed entirely instead of silently impersonating the last entry.
export const DEFAULT_WHATSAPP_USER_MAP =
  "212661234567:ali@qarizmi.com,212640347045:hamza@qarizmi.com,212664505007:wissal@qarizmi.com";

export function parseWhatsAppUserMap(
  raw = process.env.WHATSAPP_USER_MAP ?? DEFAULT_WHATSAPP_USER_MAP,
): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw) return map;

  const conflicts = new Set<string>();

  for (const entry of raw.split(/[,;\n]/)) {
    const separatorIndex = entry.indexOf(":");
    if (separatorIndex <= 0) continue;

    const phone = normalizeWhatsAppPhone(entry.slice(0, separatorIndex));
    const email = entry
      .slice(separatorIndex + 1)
      .trim()
      .toLowerCase();

    if (!phone || !email.includes("@")) continue;

    const existing = map.get(phone);
    if (existing !== undefined && existing !== email) {
      conflicts.add(phone);
      continue;
    }

    map.set(phone, email);
  }

  for (const phone of conflicts) {
    console.warn(
      `WHATSAPP_USER_MAP maps number ${phone} to conflicting emails; the number is ignored until the map is fixed.`,
    );
    map.delete(phone);
  }

  return map;
}

export function normalizeWhatsAppPhone(value: string): string {
  return value.replace(/\D/g, "");
}

export function resolveWhatsAppEmail(
  phone: string,
  raw = process.env.WHATSAPP_USER_MAP,
): string | undefined {
  const normalized = normalizeWhatsAppPhone(phone);
  if (!normalized) return undefined;

  return parseWhatsAppUserMap(raw).get(normalized);
}

// Truncates without ever splitting a UTF-16 surrogate pair: a half emoji at
// the cut point makes the Graph API reject the whole payload.
export function truncateToLimit(value: string, limit: number): string {
  if (value.length <= limit) return value;

  const truncated = value.slice(0, limit);
  const lastCode = truncated.charCodeAt(truncated.length - 1);

  return lastCode >= 0xd800 && lastCode <= 0xdbff
    ? truncated.slice(0, -1)
    : truncated;
}

export async function sendWhatsAppText({
  body,
  to,
}: {
  body: string;
  to: string;
}): Promise<void> {
  await postWhatsAppMessage({
    text: {
      body: truncateToLimit(body, WHATSAPP_TEXT_BODY_LIMIT),
      preview_url: false,
    },
    to,
    type: "text",
  });
}

export type WhatsAppReplyButton = {
  id: string;
  title: string;
};

// Interactive reply-button message: max 3 buttons, 20-character titles and
// 256-character ids. Ids are opaque references (naia_approve:<uuid>) because
// a serialized action draft never fits; drafts live in naia_pending_actions.
export async function sendWhatsAppButtons({
  bodyText,
  buttons,
  to,
}: {
  bodyText: string;
  buttons: WhatsAppReplyButton[];
  to: string;
}): Promise<void> {
  if (buttons.length === 0 || buttons.length > WHATSAPP_MAX_BUTTONS) {
    throw new Error(
      `WhatsApp interactive messages need 1 to ${WHATSAPP_MAX_BUTTONS} buttons.`,
    );
  }
  if (bodyText.length > WHATSAPP_INTERACTIVE_BODY_LIMIT) {
    throw new Error(
      `WhatsApp interactive body exceeds ${WHATSAPP_INTERACTIVE_BODY_LIMIT} characters.`,
    );
  }

  for (const button of buttons) {
    if (button.id.length > WHATSAPP_BUTTON_ID_LIMIT) {
      throw new Error(
        `WhatsApp button id exceeds ${WHATSAPP_BUTTON_ID_LIMIT} characters.`,
      );
    }
  }

  await postWhatsAppMessage({
    interactive: {
      action: {
        buttons: buttons.map((button) => ({
          reply: {
            id: button.id,
            title: button.title.slice(0, WHATSAPP_BUTTON_TITLE_LIMIT),
          },
          type: "reply",
        })),
      },
      body: {
        text: bodyText,
      },
      type: "button",
    },
    to,
    type: "interactive",
  });
}

export async function transcribeWhatsAppAudio(mediaId: string) {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const groqApiKey = process.env.GROQ_API_KEY ?? process.env.GROQ_KEY;
  const normalizedMediaId = mediaId.trim();

  if (!accessToken) {
    throw new Error("WHATSAPP_ACCESS_TOKEN is required to download audio.");
  }
  if (!isExternalAiProviderEnabled("groq")) {
    throw new Error("External Groq access is disabled.");
  }
  if (!groqApiKey) {
    throw new Error("GROQ_API_KEY is required to transcribe WhatsApp audio.");
  }
  if (!normalizedMediaId || normalizedMediaId.length > 256) {
    throw new Error("Invalid WhatsApp media id.");
  }

  const authorization = { Authorization: `Bearer ${accessToken}` };
  const metadataResponse = await fetch(
    `${WHATSAPP_GRAPH_BASE_URL}/${encodeURIComponent(normalizedMediaId)}`,
    { headers: authorization },
  );

  if (!metadataResponse.ok) {
    throw new Error(
      `WhatsApp Cloud API could not resolve the audio: ${await readWhatsAppError(metadataResponse)}`,
    );
  }

  const metadata = (await metadataResponse.json()) as {
    file_size?: number | string;
    mime_type?: string;
    url?: string;
  };
  const mediaUrl = metadata.url?.trim();
  const mimeType = (metadata.mime_type ?? "audio/ogg")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  const declaredSize = Number(metadata.file_size ?? 0);

  if (!mediaUrl || !mediaUrl.startsWith("https://")) {
    throw new Error("WhatsApp returned an invalid media URL.");
  }
  if (!mimeType.startsWith("audio/")) {
    throw new Error("The WhatsApp attachment is not an audio file.");
  }
  if (
    Number.isFinite(declaredSize) &&
    declaredSize > WHATSAPP_MAX_AUDIO_BYTES
  ) {
    throw new Error("The WhatsApp voice note is too large to transcribe.");
  }

  const audioResponse = await fetch(mediaUrl, { headers: authorization });
  if (!audioResponse.ok) {
    throw new Error(
      `WhatsApp Cloud API could not download the audio: HTTP ${audioResponse.status}`,
    );
  }

  const contentLength = Number(
    audioResponse.headers.get("content-length") ?? 0,
  );
  if (
    Number.isFinite(contentLength) &&
    contentLength > WHATSAPP_MAX_AUDIO_BYTES
  ) {
    throw new Error("The WhatsApp voice note is too large to transcribe.");
  }

  const bytes = await audioResponse.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > WHATSAPP_MAX_AUDIO_BYTES) {
    throw new Error("The WhatsApp voice note is empty or too large.");
  }

  const groqForm = new FormData();
  groqForm.append(
    "file",
    new Blob([bytes], { type: mimeType }),
    `naia-whatsapp.${audioExtension(mimeType)}`,
  );
  groqForm.append(
    "model",
    process.env.GROQ_WHISPER_MODEL ?? "whisper-large-v3-turbo",
  );

  const language = process.env.GROQ_WHISPER_LANGUAGE?.trim().toLowerCase();
  if (language && language !== "auto") {
    groqForm.append("language", language);
  }

  groqForm.append(
    "prompt",
    "Commande vocale business pour Qarizmi OS. Transcris exactement ce qui est dit sans traduire. Conserve le mélange français-anglais, les termes CRM, les noms de sociétés, de personnes, les dates et les heures.",
  );
  groqForm.append("response_format", "json");
  groqForm.append("temperature", "0");

  const groqResponse = await fetch(GROQ_TRANSCRIPTION_URL, {
    body: groqForm,
    headers: { Authorization: `Bearer ${groqApiKey}` },
    method: "POST",
  });

  if (!groqResponse.ok) {
    throw new Error(
      `Groq could not transcribe the WhatsApp audio: ${await readGroqError(groqResponse)}`,
    );
  }

  const transcript = ((await groqResponse.json()) as { text?: string }).text
    ?.replace(/\s+/g, " ")
    .trim();
  if (!transcript) {
    throw new Error("Groq returned an empty WhatsApp transcription.");
  }

  return transcript;
}

async function postWhatsAppMessage(payload: Record<string, unknown>) {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!accessToken || !phoneNumberId) {
    throw new Error(
      "WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are required to send WhatsApp messages.",
    );
  }

  const response = await fetch(
    `${WHATSAPP_GRAPH_BASE_URL}/${encodeURIComponent(phoneNumberId)}/messages`,
    {
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        ...payload,
      }),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );

  if (!response.ok) {
    const detail = await readWhatsAppError(response);
    throw new Error(`WhatsApp Cloud API rejected the message: ${detail}`);
  }
}

async function readWhatsAppError(response: Response) {
  try {
    const payload = (await response.json()) as {
      error?: { code?: number; message?: string };
    };

    return (
      payload.error?.message ??
      `HTTP ${response.status} without an error message`
    );
  } catch {
    return `HTTP ${response.status}`;
  }
}

async function readGroqError(response: Response) {
  try {
    const payload = (await response.json()) as {
      error?: { message?: string };
    };
    return payload.error?.message ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

function audioExtension(mimeType: string) {
  if (mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "m4a";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("webm")) return "webm";
  return "ogg";
}
