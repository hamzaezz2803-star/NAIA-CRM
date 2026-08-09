import { describe, expect, it } from "vitest";

import { normalizeTrelloExport } from "./trello-import";

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
});
