import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/platform/integrations/google-workspace", () => ({
  getGoogleWorkspaceAccessToken: vi.fn(),
}));

import { getMayaDriveConfigFromEnv, hasMayaDriveFolderConfig } from "./drive";

describe("Maya Drive configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the cofounder shared drive folder IDs provided by environment variables", () => {
    vi.stubEnv(
      "MAYA_DRIVE_SOURCE_FOLDER_ID",
      "1IeekoGpVpIwGRHsYjS1cuvPnSP9OJsmH",
    );
    vi.stubEnv(
      "MAYA_DRIVE_OUTPUT_FOLDER_ID",
      "1ayZ6wUIpWElEM4N0Xm1UqHRNzCz0uSn0",
    );

    expect(hasMayaDriveFolderConfig()).toBe(true);
    expect(getMayaDriveConfigFromEnv()).toEqual({
      outputFolderId: "1ayZ6wUIpWElEM4N0Xm1UqHRNzCz0uSn0",
      sourceFolderId: "1IeekoGpVpIwGRHsYjS1cuvPnSP9OJsmH",
    });
  });
});
