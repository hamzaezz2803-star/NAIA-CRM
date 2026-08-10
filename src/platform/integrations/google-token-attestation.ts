import "server-only";

import {
  attestGoogleScopes,
  googleScopeSetsEqual,
  type GoogleOAuthIntent,
  normalizeGoogleScopes,
} from "./google-workspace-scopes";

export type GoogleAccessTokenAttestation =
  | {
      ok: true;
      scopes: string[];
    }
  | {
      ok: false;
      reason: "audience" | "scope-mismatch" | "scopes" | "unavailable";
      scopes: string[];
    };

/**
 * Asks Google to attest the access token itself. POST keeps the credential out
 * of URLs, access logs and errors; callers receive provider-attested scopes
 * only.
 */
export async function attestGoogleAccessToken({
  accessToken,
  expectedScopes,
  intent,
}: {
  accessToken: string;
  expectedScopes?: readonly string[];
  intent: GoogleOAuthIntent;
}): Promise<GoogleAccessTokenAttestation> {
  if (!accessToken) {
    return { ok: false, reason: "unavailable", scopes: [] };
  }

  try {
    const response = await fetch("https://oauth2.googleapis.com/tokeninfo", {
      body: new URLSearchParams({ access_token: accessToken }),
      cache: "no-store",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    if (!response.ok) {
      return { ok: false, reason: "unavailable", scopes: [] };
    }

    const payload = (await response.json()) as {
      aud?: string;
      audience?: string;
      azp?: string;
      issued_to?: string;
      scope?: string;
    };
    const configuredAudience = process.env.GOOGLE_CLIENT_ID;
    const attestedAudiences = [
      payload.audience,
      payload.issued_to,
      payload.aud,
      payload.azp,
    ].filter((value): value is string => Boolean(value));
    if (
      !configuredAudience ||
      attestedAudiences.length === 0 ||
      attestedAudiences.some((audience) => audience !== configuredAudience)
    ) {
      return { ok: false, reason: "audience", scopes: [] };
    }

    const scopes = normalizeGoogleScopes(payload.scope?.split(/\s+/u));
    const scopeBoundary = attestGoogleScopes(scopes, intent);
    if (!scopeBoundary.ok) {
      return { ok: false, reason: "scopes", scopes };
    }
    if (expectedScopes && !googleScopeSetsEqual(scopes, expectedScopes)) {
      return { ok: false, reason: "scope-mismatch", scopes };
    }

    return { ok: true, scopes };
  } catch {
    return { ok: false, reason: "unavailable", scopes: [] };
  }
}
