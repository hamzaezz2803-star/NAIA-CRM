import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { extractCrmLeadWithGroq, generateCrmFollowUpWithGroq } from "./ai";

function groqResponse(payload: Record<string, unknown>) {
  return {
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(payload) } }],
    }),
    ok: true,
  };
}

describe("CRM Groq intelligence", () => {
  beforeEach(() => {
    vi.stubEnv("GROQ_API_KEY", "test-key");
    vi.stubEnv("GROQ_MODEL", "");
    vi.stubEnv("GROQ_ORCHESTRATOR_MODEL", "");
    vi.stubEnv("GROQ_STRUCTURED_FALLBACK_MODEL", "");
    vi.stubEnv("GROQ_FAST_MODEL", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("preserves contact fields while correcting date and CRM status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      groqResponse({
        companyName: "Atlas Telecom",
        contactEmail: "karim@example.test",
        contactJobTitle: "Directeur des opérations",
        contactLinkedinUrl: null,
        contactName: "Karim Saidi",
        contactPhone: "+212600000001",
        leadDate: "2026-07-19T11:00:00",
        nextAction: "Préparer le meeting",
        notes: "Premier échange téléphonique.",
        source: "Appel téléphonique",
        status: "contacted",
        tags: ["Télécom", "IA", "B2B"],
        topic: "Diagnostic IA Atlas Telecom",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const lead = await extractCrmLeadWithGroq(
      "J'ai parlé à Karim Saidi, Directeur des opérations d'Atlas Telecom, karim@example.test, +212600000001. Meeting planifié vendredi à 11h.",
      new Date("2026-07-15T12:00:00.000Z"),
    );

    expect(lead).toMatchObject({
      companyName: "Atlas Telecom",
      contactEmail: "karim@example.test",
      contactJobTitle: "Directeur des opérations",
      contactName: "Karim Saidi",
      contactPhone: "+212600000001",
      leadDate: "2026-07-17T10:00:00.000Z",
      status: "meeting-booked",
    });
  });

  it("drops hallucinated dates when the command contains no date", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        groqResponse({
          companyName: "Atlas Telecom",
          contactEmail: null,
          contactJobTitle: null,
          contactLinkedinUrl: null,
          contactName: "Karim Saidi",
          contactPhone: null,
          leadDate: "2026-07-19T11:00:00",
          nextAction: null,
          notes: null,
          source: "Appel",
          status: "lead-to-contact",
          tags: ["Télécom"],
          topic: "Atlas Telecom",
        }),
      ),
    );

    const lead = await extractCrmLeadWithGroq(
      "J'ai parlé à Karim Saidi d'Atlas Telecom.",
      new Date("2026-07-15T12:00:00.000Z"),
    );

    expect(lead?.leadDate).toBeUndefined();
    expect(lead?.status).toBe("contacted");
  });

  it("normalizes blank optional fields instead of rejecting the lead", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        groqResponse({
          companyName: "",
          contactEmail: "",
          contactJobTitle: "",
          contactLinkedinUrl: "",
          contactName: "Nadia",
          contactPhone: "",
          leadDate: "",
          nextAction: "",
          notes: "",
          source: "",
          status: null,
          tags: [],
          topic: "Prospect Nadia",
        }),
      ),
    );

    const lead = await extractCrmLeadWithGroq("Nouveau prospect Nadia.");

    expect(lead).toEqual({
      contactName: "Nadia",
      status: "lead-to-contact",
      topic: "Prospect Nadia",
    });
  });

  it("falls back to strict extraction when Qwen omits required keys", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        groqResponse({
          notes: "Lead rencontré au salon.",
          topic: "Atlas Telecom",
        }),
      )
      .mockResolvedValueOnce(
        groqResponse({
          companyName: "Atlas Telecom",
          contactEmail: "karim@example.test",
          contactJobTitle: null,
          contactLinkedinUrl: null,
          contactName: "Karim Saidi",
          contactPhone: "+212600000001",
          leadDate: null,
          nextAction: null,
          notes: "Lead rencontré au salon.",
          source: "Salon",
          status: "contacted",
          tags: ["Télécom"],
          topic: "Atlas Telecom",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const lead = await extractCrmLeadWithGroq(
      "Karim Saidi de Atlas Telecom, karim@example.test, +212600000001, rencontré au salon.",
    );

    expect(lead).toMatchObject({
      companyName: "Atlas Telecom",
      contactEmail: "karim@example.test",
      contactName: "Karim Saidi",
      contactPhone: "+212600000001",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const primaryRequest = JSON.parse(
      fetchMock.mock.calls[0][1].body as string,
    );
    const fallbackRequest = JSON.parse(
      fetchMock.mock.calls[1][1].body as string,
    );
    expect(primaryRequest.model).toBe("qwen/qwen3.6-27b");
    expect(fallbackRequest.model).toBe("openai/gpt-oss-120b");
    expect(fallbackRequest.response_format.type).toBe("json_schema");
  });

  it("uses the fast model profile for bounded follow-up drafts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      groqResponse({
        email: "Bonjour Karim, je reviens vers vous au sujet du diagnostic IA.",
        whatsapp:
          "Bonjour Karim, disponible pour avancer sur le diagnostic IA ?",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const draft = await generateCrmFollowUpWithGroq({
      companyName: "Atlas Telecom",
      contactName: "Karim Saidi",
      topic: "Diagnostic IA",
    });

    expect(draft?.email).toContain("Bonjour Karim");
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request.model).toBe("openai/gpt-oss-20b");
    expect(request.response_format.type).toBe("json_schema");
  });
});
