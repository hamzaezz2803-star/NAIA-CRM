import { describe, expect, it } from "vitest";

import {
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

  it("keeps ordinary commercial text organization-scoped", () => {
    expect(classifyCrmAccessScope("Meeting booked", "Client Atlas")).toBe(
      "organization",
    );
  });
});
