import { afterEach, describe, expect, it, vi } from "vitest";

import {
  hasLinkedGoogleIdentity,
  hasOAuthAuthenticationMethod,
  isAuthorizedEmail,
  isExactAllowedAuthEmail,
  isGoogleOnlyAuthorizedUser,
} from "@/platform/auth/access";

describe("auth access policy", () => {
  afterEach(() => {
    delete process.env.AUTH_ALLOWED_EMAILS;
    delete process.env.AUTH_ALLOWED_EMAIL_DOMAIN;
    vi.unstubAllEnvs();
  });

  it("allows Qarizmi email addresses by default", () => {
    expect(isAuthorizedEmail("ali@qarizmi.com")).toEqual({
      allowed: true,
      reason: "allowed-domain",
    });
  });

  it("blocks non-Qarizmi email addresses by default", () => {
    expect(isAuthorizedEmail("person@example.com")).toEqual({
      allowed: false,
      reason: "not-allowed",
    });
  });

  it("prefers an exact email allowlist when configured", () => {
    process.env.AUTH_ALLOWED_EMAILS = "ali@qarizmi.com";

    expect(isAuthorizedEmail("ali@qarizmi.com")).toEqual({
      allowed: true,
      reason: "allowed-email",
    });
    expect(isAuthorizedEmail("hamza@qarizmi.com")).toEqual({
      allowed: false,
      reason: "not-allowed",
    });
  });

  it("fails closed in production when the exact allowlist is missing", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(isAuthorizedEmail("ali@qarizmi.com")).toEqual({
      allowed: false,
      reason: "missing-production-allowlist",
    });
  });

  it("fails closed when one reviewed production cofounder is omitted", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_ALLOWED_EMAILS", "ali@qarizmi.com");

    expect(isAuthorizedEmail("ali@qarizmi.com")).toEqual({
      allowed: false,
      reason: "missing-production-allowlist",
    });
  });

  it("restricts production access to allowlisted Ali and Nabil", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "AUTH_ALLOWED_EMAILS",
      "ali@qarizmi.com,nabil@qarizmi.com,member@qarizmi.com",
    );

    expect(isAuthorizedEmail("ALI@QARIZMI.COM").allowed).toBe(true);
    expect(isAuthorizedEmail("nabil@qarizmi.com").allowed).toBe(true);
    expect(isAuthorizedEmail("member@qarizmi.com").allowed).toBe(false);
    expect(isExactAllowedAuthEmail("member@qarizmi.com")).toBe(false);
  });

  it("recognizes a linked Google identity even when the primary provider is email", () => {
    expect(
      hasLinkedGoogleIdentity({
        app_metadata: {
          provider: "email",
          providers: ["email", "google"],
        },
        email: "ali@qarizmi.com",
      }),
    ).toBe(true);
  });

  it("accepts the trusted identities list as a Google-link fallback", () => {
    expect(
      hasLinkedGoogleIdentity({
        app_metadata: { provider: "email", providers: ["email"] },
        email: "ali@qarizmi.com",
        identities: [{ provider: "email" }, { provider: "google" }],
      }),
    ).toBe(true);
  });

  it("does not trust user metadata or an email-only identity as Google-linked", () => {
    expect(
      hasLinkedGoogleIdentity({
        app_metadata: { provider: "email", providers: ["email"] },
        email: "ali@qarizmi.com",
        identities: [{ provider: "email" }],
        user_metadata: { providers: ["google"] },
      }),
    ).toBe(false);
  });

  it("requires an OAuth authentication method in signed claims", () => {
    expect(
      hasOAuthAuthenticationMethod({
        amr: [{ method: "oauth", timestamp: 1_722_000_000 }],
      }),
    ).toBe(true);
    expect(hasOAuthAuthenticationMethod({ amr: ["oauth"] })).toBe(true);
    expect(
      hasOAuthAuthenticationMethod({
        amr: [{ method: "magiclink", timestamp: 1_722_000_000 }],
      }),
    ).toBe(false);
    expect(hasOAuthAuthenticationMethod({ amr: "oauth" })).toBe(false);
  });

  it("combines the email allowlist, Google link, and OAuth AMR fail-closed", () => {
    const ali = {
      app_metadata: { provider: "email", providers: ["email", "google"] },
      email: "ali@qarizmi.com",
      id: "user-ali",
    };

    expect(
      isGoogleOnlyAuthorizedUser(ali, {
        amr: [{ method: "oauth", timestamp: 1_722_000_000 }],
        sub: "user-ali",
      }),
    ).toBe(true);
    expect(
      isGoogleOnlyAuthorizedUser(ali, {
        amr: [{ method: "magiclink", timestamp: 1_722_000_000 }],
        sub: "user-ali",
      }),
    ).toBe(false);
    expect(
      isGoogleOnlyAuthorizedUser(
        {
          ...ali,
          app_metadata: { provider: "email", providers: ["email"] },
        },
        {
          amr: [{ method: "oauth", timestamp: 1_722_000_000 }],
          sub: "user-ali",
        },
      ),
    ).toBe(false);
    expect(
      isGoogleOnlyAuthorizedUser(ali, {
        amr: [{ method: "oauth", timestamp: 1_722_000_000 }],
        sub: "different-user",
      }),
    ).toBe(false);
  });
});
