import { describe, expect, it } from "vitest";

import type { CrmLeadSummary } from "@/features/crm/contracts";

import {
  classifyNaiaAgent,
  inferCrmStatus,
  orchestrateNaiaCommand,
} from "./orchestrator";

const crmLeads: CrmLeadSummary[] = [
  {
    createdAt: "2026-07-01T10:00:00.000Z",
    id: "lead-atlas",
    notes: "CEO/CFO interested in operating system",
    organizationId: "org-1",
    status: "lead-to-contact",
    topic: "Atlas Process - OS finance et CRM",
    updatedAt: "2026-07-01T10:00:00.000Z",
  },
];

const crmPipelineLeads: CrmLeadSummary[] = [
  ...crmLeads,
  {
    companyName: "Beta",
    contactName: "Achraf",
    createdAt: "2026-07-02T10:00:00.000Z",
    id: "lead-beta",
    notes: "Meeting confirmé",
    organizationId: "org-1",
    status: "meeting-booked",
    topic: "Projet commercial avec l'entreprise Beta",
    updatedAt: "2026-07-02T10:00:00.000Z",
  },
  {
    companyName: "HPS",
    contactName: "Abdeslam",
    createdAt: "2026-07-03T10:00:00.000Z",
    id: "lead-hps",
    notes: "Contact initial",
    organizationId: "org-1",
    status: "contacted",
    topic: "HPS - LLM local",
    updatedAt: "2026-07-03T10:00:00.000Z",
  },
];

describe("NAIA orchestrator", () => {
  it.each([
    ["quels sont mes meetings de la semaine ?", "meetings"],
    ["vérifie mes disponibilités demain", "meetings"],
    ["et les meetings de mon calendar hors CRM ?", "meetings"],
    ["as-tu accès à mes mails ?", "integrations"],
    ["quels sont mes mails urgents ?", "integrations"],
    ["peux-tu consulter mon gmail ?", "integrations"],
  ] as const)("routes personal data question %s to %s", (command, agentId) => {
    const result = orchestrateNaiaCommand({ command, crmLeads });

    expect(result.agent.id).toBe(agentId);
    expect(
      result.actions.some((action) => action.kind.startsWith("crm.")),
    ).toBe(false);
  });

  it("keeps identity questions with NAIA instead of inventing a capability answer", () => {
    const result = orchestrateNaiaCommand({
      command: "qui suis-je ?",
      crmLeads,
    });

    expect(result.agent.id).toBe("naia");
    expect(result.actions).toHaveLength(0);
    expect(result.responseType).toBe("handoff");
  });

  it("answers a natural capability question with punctuation and hyphens", () => {
    const result = orchestrateNaiaCommand({
      command: "que sais-tu faire ?",
      crmLeads,
    });

    expect(result.agent.id).toBe("naia");
    expect(result.actions).toHaveLength(0);
    expect(result.response).toContain("CRM");
    expect(result.response).toContain("Google Calendar");
    expect(result.response).not.toContain("Je garde l'orchestration");
  });

  it("keeps English capability questions above domain keywords", () => {
    const result = orchestrateNaiaCommand({
      command: "What can you do for my CRM, cash and project teams?",
      crmLeads,
    });

    expect(result.agent.id).toBe("naia");
    expect(result.actions).toHaveLength(0);
    expect(result.response).toContain("CRM");
  });

  it("understands project risk questions in English", () => {
    const result = orchestrateNaiaCommand({
      command:
        "Which projects are most at risk this quarter, and what is blocking them?",
      crmLeads,
    });

    expect(result.agent.id).toBe("projects");
    expect(result.actions).toHaveLength(0);
    expect(result.response).toContain("Données simulées NAIA");
    expect(result.response).toContain("projets sont en risque");
  });

  it("prioritizes staffing over a generic delivery keyword", () => {
    const result = orchestrateNaiaCommand({
      command:
        "Do we have enough capacity for delivery, ou quels rôles faut-il recruter d'abord ?",
      crmLeads,
    });

    expect(result.agent.id).toBe("hr");
    expect(result.actions).toHaveLength(0);
    expect(result.response).toContain("Données simulées NAIA");
    expect(result.response).toContain("besoins ouverts");
  });

  it("answers CRM definition questions without drafting a write", () => {
    const result = orchestrateNaiaCommand({
      command:
        "Explique-moi la différence entre un lead contacté et un meeting booké, et quand utiliser chaque statut.",
      crmLeads,
    });

    expect(result.agent.id).toBe("crm");
    expect(result.actions).toHaveLength(0);
    expect(result.responseType).toBe("answer");
    expect(result.response).toContain("un échange réel a eu lieu");
    expect(result.response).toContain("une date et une heure");
  });

  it("still accepts an explicit CRM write phrased as a question", () => {
    const result = orchestrateNaiaCommand({
      command: "Peux-tu créer un lead pour HPS avec Abdeslam ?",
      crmLeads,
    });

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({ kind: "crm.createLead" });
  });

  it("accepts a hyphenated status-change request phrased as a question", () => {
    const result = orchestrateNaiaCommand({
      command: "Peux-tu passer Atlas en meeting booked ?",
      crmLeads,
    });

    expect(result.actions).toHaveLength(2);
    expect(result.actions[0]).toMatchObject({
      kind: "crm.updateLeadStatus",
      payload: { leadId: "lead-atlas", status: "meeting-booked" },
    });
  });

  it("routes CRM update commands to Salma with a validated action draft", () => {
    const result = orchestrateNaiaCommand({
      command: "NAIA passe Atlas en meeting booked et prepare le pitch",
      crmLeads,
    });

    expect(result.agent.id).toBe("crm");
    expect(result.agent.name).toBe("Salma");
    expect(result.actions).toHaveLength(2);
    expect(result.actions[0]).toMatchObject({
      approvalRequired: true,
      kind: "crm.updateLeadStatus",
      payload: {
        leadId: "lead-atlas",
        status: "meeting-booked",
      },
    });
    expect(result.actions[1]).toMatchObject({
      agentId: "proposals",
      approvalRequired: true,
      kind: "pitch.generateDraft",
      payload: {
        leadId: "lead-atlas",
      },
    });
  });

  it("routes explicit pitch generation to Maya with a CRM-backed lead", () => {
    const result = orchestrateNaiaCommand({
      command: "Maya prépare le pitch pour HPS",
      crmLeads: [
        ...crmLeads,
        {
          companyName: "HPS",
          contactName: "Abdeslam El-Alawi",
          createdAt: "2026-07-02T10:00:00.000Z",
          id: "lead-hps",
          notes: "Besoin IA autour du LLM de Mistral.",
          organizationId: "org-1",
          status: "meeting-booked",
          topic: "HPS - LLM local",
          updatedAt: "2026-07-02T10:00:00.000Z",
        },
      ],
    });

    expect(result.agent.id).toBe("proposals");
    expect(result.agent.name).toBe("Maya");
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({
      approvalRequired: true,
      kind: "pitch.generateDraft",
      payload: {
        clientName: "HPS",
        leadId: "lead-hps",
      },
    });
  });

  it("creates a CRM lead action from a definite French lead command", () => {
    const result = orchestrateNaiaCommand({
      command:
        "j'ai parlé à Yassine Mseffer de Delassus, il veut organiser un meeting vendredi 10 juillet à 11h, dis à Selma de créer le lead dans le CRM",
      crmLeads,
    });

    expect(result.agent.id).toBe("crm");
    expect(result.actions).toHaveLength(2);
    expect(result.actions[0]).toMatchObject({
      approvalRequired: true,
      kind: "crm.createLead",
      payload: {
        companyName: "Delassus",
        contactName: "Yassine Mseffer",
        status: "meeting-booked",
      },
    });
    expect(result.actions[1]).toMatchObject({
      agentId: "meetings",
      approvalRequired: true,
      kind: "calendar.scheduleMeeting",
    });
  });

  it("treats prospect meetings as CRM opportunities even without explicit lead wording", () => {
    const result = orchestrateNaiaCommand({
      command:
        "J'ai parlé à Achraf Hakimi de fédération de foot et il faut faire un meeting vendredi à 11h",
      crmLeads,
    });

    expect(result.agent.id).toBe("crm");
    expect(result.agent.name).toBe("Salma");
    expect(result.actions).toHaveLength(2);
    expect(result.actions[0]).toMatchObject({
      approvalRequired: true,
      kind: "crm.createLead",
      payload: {
        companyName: "fédération de foot",
        contactName: "Achraf Hakimi",
        status: "meeting-booked",
      },
    });
    expect(result.actions[1]).toMatchObject({
      agentId: "meetings",
      approvalRequired: true,
      kind: "calendar.scheduleMeeting",
    });
  });

  it("keeps CRM in charge when Groq tries to route a prospect meeting to Adam", () => {
    const result = orchestrateNaiaCommand({
      agentIdOverride: "meetings",
      command:
        "J'ai parlé à Achraf Hakimi de fédération de foot et il faut faire un meeting vendredi à 11h",
      crmLeads,
      responseOverride: "Adam prend le relais meeting.",
    });

    expect(result.agent.id).toBe("crm");
    expect(result.response).toContain("Salma");
    expect(
      result.actions.some((action) => action.kind === "crm.createLead"),
    ).toBe(true);
  });

  it("answers CRM lead count questions without proposing pipeline mutations", () => {
    const result = orchestrateNaiaCommand({
      command: "on a combien de lead dans le CRM ?",
      crmLeads: crmPipelineLeads,
    });

    expect(result.agent.id).toBe("crm");
    expect(result.actions).toHaveLength(0);
    expect(result.response).toContain("3 leads");
    expect(result.response).toContain("À contacter: 1");
    expect(result.response).toContain("Meeting fixé: 1");
  });

  it("answers leads-to-contact questions without interpreting them as Contacté status updates", () => {
    const result = orchestrateNaiaCommand({
      command: "combien de lead dans la pipe à contacter ?",
      crmLeads: crmPipelineLeads,
    });

    expect(result.agent.id).toBe("crm");
    expect(result.actions).toHaveLength(0);
    expect(result.response).toContain("1 lead à contacter");
    expect(result.response).toContain("Atlas Process");
  });

  it("creates a CRM lead card from a French commercial conversation without meeting wording", () => {
    const result = orchestrateNaiaCommand({
      command:
        "J'ai parlé à Abdaslam Alaoui Ismaili de HPS. Ils ont déjà travaillé avec Mistral IA et veulent collaborer avec nous sur des cas d'utilisation de leur LLM local.",
      crmLeads,
    });

    expect(result.agent.id).toBe("crm");
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({
      approvalRequired: true,
      kind: "crm.createLead",
      payload: {
        companyName: "HPS",
        contactName: "Abdaslam Alaoui Ismaili",
        status: "contacted",
      },
    });
  });

  it("routes contact capture with a presentation reminder to Salma instead of Maya", () => {
    const result = orchestrateNaiaCommand({
      command:
        "je viens d'avoir le contact d'un nouveau lead: Youssef Zaidi Directeur d'exploitation de Winxo 0661420960 - Yzaidi@winxo.com, je lui ai parlé au tel il me demander lui envoyer une présentation avant de se rencontrer - crée un meeting demain matin pour me rappeler de lui envoyer la présentation",
      crmLeads,
    });

    expect(result.agent.id).toBe("crm");
    expect(result.agent.name).toBe("Salma");
    expect(result.actions).toHaveLength(2);
    expect(result.actions[0]).toMatchObject({
      approvalRequired: true,
      kind: "crm.createLead",
      payload: {
        companyName: "Winxo",
        contactEmail: "Yzaidi@winxo.com",
        contactName: "Youssef Zaidi",
        contactPhone: "0661420960",
        nextAction: "Envoyer la présentation avant le rendez-vous",
        status: "contacted",
      },
    });
    expect(result.actions[1]).toMatchObject({
      agentId: "meetings",
      approvalRequired: true,
      kind: "calendar.createReminder",
      payload: {
        scheduledAt: expect.stringMatching(/T09:00:00$/),
        timeZone: "Africa/Casablanca",
        title: "Envoyer la présentation",
      },
    });
  });

  it("still creates a CRM lead card when Whisper returns the same opportunity in English", () => {
    const result = orchestrateNaiaCommand({
      command:
        "I talked to Abdaslam Alaoui Ismaili from HPS. They have already partnered with Mistralia. They would collaborate with us to develop use cases on their local LLM.",
      crmLeads,
    });

    expect(result.agent.id).toBe("crm");
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({
      approvalRequired: true,
      kind: "crm.createLead",
      payload: {
        companyName: "HPS",
        contactName: "Abdaslam Alaoui Ismaili",
        status: "contacted",
      },
    });
  });

  it("creates a new lead card instead of updating an unrelated lead for contacted prospect notes", () => {
    const result = orchestrateNaiaCommand({
      command:
        "J'ai contacté Abdeslam El-Alawi de HPS. Il m'a dit qu'il avait déjà entamé les discussions avec Mistral hier, mais qu'il voudrait qu'on l'aide à développer des solutions sur le LLM de Mistral.",
      crmLeads: [
        ...crmLeads,
        {
          createdAt: "2026-07-02T10:00:00.000Z",
          id: "lead-unrelated-crm",
          notes: "Prospects CRM automatisation commerciale",
          organizationId: "org-1",
          status: "lead-to-contact",
          topic:
            "mettre en place un CRM avec un agent IA pour automatiser la gestion des prospects",
          updatedAt: "2026-07-02T10:00:00.000Z",
        },
      ],
    });

    expect(result.agent.id).toBe("crm");
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({
      approvalRequired: true,
      kind: "crm.createLead",
      payload: {
        companyName: "HPS",
        contactName: "Abdeslam El-Alawi",
        status: "contacted",
      },
    });
  });

  it("routes feature requests to the developer agent", () => {
    expect(
      classifyNaiaAgent("NAIA demande a Codex d'ajouter une nouvelle feature"),
    ).toBe("developer");
    expect(classifyNaiaAgent("Rayan prepare une nouvelle feature CRM")).toBe(
      "developer",
    );
  });

  it("answers cash-flow analysis questions with operating data instead of a generic handoff", () => {
    const result = orchestrateNaiaCommand({
      command: "analyse mes CFs et dis moi les risques principaux",
      crmLeads,
    });

    expect(result.agent.id).toBe("finance");
    expect(result.actions).toHaveLength(0);
    expect(result.response).toContain("Données simulées NAIA");
    expect(result.response).toContain("Oct.");
    expect(result.response).toContain("Medina Health");
    expect(result.response).toContain("Sahara Logistics");
    expect(result.response).not.toContain("Nora prend le relais finance");
  });

  it("prepares a Gmail read action for workspace email requests", () => {
    const result = orchestrateNaiaCommand({
      command: "NAIA lis mes emails Gmail non lus et resume les urgences",
      crmLeads,
    });

    expect(result.agent.id).toBe("integrations");
    expect(result.agent.name).toBe("Lina");
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({
      agentId: "integrations",
      approvalRequired: true,
      kind: "google.gmail.listMessages",
      payload: {
        maxResults: 10,
        unreadOnly: true,
      },
    });
    expect(result.response).toContain("Gmail");
  });

  it("prepares a Calendar read action for agenda checks", () => {
    const result = orchestrateNaiaCommand({
      command: "NAIA check mon agenda demain matin",
      crmLeads,
    });

    expect(result.agent.id).toBe("meetings");
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({
      agentId: "meetings",
      approvalRequired: true,
      kind: "google.calendar.listEvents",
      payload: {
        daysAhead: 1,
      },
    });
  });

  it("prepares a Slack message action without sending it directly", () => {
    const result = orchestrateNaiaCommand({
      command:
        "NAIA prepare un message Slack pour Nabil: la demo client est prete",
      crmLeads,
    });

    expect(result.agent.id).toBe("integrations");
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({
      agentId: "integrations",
      approvalRequired: true,
      kind: "slack.prepareMessage",
      payload: {
        text: "la demo client est prete",
      },
    });
  });

  it("can use an LLM-selected agent while keeping deterministic action drafts", () => {
    const result = orchestrateNaiaCommand({
      agentIdOverride: "hr",
      command: "NAIA de quoi ai-je besoin pour staffer les projets signes ?",
      confidenceOverride: 0.91,
      crmLeads,
      responseOverride: "Yasmine prend le relais RH.",
    });

    expect(result.agent.id).toBe("hr");
    expect(result.agent.name).toBe("Yasmine");
    expect(result.confidence).toBe(0.91);
    expect(result.response).toBe("Yasmine prend le relais RH.");
    expect(result.actions).toHaveLength(0);
  });

  it("infers CRM pipeline statuses from French commands", () => {
    expect(inferCrmStatus("mets Atlas en propale")).toBe("proposal-sent");
    expect(inferCrmStatus("relance Medina demain")).toBe("to-follow-up");
    expect(inferCrmStatus("j'ai parlé à Nadia de Banque Centrale")).toBe(
      "contacted",
    );
    expect(inferCrmStatus("j'ai contacté Abdeslam de HPS")).toBe("contacted");
    expect(inferCrmStatus("client signe")).toBe("won");
  });

  it("creates a generateFollowUpDraft action when the user asks to write/draft a relance", () => {
    const result = orchestrateNaiaCommand({
      command:
        "rédiger le message mail et whatsapp de relance pour monsieur ahmed de l'entreprise exemple",
      crmLeads: [
        ...crmLeads,
        {
          createdAt: "2026-07-01T10:00:00.000Z",
          id: "lead-ahmed",
          notes: "Contact: Ahmed\nEntreprise: exemple",
          organizationId: "org-1",
          status: "lead-to-contact",
          topic: "Projet IA pour exemple",
          updatedAt: "2026-07-01T10:00:00.000Z",
          contactName: "Ahmed",
          companyName: "exemple",
        },
      ],
    });

    expect(result.agent.id).toBe("crm");
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({
      approvalRequired: true,
      kind: "crm.generateFollowUpDraft",
      payload: {
        leadId: "lead-ahmed",
        contactName: "Ahmed",
        companyName: "exemple",
      },
    });
  });
});
