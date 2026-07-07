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

export type CrmLeadStatus = string;

export type CrmCategory = {
  id: string;
  organizationId: string;
  name: string;
  statusKey: string;
  color: string;
  position: number;
};

export type CrmCompanySummary = {
  id: string;
  organizationId: string;
  name: string;
  driveFolderUrl?: string;
};

export type CrmCompanyDetail = CrmCompanySummary & {
  industry?: string;
  website?: string;
  notes?: string;
};

export type CrmContactSummary = {
  id: string;
  organizationId: string;
  companyId?: string;
  name: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
  linkedinUrl?: string;
  tags?: CrmTag[];
};

export type CrmTag = {
  id: string;
  organizationId: string;
  name: string;
  color: string;
};

export type CrmLeadNote = {
  id: string;
  organizationId: string;
  leadId: string;
  content: string;
  createdByProfileId?: string;
  createdByName?: string;
  assignedToProfileId?: string;
  assignedToName?: string;
  createdAt: string;
  updatedAt: string;
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
  leadDate?: string;
  contactJobTitle?: string;
  contactLinkedinUrl?: string;
  assignedToProfileId?: string;
  assignedToName?: string;
  lastUpdatedByProfileId?: string;
  lastUpdatedByName?: string;
  lastUpdatedAt?: string;
  lastContactedAt?: string;
  driveFolderUrl?: string;
  companyName?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  tags?: CrmTag[];
  createdAt: string;
  updatedAt: string;
};

export type CrmLeadDraft = {
  companyName?: string;
  contactEmail?: string;
  contactName?: string;
  contactPhone?: string;
  leadDate?: string;
  nextAction?: string;
  notes?: string;
  source?: string;
  status: CrmLeadStatus;
  topic: string;
  tags?: string[];
};

export type CrmLeadFollowUp = {
  id: string;
  organizationId: string;
  leadId: string;
  contactedAt: string;
  comment?: string;
  createdByProfileId?: string;
  createdByName?: string;
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

export type CrmTaskStatus = "todo" | "in-progress" | "done";

export type CrmTask = {
  id: string;
  organizationId: string;
  title: string;
  description?: string;
  status: CrmTaskStatus;
  dueDate?: string;
  leadId?: string;
  leadTopic?: string;
  assignedToProfileId?: string;
  assignedToName?: string;
  tags?: CrmTag[];
  createdAt: string;
  updatedAt: string;
};
