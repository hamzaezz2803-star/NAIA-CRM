import "server-only";

import { createServerSupabaseClient } from "@/platform/auth/supabase-server";

import {
  type IntegrationConnectionStatus,
  type IntegrationHealth,
  plannedIntegrationProviders,
} from "./contracts";
import { GOOGLE_USER_REQUIRED_SCOPES } from "./google-workspace-scopes";

type IntegrationConnectionRow = {
  encrypted_token_reference: string | null;
  external_account_label: string | null;
  provider: string;
  scopes: string[] | null;
  status: IntegrationConnectionStatus;
};

export async function getIntegrationReadiness(): Promise<IntegrationHealth[]> {
  const connections = await getConnectionRows();

  return plannedIntegrationProviders.map((provider) => {
    const missingEnvVars = provider.envVars.filter(
      (envVar) => !process.env[envVar],
    );
    const connection = connections.find(
      (item) => item.provider === provider.provider,
    );
    const scopes = connection?.scopes ?? [];
    const missingRequiredScopes =
      provider.provider === "google"
        ? GOOGLE_USER_REQUIRED_SCOPES.filter((scope) => !scopes.includes(scope))
        : [];

    if (!provider.isImplemented) {
      return {
        capabilities: [...provider.capabilities],
        detail:
          missingEnvVars.length === 0
            ? "Variables detectees, mais le connecteur runtime n'est pas encore implemente dans NAIA."
            : "Connecteur planifie. Le backend OAuth/API n'est pas encore implemente dans NAIA.",
        envVars: [...provider.envVars],
        externalAccountLabel: connection?.external_account_label ?? undefined,
        isImplemented: false,
        label: provider.label,
        missingEnvVars,
        plannedScopes: [...provider.plannedScopes],
        provider: provider.provider,
        scopes,
        status: "not-implemented",
      };
    }

    if (connection?.status === "connected") {
      const hasTokenReference = Boolean(connection.encrypted_token_reference);

      if (
        missingEnvVars.length === 0 &&
        hasTokenReference &&
        missingRequiredScopes.length === 0
      ) {
        return {
          capabilities: [...provider.capabilities],
          detail: `Compte connecte${connection.external_account_label ? `: ${connection.external_account_label}` : ""}.`,
          envVars: [...provider.envVars],
          externalAccountLabel: connection.external_account_label ?? undefined,
          isImplemented: true,
          label: provider.label,
          missingEnvVars,
          plannedScopes: [...provider.plannedScopes],
          provider: provider.provider,
          scopes,
          status: "connected",
        };
      }

      return {
        capabilities: [...provider.capabilities],
        detail:
          missingRequiredScopes.length > 0
            ? "Une connexion existe, mais elle n'a pas encore tous les scopes Calendar et Gmail requis. Reconnecte Google Workspace."
            : "Une connexion existe, mais il manque une variable serveur ou une reference token. Reconnecte le provider.",
        envVars: [...provider.envVars],
        externalAccountLabel: connection.external_account_label ?? undefined,
        isImplemented: true,
        label: provider.label,
        missingEnvVars,
        plannedScopes: [...provider.plannedScopes],
        provider: provider.provider,
        scopes,
        status: "needs-review",
      };
    }

    if (missingEnvVars.length === 0) {
      return {
        capabilities: [...provider.capabilities],
        detail:
          provider.provider === "google"
            ? "Credentials serveur presents. Connexion utilisateur Google Workspace requise."
            : "Token serveur present. NAIA peut preparer des notifications Slack approuvees.",
        envVars: [...provider.envVars],
        externalAccountLabel: connection?.external_account_label ?? undefined,
        isImplemented: true,
        label: provider.label,
        missingEnvVars,
        plannedScopes: [...provider.plannedScopes],
        provider: provider.provider,
        scopes,
        status: "ready-to-connect",
      };
    }

    return {
      capabilities: [...provider.capabilities],
      detail: `Variables manquantes: ${missingEnvVars.join(", ")}.`,
      envVars: [...provider.envVars],
      externalAccountLabel: connection?.external_account_label ?? undefined,
      isImplemented: true,
      label: provider.label,
      missingEnvVars,
      plannedScopes: [...provider.plannedScopes],
      provider: provider.provider,
      scopes,
      status: "not-configured",
    };
  });
}

async function getConnectionRows(): Promise<IntegrationConnectionRow[]> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return [];

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return [];

  const { data: membership } = await supabase
    .from("organization_memberships")
    .select("organization_id")
    .eq("profile_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!membership?.organization_id) return [];

  // Personal providers are always reported for the acting user. Slack does
  // not create rows here: its readiness comes from server-only environment
  // variables because the bridge is installed once for the organization.
  const { data, error } = await supabase
    .from("integration_connections")
    .select(
      "provider,status,external_account_label,scopes,encrypted_token_reference",
    )
    .eq("organization_id", membership.organization_id)
    .eq("connected_by_profile_id", user.id);

  if (error || !data) return [];

  return data as IntegrationConnectionRow[];
}
