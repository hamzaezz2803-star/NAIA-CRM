import { LockKeyhole, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { isSupabaseConfigured } from "@/platform/auth/config";

export default function LoginPage() {
  const configured = isSupabaseConfigured();

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-10 md:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-5xl items-center">
        <section className="w-full rounded-lg border border-stone-200 bg-white p-6 shadow-sm md:p-10">
          <PageHeader
            actions={
              configured ? (
                <StatusBadge status="ready-for-build" />
              ) : (
                <StatusBadge status="ready-for-build" />
              )
            }
            description={
              configured
                ? "The Supabase project is connected through local environment variables. Real sign-in is still scaffolded until the session flow is implemented."
                : "Supabase authentication is scaffolded. Local development remains available until the hosted project and environment variables are connected."
            }
            eyebrow="Authentication"
            title="Sign in to Qarizmi OS"
          />
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-stone-200 p-5">
              <LockKeyhole className="h-5 w-5 text-teal-700" />
              <h2 className="mt-4 text-base font-semibold text-stone-950">
                Supabase email authentication
              </h2>
              <p className="mt-2 text-sm leading-6 text-stone-600">
                Configure the Supabase URL and publishable key, then replace
                this scaffold with real sign-in.
              </p>
            </div>
            <div className="rounded-lg border border-stone-200 p-5">
              <ShieldCheck className="h-5 w-5 text-emerald-700" />
              <h2 className="mt-4 text-base font-semibold text-stone-950">
                Human approval by default
              </h2>
              <p className="mt-2 text-sm leading-6 text-stone-600">
                External actions are modeled behind approval requests before any
                provider sends messages or documents.
              </p>
            </div>
          </div>
          <div className="mt-8">
            <Link className={buttonVariants()} href="/dashboard">
              Enter local scaffold
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
