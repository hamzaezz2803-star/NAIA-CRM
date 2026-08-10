import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createFollowUpAction: vi.fn(),
  fetchLeadFollowUpsAction: vi.fn(),
  fetchLeadsAction: vi.fn(),
}));

vi.mock("@/features/crm/actions", () => ({
  createFollowUpAction: mocks.createFollowUpAction,
  fetchLeadFollowUpsAction: mocks.fetchLeadFollowUpsAction,
  fetchLeadsAction: mocks.fetchLeadsAction,
}));

import FollowUpsPage from "./page";

describe("FollowUpsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchLeadsAction.mockResolvedValue([
      {
        accessScope: "organization",
        companyName: "Acme Canonique",
        contactName: "Alice Canonique",
        createdAt: "2026-08-01T09:00:00.000Z",
        id: "lead-canonical",
        notes: "Entreprise: Entreprise obsolète\nContact: Contact obsolète",
        organizationId: "org-1",
        status: "to-follow-up",
        topic: "Ancien nom de projet",
        updatedAt: "2026-08-01T09:00:00.000Z",
      },
      {
        accessScope: "organization",
        createdAt: "2026-08-01T09:00:00.000Z",
        id: "lead-legacy",
        notes: "Entreprise: Société Héritée\nContact: Zoé Héritée",
        organizationId: "org-1",
        status: "contacted",
        topic: "Sujet historique",
        updatedAt: "2026-08-01T09:00:00.000Z",
      },
    ]);
  });

  it("prefers canonical identity, falls back to legacy notes, and filters without accents", async () => {
    render(<FollowUpsPage />);

    expect(await screen.findByText("Acme Canonique")).toBeInTheDocument();
    expect(screen.getByText("Alice Canonique")).toBeInTheDocument();
    expect(screen.getByText("Société Héritée")).toBeInTheDocument();
    expect(screen.getByText("Zoé Héritée")).toBeInTheDocument();
    expect(screen.queryByText("Entreprise obsolète")).not.toBeInTheDocument();
    expect(screen.queryByText("Contact obsolète")).not.toBeInTheDocument();

    const searchbox = screen.getByRole("searchbox", {
      name: "Rechercher une entreprise ou un contact",
    });

    fireEvent.change(searchbox, { target: { value: "alice canonique" } });

    expect(screen.getByText("Acme Canonique")).toBeInTheDocument();
    expect(screen.queryByText("Société Héritée")).not.toBeInTheDocument();

    fireEvent.change(searchbox, { target: { value: "zoe heritee" } });

    expect(screen.getByText("Société Héritée")).toBeInTheDocument();
    expect(screen.queryByText("Acme Canonique")).not.toBeInTheDocument();
  });
});
