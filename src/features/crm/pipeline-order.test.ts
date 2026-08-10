import { describe, expect, it } from "vitest";

import type { CrmLeadSummary } from "./contracts";
import {
  nextCrmPipelineTopPosition,
  reorderCrmPipelineColumn,
  sortCrmPipelineColumn,
} from "./pipeline-order";

function lead(
  id: string,
  status: string,
  pipelinePosition: number,
): CrmLeadSummary {
  return {
    accessScope: "organization",
    createdAt: `2026-08-10T10:00:0${id}.000Z`,
    id,
    organizationId: "org-1",
    pipelinePosition,
    status,
    topic: `Lead ${id}`,
    updatedAt: "2026-08-10T10:00:00.000Z",
  };
}

describe("CRM pipeline priority order", () => {
  it("sorts one column by its persisted position", () => {
    const leads = [
      lead("2", "contacted", 2048),
      lead("x", "won", 1),
      lead("1", "contacted", 1024),
    ];

    expect(
      sortCrmPipelineColumn(leads, "contacted").map(({ id }) => id),
    ).toEqual(["1", "2"]);
  });

  it("moves a card optimistically without changing another column", () => {
    const untouched = lead("x", "won", 1024);
    const leads = [
      lead("1", "contacted", 1024),
      lead("2", "contacted", 2048),
      lead("3", "contacted", 3072),
      untouched,
    ];

    const result = reorderCrmPipelineColumn({
      activeId: "3",
      leads,
      overId: "1",
      status: "contacted",
    });

    expect(result).not.toBeNull();
    expect(result?.expectedOrderedIds).toEqual(["1", "2", "3"]);
    expect(result?.orderedIds).toEqual(["3", "1", "2"]);
    expect(
      sortCrmPipelineColumn(result?.leads ?? [], "contacted").map(
        ({ id }) => id,
      ),
    ).toEqual(["3", "1", "2"]);
    expect(result?.leads.find(({ id }) => id === "x")).toBe(untouched);
  });

  it("ignores a drop outside the active column or onto itself", () => {
    const leads = [lead("1", "contacted", 1024), lead("2", "won", 1024)];

    expect(
      reorderCrmPipelineColumn({
        activeId: "1",
        leads,
        overId: "2",
        status: "contacted",
      }),
    ).toBeNull();
    expect(
      reorderCrmPipelineColumn({
        activeId: "1",
        leads,
        overId: "1",
        status: "contacted",
      }),
    ).toBeNull();
  });

  it("moves a card to the end when it is dropped on the empty column area", () => {
    const leads = [
      lead("1", "contacted", 1024),
      lead("2", "contacted", 2048),
      lead("3", "contacted", 3072),
    ];

    expect(
      reorderCrmPipelineColumn({
        activeId: "1",
        leads,
        overId: "crm-column:contacted",
        overType: "column",
        status: "contacted",
      })?.orderedIds,
    ).toEqual(["2", "3", "1"]);
  });

  it("allocates a strictly leading position even when the current minimum is zero", () => {
    const leads = [
      lead("1", "contacted", 0),
      lead("2", "contacted", 1024),
      lead("3", "won", -2048),
    ];

    expect(nextCrmPipelineTopPosition(leads, "contacted")).toBe(-1024);
    expect(nextCrmPipelineTopPosition([], "contacted")).toBe(0);
  });
});
