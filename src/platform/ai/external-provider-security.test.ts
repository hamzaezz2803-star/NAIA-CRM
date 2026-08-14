import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  authorizeExternalAiRequest,
  consumeExternalAiQuota,
  EXTERNAL_AI_POLICIES,
  fetchExternalAi,
  isExternalAiProviderEnabled,
  type ExternalAiSecurityDependencies,
} from "./external-provider-security";

const policy = EXTERNAL_AI_POLICIES.naiaCompletion;

function request(origin = "https://os.qarizmi.com") {
  return new Request("https://os.qarizmi.com/api/naia/complete", {
    body: JSON.stringify({ prompt: "Priorités" }),
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "Sec-Fetch-Site": "same-origin",
    },
    method: "POST",
  });
}

function dependencies(args: {
  email?: string;
  quotaAllowed?: boolean;
  role?: string;
}) {
  const membershipQuery = {
    eq: vi.fn(),
    in: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { role: args.role ?? "owner" },
      error: null,
    }),
    select: vi.fn(),
  };
  membershipQuery.select.mockReturnValue(membershipQuery);
  membershipQuery.eq.mockReturnValue(membershipQuery);
  membershipQuery.in.mockReturnValue(membershipQuery);
  membershipQuery.limit.mockReturnValue(membershipQuery);

  const rpc = vi.fn().mockResolvedValue({
    data: [{ allowed: args.quotaAllowed ?? true, remaining: 12 }],
    error: null,
  });
  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            email: args.email ?? "ali@qarizmi.com",
            id: "20000000-0000-0000-0000-000000000001",
          },
        },
        error: null,
      }),
    },
    from: vi.fn(() => membershipQuery),
    rpc,
  };
  const createClient = vi.fn().mockResolvedValue(client);

  return {
    client,
    createClient,
    dependencies: { createClient } as unknown as ExternalAiSecurityDependencies,
    rpc,
  };
}

describe("external AI security boundary", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_ALLOWED_EMAILS", "ali@qarizmi.com,nabil@qarizmi.com");
    vi.stubEnv("EXTERNAL_AI_GROQ_ENABLED", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is default-off in production and opens Groq callers when configured", async () => {
    vi.stubEnv("EXTERNAL_AI_GROQ_ENABLED", "");
    const fixture = dependencies({});

    const result = await authorizeExternalAiRequest(
      request(),
      policy,
      fixture.dependencies,
    );

    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.response.status).toBe(503);
    expect(fixture.createClient).not.toHaveBeenCalled();

    vi.stubEnv("EXTERNAL_AI_GROQ_ENABLED", "true");
    expect(isExternalAiProviderEnabled("groq", "founder-route")).toBe(true);
    expect(isExternalAiProviderEnabled("groq", "internal")).toBe(true);
  });

  it("rejects cross-site POSTs before auth or provider work", async () => {
    const fixture = dependencies({});
    const result = await authorizeExternalAiRequest(
      request("https://attacker.example"),
      policy,
      fixture.dependencies,
    );

    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.response.status).toBe(403);
    expect(fixture.createClient).not.toHaveBeenCalled();
  });

  it("rejects a non-owner/non-admin before quota or provider work", async () => {
    const fixture = dependencies({ role: "member" });
    const result = await authorizeExternalAiRequest(
      request(),
      policy,
      fixture.dependencies,
    );

    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.response.status).toBe(403);
    expect(fixture.rpc).not.toHaveBeenCalled();
  });

  it("returns 429 when the durable profile/day CAS quota is exhausted", async () => {
    const fixture = dependencies({ quotaAllowed: false });
    const authorization = await authorizeExternalAiRequest(
      request(),
      policy,
      fixture.dependencies,
    );
    expect(authorization.allowed).toBe(true);
    if (!authorization.allowed) throw new Error("authorization failed");

    const response = await consumeExternalAiQuota(authorization, policy);

    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toBe("86400");
    expect(fixture.rpc).toHaveBeenCalledWith(
      "consume_external_ai_daily_quota",
      expect.objectContaining({ requested_limit: policy.dailyLimit }),
    );
  });

  it("adds a bounded timeout to the provider fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null));
    vi.stubGlobal("fetch", fetchMock);

    await fetchExternalAi("https://provider.example", { method: "POST" }, 50);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://provider.example",
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal),
      }),
    );
  });
});
