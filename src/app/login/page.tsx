import { LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import Image from "next/image";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requestMagicLinkAction } from "@/platform/auth/actions";
import { isAuthorizedUser } from "@/platform/auth/access";
import { isSupabaseConfigured } from "@/platform/auth/config";
import { sanitizeRedirectPath } from "@/platform/auth/safe-redirect";
import { getCurrentSupabaseUser } from "@/platform/auth/supabase-server";

import { MagicLinkSubmitButton } from "./magic-link-submit-button";

type LoginPageProps = {
  searchParams?: Promise<{
    error?: string;
    notice?: string;
    redirectedFrom?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const configured = isSupabaseConfigured();
  const params = await searchParams;
  const redirectedFrom = sanitizeRedirectPath(params?.redirectedFrom);
  const currentUser = await getCurrentSupabaseUser();

  if (currentUser && isAuthorizedUser(currentUser)) {
    redirect(redirectedFrom);
  }

  const errorMessage = getLoginErrorMessage(params?.error);
  const noticeMessage = getLoginNoticeMessage(params?.notice);

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-10 md:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-5xl items-center">
        <section className="w-full rounded-lg border border-stone-200 bg-white p-6 shadow-sm md:p-10">
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
                action={requestMagicLinkAction}
                className="rounded-lg border border-stone-200 p-5"
              >
                <input
                  name="redirectedFrom"
                  type="hidden"
                  value={redirectedFrom}
                />
                <Mail className="h-5 w-5 text-teal-700" />
                <h2 className="mt-4 text-base font-semibold text-stone-950">
                  Email sign-in link
                </h2>
                <div className="mt-4 space-y-2">
                  <label
                    className="text-sm font-medium text-stone-800"
                    htmlFor="magic-email"
                  >
                    Email
                  </label>
                  <input
                    autoComplete="email"
                    className="h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm text-stone-950 outline-none transition placeholder:text-stone-400 focus:border-teal-700 focus:ring-2 focus:ring-teal-700/20 disabled:bg-stone-100 disabled:text-stone-500"
                    disabled={!configured}
                    id="magic-email"
                    name="email"
                    required
                    type="email"
                  />
                </div>
                {noticeMessage ? (
                  <p
                    className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
                    role="status"
                  >
                    {noticeMessage}
                  </p>
                ) : null}
                {errorMessage ? (
                  <p
                    className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                    role="alert"
                  >
                    {errorMessage}
                  </p>
                ) : null}
                <MagicLinkSubmitButton disabled={!configured} />
              </form>
            </div>
            <div className="rounded-lg border border-stone-200 p-5">
              <LockKeyhole className="h-5 w-5 text-teal-700" />
              <h2 className="mt-4 text-base font-semibold text-stone-950">
                Invite-only access
              </h2>
              <p className="mt-2 text-sm leading-6 text-stone-600">
                Accounts are created in Supabase Auth by an admin. Public signup
                is not exposed in NAIA-os.
              </p>
              <ShieldCheck className="h-5 w-5 text-emerald-700" />
              <h2 className="mt-4 text-base font-semibold text-stone-950">
                NAIA-os-only policy
              </h2>
              <p className="mt-2 text-sm leading-6 text-stone-600">
                By default, access is restricted to approved NAIA-os email
                accounts and can be narrowed to exact addresses in Vercel.
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
    case "invalid":
      return "The email or password is incorrect.";
    case "missing":
      return "Enter your email and password.";
    case "missing-email":
      return "Enter your NAIA-os email.";
    case "magic-link":
      return "A sign-in link could not be sent for that email.";
    case "invalid-link":
      return "That sign-in link is invalid or expired.";
    case "unauthorized":
      return "This account is not authorized for NAIA-os.";
    default:
      return null;
  }
}

function getLoginNoticeMessage(notice: string | undefined) {
  switch (notice) {
    case "sent":
      return "Check your NAIA-os inbox for a sign-in link.";
    default:
      return null;
  }
}
