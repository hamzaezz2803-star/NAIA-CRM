import type { CrmLeadSummary, CrmLeadStatus } from "./contracts";

function pipelinePosition(lead: CrmLeadSummary) {
  return Number.isFinite(lead.pipelinePosition)
    ? (lead.pipelinePosition ?? Number.MAX_SAFE_INTEGER)
    : Number.MAX_SAFE_INTEGER;
}

export function sortCrmPipelineColumn(
  leads: CrmLeadSummary[],
  status: CrmLeadStatus,
) {
  return leads
    .filter((lead) => lead.status === status)
    .sort((left, right) => {
      const positionDelta = pipelinePosition(left) - pipelinePosition(right);
      if (positionDelta !== 0) return positionDelta;

      const createdAtDelta =
        new Date(right.createdAt).getTime() -
        new Date(left.createdAt).getTime();
      if (createdAtDelta !== 0) return createdAtDelta;

      return left.id.localeCompare(right.id);
    });
}

export function reorderCrmPipelineColumn({
  activeId,
  leads,
  overId,
  overType,
  status,
}: {
  activeId: string;
  leads: CrmLeadSummary[];
  overId: string;
  overType?: "column" | "lead";
  status: CrmLeadStatus;
}): {
  expectedOrderedIds: string[];
  leads: CrmLeadSummary[];
  orderedIds: string[];
} | null {
  const column = sortCrmPipelineColumn(leads, status);
  const oldIndex = column.findIndex((lead) => lead.id === activeId);
  const newIndex =
    overType === "column"
      ? column.length - 1
      : column.findIndex((lead) => lead.id === overId);

  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return null;

  const expectedOrderedIds = column.map((lead) => lead.id);
  const reordered = [...column];
  const [moved] = reordered.splice(oldIndex, 1);
  reordered.splice(newIndex, 0, moved);

  const nextPositions = new Map(
    reordered.map((lead, index) => [lead.id, (index + 1) * 1024]),
  );

  return {
    expectedOrderedIds,
    leads: leads.map((lead) => {
      const nextPosition = nextPositions.get(lead.id);
      return nextPosition === undefined
        ? lead
        : { ...lead, pipelinePosition: nextPosition };
    }),
    orderedIds: reordered.map((lead) => lead.id),
  };
}

export function nextCrmPipelineTopPosition(
  leads: CrmLeadSummary[],
  status: CrmLeadStatus,
  excludedLeadId?: string,
) {
  const positions = leads
    .filter(
      (lead) =>
        lead.status === status &&
        lead.id !== excludedLeadId &&
        Number.isFinite(lead.pipelinePosition),
    )
    .map((lead) => lead.pipelinePosition as number);

  return (positions.length > 0 ? Math.min(...positions) : 1024) - 1024;
}
