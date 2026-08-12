import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServiceRoleSupabaseClient: vi.fn(),
}));

vi.mock("@/platform/auth/supabase-server", () => ({
  createServiceRoleSupabaseClient: mocks.createServiceRoleSupabaseClient,
}));

import {
  resolveOwnerBridgeUserByEmail,
  resolveScopedBridgeUser,
} from "./scoped-bridge-user";

describe("resolveScopedBridgeUser", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("binds the user to the exact queued profile and organization", async () => {
    const profile = query({
      data: {
        email: "ali@qarizmi.com",
        full_name: "Ali",
        id: "profile-ali",
      },
      error: null,
    });
    const membership = query({ data: { role: "owner" }, error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(profile.builder)
      .mockReturnValueOnce(membership.builder);
    mocks.createServiceRoleSupabaseClient.mockReturnValue({ from });

    await expect(
      resolveScopedBridgeUser({
        email: "Ali@Qarizmi.com",
        organizationId: "org-1",
        profileId: "profile-ali",
      }),
    ).resolves.toEqual({
      email: "ali@qarizmi.com",
      fullName: "Ali",
      organizationId: "org-1",
      profileId: "profile-ali",
      role: "owner",
    });
    expect(profile.eq).toHaveBeenCalledWith("id", "profile-ali");
    expect(membership.eq).toHaveBeenCalledWith("profile_id", "profile-ali");
    expect(membership.eq).toHaveBeenCalledWith("organization_id", "org-1");
  });

  it("fails closed when the exact membership no longer exists", async () => {
    const profile = query({
      data: {
        email: "ali@qarizmi.com",
        full_name: "Ali",
        id: "profile-ali",
      },
      error: null,
    });
    const membership = query({ data: null, error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(profile.builder)
      .mockReturnValueOnce(membership.builder);
    mocks.createServiceRoleSupabaseClient.mockReturnValue({ from });

    await expect(
      resolveScopedBridgeUser({
        email: "ali@qarizmi.com",
        organizationId: "org-1",
        profileId: "profile-ali",
      }),
    ).resolves.toBeNull();
  });

  it("retries instead of treating a profile query error as revocation", async () => {
    const profile = query({
      data: null,
      error: { code: "08006", message: "connection failure" },
    });
    mocks.createServiceRoleSupabaseClient.mockReturnValue({
      from: vi.fn(() => profile.builder),
    });

    await expect(
      resolveScopedBridgeUser({
        email: "ali@qarizmi.com",
        organizationId: "org-1",
        profileId: "profile-ali",
      }),
    ).rejects.toThrow("scoped_bridge_profile_lookup_failed");
  });

  it("retries instead of treating a membership query error as revocation", async () => {
    const profile = query({
      data: {
        email: "ali@qarizmi.com",
        full_name: "Ali",
        id: "profile-ali",
      },
      error: null,
    });
    const membership = query({
      data: null,
      error: { code: "08006", message: "connection failure" },
    });
    const from = vi
      .fn()
      .mockReturnValueOnce(profile.builder)
      .mockReturnValueOnce(membership.builder);
    mocks.createServiceRoleSupabaseClient.mockReturnValue({ from });

    await expect(
      resolveScopedBridgeUser({
        email: "ali@qarizmi.com",
        organizationId: "org-1",
        profileId: "profile-ali",
      }),
    ).rejects.toThrow("scoped_bridge_membership_lookup_failed");
  });

  it("resolves the first deterministic owner membership before enqueue", async () => {
    const profile = query({
      data: {
        email: "ali@qarizmi.com",
        full_name: "Ali",
        id: "profile-ali",
      },
      error: null,
    });
    const membership = query({
      data: { organization_id: "org-1", role: "owner" },
      error: null,
    });
    const from = vi
      .fn()
      .mockReturnValueOnce(profile.builder)
      .mockReturnValueOnce(membership.builder);
    mocks.createServiceRoleSupabaseClient.mockReturnValue({ from });

    await expect(
      resolveOwnerBridgeUserByEmail("Ali@Qarizmi.com"),
    ).resolves.toEqual({
      email: "ali@qarizmi.com",
      fullName: "Ali",
      organizationId: "org-1",
      profileId: "profile-ali",
      role: "owner",
    });
    expect(membership.eq).toHaveBeenCalledWith("role", "owner");
    expect(membership.order).toHaveBeenNthCalledWith(1, "created_at", {
      ascending: true,
    });
    expect(membership.order).toHaveBeenNthCalledWith(2, "organization_id", {
      ascending: true,
    });
    expect(membership.limit).toHaveBeenCalledWith(1);
  });
});

function query(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  const eq = vi.fn(() => builder);
  const ilike = vi.fn(() => builder);
  const limit = vi.fn(() => builder);
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const order = vi.fn(() => builder);
  Object.assign(builder, {
    eq,
    ilike,
    limit,
    maybeSingle,
    order,
    select: vi.fn(() => builder),
  });
  return { builder, eq, ilike, limit, maybeSingle, order };
}
