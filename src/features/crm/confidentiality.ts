export type CrmAccessScope = "cofounders" | "organization";

// Keep this vocabulary aligned with private.crm_text_requires_cofounder in
// the CRM confidentiality migration. Matching is intentionally conservative:
// an uncertain recruitment/internship record must be reviewed by a founder.
const FOUNDER_ONLY_PATTERN =
  /\b(stagiaires?|stages?|interns?|internships?|trainees?|apprentices?|apprenti(?:e|es|s)?|apprentissages?|alternances?|alternants?|alternantes?|candidat(?:e|es|s)?|candidatures?|recrutement|ressources humaines|human resources|graduate interns?|pfe|cv|rh|hr)\b/i;

export function containsSensitiveCrmText(...values: unknown[]) {
  return FOUNDER_ONLY_PATTERN.test(
    values
      .filter((value): value is string => typeof value === "string")
      .join("\n"),
  );
}

export function classifyCrmAccessScope(...values: unknown[]): CrmAccessScope {
  return containsSensitiveCrmText(...values) ? "cofounders" : "organization";
}

export function allowsCrmProviderSideEffects(scope: CrmAccessScope) {
  return scope === "organization";
}
