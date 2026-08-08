"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, CheckCircle2, Loader2, LogOut } from "lucide-react";

import { cn } from "@/lib/cn";

type GoogleConnectButtonProps = {
  className?: string;
  connectedAccount?: string;
  initialConnected?: boolean;
  label?: string;
};

export function GoogleConnectButton({
  className,
  connectedAccount,
  initialConnected = false,
  label = "Login with Gmail",
}: GoogleConnectButtonProps) {
  const router = useRouter();
  const popupRef = useRef<Window | null>(null);
  const popupTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectedState, setConnectedState] = useState<boolean | null>(null);
  const [accountLabelState, setAccountLabelState] = useState<
    string | undefined
  >(undefined);
  const [message, setMessage] = useState("");

  const isConnected = connectedState ?? initialConnected;
  const accountLabel = accountLabelState ?? connectedAccount;

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "GOOGLE_AUTH_SUCCESS") return;

      setIsConnecting(false);
      setConnectedState(true);
      if (event.data?.email) {
        setAccountLabelState(event.data.email);
      }
      setMessage("Google Workspace connecté.");
      if (popupTimerRef.current) {
        clearInterval(popupTimerRef.current);
        popupTimerRef.current = null;
      }
      popupRef.current?.close();
      popupRef.current = null;
      router.refresh();
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      if (popupTimerRef.current) clearInterval(popupTimerRef.current);
    };
  }, [router]);

  const connect = () => {
    const width = 520;
    const height = 640;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;
    const popup = window.open(
      "/api/integrations/google/auth",
      "GoogleAuth",
      `width=${width},height=${height},left=${left},top=${top},status=no,resizable=yes,scrollbars=yes`,
    );

    if (!popup) {
      router.push("/api/integrations/google/auth");
      return;
    }

    popupRef.current = popup;
    setIsConnecting(true);
    setMessage("Connexion Google en cours...");
    popupTimerRef.current = setInterval(() => {
      if (!popup.closed) return;

      if (popupTimerRef.current) clearInterval(popupTimerRef.current);
      popupTimerRef.current = null;
      popupRef.current = null;
      setIsConnecting(false);
      setMessage("Connexion Google annulée.");
    }, 500);
  };

  const disconnect = async () => {
    setIsConnecting(true);
    try {
      const res = await fetch("/api/integrations/disconnect", {
        body: JSON.stringify({ provider: "google" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (res.ok) {
        setConnectedState(false);
        setAccountLabelState(undefined);
        setMessage("Google déconnecté.");
        router.refresh();
      } else {
        const payload = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setMessage(payload?.error ?? "Erreur lors de la déconnexion Google.");
      }
    } catch {
      setMessage("Échec de la communication avec le serveur.");
    } finally {
      setIsConnecting(false);
    }
  };

  if (isConnected) {
    return (
      <div className={cn("flex flex-col gap-2 w-full", className)}>
        <div className="inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold tracking-wide bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 flex-none" />
          <span className="truncate">
            Google connecté {accountLabel ? `(${accountLabel})` : ""}
          </span>
        </div>
        <button
          className="inline-flex min-h-8 w-full items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium text-rose-600 dark:text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/25 transition-all cursor-pointer disabled:opacity-50"
          disabled={isConnecting}
          onClick={disconnect}
          type="button"
        >
          {isConnecting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <LogOut className="h-3.5 w-3.5 flex-none" />
          )}
          <span>Déconnecter Google</span>
        </button>
        {message ? (
          <p className="text-xs leading-5 text-stone-500" aria-live="polite">
            {message}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col items-start gap-2 w-full", className)}>
      <button
        className="inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-xl px-4 text-xs font-semibold uppercase tracking-wider text-white shadow-2xs transition hover:opacity-90 active:scale-98 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
        style={{ background: "var(--maison-sidebar)" }}
        disabled={isConnecting}
        onClick={connect}
        type="button"
      >
        {isConnecting ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <CalendarCheck className="h-4 w-4" aria-hidden="true" />
        )}
        {label}
      </button>
      {message ? (
        <p className="text-xs leading-5 text-stone-500" aria-live="polite">
          {message}
        </p>
      ) : null}
    </div>
  );
}
