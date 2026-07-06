export type ModuleStatus = "live" | "guarded" | "ready-for-build";

export type PlatformModuleId =
  | "dashboard"
  | "naia"
  | "crm"
  | "meetings"
  | "proposals"
  | "projects"
  | "hr"
  | "finance"
  | "automations"
  | "integrations"
  | "settings";

export type PlatformModule = {
  id: PlatformModuleId;
  name: string;
  href: string;
  shortName: string;
  status: ModuleStatus;
  owner: "platform" | "crm" | "future";
  summary: string;
  handoffPath?: string;
};

export const platformModules = [
  {
    id: "dashboard",
    name: "Dashboard",
    shortName: "Home",
    href: "/dashboard",
    status: "live",
    owner: "platform",
    summary: "Operational home for NAIA-os with honest empty states.",
  },
  {
    id: "naia",
    name: "NAIA",
    shortName: "NAIA",
    href: "/naia",
    status: "live",
    owner: "platform",
    summary:
      "Voice-first orchestrator for lead intelligence, cash, CRM, delivery, and HR planning.",
  },
  {
    id: "crm",
    name: "CRM",
    shortName: "CRM",
    href: "/dashboard/leads",
    status: "live",
    owner: "crm",
    summary: "Sales pipeline with AI extraction, drafts, and Google Drive.",
    handoffPath: "docs/crm-handoff.md",
  },
  {
    id: "meetings",
    name: "Meetings",
    shortName: "Meetings",
    href: "/meetings",
    status: "guarded",
    owner: "future",
    summary:
      "Calendar groundwork exists; transcripts, Gemini notes, and summaries are guarded.",
  },
  {
    id: "proposals",
    name: "Docs Generator",
    shortName: "Docs",
    href: "/proposals",
    status: "guarded",
    owner: "future",
    summary:
      "Pitch/proposal queues and Drive context are present; generation is guarded.",
  },
  {
    id: "projects",
    name: "Projects",
    shortName: "Projects",
    href: "/projects",
    status: "guarded",
    owner: "future",
    summary:
      "Delivery workstreams, milestones, deliverables, risks, and status.",
  },
  {
    id: "hr",
    name: "HR",
    shortName: "HR",
    href: "/hr",
    status: "guarded",
    owner: "future",
    summary: "Candidate intake, screening, tests, interviews, and offers.",
  },
  {
    id: "finance",
    name: "Finance",
    shortName: "Finance",
    href: "/finance",
    status: "guarded",
    owner: "future",
    summary:
      "Expenses, supplier invoices, client invoices, and cash visibility.",
  },
  {
    id: "automations",
    name: "Automations",
    shortName: "Agents",
    href: "/automations",
    status: "guarded",
    owner: "future",
    summary: "Observable workflows with approval gates for sensitive actions.",
  },
  {
    id: "integrations",
    name: "Integrations",
    shortName: "Connect",
    href: "/integrations",
    status: "guarded",
    owner: "platform",
    summary:
      "Provider connection health for Google, Slack, WhatsApp, and Microsoft 365.",
  },
  {
    id: "settings",
    name: "Settings",
    shortName: "Settings",
    href: "/settings",
    status: "live",
    owner: "platform",
    summary: "Organization, members, roles, permissions, and audit settings.",
  },
] satisfies PlatformModule[];

export function getModule(moduleId: PlatformModuleId) {
  return platformModules.find((module) => module.id === moduleId);
}

export function requireModule(moduleId: PlatformModuleId) {
  const platformModule = getModule(moduleId);

  if (!platformModule) {
    throw new Error(`Unknown platform module: ${moduleId}`);
  }

  return platformModule;
}
