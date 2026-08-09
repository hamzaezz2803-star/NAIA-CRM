import type { CrmLeadSummary } from "@/features/crm/contracts";

export const mayaTemplateFamilies = ["pitch", "commercial-proposal"] as const;

export type MayaTemplateFamily = (typeof mayaTemplateFamilies)[number];

export const mayaTemplateAvailabilities = [
  "ready",
  "manual-review",
  "unavailable",
] as const;

export type MayaTemplateAvailability =
  (typeof mayaTemplateAvailabilities)[number];

export type MayaTemplateSource = {
  availability: MayaTemplateAvailability;
  driveFileId?: string;
  family: MayaTemplateFamily;
  fileName?: string;
  modifiedAt?: string;
  sizeBytes?: number;
  sourceLabel: string;
  warning?: string;
  webViewLink?: string;
};

export const mayaDeckKinds = [
  "generic",
  "example",
  "maya_draft",
  "nabil_final",
] as const;

export type MayaDeckKind = (typeof mayaDeckKinds)[number];

export const mayaSlideSections = [
  "presentation",
  "offre",
  "credentials",
  "diagnostic",
  "appendix",
  "closing",
  "unknown",
] as const;

export type MayaSlideSection = (typeof mayaSlideSections)[number];

export const mayaBriefStatuses = [
  "needs-context",
  "ready",
  "generating",
  "draft-ready",
  "final-uploaded",
  "learned",
] as const;

export type MayaBriefStatus = (typeof mayaBriefStatuses)[number];

export const mayaGenerationStatuses = [
  "queued",
  "generating",
  "draft-ready",
  "failed",
  "final-uploaded",
  "learned",
] as const;

export type MayaGenerationStatus = (typeof mayaGenerationStatuses)[number];

export const mayaLearningEventTypes = [
  "slide_removed",
  "slide_added",
  "slide_reordered",
  "copy_changed",
  "use_case_changed",
  "credential_selection_changed",
] as const;

export type MayaLearningEventType = (typeof mayaLearningEventTypes)[number];

export type MayaClientType =
  "single-company" | "group" | "holding" | "portfolio";

export type MayaDeckFile = {
  fileName: string;
  filePath: string;
  kind: MayaDeckKind;
  modifiedAt: Date;
  sizeBytes: number;
};

export type MayaExtractedSlide = {
  section: MayaSlideSection;
  slideNumber: number;
  sourceHash: string;
  text: string;
  title: string;
};

export type MayaIndexedDeck = MayaDeckFile & {
  clientName?: string;
  residueWarnings: string[];
  slides: MayaExtractedSlide[];
};

export type MayaBrief = {
  clientName: string;
  clientType: MayaClientType;
  contactName?: string;
  contactRole?: string;
  crmContext: string;
  industry?: string;
  leadId?: string;
  meetingObjective?: string;
  missingQuestions: string[];
  sourceLead?: CrmLeadSummary;
  status: MayaBriefStatus;
  websiteUrl?: string;
};

export type MayaDeckPlan = {
  brief: MayaBrief;
  closingSlideNumbers: number[];
  credentialSlideNumbers: number[];
  diagnosticOutline: string[];
  genericDeckFileName: string;
  omittedSlideNumbers: number[];
  planner?: {
    generatedAt: string;
    model: string;
    provider: "deterministic" | "openai";
    rationale?: string;
  };
  presentationSlideNumbers: number[];
  residueWarnings: string[];
  useCaseBullets?: string[];
};

export type MayaLearningEvent = {
  afterExcerpt?: string;
  beforeExcerpt?: string;
  eventType: MayaLearningEventType;
  summary: string;
  weight: number;
};

export const DEFAULT_MAYA_SOURCE_FOLDER =
  "/Users/ali/Library/CloudStorage/GoogleDrive-ali@qarizmi.com/Drive partagés/Qarizmi/Client development/Pitch/Pitch generator";

export const DEFAULT_MAYA_OUTPUT_ROOT =
  "/Users/ali/Library/CloudStorage/GoogleDrive-ali@qarizmi.com/Drive partagés/Qarizmi/Client development/Pitch";
