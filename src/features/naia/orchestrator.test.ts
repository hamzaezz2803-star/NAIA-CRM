import { describe, expect, it } from "vitest";

import type { CrmLeadSummary } from "@/features/crm/contracts";

import {
  classifyNaiaAgent,
  inferCrmStatus,
  orchestrateNaiaCommand,
} from "./orchestrator";

const crmLeads: CrmLeadSummary[] = [
  {
    createdAt: "2026-07-01T10:00:00.000Z",
    id: "lead-atlas",
    notes: "CEO/CFO interested in operating system",
    organizationId: "org-1",
    status: "lead-to-contact",
    topic: "Atlas Process - OS finance et CRM",
    updatedAt: "2026-07-01T10:00:00.000Z",
  },
];

describe("NAIA orchestrator", () => {
  it("routes CRM update commands to Salma with a validated action draft", () => {
    const result = orchestrateNaiaCommand({
      command: "NAIA passe Atlas en meeting booked et prepare le pitch",
      crmLeads,
    });

    expect(result.agent.id).toBe("crm");
    expect(result.agent.name).toBe("Salma");
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({
      approvalRequired: true,
      kind: "crm.updateLeadStatus",
      payload: {
        leadId: "lead-atlas",
        status: "meeting-booked",
      },
    });
  });

  it("routes feature requests to the developer agent", () => {
    expect(
      classifyNaiaAgent("NAIA demande a Codex d'ajouter une nouvelle feature"),
    ).toBe("developer");
    expect(classifyNaiaAgent("Rayan prepare une nouvelle feature CRM")).toBe(
      "developer",
    );
  });

  it("can use an LLM-selected agent while keeping deterministic action drafts", () => {
    const result = orchestrateNaiaCommand({
      agentIdOverride: "hr",
      command: "NAIA de quoi ai-je besoin pour staffer les projets signes ?",
      confidenceOverride: 0.91,
      crmLeads,
      responseOverride: "Yasmine prend le relais RH.",
    });

    expect(result.agent.id).toBe("hr");
    expect(result.agent.name).toBe("Yasmine");
    expect(result.confidence).toBe(0.91);
    expect(result.response).toBe("Yasmine prend le relais RH.");
    expect(result.actions).toHaveLength(0);
  });

  it("infers CRM pipeline statuses from French commands", () => {
    expect(inferCrmStatus("mets Atlas en propale")).toBe("proposal-sent");
    expect(inferCrmStatus("relance Medina demain")).toBe("to-follow-up");
    expect(inferCrmStatus("client signe")).toBe("won");
  });
});
