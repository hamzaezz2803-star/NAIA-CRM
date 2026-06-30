import React from "react";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { getAppSession } from "@/platform/auth/session";
import { ChangePasswordForm } from "./change-password-form";
import {
  CheckCircle2,
  AlertCircle,
  Database,
  Bot,
  FolderOpen,
  Mail,
  Shield,
  User,
  Building2,
  KeyRound,
} from "lucide-react";

type IntegrationStatus = "connected" | "not-configured" | "partial";

type Integration = {
  id: string;
  name: string;
  description: string;
  status: IntegrationStatus;
  icon: React.ReactNode;
  detail?: string;
};

function getIntegrations(): Integration[] {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

  return [
    {
      id: "supabase",
      name: "Supabase",
      description:
        "Base de données PostgreSQL, authentification et Row Level Security pour toutes les données NAIA-os.",
      status: supabaseUrl && supabaseKey ? "connected" : "not-configured",
      icon: <Database className="h-5 w-5" />,
      detail: supabaseUrl
        ? `URL: ${supabaseUrl}`
        : "NEXT_PUBLIC_SUPABASE_URL manquant",
    },
    {
      id: "groq",
      name: "Groq AI",
      description:
        "LLM ultrarapide pour l'extraction de leads en langage naturel et la génération de relances commerciales.",
      status: groqKey ? "connected" : "not-configured",
      icon: <Bot className="h-5 w-5" />,
      detail: groqKey
        ? "Clé API configurée — modèle llama-3.3-70b-versatile"
        : "GROQ_API_KEY manquant dans .env.local",
    },
    {
      id: "google-drive",
      name: "Google Drive",
      description:
        "Création automatique de dossiers clients, stockage des propositions, contrats et notes de réunion.",
      status:
        googleClientId && googleClientSecret ? "partial" : "not-configured",
      icon: <FolderOpen className="h-5 w-5" />,
      detail:
        googleClientId && googleClientSecret
          ? "Credentials OAuth configurés — connexion utilisateur requise"
          : "GOOGLE_CLIENT_ID ou GOOGLE_CLIENT_SECRET manquant",
    },
    {
      id: "gmail",
      name: "Gmail",
      description:
        "Envoi de relances et propositions par email directement depuis le CRM avec validation humaine.",
      status:
        googleClientId && googleClientSecret ? "partial" : "not-configured",
      icon: <Mail className="h-5 w-5" />,
      detail:
        googleClientId && googleClientSecret
          ? "Partage les credentials OAuth Google — scope Gmail requis"
          : "Dépend de la connexion Google OAuth",
    },
  ];
}

function StatusIcon({ status }: { status: IntegrationStatus }) {
  if (status === "connected")
    return <CheckCircle2 className="h-5 w-5 text-emerald-600" />;
  if (status === "partial")
    return <AlertCircle className="h-5 w-5 text-amber-500" />;
  return <AlertCircle className="h-5 w-5 text-stone-400" />;
}

function statusLabel(status: IntegrationStatus): string {
  if (status === "connected") return "Connecté";
  if (status === "partial") return "Partiellement configuré";
  return "Non configuré";
}

function statusBadgeClass(status: IntegrationStatus): string {
  if (status === "connected")
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "partial")
    return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-stone-100 text-stone-500 border-stone-200";
}

export default async function SettingsPage() {
  const integrations = getIntegrations();
  const session = await getAppSession();

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Système · Paramètres"
        title="Paramètres & Intégrations"
        description="Gérez votre profil utilisateur et la configuration système de NAIA-os."
        actions={<StatusBadge status="live" />}
      />

      {/* User Profile Section */}
      <section className="grid gap-6 md:grid-cols-2">
        <article className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 flex-none items-center justify-center rounded-md bg-stone-100 text-stone-600">
              <User className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-stone-950">
                Informations du compte
              </h2>
              <p className="text-sm text-stone-500">
                Vos informations personnelles
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-stone-500 uppercase tracking-wider mb-1">
                Nom
              </label>
              <p className="text-sm font-medium text-stone-900">
                {session.user.name}
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 uppercase tracking-wider mb-1">
                Email
              </label>
              <p className="text-sm font-medium text-stone-900">
                {session.user.email}
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 uppercase tracking-wider mb-1">
                Rôle
              </label>
              <p className="text-sm font-medium text-stone-900 capitalize">
                {session.user.role}
              </p>
            </div>
            <div className="pt-2 border-t border-stone-100">
              <label className="flex items-center gap-2 text-xs font-medium text-stone-500 uppercase tracking-wider mb-1">
                <Building2 className="h-3.5 w-3.5" />
                Organisation
              </label>
              <p className="text-sm font-medium text-stone-900">
                {session.organization.name}
              </p>
            </div>
          </div>
        </article>

        <article className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 flex-none items-center justify-center rounded-md bg-stone-100 text-stone-600">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-stone-950">
                Sécurité
              </h2>
              <p className="text-sm text-stone-500">
                Mettre à jour votre mot de passe
              </p>
            </div>
          </div>
          <ChangePasswordForm />
        </article>
      </section>

      <div className="border-t border-stone-200 pt-8" />

      {/* Security note */}
      <div className="flex items-start gap-3 rounded-lg border border-stone-200 bg-stone-50 p-4">
        <Shield className="mt-0.5 h-5 w-5 flex-none text-teal-700" />
        <div>
          <p className="text-sm font-medium text-stone-950">
            Configuration sécurisée
          </p>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            Toutes les clés privées (GROQ_API_KEY, GOOGLE_CLIENT_SECRET,
            SUPABASE_SERVICE_ROLE_KEY) restent côté serveur. Elles ne sont
            jamais exposées dans les composants clients ou les variables
            NEXT_PUBLIC_*.
          </p>
        </div>
      </div>

      {/* Integration cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {integrations.map((integration) => (
          <article
            key={integration.id}
            id={`integration-${integration.id}`}
            className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-md bg-stone-100 text-stone-600">
                  {integration.icon}
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-stone-950">
                    {integration.name}
                  </h2>
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(integration.status)}`}
                  >
                    {statusLabel(integration.status)}
                  </span>
                </div>
              </div>
              <StatusIcon status={integration.status} />
            </div>

            <p className="mt-3 text-sm leading-6 text-stone-600">
              {integration.description}
            </p>

            {integration.detail && (
              <p className="mt-2 rounded-md bg-stone-50 px-3 py-1.5 text-xs text-stone-500 font-mono">
                {integration.detail}
              </p>
            )}
          </article>
        ))}
      </div>

      {/* Environment variables reference */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-stone-700">
          Variables d&apos;environnement attendues
        </h2>
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50">
                <th className="px-4 py-3 text-left font-semibold text-stone-700">
                  Variable
                </th>
                <th className="px-4 py-3 text-left font-semibold text-stone-700">
                  Usage
                </th>
                <th className="px-4 py-3 text-left font-semibold text-stone-700">
                  Visibilité
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {[
                {
                  name: "NEXT_PUBLIC_SUPABASE_URL",
                  usage: "URL Supabase Project",
                  visibility: "Client",
                },
                {
                  name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
                  usage: "Clé publique Supabase",
                  visibility: "Client",
                },
                {
                  name: "SUPABASE_SERVICE_ROLE_KEY",
                  usage: "Admin Supabase (migrations)",
                  visibility: "Serveur uniquement",
                },
                {
                  name: "GROQ_API_KEY",
                  usage: "Groq LLM API",
                  visibility: "Serveur uniquement",
                },
                {
                  name: "GOOGLE_CLIENT_ID",
                  usage: "OAuth Google Drive & Gmail",
                  visibility: "Serveur uniquement",
                },
                {
                  name: "GOOGLE_CLIENT_SECRET",
                  usage: "OAuth Google Drive & Gmail",
                  visibility: "Serveur uniquement",
                },
                {
                  name: "AUTH_ALLOWED_EMAILS",
                  usage: "Liste blanche utilisateurs",
                  visibility: "Serveur uniquement",
                },
              ].map((row) => (
                <tr key={row.name}>
                  <td className="px-4 py-3 font-mono text-xs text-stone-800">
                    {row.name}
                  </td>
                  <td className="px-4 py-3 text-xs text-stone-600">
                    {row.usage}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        row.visibility === "Client"
                          ? "bg-blue-50 text-blue-700"
                          : "bg-stone-100 text-stone-600"
                      }`}
                    >
                      {row.visibility}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
