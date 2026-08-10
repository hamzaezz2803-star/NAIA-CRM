import { describe, expect, it } from "vitest";

import {
  createTrelloStagingAttestation,
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
    expect(clientLead?.payload).toMatchObject({
      dueComplete: false,
      nextAction: "Échéance Trello",
      nextActionState: "pending",
    });
    expect(JSON.stringify(first)).not.toContain("intern@example.test");
    expect(JSON.stringify(first)).not.toContain("private audit trail");
  });

  it("preserves Trello due completion and derives the due next-action state", () => {
    const dryRun = normalizeTrelloExport({
      ...syntheticBoard,
      cards: [
        {
          ...syntheticBoard.cards[0],
          dueComplete: true,
          id: "card-due-complete",
        },
        {
          ...syntheticBoard.cards[0],
          id: "card-due-incomplete",
        },
      ],
    });
    const completed = dryRun.items.find(
      (item) => item.externalId === "card-due-complete",
    );
    const incomplete = dryRun.items.find(
      (item) => item.externalId === "card-due-incomplete",
    );

    expect(completed?.payload).toMatchObject({
      dueComplete: true,
      leadDate: "2026-08-11T09:30:00.000Z",
      nextAction: "Échéance Trello",
      nextActionState: "done",
    });
    expect(incomplete?.payload).toMatchObject({
      dueComplete: false,
      nextAction: "Échéance Trello",
      nextActionState: "pending",
    });
  });

  it("keeps an explicit incomplete checklist item pending even when the card due date is complete", () => {
    const dryRun = normalizeTrelloExport({
      ...syntheticBoard,
      cards: [
        {
          ...syntheticBoard.cards[0],
          dueComplete: true,
          id: "card-checklist-pending",
        },
      ],
      checklists: [
        {
          checkItems: [
            {
              id: "check-item-pending",
              name: "Envoyer la proposition",
              pos: 1,
              state: "incomplete",
            },
          ],
          id: "checklist-pending",
          idCard: "card-checklist-pending",
          name: "Suivi",
        },
      ],
    });
    const lead = dryRun.items.find(
      (item) => item.externalId === "card-checklist-pending",
    );

    expect(lead?.payload).toMatchObject({
      dueComplete: true,
      nextAction: "Envoyer la proposition",
      nextActionState: "pending",
    });
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

  it("classifies French and English internship vocabulary as cofounders-only", () => {
    for (const [index, title] of [
      "Entretien PFE - Sara",
      "Trainee Sara",
      "Apprentice Sara",
      "Apprentie Sara",
      "Alternance Sara",
      "Graduate intern Sara",
    ].entries()) {
      const externalId = `card-sensitive-${index}`;
      const dryRun = normalizeTrelloExport({
        ...syntheticBoard,
        cards: [
          {
            closed: false,
            desc: "Évaluation de la candidate",
            id: externalId,
            idLabels: [],
            idList: "list-pipeline",
            name: title,
          },
        ],
      });

      expect(
        dryRun.items.find((item) => item.externalId === externalId)
          ?.accessScope,
      ).toBe("cofounders");
    }
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
              url: "https://user:password@files.example.test/deck.pdf?access_token=secret&AWSAccessKeyId=aws-secret&GoogleAccessId=google-id&X-Goog-Credential=google-secret&Key-Pair-Id=cloudfront-id&Policy=cloudfront-policy&X-Amz-Signature=signed&unknown_secret_name=secret&download=1#private",
            },
          ],
        },
      ],
    });
    const lead = dryRun.items.find((item) => item.entityType === "lead");
    const serialized = JSON.stringify(lead);

    expect(serialized).toContain("download=1");
    expect(serialized).not.toContain("access_token");
    expect(serialized).not.toContain("AWSAccessKeyId");
    expect(serialized).not.toContain("GoogleAccessId");
    expect(serialized).not.toContain("X-Goog-Credential");
    expect(serialized).not.toContain("Key-Pair-Id");
    expect(serialized).not.toContain("Policy");
    expect(serialized).not.toContain("unknown_secret_name");
    expect(serialized).not.toContain("Signature");
    expect(serialized).not.toContain("password@");
    expect(serialized).not.toContain("#private");
  });

  it("creates a deterministic count and content attestation for staging", () => {
    const dryRun = normalizeTrelloExport(syntheticBoard);
    const first = createTrelloStagingAttestation(dryRun.items);
    const reordered = createTrelloStagingAttestation(
      [...dryRun.items].reverse(),
    );
    const changed = createTrelloStagingAttestation(
      dryRun.items.map((item, index) =>
        index === 0 ? { ...item, payloadHash: "0".repeat(64) } : item,
      ),
    );
    const validationChanged = createTrelloStagingAttestation(
      dryRun.items.map((item, index) =>
        index === 0
          ? { ...item, validationErrors: ["existing-crm:ambiguous"] }
          : item,
      ),
    );

    expect(first.expectedItemCount).toBe(dryRun.items.length);
    expect(first.stagingHash).toMatch(/^[a-f0-9]{64}$/);
    expect(reordered).toEqual(first);
    expect(changed.stagingHash).not.toBe(first.stagingHash);
    expect(validationChanged.stagingHash).not.toBe(first.stagingHash);
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

  it("turns the reviewed Ali and Nabil label IDs into assignments without staging tags", () => {
    const reviewed = normalizeTrelloExport({
      ...syntheticBoard,
      cards: [
        {
          closed: false,
          desc: "",
          id: "card-ali",
          idLabels: ["69de18c5a11891f0f0aae8f0", "label-updated"],
          idList: "list-pipeline",
          name: "Lead commercial Ali",
        },
        {
          closed: false,
          desc: "",
          id: "card-nabil",
          idLabels: ["69de18c5a11891f0f0aae8ec"],
          idList: "list-pipeline",
          name: "Lead commercial Nabil",
        },
      ],
      id: "69de18c4a11891f0f0aae68a",
      labels: [
        { color: "blue", id: "69de18c5a11891f0f0aae8f0", name: "Ali" },
        { color: "green", id: "69de18c5a11891f0f0aae8ec", name: "Nabil" },
        { color: "yellow", id: "label-updated", name: "Updated" },
      ],
      lists: [
        { closed: false, id: "list-pipeline", name: "Contacted", pos: 1 },
      ],
    });
    const aliLead = reviewed.items.find(
      (item) => item.externalId === "card-ali",
    );
    const nabilLead = reviewed.items.find(
      (item) => item.externalId === "card-nabil",
    );
    const stagedTags = reviewed.items.filter(
      (item) => item.entityType === "tag",
    );

    expect(aliLead).toMatchObject({
      accessScope: "organization",
      payload: {
        assignedToEmail: "ali@qarizmi.com",
        labelExternalIds: ["label-updated"],
      },
      validationErrors: [],
    });
    expect(nabilLead).toMatchObject({
      accessScope: "organization",
      payload: {
        assignedToEmail: "nabil@qarizmi.com",
        labelExternalIds: [],
      },
      validationErrors: [],
    });
    expect(aliLead?.privacyReasons).toContain(
      "label:explicit-sales-label-allowlist",
    );
    expect(stagedTags.map((item) => item.externalId)).toEqual([
      "label-updated",
    ]);
    expect(reviewed.counts.tags).toBe(1);

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
      labels: [{ color: "purple", id: "label-unknown", name: "Ali" }],
      lists: [
        { closed: false, id: "list-pipeline", name: "Contacted", pos: 1 },
      ],
    });
    const unknownLead = unknown.items.find(
      (item) => item.externalId === "card-unknown-label",
    );
    expect(unknownLead?.accessScope).toBe("cofounders");
    expect(unknownLead?.payload.assignedToEmail).toBeUndefined();
    expect(
      unknown.items.some(
        (item) =>
          item.entityType === "tag" && item.externalId === "label-unknown",
      ),
    ).toBe(true);
  });

  it("fails closed when a card has multiple founder assignment labels", () => {
    const dryRun = normalizeTrelloExport({
      ...syntheticBoard,
      cards: [
        {
          closed: false,
          desc: "",
          id: "card-double-assignment",
          idLabels: ["69de18c5a11891f0f0aae8f0", "69de18c5a11891f0f0aae8ec"],
          idList: "list-pipeline",
          name: "Lead commercial ambigu",
        },
      ],
      id: "69de18c4a11891f0f0aae68a",
      labels: [
        { color: "blue", id: "69de18c5a11891f0f0aae8f0", name: "Ali" },
        { color: "green", id: "69de18c5a11891f0f0aae8ec", name: "Nabil" },
      ],
      lists: [
        { closed: false, id: "list-pipeline", name: "Contacted", pos: 1 },
      ],
    });
    const lead = dryRun.items.find(
      (item) => item.externalId === "card-double-assignment",
    );

    expect(lead).toMatchObject({
      accessScope: "cofounders",
      payload: { labelExternalIds: [] },
      privacyReasons: [
        "list:explicit-sales-stage-allowlist",
        "fail-closed:multiple-assignee-labels",
      ],
      validationErrors: ["trello:multiple-assignee-labels"],
    });
    expect(lead?.payload.assignedToEmail).toBeUndefined();
    expect(dryRun.items.filter((item) => item.entityType === "tag")).toEqual(
      [],
    );
    expect(dryRun.warnings.join(" ")).toMatch(
      /plusieurs labels d'assignation refusée/i,
    );
  });

  it("treats Ali and Nabil as assignees only on the reviewed commercial board", () => {
    const foreignBoard = normalizeTrelloExport({
      ...syntheticBoard,
      cards: [
        {
          ...syntheticBoard.cards[0],
          idLabels: ["label-ali"],
        },
      ],
      labels: [{ color: "blue", id: "label-ali", name: "Ali" }],
    });
    const lead = foreignBoard.items.find((item) => item.entityType === "lead");

    expect(lead?.payload.assignedToEmail).toBeUndefined();
    expect(lead?.payload.labelExternalIds).toEqual(["label-ali"]);
    expect(
      foreignBoard.items.some(
        (item) => item.entityType === "tag" && item.externalId === "label-ali",
      ),
    ).toBe(true);
  });

  it("preserves unnamed labels privately, including unused definitions and card relations", () => {
    const dryRun = normalizeTrelloExport({
      ...syntheticBoard,
      cards: [
        {
          ...syntheticBoard.cards[0],
          idLabels: ["label-urgent", "label-blank-used"],
        },
      ],
      labels: [
        { color: "red", id: "label-urgent", name: "Urgent" },
        { color: "red", id: "label-blank-used", name: "" },
        { color: "orange", id: "label-blank-unused-a", name: "   " },
        { color: null, id: "label-blank-unused-b", name: "" },
      ],
      lists: [{ ...syntheticBoard.lists[0], name: "Contacted" }],
    });
    const blankTags = dryRun.items.filter(
      (item) =>
        item.entityType === "tag" && item.externalId.startsWith("label-blank"),
    );
    const lead = dryRun.items.find(
      (item) => item.entityType === "lead" && item.externalId === "card-client",
    );

    expect(blankTags).toHaveLength(3);
    expect(
      blankTags.map((item) => ({
        accessScope: item.accessScope,
        color: item.payload.color,
        externalId: item.externalId,
        name: item.payload.name,
        privacyReasons: item.privacyReasons,
      })),
    ).toEqual([
      {
        accessScope: "cofounders",
        color: "red",
        externalId: "label-blank-used",
        name: "Label Trello privé 199e082d54",
        privacyReasons: ["fail-closed:unnamed-label"],
      },
      {
        accessScope: "cofounders",
        color: "orange",
        externalId: "label-blank-unused-a",
        name: "Label Trello privé 63ee0a8928",
        privacyReasons: ["fail-closed:unnamed-label"],
      },
      {
        accessScope: "cofounders",
        color: "teal",
        externalId: "label-blank-unused-b",
        name: "Label Trello privé 462e36660b",
        privacyReasons: ["fail-closed:unnamed-label"],
      },
    ]);
    expect(lead).toMatchObject({
      accessScope: "cofounders",
      payload: {
        labelExternalIds: ["label-urgent", "label-blank-used"],
      },
    });
    expect(lead?.privacyReasons).toContain("label:fail-closed:unnamed-label");
    expect(dryRun.counts).toMatchObject({
      cofounderLeads: 1,
      cofoundersOnly: 4,
      tags: 4,
    });
    expect(dryRun.warnings.join(" ")).toMatch(
      /3 label\(s\) sans nom conservé\(s\)/i,
    );
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
