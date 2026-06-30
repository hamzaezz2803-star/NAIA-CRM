"use client";

import React, { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import {
  Bell,
  Check,
  Clock,
  Info,
  ShieldAlert,
  Sparkles,
  CheckCircle2,
  ArrowLeft,
  CheckCheck,
  ExternalLink,
  Trash2,
} from "lucide-react";
import {
  AppNotification,
  getNotifications,
  markNotificationAsRead,
  deleteNotification,
  deleteAllNotifications,
} from "@/platform/notifications/actions";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

function getIconForType(type: AppNotification["type"]) {
  switch (type) {
    case "lead_reminder":
      return <Clock className="h-5 w-5 text-amber-500" />;
    case "mention":
      return <Sparkles className="h-5 w-5 text-blue-500" />;
    case "alert":
      return <ShieldAlert className="h-5 w-5 text-red-500" />;
    case "success":
      return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
    case "system":
    default:
      return <Info className="h-5 w-5 text-stone-500" />;
  }
}

function getBgForType(type: AppNotification["type"]) {
  switch (type) {
    case "lead_reminder":
      return "bg-amber-50 dark:bg-amber-950/20";
    case "mention":
      return "bg-blue-50 dark:bg-blue-950/20";
    case "alert":
      return "bg-red-50 dark:bg-red-950/20";
    case "success":
      return "bg-emerald-50 dark:bg-emerald-950/20";
    case "system":
    default:
      return "bg-stone-50 dark:bg-stone-900/40";
  }
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmModal, setConfirmModal] = useState<{
    show: boolean;
    message: string;
    onConfirm: (() => void) | null;
  }>({
    show: false,
    message: "",
    onConfirm: null,
  });

  const triggerConfirmation = (message: string, onConfirm: () => void) => {
    setConfirmModal({
      show: true,
      message,
      onConfirm,
    });
  };

  const fetchNotifications = async () => {
    setIsLoading(true);
    try {
      const data = await getNotifications();
      setNotifications(data);
    } catch (e) {
      console.error("Failed to load notifications", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    async function init() {
      await Promise.resolve();
      if (active) {
        fetchNotifications();
      }
    }
    init();
    return () => {
      active = false;
    };
  }, []);

  const handleMarkAsRead = async (id: string) => {
    // Optimistic update
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
    );
    await markNotificationAsRead(id);
  };

  const handleMarkAllAsRead = async () => {
    const unread = notifications.filter((n) => !n.is_read);
    if (unread.length === 0) return;

    // Optimistic update
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));

    await Promise.all(unread.map((n) => markNotificationAsRead(n.id)));
  };

  const handleDelete = (id: string) => {
    triggerConfirmation(
      "Êtes-vous sûr de vouloir supprimer cette notification ? Cette action est irréversible.",
      async () => {
        // Optimistic update
        setNotifications((prev) => prev.filter((n) => n.id !== id));
        try {
          const success = await deleteNotification(id);
          if (!success) {
            console.error("Failed to delete notification in database");
            fetchNotifications();
          }
        } catch (e) {
          console.error("Failed to delete notification", e);
          fetchNotifications();
        }
      },
    );
  };

  const handleDeleteAll = () => {
    if (notifications.length === 0) return;
    setIsSelectionMode(true);
    setSelectedIds(new Set(notifications.map((n) => n.id)));
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleToggleSelectAll = () => {
    if (selectedIds.size === notifications.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(notifications.map((n) => n.id)));
    }
  };

  const handleCancelSelection = () => {
    setIsSelectionMode(false);
    setSelectedIds(new Set());
  };

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return;

    triggerConfirmation(
      `Êtes-vous sûr de vouloir supprimer les ${selectedIds.size} notification(s) sélectionnée(s) ? Cette action est irréversible.`,
      async () => {
        const idsToDelete = Array.from(selectedIds);
        // Optimistic update
        setNotifications((prev) => prev.filter((n) => !selectedIds.has(n.id)));
        setIsSelectionMode(false);
        setSelectedIds(new Set());

        try {
          const persistentIds = idsToDelete.filter(
            (id) => !id.startsWith("lead-reminder-"),
          );
          if (persistentIds.length > 0) {
            const totalPersistent = notifications.filter(
              (n) => !n.id.startsWith("lead-reminder-"),
            ).length;

            let success = false;
            if (persistentIds.length === totalPersistent) {
              success = await deleteAllNotifications();
            } else {
              const results = await Promise.all(
                persistentIds.map((id) => deleteNotification(id)),
              );
              success = results.every((res) => res === true);
            }

            if (!success) {
              console.error(
                "Failed to delete selected notifications in database",
              );
              fetchNotifications();
            }
          }
        } catch (e) {
          console.error("Failed to delete selected notifications", e);
          fetchNotifications();
        }
      },
    );
  };

  const unreadNotifications = notifications.filter((n) => !n.is_read);

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-stone-200 bg-white text-stone-700 shadow-sm transition hover:bg-stone-50 hover:text-stone-950 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300 dark:hover:bg-stone-900 dark:hover:text-stone-50"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <span className="text-sm font-medium text-stone-500">Retour</span>
      </div>

      <PageHeader
        eyebrow="Centre de notifications"
        title="Toutes les notifications"
        description="Consultez l'historique détaillé des actions automatisées, des relances IA et des événements de votre organisation."
        actions={
          notifications.length > 0 ? (
            <div className="flex items-center gap-2">
              {unreadNotifications.length > 0 && (
                <Button
                  variant="outline"
                  onClick={handleMarkAllAsRead}
                  className="flex items-center gap-2"
                >
                  <CheckCheck className="h-4 w-4" />
                  Tout marquer comme lu
                </Button>
              )}
              <Button
                variant="outline"
                onClick={handleDeleteAll}
                className="flex items-center gap-2 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-950/20 border-stone-200 dark:border-stone-800"
              >
                <Trash2 className="h-4 w-4" />
                Tout supprimer
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="rounded-lg border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-950">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center p-12 text-center text-sm text-stone-500">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-stone-300 border-t-teal-600 mb-4" />
            Chargement des notifications...
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center text-stone-500">
            <Bell className="h-12 w-12 text-stone-300 dark:text-stone-700 mb-4" />
            <h3 className="text-lg font-semibold text-stone-900 dark:text-stone-50">
              Aucune notification
            </h3>
            <p className="mt-1 text-sm">
              Vous n&apos;avez pas encore reçu de notification d&apos;activité.
            </p>
          </div>
        ) : (
          <div>
            {isSelectionMode && (
              <div className="flex items-center justify-between border-b border-stone-200 bg-stone-50/50 px-5 py-3 dark:border-stone-800 dark:bg-stone-900/20 rounded-t-lg">
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleToggleSelectAll}
                    className={`flex h-5 w-5 items-center justify-center rounded border transition-all duration-200 ${
                      selectedIds.size === notifications.length
                        ? "border-teal-600 bg-teal-600 text-white dark:border-teal-500 dark:bg-teal-500"
                        : "border-stone-300 bg-white hover:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:hover:border-stone-600"
                    }`}
                  >
                    {selectedIds.size === notifications.length ? (
                      <Check className="h-3 w-3 stroke-[3]" />
                    ) : selectedIds.size > 0 ? (
                      <span className="h-1.5 w-1.5 bg-teal-600 dark:bg-teal-500 rounded-sm" />
                    ) : null}
                  </button>
                  <span className="text-xs font-semibold uppercase tracking-wider text-stone-500 select-none">
                    Sélectionner tout ({notifications.length})
                  </span>
                </div>
                <button
                  onClick={handleCancelSelection}
                  className="text-xs font-medium text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
                >
                  Annuler
                </button>
              </div>
            )}
            <div className="divide-y divide-stone-200 dark:divide-stone-800">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  onClick={() => {
                    if (isSelectionMode) {
                      toggleSelection(notification.id);
                    }
                  }}
                  className={`flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-center transition hover:bg-stone-50/50 dark:hover:bg-stone-900/10 ${
                    isSelectionMode ? "cursor-pointer select-none" : ""
                  } ${
                    !notification.is_read
                      ? "bg-stone-50/40 dark:bg-stone-800/10"
                      : ""
                  }`}
                >
                  <div className="flex items-start gap-4">
                    {isSelectionMode && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelection(notification.id);
                        }}
                        className={`mt-2 flex h-5 w-5 flex-none items-center justify-center rounded border transition-all duration-200 ${
                          selectedIds.has(notification.id)
                            ? "border-teal-600 bg-teal-600 text-white dark:border-teal-500 dark:bg-teal-500"
                            : "border-stone-300 bg-white hover:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:hover:border-stone-600"
                        }`}
                      >
                        {selectedIds.has(notification.id) && (
                          <Check className="h-3 w-3 stroke-[3]" />
                        )}
                      </button>
                    )}
                    <div
                      className={`flex h-10 w-10 flex-none items-center justify-center rounded-lg ${getBgForType(
                        notification.type,
                      )}`}
                    >
                      {getIconForType(notification.type)}
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <p
                          className={`text-sm font-semibold ${
                            !notification.is_read
                              ? "text-stone-950 dark:text-stone-50"
                              : "text-stone-800 dark:text-stone-200"
                          }`}
                        >
                          {notification.title}
                        </p>
                        {!notification.is_read && (
                          <span className="h-1.5 w-1.5 rounded-full bg-teal-600 dark:bg-teal-500" />
                        )}
                      </div>
                      <p className="text-sm text-stone-600 dark:text-stone-400">
                        {notification.description}
                      </p>
                      <p className="text-xs text-stone-400 dark:text-stone-500">
                        {formatDistanceToNow(
                          new Date(notification.created_at),
                          {
                            addSuffix: true,
                            locale: fr,
                          },
                        )}
                      </p>
                    </div>
                  </div>

                  {!isSelectionMode && (
                    <div className="flex items-center gap-2 self-end sm:self-center">
                      {!notification.is_read &&
                        notification.type !== "lead_reminder" && (
                          <Button
                            variant="ghost"
                            className="h-8 px-2 text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMarkAsRead(notification.id);
                            }}
                          >
                            <Check className="h-4 w-4 mr-1" />
                            Marquer lu
                          </Button>
                        )}
                      {notification.link_url && (
                        <Link
                          href={notification.link_url}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-stone-200 bg-white px-3 text-xs font-medium text-stone-700 shadow-sm transition hover:bg-stone-50 hover:text-stone-950 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300 dark:hover:bg-stone-900 dark:hover:text-stone-50"
                        >
                          Consulter
                          <ExternalLink className="h-3 w-3 ml-0.5" />
                        </Link>
                      )}
                      <Button
                        variant="ghost"
                        className="h-8 w-8 p-0 flex items-center justify-center text-stone-400 hover:text-red-600 hover:bg-red-50 dark:text-stone-500 dark:hover:text-red-400 dark:hover:bg-red-950/20 transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(notification.id);
                        }}
                        title="Supprimer la notification"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Floating Action Bar / Popup */}
      {isSelectionMode && notifications.length > 0 && (
        <div className="fixed bottom-6 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-xl border border-stone-200 bg-white/90 p-4 shadow-xl backdrop-blur-md dark:border-stone-800 dark:bg-stone-950/90 transition-all duration-300">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-medium text-stone-800 dark:text-stone-100">
              {selectedIds.size} notification{selectedIds.size > 1 ? "s" : ""}{" "}
              sélectionnée{selectedIds.size > 1 ? "s" : ""}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={handleCancelSelection}
                className="h-9 px-3 text-xs text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
              >
                Annuler
              </Button>
              <Button
                variant="outline"
                disabled={selectedIds.size === 0}
                onClick={handleDeleteSelected}
                className="h-9 px-4 text-xs font-semibold border-red-200 dark:border-red-950/40 text-red-600 bg-red-50 hover:bg-red-100 hover:text-red-700 dark:text-red-400 dark:bg-red-950/20 dark:hover:bg-red-900/30 disabled:opacity-50 disabled:pointer-events-none"
              >
                <Trash2 className="h-4 w-4 mr-1.5 inline-block" />
                Supprimer la sélection
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop overlay */}
          <div
            className="absolute inset-0 bg-stone-950/40 backdrop-blur-sm transition-opacity duration-300 animate-in fade-in"
            onClick={() =>
              setConfirmModal({ show: false, message: "", onConfirm: null })
            }
          />
          {/* Modal content */}
          <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-stone-200 bg-white p-6 shadow-2xl dark:border-stone-800 dark:bg-stone-900 transition-all duration-300 animate-in fade-in zoom-in-95 flex flex-col gap-6">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400">
                <Trash2 className="h-6 w-6" />
              </div>
              <div className="space-y-1.5 flex-1">
                <h3 className="text-lg font-semibold text-stone-900 dark:text-stone-50">
                  Confirmer la suppression
                </h3>
                <p className="text-sm leading-6 text-stone-500 dark:text-stone-400">
                  {confirmModal.message}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-stone-100 pt-4 dark:border-stone-800">
              <button
                type="button"
                onClick={() =>
                  setConfirmModal({ show: false, message: "", onConfirm: null })
                }
                className="inline-flex h-9 items-center justify-center rounded-lg border border-stone-200 bg-white px-4 text-xs font-medium text-stone-700 shadow-sm transition hover:bg-stone-50 hover:text-stone-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300 dark:hover:bg-stone-900 dark:hover:text-stone-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirmModal.onConfirm) confirmModal.onConfirm();
                  setConfirmModal({
                    show: false,
                    message: "",
                    onConfirm: null,
                  });
                }}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-transparent bg-red-600 text-white px-4 text-xs font-semibold shadow-sm hover:bg-red-700 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 dark:bg-red-500 dark:hover:bg-red-600 dark:focus-visible:ring-red-500"
              >
                <Trash2 className="h-4 w-4" />
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
