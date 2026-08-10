import type { User } from "@supabase/supabase-js";

const DEFAULT_ALLOWED_DOMAIN = "qarizmi.com";
const PRODUCTION_FOUNDER_EMAILS = new Set([
  "ali@qarizmi.com",
  "nabil@qarizmi.com",
]);

export type AuthAccessDecision = {
  allowed: boolean;
  reason:
    | "allowed-email"
    | "allowed-domain"
    | "missing-email"
    | "missing-production-allowlist"
    | "not-allowed";
};

export function getAllowedAuthEmails() {
  return parseCsv(process.env.AUTH_ALLOWED_EMAILS);
}

export function getAllowedAuthDomain() {
  return (
    process.env.AUTH_ALLOWED_EMAIL_DOMAIN?.trim().toLowerCase() ??
    DEFAULT_ALLOWED_DOMAIN
  );
}

export function isAuthorizedEmail(
  email: string | null | undefined,
): AuthAccessDecision {
  const normalizedEmail = email?.trim().toLowerCase();

  if (!normalizedEmail) {
    return { allowed: false, reason: "missing-email" };
  }

  const allowedEmails = getAllowedAuthEmails();

  if (process.env.NODE_ENV === "production") {
    if (!hasReviewedProductionAllowlist(allowedEmails)) {
      return { allowed: false, reason: "missing-production-allowlist" };
    }

    return {
      allowed:
        PRODUCTION_FOUNDER_EMAILS.has(normalizedEmail) &&
        allowedEmails.has(normalizedEmail),
      reason:
        PRODUCTION_FOUNDER_EMAILS.has(normalizedEmail) &&
        allowedEmails.has(normalizedEmail)
          ? "allowed-email"
          : "not-allowed",
    };
  }

  if (allowedEmails.has(normalizedEmail)) {
    return { allowed: true, reason: "allowed-email" };
  }

  if (allowedEmails.size > 0) {
    return { allowed: false, reason: "not-allowed" };
  }

  const allowedDomain = getAllowedAuthDomain();

  if (normalizedEmail.endsWith(`@${allowedDomain}`)) {
    return { allowed: true, reason: "allowed-domain" };
  }

  return { allowed: false, reason: "not-allowed" };
}

export function isAuthorizedUser(user: Pick<User, "email"> | null) {
  return isAuthorizedEmail(user?.email).allowed;
}

export function isExactAllowedAuthEmail(email: string | null | undefined) {
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) return false;

  const allowedEmails = getAllowedAuthEmails();
  if (!allowedEmails.has(normalizedEmail)) return false;

  return (
    process.env.NODE_ENV !== "production" ||
    (hasReviewedProductionAllowlist(allowedEmails) &&
      PRODUCTION_FOUNDER_EMAILS.has(normalizedEmail))
  );
}

function hasReviewedProductionAllowlist(allowedEmails: Set<string>) {
  return [...PRODUCTION_FOUNDER_EMAILS].every((email) =>
    allowedEmails.has(email),
  );
}

function parseCsv(value: string | undefined) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}
