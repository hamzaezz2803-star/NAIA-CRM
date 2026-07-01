import {
  BadgeCheck,
  Banknote,
  BriefcaseBusiness,
  CalendarClock,
  CircleDollarSign,
  FileText,
  Handshake,
  Mic2,
  Network,
  Radar,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NaiaSectionId =
  | "overview"
  | "leads"
  | "cash-flow"
  | "crm"
  | "projects"
  | "hr";

export type RiskLevel = "low" | "medium" | "high";

export type NaiaSection = {
  id: NaiaSectionId;
  label: string;
  href: string;
  eyebrow: string;
  title: string;
  summary: string;
  prompt: string;
  icon: LucideIcon;
  tone: "teal" | "blue" | "emerald" | "amber" | "rose" | "violet";
};

export const naiaSections: NaiaSection[] = [
  {
    id: "overview",
    label: "Cockpit",
    href: "/naia",
    eyebrow: "Executive cockpit",
    title:
      "NAIA pilote le go-to-market, le cash, le delivery et le recrutement.",
    summary:
      "Un command center vocal: donne une instruction, NAIA prepare l'analyse, les livrables et les actions a valider.",
    prompt:
      "NAIA, prepare le cockpit executif: donne les risques business et les actions a lancer cette semaine.",
    icon: Mic2,
    tone: "teal",
  },
  {
    id: "leads",
    label: "Lead scraping",
    href: "/naia/leads",
    eyebrow: "Prospection augmentee",
    title: "Trouver les societes marocaines qui matchent un ICP.",
    summary:
      "Filtre CA, secteur, signaux publics, proximite reseau et key people a contacter avant le premier message.",
    prompt:
      "Liste les societes au Maroc entre 30 et 80 MDH de CA dans l'industrie et trouve les connexions avec les key people.",
    icon: Radar,
    tone: "blue",
  },
  {
    id: "cash-flow",
    label: "Cash flow",
    href: "/naia/cash-flow",
    eyebrow: "Finance predictive",
    title: "Predire le cash et declencher les relances prioritaires.",
    summary:
      "Couts, abonnements IA, salaires, plans 30/40/30, retards et brouillons de relance a valider.",
    prompt:
      "Predis mon cash flow sur 90 jours, flag les retards et prepare les relances clients.",
    icon: CircleDollarSign,
    tone: "emerald",
  },
  {
    id: "crm",
    label: "CRM IA",
    href: "/dashboard/leads",
    eyebrow: "Pipeline assiste",
    title: "Generer le pitch et la propale au changement d'etape.",
    summary:
      "Meeting booked cree un pitch; propale a envoyer cree une proposition structuree avec scope, planning et paiement.",
    prompt:
      "Quand je deplace un lead vers meeting booked, cree le pitch; quand il passe a propale a envoyer, cree la propale.",
    icon: Handshake,
    tone: "violet",
  },
  {
    id: "projects",
    label: "Projects",
    href: "/naia/projects",
    eyebrow: "Delivery control tower",
    title: "Visualiser les projets, les use cases et les risques de retard.",
    summary:
      "Portfolio projets, Gantt lisible, criticite, dependances et mois ou la livraison peut glisser.",
    prompt:
      "On a 10 projets en cours, cite ceux qui ont des problemes potentiels de retard et flague les mois.",
    icon: BriefcaseBusiness,
    tone: "amber",
  },
  {
    id: "hr",
    label: "HR planning",
    href: "/naia/hr",
    eyebrow: "Workforce planning",
    title: "Transformer les projets signes en besoin de recrutement.",
    summary:
      "Capacite, annonces, tests techniques, envoi candidat et organisation des entretiens de recrutement.",
    prompt:
      "En fonction des projets signes dans le CRM, calcule les recrutements, prepare une annonce, le test et les creneaux d'entretiens a valider.",
    icon: Users,
    tone: "rose",
  },
];

export const leadCompanies = [
  {
    name: "Atlas Process Industries",
    sector: "Industrie",
    city: "Casablanca",
    revenue: "48-62 MDH",
    proximity: "2e degre via Salma E.",
    keyPeople: [
      "DG: Yassine Berrada",
      "Ops: Lina El Fassi",
      "CFO: Mehdi Alaoui",
    ],
    signal:
      "Expansion de deux lignes de production et besoin de pilotage operations/finance.",
    nextMove: "Intro LinkedIn + mini-audit cash/delivery en 30 minutes.",
    score: 91,
  },
  {
    name: "Medina Health Services",
    sector: "Sante",
    city: "Rabat",
    revenue: "32-45 MDH",
    proximity: "1er degre via reseau Qarizmi",
    keyPeople: ["CEO: Nawal Mansouri", "IT: Amine Bennani", "RH: Sofia Rami"],
    signal: "Recrutement recent d'un responsable transformation digitale.",
    nextMove: "Pitch RH automation + staffing forecast.",
    score: 87,
  },
  {
    name: "Sahara Logistics Group",
    sector: "Logistique",
    city: "Tanger",
    revenue: "70-85 MDH",
    proximity: "2e degre via Hamza K.",
    keyPeople: ["COO: Karim Tazi", "Sales: Ines Zniber", "Data: Omar Kettani"],
    signal: "Pression delivery et nouveaux appels d'offres.",
    nextMove: "Diagnostic risques delivery + forecast de cash lie aux jalons.",
    score: 83,
  },
  {
    name: "Argan Retail Holding",
    sector: "Retail",
    city: "Marrakech",
    revenue: "55-78 MDH",
    proximity: "3e degre, connecteur recommande",
    keyPeople: [
      "Founder: Sara Amrani",
      "CFO: Adil Lahlou",
      "CRM: Hind Chraibi",
    ],
    signal: "Ouverture de magasins et migration CRM prevue.",
    nextMove: "Envoyer un diagnostic CRM + proposition de cockpit commercial.",
    score: 78,
  },
];

export const cashMonths = [
  {
    month: "Juil.",
    inflow: 420000,
    outflow: 310000,
    balance: 610000,
    risk: "low" as RiskLevel,
  },
  {
    month: "Aout",
    inflow: 260000,
    outflow: 390000,
    balance: 480000,
    risk: "medium" as RiskLevel,
  },
  {
    month: "Sept.",
    inflow: 710000,
    outflow: 430000,
    balance: 760000,
    risk: "low" as RiskLevel,
  },
  {
    month: "Oct.",
    inflow: 240000,
    outflow: 510000,
    balance: 490000,
    risk: "high" as RiskLevel,
  },
  {
    month: "Nov.",
    inflow: 640000,
    outflow: 455000,
    balance: 675000,
    risk: "medium" as RiskLevel,
  },
];

export const costs = [
  { name: "Abonnements IA", amount: 42000, date: "05/07", type: "SaaS" },
  { name: "Loyers & bureaux", amount: 58000, date: "01/07", type: "Fixe" },
  { name: "Salaires delivery", amount: 185000, date: "28/07", type: "Paie" },
  {
    name: "Cloud & infra client",
    amount: 31000,
    date: "12/07",
    type: "Variable",
  },
];

export const paymentPlans = [
  {
    client: "Atlas Process",
    project: "OS finance + CRM",
    amount: 420000,
    plan: "30% / 40% / 30%",
    nextPayment: 168000,
    dueDate: "15/07",
    status: "on-track",
  },
  {
    client: "Medina Health",
    project: "RH automation",
    amount: 260000,
    plan: "40% / 30% / 30%",
    nextPayment: 78000,
    dueDate: "08/07",
    status: "late",
  },
  {
    client: "Sahara Logistics",
    project: "Delivery cockpit",
    amount: 510000,
    plan: "30% / 40% / 30%",
    nextPayment: 153000,
    dueDate: "22/07",
    status: "at-risk",
  },
];

export const pipeline = [
  {
    company: "Atlas Process",
    owner: "Ali",
    value: 420000,
    stage: "Lead qualifie",
    action: "Creer pitch meeting cash + delivery.",
  },
  {
    company: "Argan Retail",
    owner: "Hamza",
    value: 310000,
    stage: "Meeting booked",
    action: "Preparer diagnostic CRM et 3 cas d'usage.",
  },
  {
    company: "Medina Health",
    owner: "Ali",
    value: 260000,
    stage: "Propale a envoyer",
    action: "Generer propale RH + planning 6 semaines.",
  },
  {
    company: "Sahara Logistics",
    owner: "Meryem",
    value: 510000,
    stage: "Negociation",
    action: "Creer version ROI + clauses de paiement.",
  },
];

export const projects = [
  {
    client: "Atlas Process",
    project: "Finance OS",
    start: 0,
    duration: 3,
    progress: 68,
    risk: "medium" as RiskLevel,
    blocker: "Validation facture et integration ERP",
    month: "Aout",
    useCases: ["Cash forecast", "Relances", "Dashboard CFO"],
  },
  {
    client: "Medina Health",
    project: "RH copilot",
    start: 1,
    duration: 4,
    progress: 41,
    risk: "high" as RiskLevel,
    blocker: "Sponsor metier peu disponible",
    month: "Sept.",
    useCases: ["Job matching", "Tests", "Entretiens"],
  },
  {
    client: "Sahara Logistics",
    project: "Delivery cockpit",
    start: 0,
    duration: 5,
    progress: 52,
    risk: "high" as RiskLevel,
    blocker: "Dependance data warehouse",
    month: "Oct.",
    useCases: ["Gantt", "Retards", "Capacite"],
  },
  {
    client: "Argan Retail",
    project: "CRM automation",
    start: 2,
    duration: 3,
    progress: 24,
    risk: "medium" as RiskLevel,
    blocker: "Segmentation client a confirmer",
    month: "Sept.",
    useCases: ["Lead scoring", "Propales", "Follow-up"],
  },
];

export const hiringNeeds = [
  {
    role: "AI Delivery Lead",
    when: "Juillet",
    load: "1 ETP",
    reason: "Trois projets IA demarrent avec sponsor metier senior.",
    status: "Entretiens",
  },
  {
    role: "Full-stack Next.js",
    when: "Aout",
    load: "2 ETP",
    reason: "CRM automation + dashboards cash/projet a livrer en parallele.",
    status: "Test pret",
  },
  {
    role: "Automation QA",
    when: "Septembre",
    load: "0.5 ETP",
    reason: "Stabiliser workflows vocaux, emails et integrations CRM.",
    status: "Annonce draft",
  },
];

export const executiveActions = [
  { label: "Intros lead", value: "4", icon: Network },
  { label: "Relances cash", value: "2", icon: Banknote },
  { label: "Risques delivery", value: "2", icon: CalendarClock },
  { label: "Recrutements", value: "3", icon: BadgeCheck },
];

export const approvalQueue = [
  {
    action: "Relance Medina Health",
    owner: "Nora",
    risk: "medium" as RiskLevel,
    source: "Cash flow",
  },
  {
    action: "Propale RH automation",
    owner: "Salma",
    risk: "high" as RiskLevel,
    source: "CRM",
  },
  {
    action: "Annonce Full-stack Next.js",
    owner: "Yasmine",
    risk: "low" as RiskLevel,
    source: "HR",
  },
];

export const integrationHealth = [
  {
    label: "CRM Qarizmi",
    owner: "Salma",
    status: "Connecte",
  },
  {
    label: "Groq",
    owner: "NAIA",
    status: "Fallback local pret",
  },
  {
    label: "ElevenLabs",
    owner: "NAIA",
    status: "Audio si cle active",
  },
  {
    label: "Gmail / Slack",
    owner: "Lina",
    status: "Non implemente",
  },
];

export const generatedAssets = [
  {
    title: "Pitch meeting",
    body: "Angle CEO/CFO, douleurs cash et delivery, parcours vocal NAIA en 8 minutes.",
    icon: FileText,
  },
  {
    title: "Propale",
    body: "Scope, planning, jalons, payment plan 30/40/30 et options de run.",
    icon: BriefcaseBusiness,
  },
  {
    title: "Relance client",
    body: "Email court, ferme et contextualise par jalon projet et impact cash.",
    icon: Banknote,
  },
];

export const formatMad = (value: number) =>
  new Intl.NumberFormat("fr-MA", {
    currency: "MAD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);

export function getNaiaSection(sectionId: NaiaSectionId) {
  return (
    naiaSections.find((section) => section.id === sectionId) ?? naiaSections[0]
  );
}

export function buildNaiaContext(sectionId: NaiaSectionId) {
  return {
    section: getNaiaSection(sectionId),
    leadCompanies,
    cashMonths,
    costs,
    paymentPlans,
    pipeline,
    projects,
    hiringNeeds,
  };
}
