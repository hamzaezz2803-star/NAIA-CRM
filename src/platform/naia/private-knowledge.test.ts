import { describe, expect, it } from "vitest";

import type { MayaIndexedDeck } from "@/features/maya/contracts";

import { buildNaiaPrivateKnowledgeContext } from "./private-knowledge";

const deck: MayaIndexedDeck = {
  fileName: "Qarizmi_Introduction_Service as a software_Generic.pptx",
  filePath: "/private/generic.pptx",
  kind: "generic",
  modifiedAt: new Date("2026-07-13T10:00:00.000Z"),
  residueWarnings: [],
  sizeBytes: 5_000_000,
  slides: [
    slide(
      3,
      "presentation",
      "Qarizmi est née d'un constat : les entreprises ont besoin d'un partenaire IA et Data end-to-end, de la stratégie à l'exécution.",
    ),
    slide(
      5,
      "presentation",
      "Nos Profils Ali El Abbassy — Co- founder, Head of Technology École Polytechnique | HEC Paris | Roland Berger | Artefact 7+ ans d'expérience en data science et AI engineering • Architecture de solutions IA end-to-end • Leadership technique Nabil Jamal Eddine — Co- founder, Head of Strategy ESSEC | Dauphine | DPI Private Equity | L.E.K. Consulting 7+ ans d'expérience en stratégie • Transformation digitale et IA",
    ),
    slide(
      6,
      "presentation",
      "Qarizmi se différencie par un modèle ROI-first, une exécution end-to-end, un delivery rapide et une expertise sectorielle concrète.",
    ),
    slide(
      11,
      "offre",
      "Une offre structurée en trois piliers : stratégie et modèle opérationnel, architecture et plateforme, solutions Data et IA.",
    ),
  ],
};

describe("NAIA private Qarizmi knowledge", () => {
  it("isolates Ali's profile from the shared founders slide", () => {
    const context = buildNaiaPrivateKnowledgeContext({
      actor: {
        email: "ali@qarizmi.com",
        name: "Ali EL ABBASSY",
        role: "owner",
      },
      command: "Que sais-tu sur moi ?",
      deck,
    });

    expect(context.actorProfile).toContain("Ali El Abbassy");
    expect(context.actorProfile).toContain("Head of Technology");
    expect(context.actorProfile).not.toContain("Nabil Jamal Eddine");
    expect(context.sourceFileName).toContain("Generic.pptx");
  });

  it("isolates Nabil's profile for Nabil's authenticated account", () => {
    const context = buildNaiaPrivateKnowledgeContext({
      actor: {
        email: "nabil@qarizmi.com",
        name: "Nabil Jamal Eddine",
        role: "owner",
      },
      command: "Who am I?",
      deck,
    });

    expect(context.actorProfile).toContain("Nabil Jamal Eddine");
    expect(context.actorProfile).toContain("Head of Strategy");
    expect(context.actorProfile).not.toContain("Ali El Abbassy");
  });

  it("falls back to email/name tokens when the profile display name differs", () => {
    const context = buildNaiaPrivateKnowledgeContext({
      actor: {
        email: "ali@qarizmi.com",
        name: "A. Abbassy",
        role: "owner",
      },
      command: "Que sais-tu sur moi ?",
      deck,
    });

    expect(context.actorProfile).toContain("Ali El Abbassy");
    expect(context.actorProfile).not.toContain("Nabil Jamal Eddine");
  });

  it("returns no profile instead of falling back to another founder", () => {
    const context = buildNaiaPrivateKnowledgeContext({
      actor: {
        email: "founder@qarizmi.com",
        name: "Profil sans correspondance",
        role: "owner",
      },
      command: "Que sais-tu sur moi ?",
      deck,
    });

    expect(context.actorProfile).toBeUndefined();
  });

  it("retrieves the most relevant Qarizmi slides for the question", () => {
    const context = buildNaiaPrivateKnowledgeContext({
      actor: {
        email: "ali@qarizmi.com",
        name: "Ali EL ABBASSY",
        role: "owner",
      },
      command: "Quels sont nos éléments de différenciation et notre offre ?",
      deck,
    });

    expect(context.snippets[0]?.text).toContain("se différencie");
    expect(context.snippets.map((snippet) => snippet.slideNumber)).toContain(
      11,
    );
    expect(context.actorProfile).toBeUndefined();
    expect(context.snippets).toHaveLength(2);
  });

  it("does not return baseline-ranked slides for an unrelated question", () => {
    const context = buildNaiaPrivateKnowledgeContext({
      actor: {
        email: "ali@qarizmi.com",
        name: "Ali EL ABBASSY",
        role: "owner",
      },
      command: "Quelle est la capitale de la France ?",
      deck,
    });

    expect(context.snippets).toEqual([]);
  });
});

function slide(
  slideNumber: number,
  section: "offre" | "presentation",
  text: string,
) {
  return {
    section,
    slideNumber,
    sourceHash: `slide-${slideNumber}`,
    text,
    title: text.slice(0, 80),
  } as const;
}
