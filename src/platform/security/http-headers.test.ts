import { describe, expect, it } from "vitest";

import nextConfig from "../../../next.config";

describe("HTTP security headers", () => {
  it("protects every route without disabling same-origin microphone access", async () => {
    const rules = await nextConfig.headers?.();

    expect(rules).toHaveLength(1);
    expect(rules?.[0]?.source).toBe("/(.*)");

    const headers = Object.fromEntries(
      (rules?.[0]?.headers ?? []).map(({ key, value }) => [key, value]),
    );

    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toContain("microphone=(self)");
    expect(headers["Permissions-Policy"]).not.toContain("microphone=()");
  });
});
