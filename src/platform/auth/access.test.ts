import { afterEach, describe, expect, it } from "vitest";

import { isAuthorizedEmail } from "@/platform/auth/access";

describe("auth access policy", () => {
  afterEach(() => {
    delete process.env.AUTH_ALLOWED_EMAILS;
    delete process.env.AUTH_ALLOWED_EMAIL_DOMAIN;
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
});
