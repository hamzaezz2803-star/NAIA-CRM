import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CashGroup, formatShortMad } from "./naia-experience";

describe("CashGroup", () => {
  it("renders compact revenue totals and lets users collapse the detail rows", () => {
    render(
      <CashGroup
        detailRows={[
          {
            label: "Atlas Industries",
            monthlyCash: [420000, 0],
            note: "Encaissement confirmé",
          },
        ]}
        label="Clients (revenus)"
        monthlyCash={[1200000, 0]}
        tone="revenue"
      />,
    );

    const summary = screen.getByText("Clients (revenus)").closest("summary");
    const details = summary?.closest("details");

    expect(details).toHaveAttribute("open");
    expect(screen.getByText("Atlas Industries")).toBeInTheDocument();
    expect(screen.getByText("Encaissement confirmé")).toBeInTheDocument();
    expect(
      screen.getByText(formatShortMad(1200000).replaceAll("\u00a0", " ")),
    ).toBeInTheDocument();

    fireEvent.click(summary as HTMLElement);

    expect(details).not.toHaveAttribute("open");
  });

  it("displays cash outflows with a negative compact amount", () => {
    render(
      <CashGroup
        detailRows={[
          {
            label: "Infrastructure",
            monthlyCash: [125000],
          },
        ]}
        label="OPEX"
        monthlyCash={[125000]}
        tone="cost"
      />,
    );

    expect(
      screen.getAllByText(formatShortMad(-125000).replaceAll("\u00a0", " ")),
    ).toHaveLength(2);
  });
});
