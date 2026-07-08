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

  it("grants Docs Generator access to owners only", () => {
    expect(
      hasPermission("owner", { module: "proposals", action: "read" }),
    ).toBe(true);

    for (const role of ["admin", "member", "viewer"] as const) {
      expect(hasPermission(role, { module: "proposals", action: "read" })).toBe(
        false,
      );
    }
  });

  it("hides the proposals module from non-owner roles", () => {
    expect(canAccessModule("owner", "proposals")).toBe(true);
    expect(canAccessModule("admin", "proposals")).toBe(false);
    expect(canAccessModule("member", "proposals")).toBe(false);
    expect(canAccessModule("viewer", "proposals")).toBe(false);
  });

  it("keeps regular modules visible to every role", () => {
    for (const role of ["owner", "admin", "member", "viewer"] as const) {
      expect(canAccessModule(role, "crm")).toBe(true);
      expect(canAccessModule(role, "dashboard")).toBe(true);
      expect(canAccessModule(role, "meetings")).toBe(true);
    }
  });
});
