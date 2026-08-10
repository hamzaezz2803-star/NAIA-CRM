// @vitest-environment node

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const pipelineSource = readFileSync(
  new URL("./crm-pipeline-client.tsx", import.meta.url),
  "utf8",
);

describe("CRM pipeline responsive layout contract", () => {
  it("keeps imported categories in readable horizontal columns", () => {
    expect(pipelineSource).toContain(
      "grid min-w-max grid-flow-col auto-cols-[minmax(220px,80vw)]",
    );
    expect(pipelineSource).toContain("md:auto-cols-[minmax(260px,280px)]");
    expect(pipelineSource).not.toContain("md:grid-flow-row");
    expect(pipelineSource).not.toContain(
      "md:grid-cols-[repeat(var(--kanban-columns),minmax(0,1fr))]",
    );
  });

  it("uses accessible sortable cards instead of native HTML drag events", () => {
    expect(pipelineSource).toContain("<DndContext");
    expect(pipelineSource).toContain('id="crm-pipeline-sortable"');
    expect(pipelineSource).toContain("<SortableContext");
    expect(pipelineSource).toContain("useSortable({");
    expect(pipelineSource).toContain("sortableKeyboardCoordinates");
    expect(pipelineSource).toContain("reorderCrmPipelineLeadsAction");
    expect(pipelineSource).toContain("disabled: !canReorder");
    expect(pipelineSource).not.toContain("e.dataTransfer");
    expect(pipelineSource).not.toContain("<article\n      draggable");
  });
});
