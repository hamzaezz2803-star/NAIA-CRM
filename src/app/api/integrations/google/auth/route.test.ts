import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

describe("Google integration auth route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requests Calendar, Gmail and read-only Drive for linked Gemini docs", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://os.qarizmi.com");

    const response = await GET();
    const location = response.headers.get("location");

    expect(location).toBeTruthy();

    const authUrl = new URL(location ?? "");
    const scopes = authUrl.searchParams.get("scope")?.split(" ") ?? [];

    expect(scopes).toEqual([
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.freebusy",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/drive.readonly",
    ]);
    expect(scopes).not.toContain("https://www.googleapis.com/auth/drive.file");
  });

  it("mints a CSRF state bound to a cookie", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://os.qarizmi.com");

    const response = await GET();
    const authUrl = new URL(response.headers.get("location") ?? "");
    const state = authUrl.searchParams.get("state");
    const stateCookie = response.cookies.get("google_oauth_state");

    expect(state).toBeTruthy();
    expect(stateCookie?.value).toBe(state);
    expect(stateCookie?.httpOnly).toBe(true);
  });
});
