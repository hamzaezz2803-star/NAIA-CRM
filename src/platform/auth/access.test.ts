import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isAuthorizedEmail,
  isExactAllowedAuthEmail,
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
});
