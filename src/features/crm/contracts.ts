import type { DomainEvent } from "@/platform/core/events";

export const crmLeadStatuses = [
  "lead-to-contact",
  "contacted",
  "to-follow-up",
  "meeting-booked",
  "proposal-sent",
  "won",
  "dead-end",
] as const;

export type CrmLeadStatus = (typeof crmLeadStatuses)[number];

export type CrmCompanySummary = {
  id: string;
  organizationId: string;
  name: string;
  driveFolderUrl?: string;
};

export type CrmContactSummary = {
  id: string;
  organizationId: string;
  companyId?: string;
  name: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
};

export type CrmLeadSummary = {
  id: string;
  organizationId: string;
  companyId?: string;
  contactId?: string;
  topic: string;
  source?: string;
  status: CrmLeadStatus;
  notes?: string;
  nextAction?: string;
  nextActionDate?: string;
  leadDate?: string;
  createdAt: string;
  updatedAt: string;
};

export type CrmDomainEventType =
  | "crm.company.created"
  | "crm.contact.created"
  | "crm.lead.created"
  | "crm.lead.updated"
  | "crm.lead.status_changed"
  | "crm.task.created"
  | "crm.document.attached";

export type CrmDomainEvent = DomainEvent & {
  module: "crm";
  eventType: CrmDomainEventType;
};
