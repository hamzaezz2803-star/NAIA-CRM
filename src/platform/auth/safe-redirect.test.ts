import { describe, expect, it } from "vitest";

import { sanitizeRedirectPath } from "@/platform/auth/safe-redirect";

describe("auth redirect safety", () => {
  it("keeps internal paths", () => {
    expect(sanitizeRedirectPath("/crm?lead=123")).toBe("/crm?lead=123");
  });

  it("rejects external URLs", () => {
    expect(sanitizeRedirectPath("https://example.com")).toBe("/dashboard");
    expect(sanitizeRedirectPath("//example.com")).toBe("/dashboard");
  });

  it("does not redirect back to login", () => {
    expect(sanitizeRedirectPath("/login?error=invalid")).toBe("/dashboard");
  });
});
