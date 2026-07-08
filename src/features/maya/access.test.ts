import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAYA_COFUNDER_EMAILS,
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
  it("allows only Ali and Nabil by email", () => {
    expect(canUseMayaPitchGeneratorEmail("ali@qarizmi.com")).toBe(true);
    expect(canUseMayaPitchGeneratorEmail("nabil@qarizmi.com")).toBe(true);
    expect(canUseMayaPitchGeneratorEmail("hamza@qarizmi.com")).toBe(false);
    expect(canUseMayaPitchGeneratorEmail("wissal@qarizmi.com")).toBe(false);
  });

  it("normalizes email case and spacing", () => {
    expect(canUseMayaPitchGeneratorEmail(" NABIL@QARIZMI.COM ")).toBe(true);
  });

  it("keeps the allowlist explicit", () => {
    expect(MAYA_COFUNDER_EMAILS).toEqual([
      "ali@qarizmi.com",
      "nabil@qarizmi.com",
    ]);
  });
});

describe("Maya pitch generation role policy", () => {
  it("only lets owner roles trigger a generation", () => {
    expect(canTriggerMayaPitchGenerationRole("owner")).toBe(true);
    expect(canTriggerMayaPitchGenerationRole("admin")).toBe(false);
    expect(canTriggerMayaPitchGenerationRole("member")).toBe(false);
    expect(canTriggerMayaPitchGenerationRole("viewer")).toBe(false);
    expect(canTriggerMayaPitchGenerationRole(null)).toBe(false);
  });
});

describe("requireMayaPitchGenerationAccess", () => {
  beforeEach(() => {
    mocks.createServerSupabaseClient.mockReset();
  });

  it("refuses generation for a cofounder with a member role", async () => {
    mocks.createServerSupabaseClient.mockResolvedValue(
      makeSupabaseStub({ role: "member" }),
    );

    await expect(requireMayaPitchGenerationAccess()).rejects.toThrow(
      "La génération de pitch Maya est réservée au rôle owner",
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
