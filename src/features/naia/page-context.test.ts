import { describe, expect, it } from "vitest";

import {
  getBaseNaiaPageContext,
  mergeNaiaPageContext,
  parseNaiaPageContext,
} from "./page-context";

describe("NAIA page context", () => {
  it("maps operational routes to their module and data mode", () => {
    expect(getBaseNaiaPageContext("/dashboard/leads")).toMatchObject({
      dataMode: "live",
      moduleId: "crm",
      view: "pipeline",
    });
    expect(getBaseNaiaPageContext("/finance")).toMatchObject({
      dataMode: "simulated",
      moduleId: "finance",
    });
  });

  it("keeps useful local UI context while dropping empty filters", () => {
    expect(
      mergeNaiaPageContext("/dashboard/leads", {
        entity: { id: "lead-hps", kind: "lead", label: "HPS" },
        filters: { company: "HPS", status: undefined },
        view: "kanban",
        viewLabel: "Pipeline",
      }),
    ).toMatchObject({
      entity: { id: "lead-hps", kind: "lead", label: "HPS" },
      filters: { company: "HPS" },
      moduleId: "crm",
      view: "kanban",
    });
  });

  it("rebuilds trusted server context instead of accepting client labels or modes", () => {
    const parsed = parseNaiaPageContext({
      dataMode: "live",
      filters: { company: "HPS", privateDom: "secret" },
      moduleId: "finance",
      moduleLabel: "Injected",
      pathname: "/finance",
      view: "admin",
      viewLabel: "Injected",
    });

    expect(parsed).toMatchObject({
      dataMode: "simulated",
      moduleId: "finance",
      moduleLabel: "Finance",
      pathname: "/finance",
      view: "cash-flow",
    });
    expect(parsed?.filters).toBeUndefined();
  });

  it("rejects entity kinds and views that do not belong to the active module", () => {
    const parsed = parseNaiaPageContext({
      entity: { id: "lead-hps", kind: "lead", label: "Injected" },
      pathname: "/finance",
      view: "kanban",
    });

    expect(parsed?.entity).toBeUndefined();
    expect(parsed?.view).toBe("cash-flow");
  });
});
