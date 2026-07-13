import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  normalizeWhatsAppPhone,
  parseWhatsAppUserMap,
  resolveWhatsAppEmail,
  sendWhatsAppButtons,
  sendWhatsAppText,
  transcribeWhatsAppAudio,
  truncateToLimit,
  verifyWhatsAppSignature,
  WHATSAPP_MAX_AUDIO_BYTES,
} from "./whatsapp";

const APP_SECRET = "test-app-secret";

function signBody(body: string, secret = APP_SECRET) {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

describe("verifyWhatsAppSignature", () => {
  it("accepts a valid signature over the raw body", () => {
    const body = JSON.stringify({
      entry: [],
      object: "whatsapp_business_account",
    });

    expect(
      verifyWhatsAppSignature({
        appSecret: APP_SECRET,
        body,
        signature: signBody(body),
      }),
    ).toBe(true);
  });

  it("rejects a signature computed over a different body", () => {
    expect(
      verifyWhatsAppSignature({
        appSecret: APP_SECRET,
        body: '{"tampered":true}',
        signature: signBody('{"original":true}'),
      }),
    ).toBe(false);
  });

  it("rejects a signature made with another secret", () => {
    const body = '{"entry":[]}';

    expect(
      verifyWhatsAppSignature({
        appSecret: APP_SECRET,
        body,
        signature: signBody(body, "wrong-secret"),
      }),
    ).toBe(false);
  });

  it("rejects when the signature header or the secret is missing", () => {
    expect(
      verifyWhatsAppSignature({
        appSecret: APP_SECRET,
        body: "{}",
        signature: null,
      }),
    ).toBe(false);
    expect(
      verifyWhatsAppSignature({
        appSecret: undefined,
        body: "{}",
        signature: signBody("{}"),
      }),
    ).toBe(false);
  });
});

describe("WHATSAPP_USER_MAP parsing", () => {
  it("parses the documented format", () => {
    const map = parseWhatsAppUserMap(
      "212661234567:ali@qarizmi.com,33612345678:nabil@qarizmi.com",
    );

    expect(map.get("212661234567")).toBe("ali@qarizmi.com");
    expect(map.get("33612345678")).toBe("nabil@qarizmi.com");
  });

  it("tolerates spaces, + prefixes, mixed case, and empty entries", () => {
    const map = parseWhatsAppUserMap(
      " +212 661-234-567 : Ali@Qarizmi.com ,, ;\n33612345678:nabil@qarizmi.com,",
    );

    expect(map.get("212661234567")).toBe("ali@qarizmi.com");
    expect(map.get("33612345678")).toBe("nabil@qarizmi.com");
    expect(map.size).toBe(2);
  });

  it("skips malformed entries", () => {
    const map = parseWhatsAppUserMap(
      "not-an-entry,212661234567:not-an-email,:missing@phone.com,212000111222:ok@qarizmi.com",
    );

    expect(map.size).toBe(1);
    expect(map.get("212000111222")).toBe("ok@qarizmi.com");
  });

  it("fails closed when a number maps to two different emails", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const map = parseWhatsAppUserMap(
        "212661234567:ali@qarizmi.com,+212 661 234 567:nabil@qarizmi.com,33612345678:nabil@qarizmi.com",
      );

      // The conflicting number is removed entirely — nobody gets impersonated.
      expect(map.has("212661234567")).toBe(false);
      expect(map.get("33612345678")).toBe("nabil@qarizmi.com");
      expect(map.size).toBe(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("212661234567"),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("keeps a number repeated with the same email", () => {
    const map = parseWhatsAppUserMap(
      "212661234567:ali@qarizmi.com,+212661234567:ALI@qarizmi.com",
    );

    expect(map.get("212661234567")).toBe("ali@qarizmi.com");
    expect(map.size).toBe(1);
  });

  it("returns an empty map when the env value is missing", () => {
    expect(parseWhatsAppUserMap(undefined).size).toBe(0);
    expect(parseWhatsAppUserMap("").size).toBe(0);
  });

  it("resolves emails by normalized phone and refuses unknown numbers", () => {
    const raw = "212661234567:ali@qarizmi.com";

    expect(resolveWhatsAppEmail("212661234567", raw)).toBe("ali@qarizmi.com");
    expect(resolveWhatsAppEmail("+212661234567", raw)).toBe("ali@qarizmi.com");
    expect(resolveWhatsAppEmail("999999999999", raw)).toBeNull();
    expect(resolveWhatsAppEmail("", raw)).toBeNull();
  });

  it("normalizes phones to Cloud API digits", () => {
    expect(normalizeWhatsAppPhone("+212 661-234-567")).toBe("212661234567");
  });
});

describe("truncateToLimit", () => {
  it("returns short values untouched", () => {
    expect(truncateToLimit("bonjour 😀", 100)).toBe("bonjour 😀");
  });

  it("truncates plain text at the limit", () => {
    expect(truncateToLimit("a".repeat(10), 5)).toBe("aaaaa");
  });

  it("never splits a surrogate pair at the cut point", () => {
    // "😀" is a surrogate pair (2 UTF-16 units); a naive slice(0, 5) would
    // keep the lone high surrogate and make the Graph API reject the payload.
    const value = `aaaa😀bbbb`;
    const truncated = truncateToLimit(value, 5);

    expect(truncated).toBe("aaaa");
    expect(truncated).not.toMatch(/[\uD800-\uDBFF]$/);
    // Cutting right after the full pair keeps the emoji intact.
    expect(truncateToLimit(value, 6)).toBe("aaaa😀");
  });
});

describe("WhatsApp Cloud API senders", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "test-access-token");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "1234567890");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), {
        status: 200,
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("posts a text message to the phone number endpoint", async () => {
    await sendWhatsAppText({ body: "Bonjour", to: "212661234567" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v21.0/1234567890/messages");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-access-token");

    const payload = JSON.parse(init.body);
    expect(payload).toMatchObject({
      messaging_product: "whatsapp",
      text: { body: "Bonjour" },
      to: "212661234567",
      type: "text",
    });
  });

  it("posts an interactive reply-button message and truncates titles to 20 characters", async () => {
    await sendWhatsAppButtons({
      bodyText: "Créer le lead HPS",
      buttons: [
        { id: "naia_approve:uuid-1", title: "✅ Valider" },
        {
          id: "naia_dismiss:uuid-1",
          title: "❌ Ignorer cette action beaucoup trop longue",
        },
      ],
      to: "212661234567",
    });

    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.type).toBe("interactive");
    expect(payload.interactive.type).toBe("button");
    expect(payload.interactive.body.text).toBe("Créer le lead HPS");

    const buttons = payload.interactive.action.buttons;
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toEqual({
      reply: { id: "naia_approve:uuid-1", title: "✅ Valider" },
      type: "reply",
    });
    expect(buttons[1].reply.title.length).toBeLessThanOrEqual(20);
  });

  it("refuses more than 3 buttons or oversized button ids", async () => {
    const button = { id: "naia_approve:uuid", title: "Ok" };

    await expect(
      sendWhatsAppButtons({
        bodyText: "Trop de boutons",
        buttons: [button, button, button, button],
        to: "212661234567",
      }),
    ).rejects.toThrow(/1 to 3 buttons/);

    await expect(
      sendWhatsAppButtons({
        bodyText: "Id trop long",
        buttons: [{ id: "x".repeat(257), title: "Ok" }],
        to: "212661234567",
      }),
    ).rejects.toThrow(/256/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an oversized interactive body instead of hiding its end", async () => {
    await expect(
      sendWhatsAppButtons({
        bodyText: "x".repeat(1025),
        buttons: [{ id: "naia_approve:uuid", title: "Ok" }],
        to: "212661234567",
      }),
    ).rejects.toThrow(/1024/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("truncates a text body without splitting an emoji at the 4096 limit", async () => {
    // 4095 chars + a surrogate pair straddling the limit at index 4095/4096.
    await sendWhatsAppText({
      body: `${"a".repeat(4095)}😀`,
      to: "212661234567",
    });

    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.text.body).toBe("a".repeat(4095));
    expect(payload.text.body).not.toMatch(/[\uD800-\uDBFF]$/);
  });

  it("surfaces Cloud API errors", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 131047, message: "Re-engagement message" },
        }),
        { status: 400 },
      ),
    );

    await expect(
      sendWhatsAppText({ body: "Bonjour", to: "212661234567" }),
    ).rejects.toThrow(/Re-engagement message/);
  });

  it("requires the access token and phone number id", async () => {
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "");

    await expect(
      sendWhatsAppText({ body: "Bonjour", to: "212661234567" }),
    ).rejects.toThrow(/WHATSAPP_ACCESS_TOKEN/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("WhatsApp Cloud API voice notes", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "meta-access-token");
    vi.stubEnv("GROQ_API_KEY", "groq-api-key");
    vi.stubEnv("GROQ_WHISPER_LANGUAGE", "auto");
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("downloads an authorized Meta audio attachment and transcribes it", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            file_size: 4,
            mime_type: "audio/ogg; codecs=opus",
            url: "https://lookaside.fbsbx.com/whatsapp/audio-1",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3, 4]), {
          headers: { "content-length": "4" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ text: "  Bonjour   HPS  " }), {
          status: 200,
        }),
      );

    await expect(transcribeWhatsAppAudio("media-1")).resolves.toBe(
      "Bonjour HPS",
    );

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://graph.facebook.com/v21.0/media-1",
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://lookaside.fbsbx.com/whatsapp/audio-1",
    );
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(
      "Bearer meta-access-token",
    );
    expect(fetchMock.mock.calls[2][0]).toBe(
      "https://api.groq.com/openai/v1/audio/transcriptions",
    );
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe(
      "Bearer groq-api-key",
    );

    const groqForm = fetchMock.mock.calls[2][1].body as FormData;
    expect(groqForm.get("model")).toBe("whisper-large-v3-turbo");
    expect(groqForm.get("language")).toBeNull();
  });

  it("rejects an oversized attachment before downloading it", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          file_size: WHATSAPP_MAX_AUDIO_BYTES + 1,
          mime_type: "audio/ogg",
          url: "https://lookaside.fbsbx.com/whatsapp/audio-1",
        }),
        { status: 200 },
      ),
    );

    await expect(transcribeWhatsAppAudio("media-1")).rejects.toThrow(
      /too large/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed when Meta or Groq credentials are missing", async () => {
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "");
    await expect(transcribeWhatsAppAudio("media-1")).rejects.toThrow(
      /WHATSAPP_ACCESS_TOKEN/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
