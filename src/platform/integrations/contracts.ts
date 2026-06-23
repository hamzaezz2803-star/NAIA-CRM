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
    provider: "google",
    label: "Google Workspace",
    plannedScopes: ["Gmail", "Drive", "Calendar", "Meet"],
  },
  {
    provider: "slack",
    label: "Slack",
    plannedScopes: ["Messages", "Channels", "Notifications"],
  },
  {
    provider: "whatsapp",
    label: "WhatsApp",
    plannedScopes: ["Contacts", "Message drafts", "Approval-based sending"],
  },
  {
    provider: "microsoft",
    label: "Microsoft 365",
    plannedScopes: ["Outlook", "SharePoint", "Teams"],
  },
] as const;
