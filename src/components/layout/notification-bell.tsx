"use client";

import { useEffect, useState, useRef } from "react";
import {
  Bell,
  Check,
  Clock,
  Info,
  ShieldAlert,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AppNotification,
  getNotifications,
  markNotificationAsRead,
} from "@/platform/notifications/actions";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

function getIconForType(type: AppNotification["type"]) {
  switch (type) {
    case "lead_reminder":
      return <Clock className="h-4 w-4 text-amber-500" />;
    case "mention":
      return <Sparkles className="h-4 w-4 text-blue-500" />;
    case "alert":
      return <ShieldAlert className="h-4 w-4 text-red-500" />;
    case "success":
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    case "system":
    default:
      return <Info className="h-4 w-4 text-stone-500" />;
  }
}

export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);

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
      // Defer execution to avoid synchronous setState inside the effect body
      await Promise.resolve();
      if (!active) return;

      setIsLoading(true);
      try {
        const data = await getNotifications();
        if (active) {
          setNotifications(data);
        }
      } catch (e) {
        console.error("Failed to load notifications", e);
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    init();

    // Refresh notifications every 5 minutes
    const interval = setInterval(
      async () => {
        try {
          const data = await getNotifications();
          if (active) {
            setNotifications(data);
          }
        } catch (e) {
          console.error("Failed to refresh notifications", e);
        }
      },
      5 * 60 * 1000,
    );

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const handleMarkAsRead = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Optimistically mark as read
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
    );

    await markNotificationAsRead(id);
  };

  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={wrapperRef}>
      <Button
        aria-label="Notifications"
        className="relative h-9 w-9 px-0"
        variant="ghost"
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) fetchNotifications();
        }}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute right-1.5 top-1.5 flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500"></span>
          </span>
        )}
      </Button>

      {isOpen && (
        <div
          className="absolute right-0 mt-2 w-80 overflow-hidden rounded-xl border shadow-lg z-50 dark:border-stone-800 dark:bg-stone-950"
          style={{
            background: "var(--maison-card)",
            borderColor: "var(--maison-border)",
            color: "var(--maison-text-primary)",
          }}
        >
          <div
            className="flex items-center justify-between border-b px-4 py-3"
            style={{ borderColor: "var(--maison-border)" }}
          >
            <h4
              className="text-sm font-semibold"
              style={{ color: "var(--maison-text-primary)" }}
            >
              Notifications
            </h4>
            {unreadCount > 0 && (
              <span
                className="rounded-full px-2 py-0.5 text-xs font-semibold"
                style={{
                  background: "rgba(176,141,79,0.15)",
                  color: "var(--maison-brass-text)",
                }}
              >
                {unreadCount} nouvelle{unreadCount > 1 ? "s" : ""}
              </span>
            )}
          </div>

          <div className="flex max-h-[400px] flex-col overflow-y-auto p-1">
            {isLoading && notifications.length === 0 ? (
              <div
                className="p-4 text-center text-sm"
                style={{ color: "var(--maison-text-secondary)" }}
              >
                Chargement...
              </div>
            ) : notifications.length === 0 ? (
              <div
                className="p-4 text-center text-sm"
                style={{ color: "var(--maison-text-secondary)" }}
              >
                Aucune notification
              </div>
            ) : (
              notifications.map((notification) => {
                const NotificationBody = (
                  <div
                    key={notification.id}
                    className="relative flex gap-3 rounded-lg p-3 text-left transition hover:bg-[var(--maison-border-subtle)]/50 dark:hover:bg-stone-800/50"
                    style={{
                      background: !notification.is_read
                        ? "rgba(176,141,79,0.06)"
                        : "transparent",
                    }}
                  >
                    <div className="mt-0.5 flex-none">
                      {getIconForType(notification.type)}
                    </div>
                    <div className="flex-1 space-y-1">
                      <p
                        className={`text-sm ${
                          !notification.is_read
                            ? "font-semibold"
                            : "font-medium"
                        }`}
                        style={{ color: "var(--maison-text-primary)" }}
                      >
                        {notification.title}
                      </p>
                      <p
                        className="text-xs"
                        style={{ color: "var(--maison-text-secondary)" }}
                      >
                        {notification.description}
                      </p>
                      <p
                        className="text-[10px]"
                        style={{ color: "var(--maison-text-muted)" }}
                      >
                        {formatDistanceToNow(
                          new Date(notification.created_at),
                          {
                            addSuffix: true,
                            locale: fr,
                          },
                        )}
                      </p>
                    </div>
                    {!notification.is_read &&
                      notification.type !== "lead_reminder" && (
                        <div className="absolute right-3 top-3">
                          <button
                            onClick={(e) =>
                              handleMarkAsRead(notification.id, e)
                            }
                            className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
                            title="Marquer comme lu"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                  </div>
                );

                if (notification.link_url) {
                  return (
                    <Link
                      href={notification.link_url}
                      key={notification.id}
                      onClick={() => setIsOpen(false)}
                    >
                      {NotificationBody}
                    </Link>
                  );
                }

                return <div key={notification.id}>{NotificationBody}</div>;
              })
            )}
          </div>

          {notifications.length > 0 && (
            <div
              className="border-t p-2 text-center"
              style={{ borderColor: "var(--maison-border)" }}
            >
              <Link
                href="/dashboard/notifications"
                onClick={() => setIsOpen(false)}
                className="text-xs font-semibold hover:underline"
                style={{ color: "var(--maison-brass)" }}
              >
                Voir toutes les notifications →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
