import { z } from "zod";

export const MEETING_RECORDINGS_BUCKET = "meeting-recordings";
export const MAX_RECORDING_CHUNKS = 500;
export const MAX_RECORDING_BYTES = 1024 * 1024 * 1024;

export const meetingRecommendationKinds = [
  "crm-note",
  "crm-next-action",
  "crm-status",
  "task",
  "calendar-follow-up",
  "proposal-input",
] as const;

const transcriptTimestampPattern =
  /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:[.,]\d{1,3})?$/;

export const evidenceSchema = z.object({
  quote: z.string().trim().max(800).default(""),
  timestamp: z.string().trim().regex(transcriptTimestampPattern).optional(),
});

const actionEvidenceSchema = z.object({
  quote: z.string().trim().min(1).max(800),
  timestamp: z.string().trim().regex(transcriptTimestampPattern),
});

export const meetingRecommendationSchema = z.object({
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
  detail: z.string().trim().max(4000).default(""),
  dueDate: z.string().datetime({ offset: true }).optional(),
  evidence: z.array(actionEvidenceSchema).min(1).max(8),
  id: z.string().trim().min(1).max(100),
  kind: z.enum(meetingRecommendationKinds),
  suggestedStatus: z.string().trim().max(80).optional(),
  title: z.string().trim().min(1).max(300),
});

const analysisItemSchema = z.object({
  detail: z.string().trim().max(5000).default(""),
  evidence: z.array(evidenceSchema).max(12).default([]),
  title: z.string().trim().min(1).max(300),
});

export const meetingStructuredOutputSchema = z.object({
  actions: z.array(meetingRecommendationSchema).max(40).default([]),
  constraints: z.array(analysisItemSchema).max(30).default([]),
  decisions: z.array(analysisItemSchema).max(30).default([]),
  executiveSummary: z.string().trim().max(10_000).default(""),
  needs: z.array(analysisItemSchema).max(40).default([]),
  openQuestions: z.array(analysisItemSchema).max(30).default([]),
  participants: z
    .array(
      z.object({
        confidence: z.enum(["high", "medium", "low"]).default("medium"),
        name: z.string().trim().min(1).max(200),
        organization: z.string().trim().max(200).optional(),
        role: z.string().trim().max(200).optional(),
      }),
    )
    .max(40)
    .default([]),
  topics: z.array(analysisItemSchema).max(50).default([]),
});

export const recordingManifestSchema = z
  .object({
    chunks: z
      .array(
        z.object({
          path: z
            .string()
            .trim()
            .min(1)
            .max(600)
            .regex(
              /^[a-f0-9-]+\/[a-f0-9-]+\/[a-f0-9-]+\/chunk-\d{4}\.[a-z0-9]+$/i,
            ),
          sha256: z.string().regex(/^[a-f0-9]{64}$/i),
          sizeBytes: z
            .number()
            .int()
            .positive()
            .max(25 * 1024 * 1024),
        }),
      )
      .min(1)
      .max(MAX_RECORDING_CHUNKS),
    durationSeconds: z
      .number()
      .nonnegative()
      .max(24 * 60 * 60)
      .optional(),
    mimeType: z.string().trim().min(1).max(120),
    originalFileName: z.string().trim().min(1).max(240),
    totalBytes: z.number().int().positive().max(MAX_RECORDING_BYTES),
  })
  .superRefine((manifest, context) => {
    const calculatedBytes = manifest.chunks.reduce(
      (total, chunk) => total + chunk.sizeBytes,
      0,
    );
    if (calculatedBytes !== manifest.totalBytes) {
      context.addIssue({
        code: "custom",
        message: "La taille totale ne correspond pas aux chunks uploadés.",
        path: ["totalBytes"],
      });
    }
    const chunkIndexes = manifest.chunks.map((chunk) =>
      Number(chunk.path.match(/chunk-(\d{4})\./i)?.[1] ?? -1),
    );
    const expectedIndexes = manifest.chunks.map((_, index) => index);
    if (
      new Set(manifest.chunks.map((chunk) => chunk.path)).size !==
        manifest.chunks.length ||
      chunkIndexes.some(
        (chunkIndex, index) => chunkIndex !== expectedIndexes[index],
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Les chunks doivent être uniques, ordonnés et contigus.",
        path: ["chunks"],
      });
    }
  });

export const workerProgressSchema = z.object({
  leaseToken: z.string().uuid(),
  message: z.string().trim().min(1).max(500),
  progress: z.number().int().min(1).max(99),
  stage: z.enum(["claimed", "transcribing", "analyzing", "uploading"]),
  workerId: z.string().trim().min(1).max(120),
});

export const workerCompletionSchema = z.object({
  engine: z
    .object({
      claudeMode: z.string().trim().max(80).optional(),
      claudeModel: z.string().trim().max(160).optional(),
      whisperBackend: z.string().trim().max(80).optional(),
      whisperModel: z.string().trim().max(160).optional(),
    })
    .default({}),
  notesMarkdown: z.string().min(20).max(300_000),
  leaseToken: z.string().uuid(),
  structured: meetingStructuredOutputSchema,
  transcriptSrt: z.string().min(20).max(1_500_000),
  transcriptText: z.string().min(20).max(1_500_000),
  warnings: z.array(z.string().trim().max(1000)).max(30).default([]),
  workerId: z.string().trim().min(1).max(120),
});

export type MeetingStructuredOutput = z.infer<
  typeof meetingStructuredOutputSchema
>;
export type MeetingRecommendation = z.infer<typeof meetingRecommendationSchema>;

export function recommendationEvidenceMatchesTranscript(
  recommendation: MeetingRecommendation,
  transcript: string,
) {
  const transcriptByTimestamp = new Map<string, string[]>();
  for (const line of transcript.split(/\r?\n/)) {
    const match = line
      .trim()
      .match(
        /^\[((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:[.,]\d{1,3})?\]\s*(.*)$/,
      );
    if (!match) continue;
    const timestamp = match[1].slice(0, 8);
    transcriptByTimestamp.set(timestamp, [
      ...(transcriptByTimestamp.get(timestamp) ?? []),
      match[2],
    ]);
  }

  return recommendation.evidence.every((evidence) => {
    const spoken = (
      transcriptByTimestamp.get(evidence.timestamp.slice(0, 8)) ?? []
    ).join(" ");
    const normalizedQuote = normalizedEvidenceText(evidence.quote);
    const normalizedSpoken = normalizedEvidenceText(spoken);
    return (
      Boolean(normalizedQuote) && normalizedSpoken.includes(normalizedQuote)
    );
  });
}

function normalizedEvidenceText(value: string) {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .match(/[a-z0-9]+/g) ?? []
  ).join(" ");
}

export type RecordingManifest = z.infer<typeof recordingManifestSchema>;

export type MeetingJobSummary = {
  error?: string;
  id: string;
  message: string;
  progress: number;
  status: string;
  updatedAt: string;
  workerId?: string;
};

export type MeetingOutputSummary = {
  appliedRecommendationIds: string[];
  approvalWarnings: string[];
  driveFolderUrl?: string;
  id: string;
  notesMarkdown: string;
  reviewRevision: number;
  reviewStatus: "draft" | "reviewing" | "approved";
  reviewedNotesMarkdown?: string;
  structured: MeetingStructuredOutput;
  transcriptAvailable: boolean;
  version: number;
  warnings: string[];
};

export type MeetingTranscript = {
  transcriptSrt: string;
  transcriptText: string;
};

export type MeetingWorkspace = {
  companyName?: string;
  contactName?: string;
  id: string;
  job?: MeetingJobSummary;
  leadId?: string;
  organizationId: string;
  output?: MeetingOutputSummary;
  startsAt?: string;
  status: string;
  supportFileName?: string;
  title: string;
};

export type MeetingIntelligenceState = {
  configured: boolean;
  error?: string;
  meetings: MeetingWorkspace[];
  organizationId?: string;
};
