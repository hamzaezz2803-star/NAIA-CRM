import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  canTriggerMayaPitchGenerationRole,
  canUseMayaPitchGeneratorEmail,
} from "./access-policy";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock("@/platform/auth/supabase-server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));

import { requireMayaPitchGenerationAccess } from "./access";

describe("Maya pitch generator access", () => {
  it("allows any signed-in organization member", () => {
    expect(canUseMayaPitchGeneratorEmail("ali@qarizmi.com")).toBe(true);
    expect(canUseMayaPitchGeneratorEmail("hamza@qarizmi.com")).toBe(true);
    expect(canUseMayaPitchGeneratorEmail(" wissal@qarizmi.com ")).toBe(true);
  });

  it("fails closed without an email", () => {
    expect(canUseMayaPitchGeneratorEmail(undefined)).toBe(false);
    expect(canUseMayaPitchGeneratorEmail("  ")).toBe(false);
  });
});

describe("Maya pitch generation role policy", () => {
  it("lets every organization role trigger a generation", () => {
    for (const role of ["owner", "admin", "member", "viewer"]) {
      expect(canTriggerMayaPitchGenerationRole(role)).toBe(true);
    }
  });

  it("rejects unknown or missing roles", () => {
    expect(canTriggerMayaPitchGenerationRole("guest")).toBe(false);
    expect(canTriggerMayaPitchGenerationRole(null)).toBe(false);
  });
});

describe("requireMayaPitchGenerationAccess", () => {
  beforeEach(() => {
    mocks.createServerSupabaseClient.mockReset();
  });

  it("allows generation for a member role", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      makeSupabaseStub({ role: "member" }),
    );

    await expect(requireMayaPitchGenerationAccess()).resolves.toMatchObject({
      role: "member",
    });
  });

  it("refuses generation for an unknown role", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      makeSupabaseStub({ role: "guest" }),
    );

    await expect(requireMayaPitchGenerationAccess()).rejects.toThrow(
      "nécessite un rôle reconnu",
    );
  });

  it("allows generation for an owner cofounder", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      makeSupabaseStub({ role: "owner" }),
    );

    await expect(requireMayaPitchGenerationAccess()).resolves.toMatchObject({
      organizationId: "org-1",
      role: "owner",
    });
  });
});

function makeSupabaseStub({ role }: { role: string }) {
  return {
    auth: {
      getUser: async () => ({
        data: { user: { email: "ali@qarizmi.com", id: "user-1" } },
        error: null,
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          limit: () => ({
            maybeSingle: async () => ({
              data: { organization_id: "org-1", role },
            }),
          }),
        }),
      }),
    }),
  };
}
