import "server-only";

import { z } from "zod";
import { completeGroqJson } from "@/platform/ai/groq";
import { crmLeadStatuses, type CrmLeadStatus } from "./contracts";
import {
  inferLeadStatusFromNaturalText,
  resolveLeadDateFromNaturalText,
} from "./extraction";

const optionalText = z
  .string()
  .trim()
  .transform((value) => value || null)
  .nullable();
const extractedLeadSchema = z.object({
  companyName: optionalText,
  contactEmail: optionalText,
  contactJobTitle: optionalText,
  contactLinkedinUrl: optionalText,
  contactName: optionalText,
  contactPhone: optionalText,
  leadDate: optionalText,
  nextAction: optionalText,
  notes: optionalText,
  source: optionalText,
  status: z.enum(crmLeadStatuses).nullable(),
  tags: z.array(z.string().trim().min(1)).max(10).nullable(),
  topic: z.string().trim().min(1).max(240),
});

const nullableString = {
  anyOf: [{ type: "string" }, { type: "null" }],
};
const extractedLeadJsonSchema = {
  additionalProperties: false,
  properties: {
    companyName: nullableString,
    contactEmail: nullableString,
    contactJobTitle: nullableString,
    contactLinkedinUrl: nullableString,
    contactName: nullableString,
    contactPhone: nullableString,
    leadDate: nullableString,
    nextAction: nullableString,
    notes: nullableString,
    source: nullableString,
    status: {
      anyOf: [{ enum: crmLeadStatuses, type: "string" }, { type: "null" }],
    },
    tags: {
      anyOf: [
        { items: { type: "string" }, maxItems: 10, type: "array" },
        { type: "null" },
      ],
    },
    topic: { maxLength: 240, minLength: 1, type: "string" },
  },
  required: [
    "topic",
    "companyName",
    "contactName",
    "contactEmail",
    "contactJobTitle",
    "contactLinkedinUrl",
    "contactPhone",
    "source",
    "notes",
    "nextAction",
    "leadDate",
    "status",
    "tags",
  ],
  type: "object",
};

const followUpDraftSchema = z.object({
  email: z.string().trim().min(1).max(4000),
  whatsapp: z.string().trim().min(1).max(800),
});
const followUpDraftJsonSchema = {
  additionalProperties: false,
  properties: {
    email: { maxLength: 4000, minLength: 1, type: "string" },
    whatsapp: { maxLength: 800, minLength: 1, type: "string" },
  },
  required: ["email", "whatsapp"],
  type: "object",
};

export type ExtractedCrmLead = {
  companyName?: string;
  contactEmail?: string;
  contactJobTitle?: string;
  contactLinkedinUrl?: string;
  contactName?: string;
  contactPhone?: string;
  leadDate?: string;
  nextAction?: string;
  notes?: string;
  source?: string;
  status: CrmLeadStatus;
  tags?: string[];
  topic: string;
};

export async function extractCrmLeadWithGroq(
  text: string,
  now = new Date(),
): Promise<ExtractedCrmLead | null> {
  const dateContext = formatDateContext(now);
  const completion = await completeGroqJson({
    jsonSchema: extractedLeadJsonSchema,
    maxTokens: 700,
    messages: [
      {
        content: buildLeadExtractionPrompt(dateContext),
        role: "system",
      },
      { content: text, role: "user" },
    ],
    schema: extractedLeadSchema,
    schemaName: "crm_lead_extraction",
    temperature: 0.1,
  });
  if (!completion) return null;

  const extracted = completion.data;
  const leadDate = resolveLeadDateFromNaturalText({
    modelValue: extracted.leadDate,
    now,
    text,
  });
  const status =
    inferLeadStatusFromNaturalText({
      leadDate,
      nextAction: extracted.nextAction ?? undefined,
      notes: extracted.notes ?? undefined,
      status: extracted.status,
      text,
      topic: extracted.topic,
    }) ?? "lead-to-contact";

  return compactLead({
    ...extracted,
    leadDate,
    status,
  });
}

export async function generateCrmFollowUpWithGroq(lead: {
  companyName?: string;
  contactName?: string;
  nextAction?: string;
  notes?: string;
  topic: string;
}) {
  const context = [
    lead.contactName && `Contact: ${lead.contactName}`,
    lead.companyName && `Entreprise: ${lead.companyName}`,
    `Sujet: ${lead.topic}`,
    lead.notes && `Notes: ${lead.notes}`,
    lead.nextAction && `Prochaine action prévue: ${lead.nextAction}`,
  ]
    .filter(Boolean)
    .join("\n");

  const completion = await completeGroqJson({
    jsonSchema: followUpDraftJsonSchema,
    maxTokens: 800,
    messages: [
      {
        content:
          "Tu es l'assistant commercial de Qarizmi, cabinet d'IA au Maroc. Rédige en français des relances professionnelles, chaleureuses et factuelles. N'invente aucun échange, engagement, date ou information absent du contexte. Retourne uniquement le JSON demandé.",
        role: "system",
      },
      {
        content: `Génère une relance pour ce lead:\n${context}`,
        role: "user",
      },
    ],
    schema: followUpDraftSchema,
    schemaName: "crm_follow_up_draft",
    temperature: 0.45,
    workload: "fast",
  });

  return completion?.data ?? null;
}

function buildLeadExtractionPrompt(dateContext: string) {
  return `Tu es Salma, l'assistante CRM de Qarizmi. Extrais fidèlement un lead commercial depuis la commande, en conservant les noms, emails, téléphones, fonctions et entreprises exactement comme fournis.
Date de référence: ${dateContext}. Fuseau horaire: Africa/Casablanca.
Retourne uniquement un objet JSON avec exactement ces clés obligatoires: topic, companyName, contactName, contactEmail, contactJobTitle, contactLinkedinUrl, contactPhone, source, notes, nextAction, leadDate, status, tags. N'omets aucune clé; utilise null pour toute information absente.

Règles de statut:
- lead-to-contact: prospect identifié mais aucun échange n'a encore eu lieu.
- contacted: Ali ou l'équipe a parlé, appelé, contacté, rencontré ou échangé avec le prospect, sans rendez-vous fixé.
- to-follow-up: relance ou rappel commercial demandé, sans rendez-vous client fixé.
- meeting-booked: rendez-vous client, meeting, call, démo ou visio explicitement fixé ou planifié.
- proposal-sent: proposition, propale, offre ou devis envoyé, à envoyer ou à préparer.
- won: projet signé, gagné, accepté ou validé par le client.
- dead-end: prospect perdu, refus, arrêt ou absence d'intérêt.
Un rappel personnel comme "rappelle-moi d'envoyer la présentation" n'est jamais un meeting client. Si le texte dit que l'équipe vient de parler au prospect, n'utilise jamais lead-to-contact.

Règles de date:
- leadDate correspond uniquement à une date ou heure explicitement demandée dans la commande.
- interprète les dates relatives depuis la date de référence et retourne ISO 8601.
- n'invente jamais de date quand la commande n'en contient pas.

topic est un intitulé commercial court et concret. nextAction décrit la prochaine action explicite. notes contient uniquement le contexte utile qui n'a pas déjà son propre champ. Déduis au maximum 5 tags sectoriels ou technologiques pertinents.`;
}

function formatDateContext(now: Date) {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "full",
    timeZone: "Africa/Casablanca",
  }).format(now);
}

function compactLead(
  lead: Omit<z.infer<typeof extractedLeadSchema>, "leadDate" | "status"> & {
    leadDate?: string;
    status: CrmLeadStatus;
  },
): ExtractedCrmLead {
  return Object.fromEntries(
    Object.entries(lead).flatMap(([key, value]) => {
      if (value === null || value === undefined) return [];
      if (Array.isArray(value) && value.length === 0) return [];
      return [[key, value]];
    }),
  ) as ExtractedCrmLead;
}
