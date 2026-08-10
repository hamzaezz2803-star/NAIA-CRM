#!/usr/bin/env node

import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { canUseMeetingNotesEmail } from "../src/features/meeting-notes/access-policy";
import {
  GoogleReattestSafeError,
  runGoogleOAuthReattestation,
  type GoogleReattestCandidate,
  type GoogleReattestMode,
} from "../src/platform/integrations/google-reattest-runner";

function parseMode(): GoogleReattestMode {
  const requested = process.argv[2];
  if (requested === "apply" || requested === "dry-run") return requested;
  throw new GoogleReattestSafeError(
    "MODE_REQUIRED",
    "Usage: npm run google:oauth-reattest -- dry-run|apply [--confirm-apply]",
  );
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!supabaseUrl || !serviceRoleKey || !clientId || !clientSecret) {
    throw new GoogleReattestSafeError(
      "CONFIGURATION_REQUIRED",
      "Les variables serveur Supabase et Google OAuth sont requises.",
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const result = await runGoogleOAuthReattestation(
    {
      clientId,
      confirmApply: process.argv.includes("--confirm-apply"),
      mode: parseMode(),
    },
    {
      async attestAccessToken(accessToken) {
        const response = await fetch(
          "https://oauth2.googleapis.com/tokeninfo",
          {
            body: new URLSearchParams({ access_token: accessToken }),
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            method: "POST",
          },
        );
        if (!response.ok) throw new Error("provider rejected attestation");
        const payload = (await response.json()) as {
          aud?: string;
          audience?: string;
          azp?: string;
          issued_to?: string;
          scope?: string;
        };
        return {
          audiences: [
            payload.audience,
            payload.issued_to,
            payload.aud,
            payload.azp,
          ].filter((value): value is string => Boolean(value)),
          scopes: payload.scope?.split(/\s+/u) ?? [],
        };
      },
      async getActor(candidate) {
        const { data, error } = await supabase
          .from("organization_memberships")
          .select("organization_id,profile_id,role,profiles:profile_id(email)")
          .eq("organization_id", candidate.organizationId)
          .eq("profile_id", candidate.profileId)
          .maybeSingle();
        const profile = Array.isArray(data?.profiles)
          ? data.profiles[0]
          : data?.profiles;
        const email = profile?.email;
        if (
          error ||
          !data ||
          data.organization_id !== candidate.organizationId ||
          data.profile_id !== candidate.profileId ||
          typeof email !== "string"
        ) {
          return null;
        }
        return {
          email,
          founderMeetingAccess:
            data.role === "owner" && canUseMeetingNotesEmail(email),
        };
      },
      async listCandidates() {
        const { data, error } = await supabase
          .from("integration_connections")
          .select(
            "id,organization_id,connected_by_profile_id,encrypted_token_reference,updated_at",
          )
          .eq("provider", "google")
          .eq("status", "needs-review")
          .in("server_review_reason", [
            "legacy-unattested",
            "scope-attestation-failed",
          ]);
        if (error) throw new Error("candidate query failed");
        return (data ?? []).flatMap((row) =>
          row.connected_by_profile_id
            ? [
                {
                  encryptedTokenReference: row.encrypted_token_reference,
                  id: row.id,
                  organizationId: row.organization_id,
                  profileId: row.connected_by_profile_id,
                  updatedAt: row.updated_at,
                } satisfies GoogleReattestCandidate,
              ]
            : [],
        );
      },
      async persist({ candidate, scopes, tokenReference }) {
        const { data, error } = await supabase
          .from("integration_connections")
          .update({
            encrypted_token_reference: tokenReference,
            scopes,
            server_review_reason: null,
            status: "connected",
            updated_at: new Date().toISOString(),
          })
          .eq("id", candidate.id)
          .eq("organization_id", candidate.organizationId)
          .eq("provider", "google")
          .eq("connected_by_profile_id", candidate.profileId)
          .eq("status", "needs-review")
          .eq("updated_at", candidate.updatedAt)
          .in("server_review_reason", [
            "legacy-unattested",
            "scope-attestation-failed",
          ])
          .select("id,organization_id,provider,connected_by_profile_id,status")
          .maybeSingle();
        return (
          !error &&
          data?.id === candidate.id &&
          data.organization_id === candidate.organizationId &&
          data.provider === "google" &&
          data.connected_by_profile_id === candidate.profileId &&
          data.status === "connected"
        );
      },
      async refreshAccessToken(refreshToken) {
        const response = await fetch("https://oauth2.googleapis.com/token", {
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: "refresh_token",
            refresh_token: refreshToken,
          }),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          method: "POST",
        });
        if (!response.ok) throw new Error("provider rejected refresh");
        const payload = (await response.json()) as {
          access_token?: string;
          expires_in?: number;
          refresh_token?: string;
        };
        if (!payload.access_token) throw new Error("missing access token");
        return {
          accessToken: payload.access_token,
          expiresIn: payload.expires_in ?? 3600,
          refreshToken: payload.refresh_token,
        };
      },
      async resolveGoogleAccountEmail(accessToken) {
        const response = await fetch(
          "https://gmail.googleapis.com/gmail/v1/users/me/profile",
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (!response.ok) return null;
        const payload = (await response.json()) as { emailAddress?: string };
        return payload.emailAddress ?? null;
      },
    },
  );

  process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
}

main().catch((error: unknown) => {
  const safeError =
    error instanceof GoogleReattestSafeError
      ? error
      : new GoogleReattestSafeError(
          "SAFE_FAILURE",
          "Ré-attestation interrompue sans sortie de credentials.",
        );
  process.stderr.write(
    `${JSON.stringify({ code: safeError.code, message: safeError.message, ok: false })}\n`,
  );
  process.exitCode = 1;
});
