import { describe, expect, it } from "vitest";

import {
  allowsCrmProviderSideEffects,
  classifyCrmAccessScope,
  containsSensitiveCrmText,
} from "./confidentiality";

describe("CRM manual confidentiality classification", () => {
  it.each([
    "Trainee candidate",
    "Apprentice review",
    "Évaluation apprentie",
    "Contrat alternance",
    "Graduate intern",
    "CV PFE",
    "Entretien stagiaire",
  ])("escalates %s to founders", (value) => {
    expect(classifyCrmAccessScope(value)).toBe("cofounders");
    expect(containsSensitiveCrmText("Compte Atlas", value)).toBe(true);
  });

  it("blocks every automatic provider side effect for cofounders data", () => {
    expect(allowsCrmProviderSideEffects("cofounders")).toBe(false);
    expect(allowsCrmProviderSideEffects("organization")).toBe(true);
  });

  it("keeps ordinary commercial text organization-scoped", () => {
    expect(classifyCrmAccessScope("Meeting booked", "Client Atlas")).toBe(
      "organization",
    );
  });
});
