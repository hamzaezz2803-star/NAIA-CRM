import {
  cashMonths,
  clientRelances,
  formatMad,
  hiringNeeds,
  paymentPlans,
  pipeline,
  projects,
  staffingPlan,
} from "./operating-data";
import type { NaiaAgentId } from "./agents";

export type NaiaOperatingContext = {
  cashFlow: string;
  followUps: string;
  pipeline: string;
  projects: string;
  risks: string;
  staffing: string;
  summary: string;
};

export function buildNaiaOperatingContext(): NaiaOperatingContext {
  const latestMonth = cashMonths[0];
  const lowestBalance = cashMonths.reduce((lowest, month) =>
    month.balance < lowest.balance ? month : lowest,
  );
  const negativeCashMonths = cashMonths
    .filter((month) => month.inflow - month.outflow < 0)
    .map(
      (month) =>
        `${month.month}: net ${formatMad(month.inflow - month.outflow)}`,
    );
  const riskyProjects = projects.filter((project) => project.risk === "high");
  const recruitmentRoles = hiringNeeds
    .map((need) => `${need.role} (${need.load}, ${need.when})`)
    .join("; ");
  const recruitedWork = staffingPlan
    .filter((row) => row.needsRecruitment)
    .map((row) => `${row.project}: ${row.linkedNeed ?? row.role}`)
    .join("; ");

  return {
    cashFlow: [
      `Current projected balance: ${latestMonth.month} ${formatMad(latestMonth.balance)}.`,
      `Lowest projected balance: ${lowestBalance.month} ${formatMad(lowestBalance.balance)}.`,
      `Negative net months: ${negativeCashMonths.join("; ") || "none"}.`,
      `Next payments: ${paymentPlans
        .map(
          (plan) =>
            `${plan.client} ${formatMad(plan.nextPayment)} due ${plan.dueDate} (${plan.status})`,
        )
        .join("; ")}.`,
    ].join(" "),
    followUps: clientRelances
      .map(
        (relance) =>
          `${relance.client}: ${formatMad(relance.amount)} due ${relance.dueDate} - ${relance.reason}`,
      )
      .join("; "),
    pipeline: pipeline
      .map(
        (lead) =>
          `${lead.company}: ${lead.stage}, ${formatMad(lead.value)}, owner ${lead.owner}, next ${lead.action}`,
      )
      .join("; "),
    projects: projects
      .map(
        (project) =>
          `${project.client} / ${project.project}: ${project.progress}% progress, risk ${project.risk}, blocker ${project.blocker}, risk month ${project.month}`,
      )
      .join("; "),
    risks: [
      `High-risk cash month: ${
        cashMonths.find((month) => month.risk === "high")?.month ?? "none"
      }.`,
      `Late or at-risk payments: ${paymentPlans
        .filter((plan) => plan.status === "late" || plan.status === "at-risk")
        .map((plan) => plan.client)
        .join(", ")}.`,
      `High-risk projects: ${riskyProjects
        .map((project) => `${project.client} (${project.blocker})`)
        .join(", ")}.`,
    ].join(" "),
    staffing: [
      `Hiring needs: ${recruitmentRoles}.`,
      `Recruitment-linked work: ${recruitedWork}.`,
    ].join(" "),
    summary:
      "NAIA has dummy operating data for cash flow, CRM pipeline, projects, staffing, follow-ups, and risks. Use it for operational analysis; do not claim external systems were updated.",
  };
}

export function buildOperationalAnalysisResponse({
  agentId,
  command,
}: {
  agentId: NaiaAgentId;
  command: string;
}) {
  const normalized = normalizeForContext(command);

  if (
    agentId === "finance" ||
    includesAny(normalized, [
      "cash",
      "cash flow",
      "cashflow",
      "cf",
      "cfs",
      "finance",
      "tresorerie",
      "encaissement",
      "decaissement",
    ])
  ) {
    return buildFinanceAnalysis();
  }

  if (
    agentId === "projects" ||
    includesAny(normalized, ["delivery", "projet", "retard", "risque"])
  ) {
    return buildProjectAnalysis();
  }

  if (
    agentId === "hr" ||
    includesAny(normalized, ["staffing", "recrut", "rh", "capacite"])
  ) {
    return buildStaffingAnalysis();
  }

  return null;
}

function buildFinanceAnalysis() {
  const context = buildNaiaOperatingContext();
  const highRiskMonth = cashMonths.find((month) => month.risk === "high");
  const lowestBalance = cashMonths.reduce((lowest, month) =>
    month.balance < lowest.balance ? month : lowest,
  );
  const urgentRelances = clientRelances.slice(0, 2);

  return [
    `Analyse cash: le solde projete est au plus bas en ${lowestBalance.month} avec ${formatMad(lowestBalance.balance)}.`,
    highRiskMonth
      ? `${highRiskMonth.month} est le mois le plus risque: ${formatMad(highRiskMonth.inflow)} d'encaissements contre ${formatMad(highRiskMonth.outflow)} de decaissements.`
      : "Aucun mois n'est marque en risque eleve dans les donnees actuelles.",
    `Relances prioritaires: ${urgentRelances
      .map(
        (relance) =>
          `${relance.client} (${formatMad(relance.amount)}, ${relance.dueDate})`,
      )
      .join(" puis ")}.`,
    `A surveiller aussi: ${context.risks}`,
  ].join("\n");
}

function buildProjectAnalysis() {
  const riskyProjects = projects.filter((project) => project.risk === "high");

  return [
    `Analyse delivery: ${riskyProjects.length} projets sont en risque eleve.`,
    ...riskyProjects.map(
      (project) =>
        `${project.client} / ${project.project}: ${project.progress}% - blocage ${project.blocker} - mois critique ${project.month}.`,
    ),
    "Action recommandee: traiter les dependances sponsor/data avant d'ajouter de nouveaux jalons.",
  ].join("\n");
}

function buildStaffingAnalysis() {
  const needs = hiringNeeds.map(
    (need) => `${need.role} (${need.load}, ${need.when}, ${need.status})`,
  );
  const linkedStaffing = staffingPlan
    .filter((row) => row.needsRecruitment)
    .map((row) => `${row.project}: ${row.linkedNeed ?? row.role}`);

  return [
    `Analyse staffing: ${hiringNeeds.length} besoins ouverts - ${needs.join("; ")}.`,
    `Les projets relies a un recrutement sont: ${linkedStaffing.join("; ")}.`,
    "Priorite: securiser AI Delivery Lead puis Full-stack Next.js avant le pic delivery.",
  ].join("\n");
}

function normalizeForContext(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(value: string, needles: string[]) {
  const tokens = new Set(value.split(/\s+/));

  return needles.some((needle) =>
    needle.includes(" ") ? value.includes(needle) : tokens.has(needle),
  );
}
