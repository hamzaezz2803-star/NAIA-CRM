import { describe, expect, it } from "vitest";

import {
  meetingRecommendationSchema,
  meetingStructuredOutputSchema,
  recommendationEvidenceMatchesTranscript,
  recordingManifestSchema,
} from "./contracts";

describe("meeting intelligence contracts", () => {
  it("accepts a bounded recording manifest", () => {
    expect(
      recordingManifestSchema.parse({
        chunks: [
          {
            path: `${crypto.randomUUID()}/${crypto.randomUUID()}/${crypto.randomUUID()}/chunk-0000.webm`,
            sha256: "a".repeat(64),
            sizeBytes: 42,
          },
        ],
        mimeType: "audio/webm",
        originalFileName: "meeting.webm",
        totalBytes: 42,
      }),
    ).toBeTruthy();
  });

  it("rejects traversal and hidden size mismatches", () => {
    expect(() =>
      recordingManifestSchema.parse({
        chunks: [
          { path: "../../secret", sha256: "a".repeat(64), sizeBytes: 42 },
        ],
        mimeType: "audio/webm",
        originalFileName: "meeting.webm",
        totalBytes: 41,
      }),
    ).toThrow();
  });

  it("rejects duplicate or non-contiguous chunks", () => {
    const prefix = `${crypto.randomUUID()}/${crypto.randomUUID()}/${crypto.randomUUID()}`;
    expect(() =>
      recordingManifestSchema.parse({
        chunks: [
          {
            path: `${prefix}/chunk-0000.webm`,
            sha256: "a".repeat(64),
            sizeBytes: 20,
          },
          {
            path: `${prefix}/chunk-0002.webm`,
            sha256: "b".repeat(64),
            sizeBytes: 22,
          },
        ],
        mimeType: "audio/webm",
        originalFileName: "meeting.webm",
        totalBytes: 42,
      }),
    ).toThrow(/uniques, ordonnés et contigus/);
  });

  it("defaults optional structured sections without inventing data", () => {
    expect(
      meetingStructuredOutputSchema.parse({ executiveSummary: "Résumé" }),
    ).toMatchObject({
      actions: [],
      decisions: [],
      executiveSummary: "Résumé",
      topics: [],
    });
  });

  it("requires transcript-backed evidence for every recommended action", () => {
    const recommendation = meetingRecommendationSchema.parse({
      confidence: "high",
      detail: "Organiser le prochain échange.",
      evidence: [
        {
          quote: "on se reparle vendredi matin",
          timestamp: "00:12:30",
        },
      ],
      id: "calendar-follow-up-1",
      kind: "calendar-follow-up",
      title: "Planifier le suivi",
    });

    expect(
      recommendationEvidenceMatchesTranscript(
        recommendation,
        "[00:12:30] On se reparle vendredi matin pour la suite.",
      ),
    ).toBe(true);
    expect(
      recommendationEvidenceMatchesTranscript(
        recommendation,
        "[00:12:30] Nous n'avons fixé aucun prochain échange.",
      ),
    ).toBe(false);
    expect(
      recommendationEvidenceMatchesTranscript(
        meetingRecommendationSchema.parse({
          ...recommendation,
          evidence: [
            {
              quote: "le client valide la proposition",
              timestamp: "00:12:30",
            },
          ],
        }),
        "[00:12:30] Le client refuse la proposition.",
      ),
    ).toBe(false);
    expect(() =>
      meetingRecommendationSchema.parse({
        ...recommendation,
        evidence: [],
      }),
    ).toThrow();
  });
});
