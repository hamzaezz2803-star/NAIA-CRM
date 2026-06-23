import type { PlatformModuleId } from "@/platform/core/modules";

export type ApprovalRequestStatus =
  | "draft"
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled";

export type ExternalActionKind =
  | "send-email"
  | "send-whatsapp"
  | "create-proposal"
  | "send-contract"
  | "send-invoice"
  | "send-offer";

export type ApprovalRequest = {
  id: string;
  organizationId: string;
  sourceModule: PlatformModuleId;
  actionKind: ExternalActionKind;
  status: ApprovalRequestStatus;
  title: string;
  draftPayload: Record<string, unknown>;
  requestedByProfileId: string;
  reviewedByProfileId?: string;
  reviewedAt?: string;
};

export type WorkflowRunStatus =
  | "queued"
  | "running"
  | "waiting-for-approval"
  | "completed"
  | "failed"
  | "cancelled";

export type WorkflowRun = {
  id: string;
  organizationId: string;
  sourceModule: PlatformModuleId | "platform";
  workflowKey: string;
  status: WorkflowRunStatus;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  createdAt: string;
  updatedAt: string;
};
