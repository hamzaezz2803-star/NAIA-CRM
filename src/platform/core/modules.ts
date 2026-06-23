export type ModuleStatus = "live" | "ready-for-build" | "planned";

export type PlatformModuleId =
  | "dashboard"
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
    summary: "Operational home for Qarizmi OS with honest empty states.",
  },
  {
    id: "crm",
    name: "CRM",
    shortName: "CRM",
    href: "/crm",
    status: "ready-for-build",
    owner: "crm",
    summary: "Native sales pipeline module reserved for Hamza's Sprint 1.",
    handoffPath: "docs/crm-handoff.md",
  },
  {
    id: "meetings",
    name: "Meetings",
    shortName: "Meetings",
    href: "/meetings",
    status: "planned",
    owner: "future",
    summary: "Meeting transcription, summaries, next steps, and CRM updates.",
  },
  {
    id: "proposals",
    name: "Proposals",
    shortName: "Proposals",
    href: "/proposals",
    status: "planned",
    owner: "future",
    summary: "Pitch and proposal generation from approved Qarizmi context.",
  },
  {
    id: "projects",
    name: "Projects",
    shortName: "Projects",
    href: "/projects",
    status: "planned",
    owner: "future",
    summary:
      "Delivery workstreams, milestones, deliverables, risks, and status.",
  },
  {
    id: "hr",
    name: "HR",
    shortName: "HR",
    href: "/hr",
    status: "planned",
    owner: "future",
    summary: "Candidate intake, screening, tests, interviews, and offers.",
  },
  {
    id: "finance",
    name: "Finance",
    shortName: "Finance",
    href: "/finance",
    status: "planned",
    owner: "future",
    summary:
      "Expenses, supplier invoices, client invoices, and cash visibility.",
  },
  {
    id: "automations",
    name: "Automations",
    shortName: "Agents",
    href: "/automations",
    status: "planned",
    owner: "future",
    summary: "Observable workflows with approval gates for sensitive actions.",
  },
  {
    id: "integrations",
    name: "Integrations",
    shortName: "Connect",
    href: "/integrations",
    status: "planned",
    owner: "platform",
    summary:
      "Provider connections for Google, Slack, WhatsApp, and Microsoft 365.",
  },
  {
    id: "settings",
    name: "Settings",
    shortName: "Settings",
    href: "/settings",
    status: "planned",
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
