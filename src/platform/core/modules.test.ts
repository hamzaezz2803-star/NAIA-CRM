import { describe, expect, it } from "vitest";

import { platformModules, requireModule } from "@/platform/core/modules";

describe("platform module registry", () => {
  it("keeps module routes unique", () => {
    const routes = platformModules.map((module) => module.href);

    expect(new Set(routes).size).toBe(routes.length);
  });

  it("keeps CRM registered as Hamza's build boundary", () => {
    const crm = requireModule("crm");

    expect(crm.href).toBe("/dashboard/leads");
    expect(crm.owner).toBe("crm");
    expect(crm.status).toBe("live");
    expect(crm.handoffPath).toBe("docs/crm-handoff.md");
  });
});
