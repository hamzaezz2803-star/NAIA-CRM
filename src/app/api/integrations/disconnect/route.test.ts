import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { POST } from "./route";

function createRequest(provider: unknown = "google") {
  return new NextRequest("http://localhost/api/integrations/disconnect", {
    body: JSON.stringify({ provider }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

describe("POST /api/integrations/disconnect", () => {
  it("rejects every provider except Google", async () => {
    const response = await POST(createRequest("slack"));

    expect(response.status).toBe(400);
  });

  it("never deletes a local Google row without proven remote revocation", async () => {
    const response = await POST(createRequest());
    const payload = await response.json();

    expect(response.status).toBe(410);
    expect(payload).toMatchObject({
      revocationEndpoint: "/api/integrations/google/revoke",
    });
  });
});
