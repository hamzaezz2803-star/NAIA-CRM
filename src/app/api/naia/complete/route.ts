import {
  naiaSections,
  type NaiaSectionId,
} from "@/features/naia/operating-data";

type CompletePayload = {
  context?: unknown;
  prompt?: string;
  sectionId?: NaiaSectionId;
};

const sectionLabels: Record<NaiaSectionId, string> = {
  overview: "cockpit executif",
  leads: "lead intelligence",
  "cash-flow": "cash flow management",
  crm: "CRM assiste",
  projects: "delivery management",
  hr: "recrutement et capacite",
};

export async function POST(request: Request) {
  let payload: CompletePayload;

  try {
    payload = (await request.json()) as CompletePayload;
  } catch {
    return Response.json(
      {
        output: fallbackAnswer("overview", "Commande invalide."),
        mode: "local",
      },
      { status: 400 },
    );
  }

  const sectionId = parseSectionId(payload.sectionId);
  const prompt = parsePrompt(payload.prompt);
  const apiKey = process.env.GROQ_API_KEY ?? process.env.GROQ_KEY;

  if (!apiKey) {
    return Response.json({
      output: fallbackAnswer(sectionId, prompt),
      mode: "local",
    });
  }

  try {
    const groqResponse = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        body: JSON.stringify({
          max_tokens: 700,
          messages: [
            {
              content:
                "Tu es NAIA, l'agent operating-system interne de Qarizmi. Reponds en francais, concret, oriente produit et operations. Ne pretends pas avoir scrape LinkedIn ou envoye des emails: parle de signaux, brouillons et actions pretes a valider. Structure en 3 a 5 puces courtes.",
              role: "system",
            },
            {
              content: JSON.stringify({
                context: payload.context,
                module: sectionLabels[sectionId],
                prompt,
              }),
              role: "user",
            },
          ],
          model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
          temperature: 0.35,
        }),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      },
    );

    if (!groqResponse.ok) {
      return Response.json({
        output: fallbackAnswer(sectionId, prompt),
        mode: "local",
      });
    }

    const data = (await groqResponse.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const output = data.choices?.[0]?.message?.content?.trim();

    return Response.json({
      mode: output ? "groq" : "local",
      output: output || fallbackAnswer(sectionId, prompt),
    });
  } catch {
    return Response.json({
      output: fallbackAnswer(sectionId, prompt),
      mode: "local",
    });
  }
}

function fallbackAnswer(sectionId: NaiaSectionId, prompt: string) {
  const answers: Record<NaiaSectionId, string> = {
    overview:
      "Plan cockpit: ouvrir par la voix, analyser les modules, puis declencher CRM, cash, delivery et RH.\n\nPriorites: leads industrie, relances Medina/Sahara, risques septembre-octobre, annonce Full-stack Next.js.",
    leads:
      "Leads prioritaires: Atlas Process, Medina Health, Sahara Logistics.\n\nActions: qualifier CA/secteur, verifier proximite reseau, preparer une intro courte et proposer un diagnostic NAIA de 30 minutes.",
    "cash-flow":
      "Cash flow: octobre est le point de tension. Les sorties salaires/cloud depassent les encaissements si Medina et Sahara glissent.\n\nActions: relance Medina, jalon Sahara avant le 22/07, acompte accelere Atlas.",
    crm: "CRM: Meeting booked genere un pitch decideur. Propale a envoyer genere perimetre, planning, payment plan et next step.\n\nAction: deplacer Atlas puis Medina pour activer l'automatisation avec validation.",
    projects:
      "Projets a risque: Medina Health en septembre, Sahara Logistics en octobre, Atlas Process en aout si l'ERP glisse.\n\nActions: sponsor meeting, gel dependances data, validation hebdo des jalons.",
    hr: "Besoins RH: AI Delivery Lead en juillet, deux Full-stack Next.js en aout, QA automation en septembre.\n\nActions: publier l'annonce, envoyer le test CRM -> propale, organiser six entretiens.",
  };

  return `${answers[sectionId]}\n\nCommande recue: ${prompt}`;
}

function parseSectionId(sectionId: unknown): NaiaSectionId {
  if (
    typeof sectionId === "string" &&
    naiaSections.some((section) => section.id === sectionId)
  ) {
    return sectionId as NaiaSectionId;
  }

  return "overview";
}

function parsePrompt(prompt: unknown) {
  return typeof prompt === "string" && prompt.trim()
    ? prompt.trim().slice(0, 2000)
    : "Analyse les prochaines actions NAIA.";
}
