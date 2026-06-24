export type FoundationStatus = "scaffolded" | "pending-external-setup";

export type PlatformFoundation = {
  name: string;
  status: FoundationStatus;
  summary: string;
};

export const platformFoundations = [
  {
    name: "Application shell",
    status: "scaffolded",
    summary:
      "Responsive navigation, top bar, module routes, and shared states.",
  },
  {
    name: "Authentication",
    status: "pending-external-setup",
    summary:
      "Supabase session enforcement with external user invites and access policy.",
  },
  {
    name: "Organization model",
    status: "scaffolded",
    summary:
      "Organization, profile, membership, role, and permission concepts.",
  },
  {
    name: "Workflow approvals",
    status: "scaffolded",
    summary: "Approval request contracts for human-reviewed external actions.",
  },
  {
    name: "Integrations",
    status: "scaffolded",
    summary:
      "Provider connection contracts for future Gmail, Drive, Calendar, Slack, WhatsApp, and Microsoft 365 work.",
  },
] satisfies PlatformFoundation[];
