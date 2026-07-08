import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

describe("Google integration auth route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requests Drive, Calendar, and Gmail workspace scopes", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://os.qarizmi.com");

    const response = await GET();
    const location = response.headers.get("location");

    expect(location).toBeTruthy();

    const authUrl = new URL(location ?? "");
    const scopes = authUrl.searchParams.get("scope")?.split(" ") ?? [];

    expect(scopes).toEqual(
      expect.arrayContaining([
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/calendar.freebusy",
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.send",
      ]),
    );
  });
});
