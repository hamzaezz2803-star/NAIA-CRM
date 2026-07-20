import { describe, expect, it } from "vitest";

import {
  inferLeadStatusFromNaturalText,
  resolveLeadDateFromNaturalText,
} from "./extraction";

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

  it("keeps a follow-up after a past call out of meetings", () => {
    expect(
      inferLeadStatusFromNaturalText({
        leadDate: "2026-07-17T10:00:00.000Z",
        text: "J'ai eu un appel avec Nadia, à relancer vendredi.",
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

  it("keeps a signed deal ahead of an earlier booked meeting", () => {
    expect(
      inferLeadStatusFromNaturalText({
        leadDate: "2026-06-30T15:00:00",
        status: "won",
        text: "RDV validé avec Nadia, contrat signé.",
      }),
    ).toBe("won");
  });

  it("keeps a sent proposal ahead of an earlier confirmed meeting", () => {
    expect(
      inferLeadStatusFromNaturalText({
        status: "proposal-sent",
        text: "Proposition envoyée après le meeting confirmé.",
      }),
    ).toBe("proposal-sent");
  });

  it("does not advance a meeting that only prepares a proposal", () => {
    expect(
      inferLeadStatusFromNaturalText({
        leadDate: "2026-06-30T15:00:00",
        text: "Meeting confirmé pour préparer la proposition.",
      }),
    ).toBe("meeting-booked");
  });

  it("keeps a dated proposal action ahead of a historical meeting", () => {
    expect(
      inferLeadStatusFromNaturalText({
        leadDate: "2026-07-21T10:00:00.000Z",
        text: "J'ai eu un meeting hier avec Nadia, envoyer la proposition demain à 10h.",
      }),
    ).toBe("proposal-sent");
  });

  it("keeps a proposal action after a historical meeting", () => {
    expect(
      inferLeadStatusFromNaturalText({
        leadDate: "2026-07-21T10:00:00.000Z",
        text: "Après le meeting, envoyer la proposition demain à 10h.",
      }),
    ).toBe("proposal-sent");
  });

  it("keeps a future meeting whose purpose is preparing a proposal", () => {
    expect(
      inferLeadStatusFromNaturalText({
        leadDate: "2026-07-21T10:00:00.000Z",
        text: "Meeting demain à 10h pour préparer la proposition.",
      }),
    ).toBe("meeting-booked");
  });

  it("does not treat a dated follow-up as a proposal task", () => {
    expect(
      inferLeadStatusFromNaturalText({
        leadDate: "2026-07-21T10:00:00.000Z",
        text: "Après le meeting, relance Nadia demain pour préparer la proposition.",
      }),
    ).toBe("to-follow-up");
  });

  it("overrides a model meeting status for a dated historical call", () => {
    expect(
      inferLeadStatusFromNaturalText({
        status: "meeting-booked",
        text: "Appel du 18/07 avec Nadia.",
      }),
    ).toBe("contacted");
  });

  it("marks plain contact notes as contacted", () => {
    expect(
      inferLeadStatusFromNaturalText({
        text: "J'ai parlé à Nadia de Banque Centrale pour un sujet data.",
      }),
    ).toBe("contacted");
  });

  it("prioritizes a proposal to prepare over the earlier contact signal", () => {
    expect(
      inferLeadStatusFromNaturalText({
        status: "contacted",
        text: "J'ai parlé à Nadia et il faut préparer une proposition.",
      }),
    ).toBe("proposal-sent");
  });

  it.each([
    "J'ai parlé à Nadia, ne pas envoyer de proposition.",
    "I talked with Nadia; don't send the proposal.",
  ])("does not advance negated proposal actions: %s", (text) => {
    expect(
      inferLeadStatusFromNaturalText({
        status: "contacted",
        text,
      }),
    ).toBe("contacted");
  });

  it.each([
    "La proposition n'a pas été envoyée.",
    "La proposition n'est pas encore envoyée.",
    "Proposition pas encore envoyée.",
    "The proposal was not sent.",
    "The proposal was not sent yet.",
  ])("does not treat unsent proposals as sent: %s", (text) => {
    expect(
      inferLeadStatusFromNaturalText({
        status: "contacted",
        text,
      }),
    ).toBe("contacted");
  });

  it("maps English contact language without relying on the model status", () => {
    expect(
      inferLeadStatusFromNaturalText({
        status: "lead-to-contact",
        text: "I talked with Karim from Atlas Telecom about an AI diagnostic.",
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

  it("does not let a model turn a personal reminder into a client meeting", () => {
    expect(
      inferLeadStatusFromNaturalText({
        leadDate: "2026-07-16T08:00:00.000Z",
        status: "meeting-booked",
        text: "J'ai parlé à Youssef et crée un meeting demain matin pour me rappeler de lui envoyer la présentation.",
      }),
    ).toBe("contacted");
  });
});

describe("CRM natural language date normalization", () => {
  const now = new Date("2026-07-15T12:00:00.000Z");

  it("calculates the next French weekday in Casablanca", () => {
    expect(
      resolveLeadDateFromNaturalText({
        modelValue: "2026-07-19T11:00:00",
        now,
        text: "Meeting planifié vendredi à 11h",
      }),
    ).toBe("2026-07-17T10:00:00.000Z");
  });

  it("calculates mixed English dates without translating the command", () => {
    expect(
      resolveLeadDateFromNaturalText({
        now,
        text: "Book the OCP meeting next Tuesday at 2pm",
      }),
    ).toBe("2026-07-21T13:00:00.000Z");
  });

  it("keeps a time written before an English relative date", () => {
    expect(
      resolveLeadDateFromNaturalText({
        now,
        text: "Book the OCP meeting at 2pm next Tuesday",
      }),
    ).toBe("2026-07-21T13:00:00.000Z");
  });

  it("recognizes an abbreviated English weekday without an on prefix", () => {
    expect(
      resolveLeadDateFromNaturalText({
        now,
        text: "Meeting with Nadia Fri at 10am",
      }),
    ).toBe("2026-07-17T09:00:00.000Z");
  });

  it.each([
    ["Mon", "2026-07-20T09:00:00.000Z"],
    ["Tue", "2026-07-21T09:00:00.000Z"],
    ["Wed", "2026-07-22T09:00:00.000Z"],
    ["Thu", "2026-07-16T09:00:00.000Z"],
    ["Fri", "2026-07-17T09:00:00.000Z"],
    ["Sat", "2026-07-18T09:00:00.000Z"],
    ["Sun", "2026-07-19T09:00:00.000Z"],
  ])("recognizes the %s weekday abbreviation", (weekday, expected) => {
    expect(
      resolveLeadDateFromNaturalText({
        now,
        text: `Meeting with Nadia on ${weekday} at 10am`,
      }),
    ).toBe(expected);
  });

  it("does not parse French possessives as Monday abbreviations", () => {
    expect(
      resolveLeadDateFromNaturalText({
        modelValue: "2026-07-20T10:00:00",
        now,
        text: "Contacte mon client.",
      }),
    ).toBeUndefined();
  });

  it("does not treat contact names that match months as dates", () => {
    expect(
      resolveLeadDateFromNaturalText({
        modelValue: "2027-05-01T10:00:00",
        now,
        text: "Meeting with May from Acme.",
      }),
    ).toBeUndefined();
    expect(
      resolveLeadDateFromNaturalText({
        modelValue: "2027-05-01T10:00:00",
        now,
        text: "RDV avec Mai de Qarizmi.",
      }),
    ).toBeUndefined();
  });

  it.each(["18 July", "18th July", "July 18", "July 18th", "Jul 18, 2026"])(
    "keeps the named date %s",
    (namedDate) => {
      expect(
        resolveLeadDateFromNaturalText({
          now,
          text: `Meeting with Nadia on ${namedDate} at 10am.`,
        }),
      ).toBe("2026-07-18T09:00:00.000Z");
    },
  );

  it("rejects invalid month-first dates", () => {
    expect(
      resolveLeadDateFromNaturalText({
        modelValue: "2026-03-03T10:00:00",
        now,
        text: "Meeting with Nadia on February 31 at 10am.",
      }),
    ).toBeUndefined();
  });

  it("uses tomorrow morning defaults in Casablanca", () => {
    expect(
      resolveLeadDateFromNaturalText({
        now,
        text: "Rappelle-moi demain matin",
      }),
    ).toBe("2026-07-16T08:00:00.000Z");
  });

  it("skips pasted contact labels before the actual planned action", () => {
    expect(
      resolveLeadDateFromNaturalText({
        now,
        text: "Contact: Karim. Relance demain à 10h.",
      }),
    ).toBe("2026-07-16T09:00:00.000Z");
    expect(
      resolveLeadDateFromNaturalText({
        now,
        text: "Contact principal: Karim. Relance demain à 10h.",
      }),
    ).toBe("2026-07-16T09:00:00.000Z");
    expect(
      resolveLeadDateFromNaturalText({
        now,
        text: "Statut: à contacter. Relance demain à 10h.",
      }),
    ).toBe("2026-07-16T09:00:00.000Z");
  });

  it("does not schedule a contextual future date without an action", () => {
    expect(
      resolveLeadDateFromNaturalText({
        modelValue: "2026-07-16T10:00:00",
        now,
        text: "J'ai parlé à Nadia; elle est en congé demain.",
      }),
    ).toBeUndefined();
  });

  it("keeps a relative date attached to a meeting", () => {
    expect(
      resolveLeadDateFromNaturalText({
        now,
        text: "RDV avec Nadia demain à 10h.",
      }),
    ).toBe("2026-07-16T09:00:00.000Z");
  });

  it("distinguishes the day after tomorrow from tomorrow", () => {
    expect(
      resolveLeadDateFromNaturalText({
        now,
        text: "Relance après-demain à 10h",
      }),
    ).toBe("2026-07-17T09:00:00.000Z");
  });

  it("understands bilingual relative day counts", () => {
    expect(
      resolveLeadDateFromNaturalText({
        now,
        text: "Schedule the follow-up dans deux jours à 4pm",
      }),
    ).toBe("2026-07-17T15:00:00.000Z");
  });

  it("keeps an explicit date without a time as an all-day date", () => {
    expect(
      resolveLeadDateFromNaturalText({
        now,
        text: "Relancer le 18/07",
      }),
    ).toBe("2026-07-18");
  });

  it("keeps an explicit ISO date instead of dropping it as hallucinated", () => {
    expect(
      resolveLeadDateFromNaturalText({
        now,
        text: "Meeting planifié le 2026-07-18 à 16h",
      }),
    ).toBe("2026-07-18T15:00:00.000Z");
  });

  it("accepts common French dates written with hyphens", () => {
    expect(
      resolveLeadDateFromNaturalText({
        now,
        text: "Relancer le 18-07-2026",
      }),
    ).toBe("2026-07-18");
  });

  it("preserves an explicitly zoned ISO timestamp", () => {
    expect(
      resolveLeadDateFromNaturalText({
        now,
        text: "Meeting planifié 2026-07-18T16:00:00Z",
      }),
    ).toBe("2026-07-18T16:00:00.000Z");
  });

  it("does not parse dotted phone numbers or model versions as dates", () => {
    expect(
      resolveLeadDateFromNaturalText({
        modelValue: "2026-12-06T09:00:00",
        now,
        text: "Appeler Nadia au 06.12.34.56.78 pour discuter de GPT-4.1.",
      }),
    ).toBeUndefined();
  });

  it("prioritizes a relative follow-up over an earlier context date", () => {
    expect(
      resolveLeadDateFromNaturalText({
        modelValue: "2026-07-16T09:00:00",
        now,
        text: "J'ai parlé le 10/07 à 16h, relance demain matin.",
      }),
    ).toBe("2026-07-16T08:00:00.000Z");
  });

  it("does not reuse a historical date for an undated follow-up", () => {
    expect(
      resolveLeadDateFromNaturalText({
        modelValue: "2027-07-10T16:00:00",
        now,
        text: "J'ai parlé le 10/07 à 16h, relance Nadia.",
      }),
    ).toBeUndefined();
  });

  it("does not let multiple historical dates enable an undated follow-up", () => {
    expect(
      resolveLeadDateFromNaturalText({
        modelValue: "2027-07-11T16:00:00",
        now,
        text: "J'ai parlé le 10/07 puis le 11/07, relance Nadia.",
      }),
    ).toBeUndefined();
  });

  it("does not reuse a historical relative weekday for an undated follow-up", () => {
    expect(
      resolveLeadDateFromNaturalText({
        modelValue: "2026-07-17T16:00:00",
        now,
        text: "J'ai parlé vendredi dernier à 16h, relance Nadia.",
      }),
    ).toBeUndefined();
  });

  it("does not reuse a date-first historical clause for a later follow-up", () => {
    expect(
      resolveLeadDateFromNaturalText({
        modelValue: "2027-07-10T16:00:00",
        now,
        text: "Le 10/07 à 16h, j'ai parlé avec Nadia; relance Nadia.",
      }),
    ).toBeUndefined();
  });

  it("selects the relative weekday attached to the planned follow-up", () => {
    expect(
      resolveLeadDateFromNaturalText({
        now,
        text: "J'ai parlé vendredi à 16h, relance Nadia lundi à 10h.",
      }),
    ).toBe("2026-07-20T09:00:00.000Z");
  });

  it("does not attach a contextual relative date from another clause", () => {
    expect(
      resolveLeadDateFromNaturalText({
        modelValue: null,
        now,
        text: "Relance Nadia; elle est en congé demain.",
      }),
    ).toBeUndefined();
    expect(
      resolveLeadDateFromNaturalText({
        modelValue: null,
        now,
        text: "Relance Nadia, car elle est en congé demain.",
      }),
    ).toBeUndefined();
  });

  it("uses the planned model date instead of an earlier context date", () => {
    expect(
      resolveLeadDateFromNaturalText({
        modelValue: "2026-07-22T10:00:00",
        now,
        text: "Nadia est en congé demain, relance-la la semaine prochaine.",
      }),
    ).toBe("2026-07-22T09:00:00.000Z");
  });

  it("keeps an immediately separated relative follow-up schedulable", () => {
    expect(
      resolveLeadDateFromNaturalText({
        now,
        text: "Relance Nadia; demain à 10h.",
      }),
    ).toBe("2026-07-16T09:00:00.000Z");
  });

  it("keeps a date-first follow-up instruction schedulable", () => {
    expect(
      resolveLeadDateFromNaturalText({
        now,
        text: "Le 18/07 à 10h, relance Nadia.",
      }),
    ).toBe("2026-07-18T09:00:00.000Z");
  });

  it("uses validated model output when multiple explicit dates are ambiguous", () => {
    expect(
      resolveLeadDateFromNaturalText({
        modelValue: "2026-07-18T10:00:00",
        now,
        text: "J'ai parlé le 10/07 à 16h, relance le 18/07 à 10h.",
      }),
    ).toBe("2026-07-18T09:00:00.000Z");
  });

  it("does not let a historical ISO timestamp override a relative action", () => {
    expect(
      resolveLeadDateFromNaturalText({
        now,
        text: "Historique 2026-07-10T16:00:00Z, relance demain matin.",
      }),
    ).toBe("2026-07-16T08:00:00.000Z");
  });

  it("does not schedule a single historical context date", () => {
    expect(
      resolveLeadDateFromNaturalText({
        modelValue: null,
        now,
        text: "J'ai parlé le 10/07 à 16h avec Nadia.",
      }),
    ).toBeUndefined();
  });

  it("does not schedule a historical weekday without an action cue", () => {
    expect(
      resolveLeadDateFromNaturalText({
        modelValue: "2026-07-17T16:00:00",
        now,
        text: "J'ai parlé vendredi à 16h avec Nadia.",
      }),
    ).toBeUndefined();
  });

  it("does not treat past contact verbs as planned actions", () => {
    expect(
      resolveLeadDateFromNaturalText({
        modelValue: "2027-07-10T16:00:00",
        now,
        text: "J'ai contacté Nadia le 10/07 à 16h.",
      }),
    ).toBeUndefined();
  });

  it("does not treat imperfect contact verbs as planned actions", () => {
    expect(
      resolveLeadDateFromNaturalText({
        modelValue: "2027-07-10T16:00:00",
        now,
        text: "J'avais contacté Nadia le 10/07 à 16h.",
      }),
    ).toBeUndefined();
  });

  it.each([
    "Je l'ai contacté le 10/07 à 16h.",
    "Je lui ai parlé le 10/07 à 16h.",
    "Je ne l'ai pas contacté le 10/07 à 16h.",
    "On l'avait contacté le 10/07 à 16h.",
    "Nous nous sommes parlé le 10/07 à 16h.",
    "Je viens de le contacter le 10/07 à 16h.",
  ])("does not schedule pronoun-assisted past contact: %s", (text) => {
    expect(
      resolveLeadDateFromNaturalText({
        modelValue: "2027-07-10T16:00:00",
        now,
        text,
      }),
    ).toBeUndefined();
  });

  it("keeps a pronoun-assisted future contact schedulable", () => {
    expect(
      resolveLeadDateFromNaturalText({
        now,
        text: "Je vais le contacter le 18/07 à 10h.",
      }),
    ).toBe("2026-07-18T09:00:00.000Z");
  });

  it("does not attach a date-first pronoun-assisted contact to a later action", () => {
    expect(
      resolveLeadDateFromNaturalText({
        modelValue: "2027-07-10T16:00:00",
        now,
        text: "Le 10/07 à 16h, je l'ai contacté; relance Nadia.",
      }),
    ).toBeUndefined();
  });

  it("does not treat past preparation as a planned weekday action", () => {
    expect(
      resolveLeadDateFromNaturalText({
        modelValue: "2026-07-17T10:00:00",
        now,
        text: "J'ai préparé la propale vendredi.",
      }),
    ).toBeUndefined();
  });

  it("keeps imperative contact actions schedulable", () => {
    expect(
      resolveLeadDateFromNaturalText({
        now,
        text: "Contacte Nadia le 18/07 à 10h.",
      }),
    ).toBe("2026-07-18T09:00:00.000Z");
  });

  it("schedules a dated RDV without requiring an extra booked word", () => {
    expect(
      resolveLeadDateFromNaturalText({
        now,
        text: "RDV avec Nadia le 18/07 à 10h.",
      }),
    ).toBe("2026-07-18T09:00:00.000Z");
  });

  it("schedules a French call noun with a relative date", () => {
    expect(
      resolveLeadDateFromNaturalText({
        now,
        text: "Appel avec Nadia demain à 10h.",
      }),
    ).toBe("2026-07-16T09:00:00.000Z");
  });

  it("does not schedule a historical French call noun", () => {
    expect(
      resolveLeadDateFromNaturalText({
        modelValue: "2026-07-17T16:00:00",
        now,
        text: "J'ai eu un appel avec Nadia vendredi à 16h.",
      }),
    ).toBeUndefined();
  });

  it("does not roll a dated historical call into the next year", () => {
    expect(
      resolveLeadDateFromNaturalText({
        modelValue: "2027-07-18T10:00:00",
        now: new Date("2026-07-20T12:00:00.000Z"),
        text: "Appel du 18/07 avec Nadia.",
      }),
    ).toBeUndefined();
  });

  it("keeps a newly booked dated RDV schedulable", () => {
    expect(
      resolveLeadDateFromNaturalText({
        now,
        text: "J'ai booké un RDV avec Nadia pour le 18/07 à 10h.",
      }),
    ).toBe("2026-07-18T09:00:00.000Z");
  });

  it("keeps a recently planned dated RDV schedulable", () => {
    expect(
      resolveLeadDateFromNaturalText({
        now,
        text: "J'ai programmé un RDV avec Nadia pour le 18/07 à 10h.",
      }),
    ).toBe("2026-07-18T09:00:00.000Z");
  });

  it("schedules an English dated meeting without a booked adjective", () => {
    expect(
      resolveLeadDateFromNaturalText({
        now,
        text: "Meeting with Nadia on 18/07 at 10am.",
      }),
    ).toBe("2026-07-18T09:00:00.000Z");
  });

  it("does not schedule a past RDV from a historical note", () => {
    expect(
      resolveLeadDateFromNaturalText({
        modelValue: "2027-07-10T10:00:00",
        now,
        text: "J'ai eu un RDV avec Nadia le 10/07 à 10h.",
      }),
    ).toBeUndefined();
  });

  it("does not schedule a past RDV described with an imperfect auxiliary", () => {
    expect(
      resolveLeadDateFromNaturalText({
        modelValue: "2027-07-10T10:00:00",
        now,
        text: "J'avais un RDV avec Nadia le 10/07 à 10h.",
      }),
    ).toBeUndefined();
  });

  it("does not schedule a previously planned RDV", () => {
    expect(
      resolveLeadDateFromNaturalText({
        modelValue: "2027-07-10T10:00:00",
        now,
        text: "J'avais programmé un RDV avec Nadia le 10/07 à 10h.",
      }),
    ).toBeUndefined();
  });

  it("does not schedule a past meeting written in English", () => {
    expect(
      resolveLeadDateFromNaturalText({
        modelValue: "2027-07-10T10:00:00",
        now,
        text: "We had a meeting with Nadia on 10/07 at 10am.",
      }),
    ).toBeUndefined();
  });

  it("does not schedule a dated meeting recap", () => {
    expect(
      resolveLeadDateFromNaturalText({
        modelValue: "2027-07-10T10:00:00",
        now,
        text: "Compte-rendu du RDV avec Nadia le 10/07 à 10h.",
      }),
    ).toBeUndefined();
  });

  it("does not retain the date of a cancelled meeting", () => {
    expect(
      resolveLeadDateFromNaturalText({
        modelValue: "2026-07-18T10:00:00",
        now,
        text: "RDV annulé avec Nadia le 18/07 à 10h.",
      }),
    ).toBeUndefined();
  });

  it("does not retain a relative date for a cancelled meeting", () => {
    expect(
      resolveLeadDateFromNaturalText({
        modelValue: "2026-07-16T10:00:00",
        now,
        text: "RDV annulé avec Nadia demain à 10h.",
      }),
    ).toBeUndefined();
  });

  it.each([
    "Ne relance pas Nadia demain.",
    "Pas relancer Nadia demain.",
    "Annule la relance demain.",
    "Sans relancer Nadia demain.",
    "Do not follow up with Nadia tomorrow.",
    "Don't follow up with Nadia tomorrow.",
    "Ne programme pas un RDV demain.",
    "Do not schedule a call tomorrow.",
  ])("does not schedule a suppressed action: %s", (text) => {
    expect(
      resolveLeadDateFromNaturalText({
        modelValue: "2026-07-16T10:00:00",
        now,
        text,
      }),
    ).toBeUndefined();
  });

  it("keeps a new follow-up after a separate cancellation schedulable", () => {
    expect(
      resolveLeadDateFromNaturalText({
        now,
        text: "Annule le meeting, puis relance Nadia demain à 10h.",
      }),
    ).toBe("2026-07-16T09:00:00.000Z");
  });

  it("does not schedule a historical mention of today", () => {
    expect(
      resolveLeadDateFromNaturalText({
        modelValue: "2026-07-15T10:00:00",
        now,
        text: "J'ai parlé aujourd'hui à 10h avec Nadia.",
      }),
    ).toBeUndefined();
  });

  it("uses the time attached to the planned action, not earlier context", () => {
    expect(
      resolveLeadDateFromNaturalText({
        now,
        text: "J'ai parlé à 16h avec Nadia, relancer le 18/07 à 10h.",
      }),
    ).toBe("2026-07-18T09:00:00.000Z");
  });

  it("does not reuse a time from historical context after the planned clause", () => {
    expect(
      resolveLeadDateFromNaturalText({
        now,
        text: "Demain matin, relance Nadia. J'ai parlé à 16h hier.",
      }),
    ).toBe("2026-07-16T08:00:00.000Z");
    expect(
      resolveLeadDateFromNaturalText({
        now,
        text: "Demain matin, relance Nadia, j'ai parlé à 16h hier.",
      }),
    ).toBe("2026-07-16T08:00:00.000Z");
  });

  it("rejects model dates when the user never mentioned a date", () => {
    expect(
      resolveLeadDateFromNaturalText({
        modelValue: "2026-07-18T11:00:00",
        now,
        text: "J'ai parlé à Nadia de Banque Centrale pour un sujet data.",
      }),
    ).toBeUndefined();
  });

  it.each([
    "2026-02-31",
    "2026-02-31T10:00:00",
    "2026-02-31T10:00:00Z",
    "2026-07-18T25:00:00",
  ])("rejects an invalid model-proposed date: %s", (modelValue) => {
    expect(
      resolveLeadDateFromNaturalText({
        modelValue,
        now,
        text: "Relance Nadia la semaine prochaine.",
      }),
    ).toBeUndefined();
  });
});
