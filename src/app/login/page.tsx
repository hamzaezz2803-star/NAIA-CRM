import { LockKeyhole, ShieldCheck } from "lucide-react";
import Image from "next/image";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { signInWithGoogleAction } from "@/platform/auth/actions";
import { isGoogleOnlyAuthorizedUser } from "@/platform/auth/access";
import { isSupabaseConfigured } from "@/platform/auth/config";
import { sanitizeRedirectPath } from "@/platform/auth/safe-redirect";
import { getCurrentSupabaseClaims } from "@/platform/auth/supabase-server";

type LoginPageProps = {
  searchParams?: Promise<{
    error?: string;
    redirectedFrom?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const configured = isSupabaseConfigured();
  const params = await searchParams;
  const redirectedFrom = sanitizeRedirectPath(params?.redirectedFrom);
  const currentClaims = await getCurrentSupabaseClaims();

  if (
    currentClaims &&
    isGoogleOnlyAuthorizedUser(currentClaims, currentClaims)
  ) {
    redirect(redirectedFrom);
  }

  const errorMessage = getLoginErrorMessage(params?.error);

  return (
    <main
      className="min-h-screen px-4 py-10 md:px-8 flex items-center justify-center"
      style={{ background: "var(--maison-page)" }}
    >
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-5xl items-center">
        <section
          className="w-full rounded-2xl border p-6 md:p-10 transition-all"
          style={{
            background: "var(--maison-card)",
            borderColor: "var(--maison-border)",
            boxShadow: "0 25px 60px rgba(20, 41, 60, 0.16)",
          }}
        >
          <Image
            alt="NAIA-os"
            className="mb-8 h-auto w-44 dark:hidden"
            height={58}
            priority
            src="/brand/naia-os-logo-small.png"
            width={180}
          />
          <Image
            alt="NAIA-os"
            className="mb-8 hidden h-auto w-44 dark:block"
            height={58}
            priority
            src="/brand/naia-os-logo-white.png"
            width={180}
          />
          <PageHeader
            actions={
              configured ? (
                <StatusBadge status="live" />
              ) : (
                <StatusBadge status="ready-for-build" />
              )
            }
            description={
              configured
                ? "Use an approved NAIA-os account to access the internal operating system."
                : "Supabase environment variables are missing, so sign-in is disabled."
            }
            eyebrow="Authentication"
            title="Sign in to NAIA-os"
          />
          <div className="mt-8 grid gap-6 md:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="space-y-4">
              <form
                action={signInWithGoogleAction}
                className="rounded-xl border p-5 transition"
                style={{
                  background: "var(--maison-page)",
                  borderColor: "var(--maison-border)",
                }}
              >
                <input
                  name="redirectedFrom"
                  type="hidden"
                  value={redirectedFrom}
                />
                <svg
                  aria-hidden
                  className="h-5 w-5"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M23.52 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81Z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3c-1.08.72-2.45 1.14-4.06 1.14-3.13 0-5.78-2.11-6.72-4.95H1.27v3.1A12 12 0 0 0 12 24Z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.28 14.28A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.38-2.28v-3.1H1.27a12 12 0 0 0 0 10.76l4.01-3.1Z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 4.77c1.77 0 3.35.61 4.6 1.8l3.44-3.44A11.98 11.98 0 0 0 12 0 12 12 0 0 0 1.27 6.62l4.01 3.1C6.22 6.88 8.87 4.77 12 4.77Z"
                    fill="#EA4335"
                  />
                </svg>
                <h2
                  className="mt-4 text-base font-bold tracking-tight"
                  style={{ color: "var(--maison-text-primary)" }}
                >
                  Continue with Google
                </h2>
                <p className="mt-2 text-xs leading-5 text-[#5c6b7a]">
                  One click signs you in with your Qarizmi account and connects
                  your own Calendar and Gmail for the NAIA agents.
                </p>
                <button
                  className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-xs font-bold uppercase tracking-wider text-white transition hover:opacity-90 shadow-2xs disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    background: "var(--maison-sidebar)",
                    color: "#ffffff",
                  }}
                  disabled={!configured}
                  type="submit"
                >
                  Sign in with Google
                </button>
                {errorMessage ? (
                  <p
                    className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                    role="alert"
                  >
                    {errorMessage}
                  </p>
                ) : null}
              </form>
            </div>
            <div className="rounded-lg border border-stone-200 p-5">
              <LockKeyhole className="h-5 w-5 text-teal-700" />
              <h2 className="mt-4 text-base font-semibold text-stone-950">
                Qarizmi-only access
              </h2>
              <p className="mt-2 text-sm leading-6 text-stone-600">
                Google sign-in is mandatory and reserved for approved
                @qarizmi.com accounts.
              </p>
              <ShieldCheck className="h-5 w-5 text-emerald-700" />
              <h2 className="mt-4 text-base font-semibold text-stone-950">
                NAIA-os-only policy
              </h2>
              <p className="mt-2 text-sm leading-6 text-stone-600">
                NAIA-os requires both a linked Google identity and a verified
                Google OAuth session in addition to the email allowlist.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function getLoginErrorMessage(error: string | undefined) {
  switch (error) {
    case "config":
      return "Supabase authentication is not configured for this environment.";
    case "google-only":
      return "NAIA-os accepts Google sign-in only. Continue with your approved Google account.";
    case "google":
      return "Google sign-in could not be started. Check the Supabase Google provider configuration.";
    case "google-signin":
      return "Google sign-in was cancelled or failed. Please try again.";
    case "invalid-link":
      return "That Google sign-in link is invalid or expired.";
    case "unauthorized":
      return "This account is not authorized for NAIA-os.";
    default:
      return null;
  }
}
