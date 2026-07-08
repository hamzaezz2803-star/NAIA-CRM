import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

// WhatsApp Business Cloud API helper for the NAIA bridge. Server-only: it
// holds the permanent access token, verifies Meta webhook signatures, and
// maps sender phone numbers to Qarizmi OS emails via WHATSAPP_USER_MAP.

const WHATSAPP_GRAPH_BASE_URL = "https://graph.facebook.com/v21.0";

// Cloud API hard limits.
export const WHATSAPP_TEXT_BODY_LIMIT = 4096;
export const WHATSAPP_INTERACTIVE_BODY_LIMIT = 1024;
export const WHATSAPP_BUTTON_TITLE_LIMIT = 20;
export const WHATSAPP_BUTTON_ID_LIMIT = 256;
export const WHATSAPP_MAX_BUTTONS = 3;

// Meta signs every webhook delivery with
// `sha256=HMAC_SHA256(app_secret, raw_body)` in X-Hub-Signature-256. The raw
// body must be read as text before any JSON.parse, and compared timing-safe.
export function verifyWhatsAppSignature({
  appSecret = process.env.WHATSAPP_APP_SECRET,
  body,
  signature,
}: {
  appSecret?: string;
  body: string;
  signature: string | null;
}): boolean {
  if (!appSecret || !signature) return false;

  const expected = `sha256=${createHmac("sha256", appSecret)
    .update(body, "utf8")
    .digest("hex")}`;
  const signatureBuffer = Buffer.from(signature);
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
export function parseWhatsAppUserMap(
  raw = process.env.WHATSAPP_USER_MAP,
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
): string | null {
  const normalized = normalizeWhatsAppPhone(phone);
  if (!normalized) return null;

  return parseWhatsAppUserMap(raw).get(normalized) ?? null;
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
        text: truncateToLimit(bodyText, WHATSAPP_INTERACTIVE_BODY_LIMIT),
      },
      type: "button",
    },
    to,
    type: "interactive",
  });
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
