import {
  attestGoogleScopes,
  type GoogleOAuthIntent,
  normalizeGoogleScopes,
} from "./google-workspace-scopes";

export type GoogleReattestMode = "apply" | "dry-run";

export type GoogleReattestCandidate = {
  encryptedTokenReference: string | null;
  id: string;
  organizationId: string;
  profileId: string;
  updatedAt: string;
};

export type GoogleReattestActor = {
  email: string;
  founderMeetingAccess: boolean;
};

export type RefreshedGoogleCredential = {
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
};

export type GoogleProviderAttestation = {
  audiences: string[];
  scopes: string[];
};

export type GoogleReattestDependencies = {
  attestAccessToken: (
    accessToken: string,
  ) => Promise<GoogleProviderAttestation>;
  getActor: (
    candidate: GoogleReattestCandidate,
  ) => Promise<GoogleReattestActor | null>;
  listCandidates: () => Promise<GoogleReattestCandidate[]>;
  persist: (input: {
    candidate: GoogleReattestCandidate;
    scopes: string[];
    tokenReference: string;
  }) => Promise<boolean>;
  refreshAccessToken: (
    refreshToken: string,
  ) => Promise<RefreshedGoogleCredential>;
  resolveGoogleAccountEmail: (accessToken: string) => Promise<string | null>;
};

export type GoogleReattestResult = {
  accountMismatch: number;
  eligible: number;
  missingCredential: number;
  mode: GoogleReattestMode;
  providerRejected: number;
  reconnected: number;
  scanned: number;
  scopeRejected: number;
};

export class GoogleReattestSafeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GoogleReattestSafeError";
  }
}

/**
 * Re-attests quarantined credentials without trusting any previously mutable
 * scope/status/account label. The returned summary contains counts only.
 */
export async function runGoogleOAuthReattestation(
  {
    clientId,
    confirmApply,
    mode,
  }: {
    clientId: string;
    confirmApply: boolean;
    mode: GoogleReattestMode;
  },
  dependencies: GoogleReattestDependencies,
): Promise<GoogleReattestResult> {
  if (!clientId) {
    throw new GoogleReattestSafeError(
      "CONFIGURATION_REQUIRED",
      "GOOGLE_CLIENT_ID est requis.",
    );
  }
  if (mode === "apply" && !confirmApply) {
    throw new GoogleReattestSafeError(
      "CONFIRMATION_REQUIRED",
      "Le mode apply exige --confirm-apply.",
    );
  }

  const candidates = await dependencies.listCandidates();
  const result: GoogleReattestResult = {
    accountMismatch: 0,
    eligible: 0,
    missingCredential: 0,
    mode,
    providerRejected: 0,
    reconnected: 0,
    scanned: candidates.length,
    scopeRejected: 0,
  };

  for (const candidate of candidates) {
    const storedRefreshToken = parseRefreshToken(
      candidate.encryptedTokenReference,
    );
    if (!storedRefreshToken) {
      result.missingCredential += 1;
      continue;
    }

    const actor = await dependencies.getActor(candidate);
    if (!actor?.email) {
      result.accountMismatch += 1;
      continue;
    }

    let refreshed: RefreshedGoogleCredential;
    let providerAttestation: GoogleProviderAttestation;
    try {
      refreshed = await dependencies.refreshAccessToken(storedRefreshToken);
      providerAttestation = await dependencies.attestAccessToken(
        refreshed.accessToken,
      );
    } catch {
      result.providerRejected += 1;
      continue;
    }

    const audiences = normalizeGoogleScopes(providerAttestation.audiences);
    if (
      audiences.length === 0 ||
      audiences.some((audience) => audience !== clientId)
    ) {
      result.providerRejected += 1;
      continue;
    }

    const scopes = normalizeGoogleScopes(providerAttestation.scopes);
    const intent = resolveAttestedIntent(scopes, actor.founderMeetingAccess);
    if (!intent) {
      result.scopeRejected += 1;
      continue;
    }

    let googleAccountEmail: string | null;
    try {
      googleAccountEmail = await dependencies.resolveGoogleAccountEmail(
        refreshed.accessToken,
      );
    } catch {
      googleAccountEmail = null;
    }
    if (
      !googleAccountEmail ||
      normalizeEmail(googleAccountEmail) !== normalizeEmail(actor.email)
    ) {
      result.accountMismatch += 1;
      continue;
    }

    result.eligible += 1;
    if (mode === "dry-run") continue;

    const persisted = await dependencies.persist({
      candidate,
      scopes,
      tokenReference: JSON.stringify({
        access_token: refreshed.accessToken,
        expiry_date: Date.now() + Math.max(60, refreshed.expiresIn) * 1000,
        refresh_token: refreshed.refreshToken ?? storedRefreshToken,
      }),
    });
    if (!persisted) {
      throw new GoogleReattestSafeError(
        "PERSISTENCE_FAILED",
        "Une connexion attestée n’a pas pu être réactivée de façon atomique.",
      );
    }
    result.reconnected += 1;
  }

  return result;
}

function resolveAttestedIntent(
  scopes: string[],
  founderMeetingAccess: boolean,
): GoogleOAuthIntent | null {
  if (attestGoogleScopes(scopes, "user").ok) return "user";
  if (founderMeetingAccess && attestGoogleScopes(scopes, "meeting-notes").ok) {
    return "meeting-notes";
  }
  return null;
}

function parseRefreshToken(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { refresh_token?: unknown };
    return typeof parsed.refresh_token === "string" && parsed.refresh_token
      ? parsed.refresh_token
      : null;
  } catch {
    return null;
  }
}

function normalizeEmail(value: string) {
  return value.trim().toLocaleLowerCase("en");
}
