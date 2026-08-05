import { describe, expect, it } from "vitest";

import { naiaDelegatedAgents } from "./agents";

describe("NAIA agent navigation", () => {
  it("routes every delegated agent to its operational module", () => {
    expect(
      Object.fromEntries(
        naiaDelegatedAgents.map((agent) => [agent.name, agent.route]),
      ),
    ).toEqual({
      Adam: "/meetings",
      Amine: "/settings",
      Idriss: "/naia/leads",
      Ilyas: "/projects",
      Lina: "/integrations",
      Maya: "/proposals",
      Nora: "/finance",
      Omar: "/automations",
      Rayan: "/automations",
      Salma: "/dashboard/leads",
      Yasmine: "/hr",
    });
  });
});
