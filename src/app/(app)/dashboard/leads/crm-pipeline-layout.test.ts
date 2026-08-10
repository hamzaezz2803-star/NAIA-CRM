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

  it("keeps the UAT lead card compact and action-oriented", () => {
    const leadCardSource = pipelineSource.slice(
      pipelineSource.indexOf("function LeadCard"),
    );

    expect(leadCardSource).toContain("getCrmPipelineLeadIdentity(lead)");
    expect(leadCardSource).toContain("ownerLabel = /\\bali\\b/i");
    expect(leadCardSource).toContain('"Nabil"');
    expect(leadCardSource).toContain("onToggleDone(lead)");
    expect(leadCardSource).toContain("datePresentation.label");
    expect(leadCardSource).not.toContain("sourceDisplay");
    expect(leadCardSource).not.toContain("displayTopic");
    expect(leadCardSource).not.toContain("avatarInitials");
    expect(leadCardSource).not.toContain("onDelete");
    expect(leadCardSource).not.toContain('title="Supprimer"');
    expect(leadCardSource).not.toContain("hidden items-center");
    expect(leadCardSource).toContain("h-11 w-11 touch-none");
    expect(leadCardSource).toContain("sm:group-focus-within:opacity-100");
    expect(leadCardSource).toContain("aria-label={`Avancer ${companyName}`}");
  });

  it("shows only overdue and current-week priorities above the pipeline", () => {
    expect(pipelineSource).toContain('label: "Retards"');
    expect(pipelineSource).toContain('label: "Cette semaine"');
    expect(pipelineSource).toContain("partitionCrmPipelineActionLeads(leads)");
    expect(pipelineSource).not.toContain("activeLeads.length");
  });

  it("removes the project field and keeps advanced lead details collapsed", () => {
    expect(pipelineSource).not.toContain('label="Projet *"');
    expect(pipelineSource).toContain("Informations complémentaires et tags");
    expect(pipelineSource).toContain("Actions avancées");
    expect(pipelineSource).toContain("Historique et notes de suivi");
    expect(pipelineSource).toContain("Marquer comme faite");
    expect(pipelineSource).toContain('id="edit-status"');
    expect(pipelineSource).not.toContain("isStatusDropdownOpen");
  });

  it("uses the canonical CRM identity outside the Kanban too", () => {
    expect(pipelineSource).toContain(
      ".map((lead) => getCrmPipelineLeadIdentity(lead).companyName)",
    );
    expect(pipelineSource).toContain(
      "const { companyName } = getCrmPipelineLeadIdentity(lead);",
    );
    expect(
      pipelineSource.match(/getCrmPipelineLeadIdentity\(lead\)/g)?.length,
    ).toBeGreaterThanOrEqual(5);
  });
});
