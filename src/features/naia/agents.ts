import {
  BadgeCheck,
  Bot,
  BriefcaseBusiness,
  CalendarClock,
  CircleDollarSign,
  Code2,
  FileText,
  Handshake,
  Mic2,
  Network,
  PlugZap,
  Radar,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NaiaAgentId =
  | "naia"
  | "leads"
  | "crm"
  | "finance"
  | "projects"
  | "hr"
  | "meetings"
  | "proposals"
  | "automations"
  | "integrations"
  | "settings"
  | "developer";

export type NaiaAgent = {
  id: NaiaAgentId;
  name: string;
  role: string;
  label: string;
  route: string;
  accent: "cyan" | "gold" | "rose" | "emerald" | "blue" | "violet";
  icon: LucideIcon;
  mission: string;
  orbit: {
    desktop: { x: number; y: number };
    tablet: { x: number; y: number };
  };
  status: "guarded" | "live";
};

export const naiaAgents: NaiaAgent[] = [
  {
    id: "naia",
    name: "NAIA",
    role: "Orchestrator",
    label: "NAIA",
    route: "/naia",
    accent: "cyan",
    icon: Mic2,
    mission:
      "Comprend l'intention, choisit l'agent, garde la voix et les validations humaines.",
    orbit: {
      desktop: { x: 50, y: 50 },
      tablet: { x: 50, y: 50 },
    },
    status: "live",
  },
  {
    id: "leads",
    name: "Idriss",
    role: "Lead intelligence",
    label: "Leads",
    route: "/naia/leads",
    accent: "blue",
    icon: Radar,
    mission:
      "Scanne les ICP, signaux de marche, key people et chemins d'introduction.",
    orbit: {
      desktop: { x: 23, y: 31 },
      tablet: { x: 23, y: 32 },
    },
    status: "live",
  },
  {
    id: "crm",
    name: "Salma",
    role: "CRM",
    label: "CRM",
    route: "/dashboard/leads",
    accent: "gold",
    icon: Handshake,
    mission:
      "Met a jour le pipeline, prepare pitchs, propositions et prochaines actions.",
    orbit: {
      desktop: { x: 73, y: 67 },
      tablet: { x: 76, y: 68 },
    },
    status: "live",
  },
  {
    id: "finance",
    name: "Nora",
    role: "Finance",
    label: "Finance",
    route: "/naia/cash-flow",
    accent: "emerald",
    icon: CircleDollarSign,
    mission:
      "Prevoit le cash, repere les retards et priorise les relances a valider.",
    orbit: {
      desktop: { x: 78, y: 29 },
      tablet: { x: 75, y: 30 },
    },
    status: "live",
  },
  {
    id: "projects",
    name: "Ilyas",
    role: "Delivery",
    label: "Projects",
    route: "/naia/projects",
    accent: "violet",
    icon: BriefcaseBusiness,
    mission:
      "Suit le portefeuille, les use cases, le Gantt et les risques de delivery.",
    orbit: {
      desktop: { x: 36, y: 73 },
      tablet: { x: 33, y: 71 },
    },
    status: "live",
  },
  {
    id: "hr",
    name: "Yasmine",
    role: "People",
    label: "HR",
    route: "/naia/hr",
    accent: "rose",
    icon: Users,
    mission:
      "Convertit projets signes et capacite en recrutements, tests et entretiens.",
    orbit: {
      desktop: { x: 63, y: 77 },
      tablet: { x: 64, y: 75 },
    },
    status: "live",
  },
  {
    id: "meetings",
    name: "Adam",
    role: "Meetings",
    label: "Meetings",
    route: "/meetings",
    accent: "cyan",
    icon: CalendarClock,
    mission:
      "Transforme appels et rendez-vous en syntheses, decisions et suivis CRM.",
    orbit: {
      desktop: { x: 20, y: 55 },
      tablet: { x: 24, y: 55 },
    },
    status: "live",
  },
  {
    id: "proposals",
    name: "Maya",
    role: "Proposals",
    label: "Proposals",
    route: "/proposals",
    accent: "blue",
    icon: FileText,
    mission:
      "Assemble pitch, scope, planning, prix et jalons depuis le contexte valide.",
    orbit: {
      desktop: { x: 84, y: 52 },
      tablet: { x: 79, y: 52 },
    },
    status: "live",
  },
  {
    id: "automations",
    name: "Omar",
    role: "Ops",
    label: "Ops",
    route: "/automations",
    accent: "gold",
    icon: Bot,
    mission:
      "Observe les workflows, files d'attente, approbations et actions sensibles.",
    orbit: {
      desktop: { x: 34, y: 42 },
      tablet: { x: 36, y: 42 },
    },
    status: "live",
  },
  {
    id: "integrations",
    name: "Lina",
    role: "Integrations",
    label: "Connect",
    route: "/integrations",
    accent: "emerald",
    icon: PlugZap,
    mission:
      "Controle les providers disponibles, les tokens et les statuts avant toute action externe.",
    orbit: {
      desktop: { x: 82, y: 42 },
      tablet: { x: 76, y: 43 },
    },
    status: "guarded",
  },
  {
    id: "settings",
    name: "Amine",
    role: "Governance",
    label: "Settings",
    route: "/settings",
    accent: "violet",
    icon: Settings,
    mission: "Gere roles, permissions, audit et politiques d'approbation.",
    orbit: {
      desktop: { x: 51, y: 25 },
      tablet: { x: 50, y: 26 },
    },
    status: "live",
  },
  {
    id: "developer",
    name: "Rayan",
    role: "Dev agent",
    label: "Developer",
    route: "/automations",
    accent: "rose",
    icon: Code2,
    mission:
      "Transforme une demande produit en specification, branche et revue humaine.",
    orbit: {
      desktop: { x: 15, y: 76 },
      tablet: { x: 20, y: 78 },
    },
    status: "guarded",
  },
];

export const naiaDelegatedAgents = naiaAgents.filter(
  (agent) => agent.id !== "naia",
);

export function getNaiaAgent(agentId: NaiaAgentId) {
  return naiaAgents.find((agent) => agent.id === agentId) ?? naiaAgents[0];
}

export const accentClasses: Record<NaiaAgent["accent"], string> = {
  blue: "border-sky-300 bg-sky-50 text-sky-950 shadow-sky-500/20 dark:border-sky-300/50 dark:bg-sky-300/12 dark:text-sky-100 dark:shadow-sky-500/25",
  cyan: "border-cyan-300 bg-cyan-50 text-cyan-950 shadow-cyan-500/20 dark:border-cyan-300/50 dark:bg-cyan-300/12 dark:text-cyan-100 dark:shadow-cyan-500/25",
  emerald:
    "border-emerald-300 bg-emerald-50 text-emerald-950 shadow-emerald-500/20 dark:border-emerald-300/50 dark:bg-emerald-300/12 dark:text-emerald-100 dark:shadow-emerald-500/25",
  gold: "border-amber-300 bg-amber-50 text-amber-950 shadow-amber-500/20 dark:border-amber-300/60 dark:bg-amber-300/12 dark:text-amber-100 dark:shadow-amber-500/25",
  rose: "border-rose-300 bg-rose-50 text-rose-950 shadow-rose-500/20 dark:border-rose-300/50 dark:bg-rose-300/12 dark:text-rose-100 dark:shadow-rose-500/25",
  violet:
    "border-violet-300 bg-violet-50 text-violet-950 shadow-violet-500/20 dark:border-violet-300/50 dark:bg-violet-300/12 dark:text-violet-100 dark:shadow-violet-500/25",
};

export const agentStatusIcon = BadgeCheck;
export const networkIcon = Network;
