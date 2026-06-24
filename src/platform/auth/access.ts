import type { User } from "@supabase/supabase-js";

const DEFAULT_ALLOWED_DOMAIN = "qarizmi.com";

export type AuthAccessDecision = {
  allowed: boolean;
  reason: "allowed-email" | "allowed-domain" | "missing-email" | "not-allowed";
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

function parseCsv(value: string | undefined) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}
