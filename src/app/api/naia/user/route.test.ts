import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentSupabaseUser: vi.fn(),
  isAuthorizedUser: vi.fn(),
}));

vi.mock("@/platform/auth/access", () => ({
  isAuthorizedUser: mocks.isAuthorizedUser,
}));

vi.mock("@/platform/auth/supabase-server", () => ({
  getCurrentSupabaseUser: mocks.getCurrentSupabaseUser,
}));

import { GET } from "./route";

describe("GET /api/naia/user", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAuthorizedUser.mockReturnValue(true);
  });

  it("rejects anonymous requests instead of returning a default identity", async () => {
    mocks.getCurrentSupabaseUser.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Not authenticated.",
    });
  });

  it("rejects authenticated users outside the access policy", async () => {
    mocks.getCurrentSupabaseUser.mockResolvedValue({
      email: "outside@example.com",
      user_metadata: {},
    });
    mocks.isAuthorizedUser.mockReturnValue(false);

    const response = await GET();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Not authorized.",
    });
  });

  it("returns the authorized user's first name from profile metadata", async () => {
    mocks.getCurrentSupabaseUser.mockResolvedValue({
      email: "ali@qarizmi.com",
      user_metadata: { full_name: "Ali El Abbassy" },
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ name: "Ali" });
  });

  it("falls back to the authorized email prefix when metadata is absent", async () => {
    mocks.getCurrentSupabaseUser.mockResolvedValue({
      email: "hamza@qarizmi.com",
      user_metadata: {},
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ name: "hamza" });
  });
});
