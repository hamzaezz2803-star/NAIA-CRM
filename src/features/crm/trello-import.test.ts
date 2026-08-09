import { describe, expect, it } from "vitest";

import {
  normalizeTrelloExport,
  reconcileTrelloImportWithExistingCrm,
} from "./trello-import";

const syntheticBoard = {
  actions: [
    {
      data: { text: "private audit trail" },
      memberCreator: { email: "intern@example.test" },
    },
  ],
  cards: [
    {
      attachments: [
        {
          date: "2026-08-09T10:00:00.000Z",
          id: "attachment-1",
          mimeType: "application/pdf",
          name: "Deck synthétique.pdf",
          url: "https://trello.example.test/attachments/deck.pdf",
        },
      ],
      closed: false,
      desc: "Préparer la relance",
      due: "2026-08-11T09:30:00.000Z",
      id: "card-client",
      idLabels: ["label-urgent"],
      idList: "list-pipeline",
      idMembers: ["member-intern"],
      name: "Client Atlas",
      pos: 10,
    },
    {
      closed: false,
      desc: "Évaluation confidentielle",
      id: "card-intern",
      idLabels: [],
      idList: "list-interns",
      name: "Stagiaire synthétique",
      pos: 20,
    },
  ],
  id: "board-synthetic",
  labels: [{ color: "red", id: "label-urgent", name: "Urgent" }],
  lists: [
    { closed: false, id: "list-pipeline", name: "À relancer", pos: 10 },
    { closed: false, id: "list-interns", name: "Stagiaires", pos: 20 },
  ],
  members: [{ email: "intern@example.test", id: "member-intern" }],
  name: "CRM synthétique",
};

describe("normalizeTrelloExport", () => {
  it("is deterministic, strips people/actions, and marks intern data cofounders-only", () => {
    const first = normalizeTrelloExport(syntheticBoard);
    const second = normalizeTrelloExport({
      ...syntheticBoard,
      actions: [{ data: { text: "changed but intentionally ignored" } }],
      members: [{ email: "someone-else@example.test" }],
    });

    expect(second.sourceHash).toBe(first.sourceHash);
    expect(second.items).toEqual(first.items);
    expect(first.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.items.every((item) => item.payloadHash.length === 64)).toBe(
      true,
    );

    const internCategory = first.items.find(
      (item) =>
        item.entityType === "category" && item.externalId === "list-interns",
    );
    const internLead = first.items.find(
      (item) => item.entityType === "lead" && item.externalId === "card-intern",
    );
    expect(internCategory?.accessScope).toBe("cofounders");
    expect(internLead?.accessScope).toBe("cofounders");
    expect(internLead?.privacyReasons).toContain(
      "sensitive-keyword:card-content",
    );
    expect(first.preserved).toMatchObject({
      attachments: 1,
      commentActionsIgnored: 0,
      dueDates: 1,
      memberAssignments: 1,
    });
    const clientLead = first.items.find(
      (item) => item.entityType === "lead" && item.externalId === "card-client",
    );
    expect(clientLead?.payload.sourceMeta).toEqual({
      assignedMemberExternalIds: ["member-intern"],
      attachments: [
        expect.objectContaining({
          externalId: "attachment-1",
          url: "https://trello.example.test/attachments/deck.pdf",
        }),
      ],
    });
    expect(JSON.stringify(first)).not.toContain("intern@example.test");
    expect(JSON.stringify(first)).not.toContain("private audit trail");
  });

  it("fails closed when a credential-like key is present", () => {
    expect(() =>
      normalizeTrelloExport({ ...syntheticBoard, apiKey: "do-not-store" }),
    ).toThrow(/credential interdit/i);
  });

  it("puts orphan cards in a founder-only review category", () => {
    const dryRun = normalizeTrelloExport({
      ...syntheticBoard,
      cards: [
        {
          closed: false,
          desc: "",
          id: "card-orphan",
          idLabels: [],
          idList: "missing-list",
          name: "À vérifier",
        },
      ],
    });

    expect(
      dryRun.items.find((item) => item.externalId === "card-orphan")
        ?.accessScope,
    ).toBe("cofounders");
    expect(dryRun.warnings.join(" ")).toMatch(/sans liste reconnue/i);
  });

  it("classifies common French internship vocabulary as cofounders-only", () => {
    const dryRun = normalizeTrelloExport({
      ...syntheticBoard,
      cards: [
        {
          closed: false,
          desc: "CV et évaluation de la candidate",
          id: "card-pfe",
          idLabels: [],
          idList: "list-pipeline",
          name: "Entretien PFE - Sara",
        },
      ],
    });

    expect(
      dryRun.items.find((item) => item.externalId === "card-pfe")?.accessScope,
    ).toBe("cofounders");
  });

  it("removes credentials and signatures from attachment URLs", () => {
    const dryRun = normalizeTrelloExport({
      ...syntheticBoard,
      cards: [
        {
          ...syntheticBoard.cards[0],
          attachments: [
            {
              id: "attachment-signed",
              name: "Deck privé",
              url: "https://user:password@files.example.test/deck.pdf?access_token=secret&X-Amz-Signature=signed&download=1#private",
            },
          ],
        },
      ],
    });
    const lead = dryRun.items.find((item) => item.entityType === "lead");
    const serialized = JSON.stringify(lead);

    expect(serialized).toContain("download=1");
    expect(serialized).not.toContain("access_token");
    expect(serialized).not.toContain("Signature");
    expect(serialized).not.toContain("password@");
    expect(serialized).not.toContain("#private");
  });

  it("preserves accepted long descriptions without truncation", () => {
    const description = "x".repeat(25_000);
    const dryRun = normalizeTrelloExport({
      ...syntheticBoard,
      cards: [{ ...syntheticBoard.cards[0], desc: description }],
    });
    const lead = dryRun.items.find((item) => item.entityType === "lead");

    expect(lead?.payload.notes).toBe(
      description +
        "\n\nPièces jointes Trello:\n- [Deck synthétique.pdf](https://trello.example.test/attachments/deck.pdf) (application/pdf)",
    );
    expect(lead?.validationErrors).toEqual([]);
    expect(dryRun.warnings.join(" ")).not.toMatch(/tronqu/i);
  });

  it("allows only the three explicitly reviewed labels on the commercial board", () => {
    const reviewed = normalizeTrelloExport({
      ...syntheticBoard,
      cards: [
        {
          closed: false,
          desc: "",
          id: "card-reviewed-labels",
          idLabels: ["label-ali", "label-nabil", "label-updated"],
          idList: "list-pipeline",
          name: "Lead commercial synthétique",
        },
      ],
      id: "69de18c4a11891f0f0aae68a",
      labels: [
        { color: "blue", id: "label-ali", name: "Ali" },
        { color: "green", id: "label-nabil", name: "Nabil" },
        { color: "yellow", id: "label-updated", name: "Updated" },
      ],
      lists: [
        { closed: false, id: "list-pipeline", name: "Contacted", pos: 1 },
      ],
    });
    const reviewedLead = reviewed.items.find(
      (item) => item.externalId === "card-reviewed-labels",
    );

    expect(reviewedLead?.accessScope).toBe("organization");
    expect(reviewedLead?.privacyReasons).toContain(
      "label:explicit-sales-label-allowlist",
    );

    const unknown = normalizeTrelloExport({
      ...syntheticBoard,
      cards: [
        {
          closed: false,
          desc: "",
          id: "card-unknown-label",
          idLabels: ["label-unknown"],
          idList: "list-pipeline",
          name: "Lead à revoir",
        },
      ],
      id: "69de18c4a11891f0f0aae68a",
      labels: [{ color: "purple", id: "label-unknown", name: "Unknown label" }],
      lists: [
        { closed: false, id: "list-pipeline", name: "Contacted", pos: 1 },
      ],
    });
    expect(
      unknown.items.find((item) => item.externalId === "card-unknown-label")
        ?.accessScope,
    ).toBe("cofounders");
  });

  it("reconciles one exact existing CRM lead and fails closed on ambiguity", () => {
    const dryRun = normalizeTrelloExport({
      ...syntheticBoard,
      cards: [syntheticBoard.cards[0]],
    });
    const importedScope = dryRun.items.find(
      (item) => item.entityType === "lead",
    )?.accessScope;
    expect(importedScope).toBeDefined();
    const deterministic = reconcileTrelloImportWithExistingCrm(dryRun, {
      categories: [],
      externalRefs: [],
      leads: [
        {
          accessScope: importedScope!,
          id: "lead-existing",
          topic: "  client   atlas ",
        },
      ],
      tags: [],
    });

    expect(deterministic.review.existingCrmDeterministicMatches).toBe(1);
    expect(deterministic.review.existingCrmAmbiguousItems).toBe(0);
    expect(
      deterministic.items.find((item) => item.entityType === "lead")
        ?.validationErrors,
    ).toEqual([]);

    const ambiguous = reconcileTrelloImportWithExistingCrm(dryRun, {
      categories: [],
      externalRefs: [],
      leads: [
        {
          accessScope: importedScope!,
          id: "lead-existing-1",
          topic: "Client Atlas",
        },
        {
          accessScope: importedScope!,
          id: "lead-existing-2",
          topic: "client atlas",
        },
      ],
      tags: [],
    });

    expect(ambiguous.review.existingCrmAmbiguousItems).toBe(1);
    expect(
      ambiguous.items.find((item) => item.entityType === "lead")
        ?.validationErrors,
    ).toContain("existing-crm:ambiguous-lead-match");
  });

  it("fails closed when staged homonymous tags compete for one CRM tag", () => {
    const dryRun = normalizeTrelloExport({
      ...syntheticBoard,
      labels: [
        { color: "red", id: "tag-urgent-a", name: "Urgent" },
        { color: "orange", id: "tag-urgent-b", name: " urgent " },
      ],
    });
    const reconciled = reconcileTrelloImportWithExistingCrm(dryRun, {
      categories: [],
      externalRefs: [],
      leads: [],
      tags: [
        {
          accessScope: "cofounders",
          id: "tag-existing",
          name: "URGENT",
        },
      ],
    });
    const stagedTags = reconciled.items.filter(
      (item) => item.entityType === "tag",
    );

    expect(stagedTags).toHaveLength(2);
    expect(
      stagedTags.every((item) =>
        item.validationErrors.includes(
          "existing-crm:ambiguous-staged-tag-name",
        ),
      ),
    ).toBe(true);
    expect(reconciled.review.existingCrmAmbiguousItems).toBe(2);
  });

  it("blocks a changed entity after rollback while allowing an exact retry", () => {
    const dryRun = normalizeTrelloExport({
      ...syntheticBoard,
      cards: [syntheticBoard.cards[0]],
    });
    const lead = dryRun.items.find((item) => item.entityType === "lead");
    expect(lead).toBeDefined();
    const baseSnapshot = {
      categories: [],
      leads: [],
      tags: [],
    };
    const exact = reconcileTrelloImportWithExistingCrm(dryRun, {
      ...baseSnapshot,
      externalRefs: [
        {
          archivedAt: "2026-08-10T00:00:00.000Z",
          externalId: lead!.externalId,
          externalType: "lead" as const,
          localId: "lead-imported",
          sourceHash: lead!.payloadHash,
        },
      ],
    });
    expect(exact.review.existingCrmAmbiguousItems).toBe(0);

    const changed = reconcileTrelloImportWithExistingCrm(dryRun, {
      ...baseSnapshot,
      externalRefs: [
        {
          archivedAt: "2026-08-10T00:00:00.000Z",
          externalId: lead!.externalId,
          externalType: "lead" as const,
          localId: "lead-imported",
          sourceHash: "0".repeat(64),
        },
      ],
    });
    expect(
      changed.items.find((item) => item.externalId === lead!.externalId)
        ?.validationErrors,
    ).toContain("existing-crm:rolled-back-lead-changed");
  });
});
