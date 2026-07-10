import { describe, expect, it } from "vitest";

import {
  canonicalizeConversationText,
  extractLeadIdentity,
} from "./lead-understanding";

describe("NAIA lead understanding", () => {
  it("decodes Slack mailto markup before extracting contact details", () => {
    const command =
      "je viens d'avoir le contact d'un nouveau lead: Youssef Zaidi Directeur d'exploitation de Winxo <mailto:0661420960Yzaidi@winxo.com|0661420960 - Yzaidi@winxo.com>";

    expect(canonicalizeConversationText(command)).toContain(
      "0661420960 - Yzaidi@winxo.com",
    );
    expect(extractLeadIdentity(command)).toMatchObject({
      companyName: "Winxo",
      contactEmail: "Yzaidi@winxo.com",
      contactJobTitle: "Directeur d'exploitation",
      contactName: "Youssef Zaidi",
      contactPhone: "0661420960",
    });
  });

  it("normalizes Slack entities and removes user mentions without losing links", () => {
    expect(
      canonicalizeConversationText(
        "<@U123> contacte &amp; vérifie <https://winxo.com|le site Winxo>",
      ),
    ).toBe("contacte & vérifie le site Winxo (https://winxo.com)");
  });
});
