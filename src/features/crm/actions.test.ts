import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

import { updateLeadStatusAction, type CrmActionContext } from "./actions";

function fakeLeadUpdateClient(result: {
  data: Array<{ id: string }> | null;
  error: { message: string } | null;
}) {
  const select = vi.fn().mockResolvedValue(result);
  const orgEq = vi.fn(() => ({ select }));
  const idEq = vi.fn(() => ({ eq: orgEq }));
  const update = vi.fn(() => ({ eq: idEq }));

  return {
    client: { from: vi.fn(() => ({ update })) } as unknown as SupabaseClient,
    update,
  };
}

function trustedContext(client: SupabaseClient): CrmActionContext {
  return {
    actorProfileId: "profile-ali",
    organizationId: "org-1",
    supabase: client,
  };
}

describe("updateLeadStatusAction", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("succeeds when the scoped update matches a lead", async () => {
    const { client } = fakeLeadUpdateClient({
      data: [{ id: "lead-1" }],
      error: null,
    });

    const result = await updateLeadStatusAction(
      "lead-1",
      "meeting-booked",
      trustedContext(client),
    );

    expect(result).toEqual({ success: true });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/crm");
  });

  it("fails when the update matches zero rows instead of silently succeeding", async () => {
    const { client } = fakeLeadUpdateClient({ data: [], error: null });

    const result = await updateLeadStatusAction(
      "lead-of-another-org",
      "won",
      trustedContext(client),
    );

    expect(result).toEqual({ success: false, error: "Lead introuvable" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("propagates database errors", async () => {
    const { client } = fakeLeadUpdateClient({
      data: null,
      error: { message: "permission denied" },
    });

    const result = await updateLeadStatusAction(
      "lead-1",
      "won",
      trustedContext(client),
    );

    expect(result).toEqual({ success: false, error: "permission denied" });
  });
});
