import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireMeetingNotesAccess: vi.fn(),
}));

vi.mock("@/features/meeting-notes/access", () => ({
  requireMeetingNotesAccess: mocks.requireMeetingNotesAccess,
}));

import { GET } from "./route";

describe("Google integration auth route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireMeetingNotesAccess.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps ordinary employee sign-in limited to Calendar and Gmail", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://os.qarizmi.com");

    const response = await GET();
    const location = response.headers.get("location");

    expect(location).toBeTruthy();

    const authUrl = new URL(location ?? "");
    const scopes = authUrl.searchParams.get("scope")?.split(" ") ?? [];

    expect(authUrl.searchParams.has("include_granted_scopes")).toBe(false);
    expect(scopes).toEqual([
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.freebusy",
      "https://www.googleapis.com/auth/gmail.readonly",
    ]);
    expect(scopes).not.toContain(
      "https://www.googleapis.com/auth/drive.meet.readonly",
    );
    expect(scopes).not.toContain(
      "https://www.googleapis.com/auth/drive.readonly",
    );
    expect(scopes).not.toContain("https://www.googleapis.com/auth/drive.file");
  });

  it("requests only the narrow Meet document scope for an authorized founder", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://os.qarizmi.com");
    const request = new NextRequest(
      "https://os.qarizmi.com/api/integrations/google/auth?intent=meeting-notes",
    );

    const response = await GET(request);
    const scopes =
      new URL(response.headers.get("location") ?? "").searchParams
        .get("scope")
        ?.split(" ") ?? [];

    expect(mocks.requireMeetingNotesAccess).toHaveBeenCalledTimes(1);
    expect(scopes).toContain(
      "https://www.googleapis.com/auth/drive.meet.readonly",
    );
    expect(scopes).not.toContain(
      "https://www.googleapis.com/auth/drive.readonly",
    );
  });

  it("rejects incremental Meet document access for a non-founder", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    mocks.requireMeetingNotesAccess.mockRejectedValue(
      new Error("founder access required"),
    );
    const request = new NextRequest(
      "https://os.qarizmi.com/api/integrations/google/auth?intent=meeting-notes",
    );

    const response = await GET(request);

    expect(response.status).toBe(403);
    expect(response.headers.get("location")).toBeNull();
  });

  it("mints a CSRF state bound to a cookie", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://os.qarizmi.com");

    const response = await GET();
    const authUrl = new URL(response.headers.get("location") ?? "");
    const state = authUrl.searchParams.get("state");
    const stateCookie = response.cookies.get("google_oauth_state");

    expect(state).toBeTruthy();
    expect(stateCookie?.value).toBe(`${state}:user`);
    expect(stateCookie?.httpOnly).toBe(true);
  });

  it("binds the founder intent to the state cookie", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    const response = await GET(
      new NextRequest(
        "https://os.qarizmi.com/api/integrations/google/auth?intent=meeting-notes",
      ),
    );
    const state = new URL(
      response.headers.get("location") ?? "",
    ).searchParams.get("state");

    expect(response.cookies.get("google_oauth_state")?.value).toBe(
      `${state}:meeting-notes`,
    );
  });
});
