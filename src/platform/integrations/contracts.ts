export type IntegrationProvider = "google" | "slack" | "whatsapp" | "microsoft";

export type IntegrationConnectionStatus =
  | "not-connected"
  | "connected"
  | "needs-review"
  | "revoked";

export type IntegrationConnection = {
  id: string;
  organizationId: string;
  provider: IntegrationProvider;
  status: IntegrationConnectionStatus;
  externalAccountLabel?: string;
  scopes: string[];
  connectedByProfileId?: string;
  connectedAt?: string;
};

export const plannedIntegrationProviders = [
  {
    capabilities: [
      "Dossiers Drive depuis le CRM",
      "Synchronisation Calendar",
      "Verification des disponibilites",
      "Lecture Gmail encadree",
      "Brouillons et envois Gmail apres validation",
      "OAuth utilisateur",
    ],
    envVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    isImplemented: true,
    provider: "google",
    label: "Google Workspace",
    plannedScopes: ["Google login", "Drive", "Calendar", "FreeBusy", "Gmail"],
  },
  {
    capabilities: [
      "Recaps de canaux",
      "Notifications approuvees",
      "Actions de suivi",
    ],
    envVars: ["SLACK_BOT_TOKEN"],
    isImplemented: true,
    provider: "slack",
    label: "Slack",
    plannedScopes: ["chat:write", "Channels", "Notifications approuvees"],
  },
  {
    capabilities: ["Message drafts", "Approval-based sending", "Contacts"],
    envVars: ["WHATSAPP_BUSINESS_ACCOUNT_ID"],
    isImplemented: false,
    provider: "whatsapp",
    label: "WhatsApp",
    plannedScopes: ["Contacts", "Message drafts", "Approval-based sending"],
  },
  {
    capabilities: ["Outlook", "SharePoint", "Teams"],
    envVars: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"],
    isImplemented: false,
    provider: "microsoft",
    label: "Microsoft 365",
    plannedScopes: ["Outlook", "SharePoint", "Teams"],
  },
] as const;

export type IntegrationHealthStatus =
  | "connected"
  | "needs-review"
  | "ready-to-connect"
  | "not-configured"
  | "not-implemented";

export type IntegrationHealth = {
  capabilities: string[];
  detail: string;
  envVars: string[];
  externalAccountLabel?: string;
  isImplemented: boolean;
  label: string;
  missingEnvVars: string[];
  plannedScopes: string[];
  provider: IntegrationProvider;
  scopes: string[];
  status: IntegrationHealthStatus;
};
