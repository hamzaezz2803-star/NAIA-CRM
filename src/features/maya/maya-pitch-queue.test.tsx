import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { MayaPitchQueueResult } from "./actions";
import { MayaPitchQueue } from "./maya-pitch-queue";

vi.mock("./actions", () => ({
  generateMayaPitchDraftFormAction: vi.fn(),
}));

describe("MayaPitchQueue", () => {
  it("renders editable context questions before draft generation", () => {
    render(
      <MayaPitchQueue
        result={{
          authorized: true,
          genericDeckFileName: "Qarizmi_Generic.pptx",
          items: [
            {
              clientName: "HPS",
              contactName: "Abdeslam El-Alawi",
              contextDefaults: {
                contactName: "Abdeslam El-Alawi",
                meetingObjective:
                  "Préparer un pitch de diagnostic IA pour le prochain meeting.",
              },
              leadId: "lead-1",
              leadStatus: "meeting-booked",
              missingQuestions: ["Quel est le site web exact du client ?"],
              status: "needs-context",
            },
          ],
          sourceFolder: "Google Drive folder source-folder",
          sourceWarnings: [],
        }}
      />,
    );

    expect(
      screen.getByLabelText("Site web exact du client"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Site web exact du client")).toBeRequired();
    expect(
      screen.getByLabelText("Contexte additionnel pour Maya"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /Compléter et générer le draft PPTX/,
      }),
    ).toBeInTheDocument();
  });

  it("shows a direct Drive link when a draft already exists", () => {
    const result: MayaPitchQueueResult = {
      authorized: true,
      genericDeckFileName: "Qarizmi_Generic.pptx",
      items: [
        {
          clientName: "HPS",
          contactName: "Abdeslam El-Alawi",
          contextDefaults: {
            contactName: "Abdeslam El-Alawi",
            websiteUrl: "https://hps-worldwide.com",
          },
          draftFileName:
            "20260708_Qarizmi_Introduction_Service as a software_HPS_vDraft.pptx",
          draftFilePath: "gdrive:draft-file-id",
          leadId: "lead-1",
          leadStatus: "meeting-booked",
          missingQuestions: [],
          status: "draft-ready",
        },
      ],
      sourceFolder: "Google Drive folder source-folder",
      sourceWarnings: [],
    };

    render(<MayaPitchQueue result={result} />);

    expect(
      screen.getByRole("link", {
        name: /Ouvrir le draft dans Drive/,
      }),
    ).toHaveAttribute(
      "href",
      "https://drive.google.com/file/d/draft-file-id/view",
    );
  });
});
