import { describe, expect, it } from "vitest";

import type { CrmLeadSummary } from "./contracts";
import {
  getCrmPipelineDateState,
  getCrmPipelineLeadIdentity,
  partitionCrmPipelineActionLeads,
} from "./pipeline-presentation";

function lead(
  id: string,
  overrides: Partial<CrmLeadSummary> = {},
): CrmLeadSummary {
  return {
    accessScope: "organization",
    createdAt: "2026-08-01T09:00:00.000Z",
    id,
    organizationId: "org-1",
    status: "to-follow-up",
    topic: "Projet CRM",
    updatedAt: "2026-08-01T09:00:00.000Z",
    ...overrides,
  };
}

describe("getCrmPipelineLeadIdentity", () => {
  it("prefers canonical company and contact fields", () => {
    expect(
      getCrmPipelineLeadIdentity(
        lead("canonical", {
          companyName: "  TGCC  ",
          contactName: "  Salma Alaoui ",
          notes: "Entreprise: Ancienne société\nContact: Ancien contact",
          topic: "Meeting chez une autre société",
        }),
      ),
    ).toEqual({
      companyName: "TGCC",
      contactName: "Salma Alaoui",
    });
  });

  it("reads case-insensitive legacy note fields", () => {
    expect(
      getCrmPipelineLeadIdentity(
        lead("legacy", {
          notes: "ENTREPRISE :  HPS\r\ncontact: Karim Saidi",
        }),
      ),
    ).toEqual({
      companyName: "HPS",
      contactName: "Karim Saidi",
    });
  });

  it("keeps the original title when no company was safely structured", () => {
    expect(
      getCrmPipelineLeadIdentity(
        lead("contextual", { topic: "Présentation du CRM chez Novatec" }),
      ),
    ).toEqual({
      companyName: "Présentation du CRM chez Novatec",
      contactName: "Contact à qualifier",
    });
    expect(
      getCrmPipelineLeadIdentity(
        lead("prefixed", { topic: "QARIZMI Inc. - Démonstration" }),
      ).companyName,
    ).toBe("QARIZMI Inc. - Démonstration");
    expect(getCrmPipelineLeadIdentity(lead("empty", { topic: "  " }))).toEqual({
      companyName: "Sans entreprise",
      contactName: "Contact à qualifier",
    });
  });
});

describe("getCrmPipelineDateState", () => {
  const mondayInCasablanca = new Date("2026-08-09T23:30:00.000Z");

  it("marks completed actions and terminal leads as done", () => {
    expect(
      getCrmPipelineDateState(
        lead("state-done", {
          leadDate: "2026-08-10",
          nextActionState: "done",
        }),
        { now: mondayInCasablanca },
      ),
    ).toBe("done");
    expect(
      getCrmPipelineDateState(
        lead("timestamp-done", {
          leadDate: "2026-08-10",
          nextActionCompletedAt: "2026-08-09T12:00:00.000Z",
          nextActionState: "pending",
        }),
        { now: mondayInCasablanca },
      ),
    ).toBe("done");
    expect(
      getCrmPipelineDateState(
        lead("won", { leadDate: "2026-08-10", status: "won" }),
        { now: mondayInCasablanca },
      ),
    ).toBe("done");
    expect(
      getCrmPipelineDateState(
        lead("dead-end", { leadDate: "2026-08-10", status: "dead-end" }),
        { now: mondayInCasablanca },
      ),
    ).toBe("done");
  });

  it("uses Casablanca calendar days and a Monday-to-Sunday week", () => {
    expect(
      getCrmPipelineDateState(
        lead("overdue", { leadDate: "2026-08-09T22:00:00.000Z" }),
        { now: mondayInCasablanca },
      ),
    ).toBe("overdue");
    expect(
      getCrmPipelineDateState(
        lead("today", { leadDate: "2026-08-09T23:45:00.000Z" }),
        { now: mondayInCasablanca },
      ),
    ).toBe("today");
    expect(
      getCrmPipelineDateState(
        lead("sunday", { leadDate: "2026-08-16T09:00:00.000Z" }),
        { now: mondayInCasablanca },
      ),
    ).toBe("this-week");
    expect(
      getCrmPipelineDateState(
        lead("next-monday", { leadDate: "2026-08-17T09:00:00.000Z" }),
        { now: mondayInCasablanca },
      ),
    ).toBe("later");
  });

  it("treats naive values as Casablanca local dates and rejects invalid dates", () => {
    expect(
      getCrmPipelineDateState(
        lead("naive", { leadDate: "2026-08-10T00:15:00" }),
        { now: mondayInCasablanca },
      ),
    ).toBe("today");
    expect(
      getCrmPipelineDateState(lead("invalid", { leadDate: "2026-02-31" }), {
        now: mondayInCasablanca,
      }),
    ).toBe("later");
    expect(
      getCrmPipelineDateState(lead("undated"), {
        now: mondayInCasablanca,
      }),
    ).toBe("later");
  });

  it("does not leak Monday into the preceding Sunday week", () => {
    const sundayInCasablanca = new Date("2026-08-16T10:00:00.000Z");

    expect(
      getCrmPipelineDateState(lead("same-sunday", { leadDate: "2026-08-16" }), {
        now: sundayInCasablanca,
      }),
    ).toBe("today");
    expect(
      getCrmPipelineDateState(
        lead("following-monday", { leadDate: "2026-08-17" }),
        { now: sundayInCasablanca },
      ),
    ).toBe("later");
  });
});

describe("partitionCrmPipelineActionLeads", () => {
  it("partitions only pending active actions and sorts them deterministically", () => {
    const input = [
      lead("sunday", {
        leadDate: "2026-08-16",
        nextAction: "Préparer le rendez-vous",
        pipelinePosition: 20,
      }),
      lead("older-overdue", {
        leadDate: "2026-08-07",
        nextAction: "Relancer",
      }),
      lead("same-date-position-2", {
        leadDate: "2026-08-09",
        nextAction: "Relancer",
        pipelinePosition: 2,
      }),
      lead("same-date-position-1", {
        leadDate: "2026-08-09",
        nextAction: "Relancer",
        pipelinePosition: 1,
      }),
      lead("today", {
        leadDate: "2026-08-10",
        nextAction: "Envoyer le deck",
      }),
      lead("later", {
        leadDate: "2026-08-17",
        nextAction: "Recontacter",
      }),
      lead("done-state", {
        leadDate: "2026-08-09",
        nextAction: "Ancienne relance",
        nextActionState: "done",
      }),
      lead("done-timestamp", {
        leadDate: "2026-08-09",
        nextAction: "Ancienne relance",
        nextActionCompletedAt: "2026-08-09T11:00:00.000Z",
        nextActionState: "pending",
      }),
      lead("won", {
        leadDate: "2026-08-09",
        nextAction: "Action gagnée",
        status: "won",
      }),
      lead("dead-end", {
        leadDate: "2026-08-09",
        nextAction: "Action abandonnée",
        status: "dead-end",
      }),
      lead("no-action", { leadDate: "2026-08-09" }),
      lead("invalid-date", {
        leadDate: "pas une date",
        nextAction: "Qualifier",
      }),
    ];
    const originalOrder = input.map(({ id }) => id);

    const result = partitionCrmPipelineActionLeads(input, {
      now: new Date("2026-08-10T08:00:00.000Z"),
    });

    expect(result.overdue.map(({ id }) => id)).toEqual([
      "older-overdue",
      "same-date-position-1",
      "same-date-position-2",
    ]);
    expect(result.thisWeek.map(({ id }) => id)).toEqual(["today", "sunday"]);
    expect(input.map(({ id }) => id)).toEqual(originalOrder);
  });
});
