import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteAllNotifications: vi.fn(),
  deleteNotification: vi.fn(),
  getNotifications: vi.fn(),
  markNotificationAsRead: vi.fn(),
}));

vi.mock("@/platform/notifications/actions", () => ({
  deleteAllNotifications: mocks.deleteAllNotifications,
  deleteNotification: mocks.deleteNotification,
  getNotifications: mocks.getNotifications,
  markNotificationAsRead: mocks.markNotificationAsRead,
}));

import NotificationsPage from "./page";

describe("NotificationsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteAllNotifications.mockResolvedValue(true);
    mocks.deleteNotification.mockResolvedValue(true);
    mocks.markNotificationAsRead.mockResolvedValue(true);
    mocks.getNotifications.mockResolvedValue([
      {
        created_at: "2026-07-20T10:00:00.000Z",
        description: "Relancer le client",
        id: "lead-reminder-lead-1:2026-07-20",
        is_read: false,
        link_url: "/dashboard/leads",
        title: "Rappel Lead : HPS",
        type: "lead_reminder",
      },
    ]);
  });

  it("persists deleting a selection containing only CRM reminders", async () => {
    render(<NotificationsPage />);

    expect(await screen.findByText("Rappel Lead : HPS")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Tout supprimer" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Supprimer la sélection" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));

    await waitFor(() => {
      expect(mocks.deleteAllNotifications).toHaveBeenCalledOnce();
    });
    expect(mocks.deleteNotification).not.toHaveBeenCalled();
  });

  it("persists a partially selected CRM reminder without deleting unselected notifications", async () => {
    mocks.getNotifications.mockResolvedValue([
      {
        created_at: "2026-07-20T10:00:00.000Z",
        description: "Relancer le client",
        id: "lead-reminder-lead-1:2026-07-20",
        is_read: false,
        link_url: "/dashboard/leads",
        title: "Rappel Lead : HPS",
        type: "lead_reminder",
      },
      {
        created_at: "2026-07-21T10:00:00.000Z",
        description: "Une notification persistante",
        id: "notification-1",
        is_read: false,
        title: "Notification système",
        type: "system",
      },
    ]);

    render(<NotificationsPage />);

    expect(await screen.findByText("Notification système")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Tout supprimer" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Désélectionner Notification système",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Supprimer la sélection" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));

    await waitFor(() => {
      expect(mocks.deleteNotification).toHaveBeenCalledWith(
        "lead-reminder-lead-1:2026-07-20",
      );
    });
    expect(mocks.deleteAllNotifications).not.toHaveBeenCalled();
  });
});
