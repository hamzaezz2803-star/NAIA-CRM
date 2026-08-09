import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { MayaPitchQueueResult } from "./actions";
import { MayaPitchQueue } from "./maya-pitch-queue";

vi.mock("./actions", () => ({
  generateMayaPitchDraftFormAction: vi.fn(),
}));

describe("MayaPitchQueue", () => {
  it("shows the approved family, source, date and explicit confirmation", () => {
    render(<MayaPitchQueue result={makeResult()} />);

    expect(screen.getByText("Pitch client")).toBeInTheDocument();
    expect(screen.getByText("Proposition commerciale")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Qarizmi_Introduction_Service as a software_Teaser.pptx",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/3 août 2026/)).toBeInTheDocument();
    expect(screen.getByText("a".repeat(64))).toBeInTheDocument();
    expect(screen.getByLabelText(/Je confirme la copie fidèle/)).toBeRequired();
    expect(
      screen.getByRole("button", { name: "Copier dans 01_Pitch" }),
    ).toBeEnabled();
    expect(screen.getByText(/aucun provider IA/)).toBeInTheDocument();
  });

  it("disables generation when the CRM Drive destination is unsafe", () => {
    const result = makeResult();
    if (!result.authorized) throw new Error("test fixture must be authorized");
    result.items[0] = {
      ...result.items[0]!,
      destinationError:
        "Le dossier CRM contient plusieurs sous-dossiers 01_Pitch; la destination est ambiguë.",
      destinationFolderUrl: undefined,
      status: "blocked",
    };

    render(<MayaPitchQueue result={result} />);

    expect(screen.getByText("Copie bloquée")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copier dans 01_Pitch" }),
    ).toBeDisabled();
  });

  it("shows a direct Drive link when a draft already exists", () => {
    const result = makeResult();
    if (!result.authorized) throw new Error("test fixture must be authorized");
    result.items[0] = {
      ...result.items[0]!,
      draftFileName:
        "20260809_Qarizmi_Introduction_Service as a software_HPS_vDraft.pptx",
      draftFilePath: "gdrive:draft-file-id",
      status: "draft-ready",
    };

    render(<MayaPitchQueue result={result} />);

    expect(
      screen.getByRole("link", { name: /Ouvrir le draft dans Drive/ }),
    ).toHaveAttribute(
      "href",
      "https://drive.google.com/file/d/draft-file-id/view",
    );
  });
});

function makeResult(): MayaPitchQueueResult {
  return {
    authorized: true,
    items: [
      {
        clientName: "HPS",
        contactName: "Abdeslam El-Alawi",
        destinationFolderUrl:
          "https://drive.google.com/drive/folders/pitch-folder-id",
        leadId: "lead-1",
        leadStatus: "meeting-booked",
        status: "ready",
      },
    ],
    sourceWarnings: [],
    templates: [
      {
        availability: "ready",
        driveFileId: "approved-teaser-id",
        family: "pitch",
        fileName: "Qarizmi_Introduction_Service as a software_Teaser.pptx",
        modifiedAt: "2026-08-03T22:14:53.763Z",
        sha256: "a".repeat(64),
        sizeBytes: 4_933_715,
        sourceLabel: "Google Drive · approved-teaser-id",
        webViewLink:
          "https://docs.google.com/presentation/d/approved-teaser-id/edit",
      },
      {
        availability: "manual-review",
        family: "commercial-proposal",
        sourceLabel: "Validation manuelle",
        warning:
          "La famille proposition commerciale n'effectue aucune copie automatique en V1.",
      },
    ],
  };
}
