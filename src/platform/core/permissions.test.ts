import { describe, expect, it } from "vitest";

import { canAccessModule, hasPermission } from "@/platform/core/permissions";

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

  it("grants Docs Generator access to every role", () => {
    for (const role of ["owner", "admin", "member", "viewer"] as const) {
      expect(hasPermission(role, { module: "proposals", action: "read" })).toBe(
        true,
      );
      expect(canAccessModule(role, "proposals")).toBe(true);
    }
  });

  it("keeps regular modules visible to every role", () => {
    for (const role of ["owner", "admin", "member", "viewer"] as const) {
      expect(canAccessModule(role, "crm")).toBe(true);
      expect(canAccessModule(role, "dashboard")).toBe(true);
      expect(canAccessModule(role, "meetings")).toBe(true);
    }
  });
});
