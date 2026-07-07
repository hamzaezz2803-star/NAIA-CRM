import { describe, expect, it } from "vitest";

import { inferLeadStatusFromNaturalText } from "./extraction";

describe("CRM natural language status inference", () => {
  it("marks booked meetings as meeting-booked", () => {
    expect(
      inferLeadStatusFromNaturalText({
        text: "j'ai parlé à Fouzi Lekjaa de Royal Moroccan Football Federation, on a un premier meeting booké pour mardi 15h",
        leadDate: "2026-06-30T15:00:00",
      }),
    ).toBe("meeting-booked");
  });

  it("marks reminders as to-follow-up", () => {
    expect(
      inferLeadStatusFromNaturalText({
        text: "J'ai parlé à Karim de Atlas Telecom, à relancer vendredi.",
        leadDate: "2026-06-26",
      }),
    ).toBe("to-follow-up");
  });

  it("keeps dated explicit follow-ups out of meetings", () => {
    expect(
      inferLeadStatusFromNaturalText({
        leadDate: "2026-06-26",
        status: "to-follow-up",
        text: "Relancer Karim vendredi à 10h.",
      }),
    ).toBe("to-follow-up");
  });

  it("classifies validated appointments as meeting-booked, not won", () => {
    expect(
      inferLeadStatusFromNaturalText({
        leadDate: "2026-06-30T15:00:00",
        text: "RDV validé avec Fouzi mardi à 15h.",
      }),
    ).toBe("meeting-booked");
  });

  it("marks plain contact notes as contacted", () => {
    expect(
      inferLeadStatusFromNaturalText({
        text: "J'ai parlé à Nadia de Banque Centrale pour un sujet data.",
      }),
    ).toBe("contacted");
  });

  it("overrides a generic model status when the text says the prospect was contacted", () => {
    expect(
      inferLeadStatusFromNaturalText({
        status: "lead-to-contact",
        text: "J'ai contacté Abdeslam de HPS au sujet du LLM de Mistral.",
      }),
    ).toBe("contacted");
  });
});
