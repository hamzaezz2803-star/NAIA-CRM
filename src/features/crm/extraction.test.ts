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

  it("marks plain contact notes as contacted", () => {
    expect(
      inferLeadStatusFromNaturalText({
        text: "J'ai parlé à Nadia de Banque Centrale pour un sujet data.",
      }),
    ).toBe("contacted");
  });
});
