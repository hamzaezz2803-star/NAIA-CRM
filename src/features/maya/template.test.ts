import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";

import type { MayaDeckKind } from "./contracts";
import {
  assertMayaPptxMatchesExpectedHash,
  assertMayaPptxSafeForClone,
  classifyMayaTemplateFamily,
  scanMayaPptxResidues,
  selectLatestMayaTemplateCandidate,
  hashMayaPptx,
  normalizeMayaExpectedSha256,
  type MayaTemplateCandidate,
} from "./template";

describe("Maya template selection", () => {
  it("classifies pitch and commercial-proposal families separately", () => {
    expect(
      classifyMayaTemplateFamily(
        "Qarizmi_Introduction_Service as a software_Teaser.pptx",
      ),
    ).toBe("pitch");
    expect(
      classifyMayaTemplateFamily(
        "Qarizmi_TGCC_Proposition Commerciale v5.pptx",
      ),
    ).toBe("commercial-proposal");
  });

  it("selects the latest eligible pitch but honors the approved Drive id", () => {
    const teaser = makeCandidate({
      driveFileId: "approved-teaser",
      fileName: "Qarizmi_Introduction_Service as a software_Teaser.pptx",
      modifiedAt: "2026-08-03T22:14:53.763Z",
    });
    const laterClientDeck = makeCandidate({
      driveFileId: "unapproved-client",
      fileName: "Qarizmi_Introduction_Service as a software_Client.pptx",
      modifiedAt: "2026-08-04T22:14:53.763Z",
    });

    expect(
      selectLatestMayaTemplateCandidate({
        approvedDriveFileId: "approved-teaser",
        candidates: [teaser, laterClientDeck],
        family: "pitch",
      })?.driveFileId,
    ).toBe("approved-teaser");
    expect(
      selectLatestMayaTemplateCandidate({
        candidates: [teaser, laterClientDeck],
        family: "pitch",
      })?.driveFileId,
    ).toBe("unapproved-client");
  });

  it("never treats Generic, draft, final or _old files as safe templates", () => {
    const rejectedNames = [
      "Qarizmi_Introduction_Service as a software_Generic.pptx",
      "Qarizmi_Introduction_Service as a software_HPS_vDraft.pptx",
      "Qarizmi_Introduction_Service as a software_HPS_vF.pptx",
      "_old/Qarizmi_Introduction_Service as a software_Teaser.pptx",
    ];

    const selected = selectLatestMayaTemplateCandidate({
      candidates: rejectedNames.map((fileName, index) =>
        makeCandidate({
          driveFileId: `deck-${index}`,
          fileName: fileName.split("/").at(-1)!,
          filePath: fileName,
          modifiedAt: "2026-08-04T22:14:53.763Z",
        }),
      ),
      family: "pitch",
    });

    expect(selected).toBeNull();
  });
});

describe("Maya OOXML residue scanning", () => {
  it("scans slides, notes, comments, properties and relationships", () => {
    const pptx = makePptx({
      "docProps/core.xml": "<cp:keywords>Orange</cp:keywords>",
      "ppt/comments/comment1.xml": "<p:cm><a:t>AKWA</a:t></p:cm>",
      "ppt/media/TGCC-logo.png": "binary-placeholder",
      "ppt/notesSlides/notesSlide1.xml": "<a:t>Econosol</a:t>",
      "ppt/slides/_rels/slide1.xml.rels":
        '<Relationship Target="https://jll.example/client"/>',
      "ppt/slides/slide1.xml": "<a:t>TG</a:t><a:t>CC</a:t>",
    });

    expect(scanMayaPptxResidues(pptx)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ token: "AKWA" }),
        expect.objectContaining({ token: "Econosol" }),
        expect.objectContaining({ token: "JLL" }),
        expect.objectContaining({ token: "Orange" }),
        expect.objectContaining({ token: "TGCC" }),
      ]),
    );
    expect(() => assertMayaPptxSafeForClone(pptx)).toThrow(
      "résidus client interdits",
    );
  });

  it("accepts a client-neutral OOXML package", () => {
    const pptx = makePptx({
      "ppt/notesSlides/notesSlide1.xml": "<a:t>Page 1</a:t>",
      "ppt/slides/slide1.xml": "<a:t>Présentation Qarizmi AI and Data</a:t>",
    });

    expect(scanMayaPptxResidues(pptx)).toEqual([]);
    expect(() => assertMayaPptxSafeForClone(pptx)).not.toThrow();
  });

  it("rejects a non-PPTX payload before copying", () => {
    expect(() => assertMayaPptxSafeForClone(Buffer.from("not a pptx"))).toThrow(
      "PPTX OOXML valide",
    );
  });
});

describe("Maya immutable template identity", () => {
  it("normalizes and verifies an audited SHA-256", () => {
    const pptx = makePptx({
      "ppt/slides/slide1.xml": "<a:t>Présentation Qarizmi</a:t>",
    });
    const sha256 = hashMayaPptx(pptx);

    expect(normalizeMayaExpectedSha256(` ${sha256.toUpperCase()} `)).toBe(
      sha256,
    );
    expect(assertMayaPptxMatchesExpectedHash(pptx, sha256)).toBe(sha256);
    expect(() =>
      assertMayaPptxMatchesExpectedHash(pptx, "0".repeat(64)),
    ).toThrow("SHA-256 audité");
    expect(normalizeMayaExpectedSha256("not-a-hash")).toBeNull();
  });
});

function makeCandidate({
  driveFileId,
  fileName,
  filePath = `/templates/${fileName}`,
  modifiedAt,
}: {
  driveFileId: string;
  fileName: string;
  filePath?: string;
  modifiedAt: string;
}): MayaTemplateCandidate {
  return {
    driveFileId,
    fileName,
    filePath,
    kind: "example" satisfies MayaDeckKind,
    modifiedAt: new Date(modifiedAt),
    sizeBytes: 1_000,
  };
}

function makePptx(parts: Record<string, string>) {
  const zip: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8("<Types/>"),
    "ppt/presentation.xml": strToU8("<p:presentation/>"),
  };

  for (const [partName, content] of Object.entries(parts)) {
    zip[partName] = strToU8(content);
  }

  return Buffer.from(zipSync(zip, { level: 6 }));
}
