import { LockKeyhole, ShieldCheck } from "lucide-react";
import Image from "next/image";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { signInWithPasswordAction } from "@/platform/auth/actions";
import { isAuthorizedUser } from "@/platform/auth/access";
import { isSupabaseConfigured } from "@/platform/auth/config";
import { sanitizeRedirectPath } from "@/platform/auth/safe-redirect";
import { getCurrentSupabaseUser } from "@/platform/auth/supabase-server";

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
  const currentUser = await getCurrentSupabaseUser();

  if (currentUser && isAuthorizedUser(currentUser)) {
    redirect(redirectedFrom);
  }

  const errorMessage = getLoginErrorMessage(params?.error);

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-10 md:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-5xl items-center">
        <section className="w-full rounded-lg border border-stone-200 bg-white p-6 shadow-sm md:p-10">
          <Image
            alt="Qarizmi"
            className="mb-8 h-auto w-44"
            height={58}
            priority
            src="/brand/qarizmi-logo-small.png"
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
                ? "Use an approved Qarizmi account to access the internal operating system."
                : "Supabase environment variables are missing, so sign-in is disabled."
            }
            eyebrow="Authentication"
            title="Sign in to Qarizmi OS"
          />
          <div className="mt-8 grid gap-6 md:grid-cols-[minmax(0,1fr)_18rem]">
            <form
              action={signInWithPasswordAction}
              className="rounded-lg border border-stone-200 p-5"
            >
              <input
                name="redirectedFrom"
                type="hidden"
                value={redirectedFrom}
              />
              <div className="space-y-2">
                <label
                  className="text-sm font-medium text-stone-800"
                  htmlFor="email"
                >
                  Email
                </label>
                <input
                  autoComplete="email"
                  className="h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm text-stone-950 outline-none transition placeholder:text-stone-400 focus:border-teal-700 focus:ring-2 focus:ring-teal-700/20 disabled:bg-stone-100 disabled:text-stone-500"
                  disabled={!configured}
                  id="email"
                  name="email"
                  required
                  type="email"
                />
              </div>
              <div className="mt-4 space-y-2">
                <label
                  className="text-sm font-medium text-stone-800"
                  htmlFor="password"
                >
                  Password
                </label>
                <input
                  autoComplete="current-password"
                  className="h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm text-stone-950 outline-none transition placeholder:text-stone-400 focus:border-teal-700 focus:ring-2 focus:ring-teal-700/20 disabled:bg-stone-100 disabled:text-stone-500"
                  disabled={!configured}
                  id="password"
                  name="password"
                  required
                  type="password"
                />
              </div>
              {errorMessage ? (
                <p
                  className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                  role="alert"
                >
                  {errorMessage}
                </p>
              ) : null}
              <Button
                className="mt-5 w-full"
                disabled={!configured}
                type="submit"
              >
                Sign in
              </Button>
            </form>
            <div className="rounded-lg border border-stone-200 p-5">
              <LockKeyhole className="h-5 w-5 text-teal-700" />
              <h2 className="mt-4 text-base font-semibold text-stone-950">
                Invite-only access
              </h2>
              <p className="mt-2 text-sm leading-6 text-stone-600">
                Accounts are created in Supabase Auth by an admin. Public signup
                is not exposed in Qarizmi OS.
              </p>
              <ShieldCheck className="h-5 w-5 text-emerald-700" />
              <h2 className="mt-4 text-base font-semibold text-stone-950">
                Qarizmi-only policy
              </h2>
              <p className="mt-2 text-sm leading-6 text-stone-600">
                By default, access is restricted to approved Qarizmi email
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
    case "unauthorized":
      return "This account is not authorized for Qarizmi OS.";
    default:
      return null;
  }
}
