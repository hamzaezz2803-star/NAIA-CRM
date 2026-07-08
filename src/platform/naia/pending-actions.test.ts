import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServiceRoleSupabaseClient: vi.fn(),
}));

vi.mock("@/platform/auth/supabase-server", () => ({
  createServiceRoleSupabaseClient: mocks.createServiceRoleSupabaseClient,
}));

import {
  claimPendingAction,
  NAIA_PENDING_ACTION_TTL_MS,
  storePendingAction,
  type NaiaPendingDraft,
} from "./pending-actions";

const DRAFT_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

const pendingDraft: NaiaPendingDraft = {
  action: {
    agentId: "integrations",
    approvalRequired: true,
    description: "Lina lira les derniers messages Gmail autorises.",
    id: "gmail-list-abc",
    kind: "google.gmail.listMessages",
    label: "Lire Gmail",
    payload: { maxResults: 10, unreadOnly: true },
    risk: "low",
  },
  approvalToken: "payload.signature",
  command: "lis mes emails gmail non lus",
};

type FakeResult = { data: unknown; error: unknown };

type RecordedCall = { args: unknown[]; method: string };

// Minimal chainable stand-in for the supabase-js query builder: every filter
// method returns the builder, awaiting it (or maybeSingle/single) resolves
// the queued result for that from() call.
function createFakeSupabase(results: FakeResult[]) {
  const queries: RecordedCall[][] = [];

  const from = vi.fn(() => {
    const log: RecordedCall[] = [];
    queries.push(log);
    const result = results.shift() ?? { data: null, error: null };

    const builder: Record<string, unknown> = {};
    for (const method of ["delete", "eq", "gt", "insert", "lte", "select"]) {
      builder[method] = (...args: unknown[]) => {
        log.push({ args, method });
        return builder;
      };
    }
    builder.maybeSingle = () => {
      log.push({ args: [], method: "maybeSingle" });
      return Promise.resolve(result);
    };
    builder.single = () => {
      log.push({ args: [], method: "single" });
      return Promise.resolve(result);
    };
    builder.then = (resolve: (value: FakeResult) => unknown) =>
      Promise.resolve(result).then(resolve);

    return builder;
  });

  return { client: { from }, from, queries };
}

function methods(calls: RecordedCall[]) {
  return calls.map((call) => call.method);
}

describe("NAIA pending actions store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-08T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("stores a draft with the TTL and returns the row id", async () => {
    const fake = createFakeSupabase([{ data: { id: DRAFT_ID }, error: null }]);
    mocks.createServiceRoleSupabaseClient.mockReturnValue(fake.client);

    const id = await storePendingAction({
      draft: pendingDraft,
      organizationId: "org-1",
      profileId: "profile-ali",
    });

    expect(id).toBe(DRAFT_ID);

    const insertCall = fake.queries[0].find((call) => call.method === "insert");
    const row = insertCall?.args[0] as {
      draft: unknown;
      expires_at: Date;
      organization_id: string;
      profile_id: string;
    };
    expect(row.draft).toEqual(pendingDraft);
    expect(row.organization_id).toBe("org-1");
    expect(row.profile_id).toBe("profile-ali");
    expect(new Date(row.expires_at).getTime()).toBe(
      Date.now() + NAIA_PENDING_ACTION_TTL_MS,
    );
  });

  it("returns null when Supabase is not configured or the insert fails", async () => {
    mocks.createServiceRoleSupabaseClient.mockReturnValue(null);
    expect(
      await storePendingAction({
        draft: pendingDraft,
        organizationId: "org-1",
        profileId: "profile-ali",
      }),
    ).toBeNull();

    const fake = createFakeSupabase([
      { data: null, error: { message: "boom" } },
    ]);
    mocks.createServiceRoleSupabaseClient.mockReturnValue(fake.client);
    expect(
      await storePendingAction({
        draft: pendingDraft,
        organizationId: "org-1",
        profileId: "profile-ali",
      }),
    ).toBeNull();
  });

  it("claims a draft once: purge of expired rows, then a filtered single-use delete", async () => {
    const fake = createFakeSupabase([
      { data: null, error: null },
      { data: { draft: pendingDraft }, error: null },
    ]);
    mocks.createServiceRoleSupabaseClient.mockReturnValue(fake.client);

    const draft = await claimPendingAction({
      id: DRAFT_ID,
      profileId: "profile-ali",
    });

    expect(draft).toEqual(pendingDraft);

    // First query: purge every expired draft at read time.
    expect(methods(fake.queries[0])).toEqual(["delete", "lte"]);
    expect(fake.queries[0][1].args).toEqual([
      "expires_at",
      "2026-07-08T12:00:00.000Z",
    ]);

    // Second query: delete-with-return filtered on id, owner, and expiry.
    expect(methods(fake.queries[1])).toEqual([
      "delete",
      "eq",
      "eq",
      "gt",
      "select",
      "maybeSingle",
    ]);
    expect(fake.queries[1][1].args).toEqual(["id", DRAFT_ID]);
    expect(fake.queries[1][2].args).toEqual(["profile_id", "profile-ali"]);
    expect(fake.queries[1][3].args).toEqual([
      "expires_at",
      "2026-07-08T12:00:00.000Z",
    ]);
  });

  it("returns null for an expired, foreign, or already-claimed draft", async () => {
    const fake = createFakeSupabase([
      { data: null, error: null },
      { data: null, error: null },
    ]);
    mocks.createServiceRoleSupabaseClient.mockReturnValue(fake.client);

    expect(
      await claimPendingAction({ id: DRAFT_ID, profileId: "profile-ali" }),
    ).toBeNull();
  });

  it("rejects malformed draft ids without touching the database", async () => {
    const fake = createFakeSupabase([]);
    mocks.createServiceRoleSupabaseClient.mockReturnValue(fake.client);

    expect(
      await claimPendingAction({
        id: "not-a-uuid",
        profileId: "profile-ali",
      }),
    ).toBeNull();
    expect(fake.from).not.toHaveBeenCalled();
  });

  it("rejects rows whose stored draft lost its expected shape", async () => {
    const fake = createFakeSupabase([
      { data: null, error: null },
      { data: { draft: { command: "x" } }, error: null },
    ]);
    mocks.createServiceRoleSupabaseClient.mockReturnValue(fake.client);

    expect(
      await claimPendingAction({ id: DRAFT_ID, profileId: "profile-ali" }),
    ).toBeNull();
  });
});
