import { describe, expect, it } from "vitest";

import { hasPermission } from "@/platform/core/permissions";

describe("platform permissions", () => {
  it("allows owners to manage platform settings", () => {
    expect(
      hasPermission("owner", { module: "settings", action: "manage" }),
    ).toBe(true);
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
