import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  NaiaPageContextProvider,
  useNaiaPageContext,
} from "./naia-page-context";

function ContextProbe() {
  const { context, publish } = useNaiaPageContext();

  return (
    <>
      <button
        onClick={() =>
          publish({
            entity: { id: "lead-hps", kind: "lead", label: "HPS" },
            view: "kanban",
          })
        }
        type="button"
      >
        Select lead
      </button>
      <output data-testid="context">{JSON.stringify(context)}</output>
    </>
  );
}

describe("NaiaPageContextProvider", () => {
  it("drops selected entities and page details after route changes", () => {
    const view = render(
      <NaiaPageContextProvider pathname="/dashboard/leads">
        <ContextProbe />
      </NaiaPageContextProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Select lead" }));
    expect(screen.getByTestId("context").textContent).toContain("lead-hps");

    view.rerender(
      <NaiaPageContextProvider pathname="/meetings">
        <ContextProbe />
      </NaiaPageContextProvider>,
    );

    const context = JSON.parse(
      screen.getByTestId("context").textContent ?? "{}",
    ) as Record<string, unknown>;
    expect(context).toMatchObject({
      moduleId: "meetings",
      pathname: "/meetings",
      view: "calendar",
    });
    expect(context).not.toHaveProperty("entity");
  });
});
