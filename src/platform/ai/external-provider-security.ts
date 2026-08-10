import "server-only";

import { isExactAllowedAuthEmail } from "@/platform/auth/access";
import { createServerSupabaseClient } from "@/platform/auth/supabase-server";

export type ExternalAiProvider = "elevenlabs" | "groq";
export type ExternalAiSurface = "founder-route" | "internal";

export type ExternalAiPolicy = {
  dailyLimit: number;
  maxBodyBytes: number;
  operation: string;
  provider: ExternalAiProvider;
  timeoutMs: number;
};

const MEBIBYTE = 1024 * 1024;

export const EXTERNAL_AI_POLICIES = {
  crmTranscription: {
    dailyLimit: 30,
    maxBodyBytes: 10 * MEBIBYTE,
    operation: "crm-transcription",
    provider: "groq",
    timeoutMs: 30_000,
  },
  naiaCompletion: {
    dailyLimit: 120,
    maxBodyBytes: 16 * 1024,
    operation: "naia-completion",
    provider: "groq",
    timeoutMs: 15_000,
  },
  naiaTranscription: {
    dailyLimit: 30,
    maxBodyBytes: 10 * MEBIBYTE,
    operation: "naia-transcription",
    provider: "groq",
    timeoutMs: 30_000,
  },
  naiaVoice: {
    dailyLimit: 120,
    maxBodyBytes: 8 * 1024,
    operation: "naia-voice",
    provider: "elevenlabs",
    timeoutMs: 20_000,
  },
} as const satisfies Record<string, ExternalAiPolicy>;

export const ALLOWED_AUDIO_MIME_TYPES = new Set([
  "audio/m4a",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/x-m4a",
  "audio/x-wav",
]);

type ServerSupabaseClient = NonNullable<
  Awaited<ReturnType<typeof createServerSupabaseClient>>
>;

export type ExternalAiAuthorization =
  | {
      allowed: true;
      profileId: string;
      supabase: ServerSupabaseClient;
    }
  | { allowed: false; response: Response };

export type ExternalAiSecurityDependencies = {
  createClient(): Promise<ServerSupabaseClient | null>;
};

const defaultDependencies: ExternalAiSecurityDependencies = {
  createClient: createServerSupabaseClient,
};

export function isExternalAiProviderEnabled(
  provider: ExternalAiProvider,
  surface: ExternalAiSurface = "internal",
) {
  const configured = process.env[providerFlag(provider)]?.trim().toLowerCase();
  if (configured === "false") return false;
  if (process.env.NODE_ENV === "production") {
    return surface === "founder-route" && configured === "true";
  }
  return true;
}

export async function authorizeExternalAiRequest(
  request: Request,
  policy: ExternalAiPolicy,
  dependencies: ExternalAiSecurityDependencies = defaultDependencies,
): Promise<ExternalAiAuthorization> {
  if (!isExternalAiProviderEnabled(policy.provider, "founder-route")) {
    return denied(503, "external-ai-disabled");
  }

  if (request.method !== "POST") {
    return {
      allowed: false,
      response: Response.json(
        { error: "method-not-allowed" },
        { headers: { Allow: "POST" }, status: 405 },
      ),
    };
  }

  if (!isSameOrigin(request)) {
    return denied(403, "cross-site-request-blocked");
  }

  const supabase = await dependencies.createClient();
  if (!supabase) return denied(503, "authentication-unavailable");

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return denied(401, "authentication-required");
  if (!isExactAllowedAuthEmail(user.email)) {
    return denied(403, "external-ai-not-allowlisted");
  }

  const { data: membership, error: membershipError } = await supabase
    .from("organization_memberships")
    .select("role")
    .eq("profile_id", user.id)
    .in("role", ["owner", "admin"])
    .limit(1)
    .maybeSingle();
  if (membershipError) return denied(503, "authorization-unavailable");
  if (membership?.role !== "owner" && membership?.role !== "admin") {
    return denied(403, "external-ai-role-forbidden");
  }

  return { allowed: true, profileId: user.id, supabase };
}

export async function consumeExternalAiQuota(
  authorization: Extract<ExternalAiAuthorization, { allowed: true }>,
  policy: ExternalAiPolicy,
) {
  const { data, error } = await authorization.supabase.rpc(
    "consume_external_ai_daily_quota",
    {
      requested_limit: policy.dailyLimit,
      requested_operation: policy.operation,
      requested_provider: policy.provider,
    },
  );
  if (error) return quotaResponse(503, "external-ai-quota-unavailable");

  const result = Array.isArray(data) ? data[0] : data;
  if (
    !result ||
    typeof result !== "object" ||
    !("allowed" in result) ||
    typeof result.allowed !== "boolean"
  ) {
    return quotaResponse(503, "external-ai-quota-invalid");
  }
  if (!result.allowed) return quotaResponse(429, "external-ai-quota-exceeded");

  return null;
}

export function rejectOversizedRequest(request: Request, maxBytes: number) {
  const rawLength = request.headers.get("content-length");
  if (!rawLength) {
    return Response.json({ error: "content-length-required" }, { status: 411 });
  }
  if (!/^\d+$/.test(rawLength)) {
    return Response.json({ error: "invalid-content-length" }, { status: 400 });
  }
  return Number(rawLength) > maxBytes
    ? Response.json({ error: "request-too-large" }, { status: 413 })
    : null;
}

export async function readBoundedRequestBody(
  request: Request,
  maxBytes: number,
): Promise<
  | { bytes: Uint8Array<ArrayBuffer>; ok: true }
  | { ok: false; response: Response }
> {
  const headerRejection = rejectOversizedRequest(request, maxBytes);
  if (headerRejection) return { ok: false, response: headerRejection };

  const reader = request.body?.getReader();
  if (!reader) {
    return { bytes: new Uint8Array(new ArrayBuffer(0)), ok: true };
  }

  const chunks: Uint8Array<ArrayBufferLike>[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return {
        ok: false,
        response: Response.json(
          { error: "request-too-large" },
          { status: 413 },
        ),
      };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(new ArrayBuffer(totalBytes));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, ok: true };
}

export function isAllowedAudioMimeType(value: string | null | undefined) {
  const mimeType = value?.split(";", 1)[0]?.trim().toLowerCase();
  return Boolean(mimeType && ALLOWED_AUDIO_MIME_TYPES.has(mimeType));
}

export function isJsonRequest(request: Request) {
  return (
    request.headers.get("content-type")?.split(";", 1)[0]?.trim() ===
    "application/json"
  );
}

export function fetchExternalAi(
  input: string | URL,
  init: RequestInit,
  timeoutMs: number,
) {
  return fetch(input, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!origin || (fetchSite && fetchSite !== "same-origin")) return false;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function providerFlag(provider: ExternalAiProvider) {
  return provider === "groq"
    ? "EXTERNAL_AI_GROQ_ENABLED"
    : "EXTERNAL_AI_ELEVENLABS_ENABLED";
}

function denied(status: 401 | 403 | 503, error: string) {
  return {
    allowed: false as const,
    response: Response.json({ error }, { status }),
  };
}

function quotaResponse(status: 429 | 503, error: string) {
  return Response.json(
    { error },
    {
      headers: {
        "Cache-Control": "no-store",
        ...(status === 429 ? { "Retry-After": "86400" } : {}),
      },
      status,
    },
  );
}
