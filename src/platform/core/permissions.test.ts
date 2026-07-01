import { describe, expect, it } from "vitest";

import { hasPermission } from "@/platform/core/permissions";

describe("platform permissions", () => {
  it("allows owners to manage platform settings", () => {
    expect(
      hasPermission("owner", { module: "settings", action: "manage" }),
    ).toBe(true);
  });

  it("treats manage as covering narrower actions in the same module", () => {
    expect(hasPermission("owner", { module: "crm", action: "update" })).toBe(
      true,
    );
    expect(hasPermission("admin", { module: "crm", action: "create" })).toBe(
      true,
    );
  });

  it("keeps viewers read-only in CRM", () => {
    expect(hasPermission("viewer", { module: "crm", action: "read" })).toBe(
      true,
    );
    expect(hasPermission("viewer", { module: "crm", action: "update" })).toBe(
      false,
    );
  });
});
