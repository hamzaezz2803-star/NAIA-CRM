"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, Loader2 } from "lucide-react";

import { cn } from "@/lib/cn";

type GoogleConnectButtonProps = {
  className?: string;
  label?: string;
};

export function GoogleConnectButton({
  className,
  label = "Login with Gmail",
}: GoogleConnectButtonProps) {
  const router = useRouter();
  const popupRef = useRef<Window | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "GOOGLE_AUTH_SUCCESS") return;

      setIsConnecting(false);
      setMessage("Google Workspace connecte.");
      popupRef.current?.close();
      popupRef.current = null;
      router.refresh();
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
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
      window.location.href = "/api/integrations/google/auth";
      return;
    }

    popupRef.current = popup;
    setIsConnecting(true);
    setMessage("Connexion Google en cours...");
  };

  return (
    <div className={cn("flex flex-col items-start gap-2", className)}>
      <button
        className="inline-flex min-h-11 items-center gap-2 rounded-md bg-stone-950 px-4 text-sm font-semibold text-white transition hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-stone-950 dark:hover:bg-stone-200"
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
