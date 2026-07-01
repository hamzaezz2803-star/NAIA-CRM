import type {
  CrmCompanySummary,
  CrmContactSummary,
  CrmLeadSummary,
} from "./contracts";

export const dummyCrmOrganizationId = "demo-qarizmi";

export const dummyCrmCompanies: CrmCompanySummary[] = [
  {
    id: "demo-company-atlas-process",
    name: "Atlas Process Industries",
    organizationId: dummyCrmOrganizationId,
  },
  {
    id: "demo-company-medina-health",
    name: "Medina Health Services",
    organizationId: dummyCrmOrganizationId,
  },
  {
    id: "demo-company-sahara-logistics",
    name: "Sahara Logistics Group",
    organizationId: dummyCrmOrganizationId,
  },
  {
    id: "demo-company-argan-retail",
    name: "Argan Retail Holding",
    organizationId: dummyCrmOrganizationId,
  },
  {
    id: "demo-company-nova-agri",
    name: "Nova Agri Export",
    organizationId: dummyCrmOrganizationId,
  },
  {
    id: "demo-company-casa-tech",
    name: "CasaTech Foundry",
    organizationId: dummyCrmOrganizationId,
  },
];

export const dummyCrmContacts: CrmContactSummary[] = [
  {
    id: "demo-contact-yassine-berrada",
    companyId: "demo-company-atlas-process",
    email: "yassine.berrada@example.com",
    jobTitle: "Directeur general",
    name: "Yassine Berrada",
    organizationId: dummyCrmOrganizationId,
    phone: "+212 600 000 101",
  },
  {
    id: "demo-contact-nawal-mansouri",
    companyId: "demo-company-medina-health",
    email: "nawal.mansouri@example.com",
    jobTitle: "CEO",
    name: "Nawal Mansouri",
    organizationId: dummyCrmOrganizationId,
    phone: "+212 600 000 102",
  },
  {
    id: "demo-contact-karim-tazi",
    companyId: "demo-company-sahara-logistics",
    email: "karim.tazi@example.com",
    jobTitle: "COO",
    name: "Karim Tazi",
    organizationId: dummyCrmOrganizationId,
    phone: "+212 600 000 103",
  },
  {
    id: "demo-contact-sara-amrani",
    companyId: "demo-company-argan-retail",
    email: "sara.amrani@example.com",
    jobTitle: "Founder",
    name: "Sara Amrani",
    organizationId: dummyCrmOrganizationId,
    phone: "+212 600 000 104",
  },
  {
    id: "demo-contact-hicham-elalami",
    companyId: "demo-company-nova-agri",
    email: "hicham.elalami@example.com",
    jobTitle: "Directeur export",
    name: "Hicham El Alami",
    organizationId: dummyCrmOrganizationId,
    phone: "+212 600 000 105",
  },
  {
    id: "demo-contact-ines-bennis",
    companyId: "demo-company-casa-tech",
    email: "ines.bennis@example.com",
    jobTitle: "Head of Operations",
    name: "Ines Bennis",
    organizationId: dummyCrmOrganizationId,
    phone: "+212 600 000 106",
  },
];

export const dummyCrmLeads: CrmLeadSummary[] = [
  {
    companyId: "demo-company-atlas-process",
    contactId: "demo-contact-yassine-berrada",
    createdAt: "2026-06-28T09:30:00.000Z",
    id: "demo-lead-atlas-process",
    leadDate: "2026-07-08T10:00:00.000Z",
    nextAction: "Preparer un pitch OS finance + CRM pour le comite ops.",
    notes:
      "CA estime 48-62 MDH. Expansion de deux lignes de production. Proximite 2e degre via Salma E.",
    organizationId: dummyCrmOrganizationId,
    source: "NAIA lead intelligence",
    status: "meeting-booked",
    topic: "Atlas Process Industries - cockpit finance + CRM",
    updatedAt: "2026-07-01T09:00:00.000Z",
  },
  {
    companyId: "demo-company-medina-health",
    contactId: "demo-contact-nawal-mansouri",
    createdAt: "2026-06-27T14:15:00.000Z",
    id: "demo-lead-medina-health",
    leadDate: "2026-07-10T11:30:00.000Z",
    nextAction: "Envoyer la propale RH automation avec test technique inclus.",
    notes:
      "Besoin RH automation apres recrutement d'un responsable transformation digitale.",
    organizationId: dummyCrmOrganizationId,
    source: "CRM Qarizmi",
    status: "proposal-sent",
    topic: "Medina Health Services - RH automation",
    updatedAt: "2026-07-01T09:05:00.000Z",
  },
  {
    companyId: "demo-company-sahara-logistics",
    contactId: "demo-contact-karim-tazi",
    createdAt: "2026-06-26T16:45:00.000Z",
    id: "demo-lead-sahara-logistics",
    leadDate: "2026-07-04T15:00:00.000Z",
    nextAction:
      "Relancer Karim avec diagnostic risques delivery + jalons cash.",
    notes:
      "Pression delivery et appels d'offres. Retard potentiel sur validation budget.",
    organizationId: dummyCrmOrganizationId,
    source: "LinkedIn proximity",
    status: "to-follow-up",
    topic: "Sahara Logistics Group - delivery control tower",
    updatedAt: "2026-07-01T09:10:00.000Z",
  },
  {
    companyId: "demo-company-argan-retail",
    contactId: "demo-contact-sara-amrani",
    createdAt: "2026-06-25T12:10:00.000Z",
    id: "demo-lead-argan-retail",
    leadDate: "2026-07-12T09:30:00.000Z",
    nextAction: "Verifier le connecteur recommande puis proposer un audit CRM.",
    notes: "Ouverture de magasins et migration CRM prevue. Proximite 3e degre.",
    organizationId: dummyCrmOrganizationId,
    source: "NAIA scraping",
    status: "contacted",
    topic: "Argan Retail Holding - migration CRM",
    updatedAt: "2026-07-01T09:15:00.000Z",
  },
  {
    companyId: "demo-company-nova-agri",
    contactId: "demo-contact-hicham-elalami",
    createdAt: "2026-06-24T10:20:00.000Z",
    id: "demo-lead-nova-agri",
    leadDate: "2026-07-18T14:00:00.000Z",
    nextAction: "Qualifier le besoin cash forecasting et flux export.",
    notes:
      "Croissance export et besoin de suivi paiements clients internationaux.",
    organizationId: dummyCrmOrganizationId,
    source: "Referral",
    status: "lead-to-contact",
    topic: "Nova Agri Export - cash forecasting",
    updatedAt: "2026-07-01T09:20:00.000Z",
  },
  {
    companyId: "demo-company-casa-tech",
    contactId: "demo-contact-ines-bennis",
    createdAt: "2026-06-22T08:50:00.000Z",
    id: "demo-lead-casa-tech",
    leadDate: "2026-07-02T16:30:00.000Z",
    nextAction: "Transformer le diagnostic en offre Qarizmi OS pilote.",
    notes:
      "Premier workshop concluant. Budget pilote valide sous reserve planning.",
    organizationId: dummyCrmOrganizationId,
    source: "Inbound",
    status: "won",
    topic: "CasaTech Foundry - Qarizmi OS pilote",
    updatedAt: "2026-07-01T09:25:00.000Z",
  },
];

const sessionDummyCrmLeads: CrmLeadSummary[] = [];

export function addDummyCrmLead(lead: CrmLeadSummary) {
  sessionDummyCrmLeads.unshift(lead);
}

export function getDummyCrmLeads() {
  return [...sessionDummyCrmLeads, ...dummyCrmLeads];
}
