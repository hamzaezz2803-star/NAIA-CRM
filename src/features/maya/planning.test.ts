import { describe, expect, it } from "vitest";

import type { CrmLeadSummary } from "@/features/crm/contracts";
import type { MayaIndexedDeck } from "./contracts";
import {
  buildMayaDeckPlan,
  buildMayaPitchBriefFromLead,
  inferMayaClientType,
  selectMayaCredentialSlides,
} from "./planning";

describe("Maya pitch planning", () => {
  it("builds a brief from a meeting-booked lead", () => {
    const lead = makeLead({
      companyName: "HPS",
      contactName: "Abdeslam El-Alawi",
      notes:
        "J'ai contacté Abdeslam El-Alawi de HPS. Ils parlent avec Mistral pour développer des solutions IA sur leur LLM local.",
      status: "meeting-booked",
      topic: "IA on Mistral",
    });

    const brief = buildMayaPitchBriefFromLead(lead);

    expect(brief).toMatchObject({
      clientName: "HPS",
      clientType: "single-company",
      contactName: "Abdeslam El-Alawi",
      status: "needs-context",
    });
    expect(brief.missingQuestions).toContain(
      "Quel est le site web exact du client ?",
    );
  });

  it("infers portfolio and holding contexts", () => {
    expect(
      inferMayaClientType(
        "SPE Capital veut analyser son portefeuille de participations au Maroc et prioriser les sociétés.",
      ),
    ).toBe("portfolio");
    expect(
      inferMayaClientType(
        "AKWA est un groupe avec plusieurs filiales énergie, retail et immobilier.",
      ),
    ).toBe("group");
  });

  it("selects relevant credential slides by sector", () => {
    const genericDeck = makeGenericDeck();

    expect(
      selectMayaCredentialSlides({
        brief: {
          ...makeBrief("ODM"),
          crmContext: "Clinique, santé, parcours patient et Healthcare.",
          industry: "Healthcare",
        },
        genericDeck,
      }),
    ).toEqual([16, 17]);

    expect(
      selectMayaCredentialSlides({
        brief: {
          ...makeBrief("SPE"),
          crmContext: "Fonds PE, services financiers et portefeuille.",
          industry: "Financial Services",
        },
        genericDeck,
      }),
    ).toEqual([20, 21]);
  });

  it("keeps generic presentation and offer while planning diagnostics", () => {
    const genericDeck = makeGenericDeck();
    const plan = buildMayaDeckPlan({
      brief: {
        ...makeBrief("AKWA"),
        clientType: "group",
        crmContext: "Groupe marocain énergie, retail, gaz, immobilier.",
      },
      genericDeck,
      learningEvents: [],
    });

    expect(plan.presentationSlideNumbers).toEqual([1, 2, 3, 4, 5, 6]);
    expect(plan.credentialSlideNumbers).toEqual([18, 19]);
    expect(plan.diagnosticOutline[0]).toContain(
      "cartographier la chaîne de valeur",
    );
    expect(plan.omittedSlideNumbers).toContain(16);
  });
});

function makeLead(overrides: Partial<CrmLeadSummary>): CrmLeadSummary {
  return {
    createdAt: "2026-07-08T00:00:00.000Z",
    id: "lead-1",
    organizationId: "org-1",
    status: "lead-to-contact",
    topic: "Lead",
    updatedAt: "2026-07-08T00:00:00.000Z",
    ...overrides,
  };
}

function makeBrief(clientName: string) {
  return {
    clientName,
    clientType: "single-company" as const,
    crmContext: "",
    missingQuestions: [],
    status: "ready" as const,
  };
}

function makeGenericDeck(): MayaIndexedDeck {
  return {
    fileName: "Qarizmi_Introduction_Service as a software_Generic.pptx",
    filePath: "/tmp/generic.pptx",
    kind: "generic",
    modifiedAt: new Date("2026-07-08T00:00:00.000Z"),
    residueWarnings: [],
    sizeBytes: 5_000_000,
    slides: [
      ...Array.from({ length: 6 }, (_, index) => ({
        section: index < 4 ? ("presentation" as const) : ("offre" as const),
        slideNumber: index + 1,
        sourceHash: `intro-${index}`,
        text: "Présentation Qarizmi",
        title: "Présentation Qarizmi",
      })),
      {
        section: "credentials",
        slideNumber: 16,
        sourceHash: "healthcare-1",
        text: "Healthcare Pharma parcours patient clinique",
        title: "Healthcare",
      },
      {
        section: "credentials",
        slideNumber: 17,
        sourceHash: "healthcare-2",
        text: "Centres dentaires laboratoires biologie médicale",
        title: "Healthcare detail",
      },
      {
        section: "credentials",
        slideNumber: 18,
        sourceHash: "energy-1",
        text: "Retail stations énergie distribution carburant",
        title: "Retail energy",
      },
      {
        section: "credentials",
        slideNumber: 19,
        sourceHash: "industrial-1",
        text: "Industrials logistics transport optimisation stocks",
        title: "Industrials",
      },
      {
        section: "credentials",
        slideNumber: 20,
        sourceHash: "finance-1",
        text: "Financial Services scoring crédit assurance agents",
        title: "Financial Services",
      },
      {
        section: "credentials",
        slideNumber: 21,
        sourceHash: "finance-2",
        text: "Consumer finance BNPL scoring marchands",
        title: "Consumer finance",
      },
      {
        section: "closing",
        slideNumber: 44,
        sourceHash: "closing",
        text: "Next steps Q&A",
        title: "Next steps",
      },
    ],
  };
}
