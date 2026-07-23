import React from "react";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { getGroqApiKey, getGroqModelConfiguration } from "@/platform/ai/groq";
import { getAppSession } from "@/platform/auth/session";
import { ChangePasswordForm } from "./change-password-form";
import {
  CheckCircle2,
  AlertCircle,
  Database,
  Bot,
  FolderOpen,
  Mail,
  MessageCircle,
  PlugZap,
  Shield,
  User,
  Building2,
  KeyRound,
} from "lucide-react";
import { type IntegrationHealth } from "@/platform/integrations/contracts";
import { isDriveServiceConfigured } from "@/platform/integrations/google-drive-service";
import { getIntegrationReadiness } from "@/platform/integrations/readiness";

type SystemIntegrationStatus =
  | "connected"
  | "not-configured"
  | "ready-to-connect"
  | "not-implemented"
  | "needs-review";

type Integration = {
  id: string;
  name: string;
  description: string;
  status: SystemIntegrationStatus;
  icon: React.ReactNode;
  detail?: string;
};

function getSystemIntegrations(
  providerReadiness: IntegrationHealth[],
): Integration[] {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const groqKey = getGroqApiKey();
  const groqModels = getGroqModelConfiguration();
  const google = providerReadiness.find(
    (integration) => integration.provider === "google",
  );
  const slack = providerReadiness.find(
    (integration) => integration.provider === "slack",
  );
  const whatsapp = providerReadiness.find(
    (integration) => integration.provider === "whatsapp",
  );

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
        "Orchestration NAIA, extraction CRM structurée et génération de relances avec fallback automatique.",
      status: groqKey ? "connected" : "not-configured",
      icon: <Bot className="h-5 w-5" />,
      detail: groqKey
        ? `Primaire: ${groqModels.orchestrator} — fallback: ${groqModels.structuredFallback}`
        : "GROQ_API_KEY manquant dans .env.local",
    },
    {
      id: "google-workspace",
      name: "Google Calendar / Gmail (connexion personnelle)",
      description:
        "Connexion Google par utilisateur, capturée au login : synchronisation Calendar et lectures Gmail des agents NAIA sur ton propre compte.",
      status: google?.status ?? "not-configured",
      icon: <Mail className="h-5 w-5" />,
      detail:
        google?.detail ?? "GOOGLE_CLIENT_ID ou GOOGLE_CLIENT_SECRET manquant",
    },
    {
      id: "google-drive-service",
      name: "Google Drive (service account)",
      description:
        "Dossiers clients et documents Maya créés dans le Drive partagé cofondateurs par le compte de service de l'organisation.",
      status: isDriveServiceConfigured() ? "connected" : "not-configured",
      icon: <FolderOpen className="h-5 w-5" />,
      detail: isDriveServiceConfigured()
        ? "Compte de service actif — dossiers clients créés dans le Drive partagé (clients)."
        : "GOOGLE_SERVICE_ACCOUNT_KEY ou MAYA_DRIVE_OUTPUT_FOLDER_ID manquant — création de dossiers clients désactivée.",
    },
    {
      id: "slack",
      name: "Slack",
      description:
        "Prévu pour les récapitulatifs de canaux, notifications et suivis approuvés.",
      status: slack?.status ?? "not-implemented",
      icon: <PlugZap className="h-5 w-5" />,
      detail:
        slack?.detail ??
        "SLACK_CLIENT_ID / SLACK_CLIENT_SECRET ne suffisent pas sans route OAuth Slack.",
    },
    {
      id: "whatsapp",
      name: "WhatsApp",
      description:
        "Brouillons ouvrables dans WhatsApp. Aucun envoi Business API n'est fait automatiquement.",
      status: whatsapp?.status ?? "not-implemented",
      icon: <MessageCircle className="h-5 w-5" />,
      detail:
        whatsapp?.detail ??
        "Connecteur Business API à implémenter derrière approbation humaine.",
    },
  ];
}

function StatusIcon({ status }: { status: SystemIntegrationStatus }) {
  if (status === "connected")
    return <CheckCircle2 className="h-5 w-5 text-emerald-600" />;
  if (status === "ready-to-connect" || status === "needs-review")
    return <AlertCircle className="h-5 w-5 text-amber-500" />;
  return <AlertCircle className="h-5 w-5 text-stone-400" />;
}

function statusLabel(status: SystemIntegrationStatus): string {
  if (status === "connected") return "Connecté";
  if (status === "ready-to-connect") return "Prêt à connecter";
  if (status === "needs-review") return "À vérifier";
  if (status === "not-implemented") return "Non implémenté";
  return "Non configuré";
}

function statusBadgeClass(status: SystemIntegrationStatus): string {
  if (status === "connected")
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "ready-to-connect" || status === "needs-review")
    return "bg-amber-50 text-amber-700 border-amber-200";
  if (status === "not-implemented")
    return "bg-stone-50 text-stone-500 border-stone-200";
  return "bg-stone-100 text-stone-500 border-stone-200";
}

export default async function SettingsPage() {
  const providerReadiness = await getIntegrationReadiness();
  const integrations = getSystemIntegrations(providerReadiness);
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
      <section className="grid gap-4 md:grid-cols-2">
        <article
          className="rounded-xl border p-4 sm:p-5 shadow-xs dark:border-stone-800 dark:bg-stone-950 transition-all"
          style={{
            background: "var(--maison-card)",
            borderColor: "var(--maison-border)",
          }}
        >
          <div
            className="flex items-center gap-3 mb-3 pb-3 border-b"
            style={{ borderColor: "var(--maison-border)" }}
          >
            <div
              className="flex h-9 w-9 flex-none items-center justify-center rounded-lg shadow-2xs"
              style={{
                background: "rgba(176,141,79,0.12)",
                color: "var(--maison-brass)",
              }}
            >
              <User className="h-4.5 w-4.5" />
            </div>
            <div>
              <h2
                className="text-base font-semibold tracking-tight"
                style={{
                  fontFamily: "var(--font-playfair), Georgia, serif",
                  color: "var(--maison-text-primary)",
                }}
              >
                Informations du compte
              </h2>
              <p
                className="text-xs"
                style={{ color: "var(--maison-text-secondary)" }}
              >
                Vos informations personnelles
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label
                className="block text-xs font-semibold uppercase tracking-wider mb-1"
                style={{ color: "var(--maison-text-muted)" }}
              >
                Nom
              </label>
              <p
                className="text-sm font-medium"
                style={{ color: "var(--maison-text-primary)" }}
              >
                {session.user.name}
              </p>
            </div>
            <div>
              <label
                className="block text-xs font-semibold uppercase tracking-wider mb-1"
                style={{ color: "var(--maison-text-muted)" }}
              >
                Email
              </label>
              <p
                className="text-sm font-medium"
                style={{ color: "var(--maison-text-primary)" }}
              >
                {session.user.email}
              </p>
            </div>
            <div>
              <label
                className="block text-xs font-semibold uppercase tracking-wider mb-1"
                style={{ color: "var(--maison-text-muted)" }}
              >
                Rôle
              </label>
              <p
                className="text-sm font-medium capitalize"
                style={{ color: "var(--maison-text-primary)" }}
              >
                {session.user.role}
              </p>
            </div>
            <div
              className="pt-3 border-t"
              style={{ borderColor: "var(--maison-border-subtle)" }}
            >
              <label
                className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider mb-1"
                style={{ color: "var(--maison-text-muted)" }}
              >
                <Building2 className="h-3.5 w-3.5" />
                Organisation
              </label>
              <p
                className="text-sm font-medium"
                style={{ color: "var(--maison-text-primary)" }}
              >
                {session.organization.name}
              </p>
            </div>
          </div>
        </article>

        <article
          className="rounded-xl border p-4 sm:p-5 shadow-xs dark:border-stone-800 dark:bg-stone-950 transition-all"
          style={{
            background: "var(--maison-card)",
            borderColor: "var(--maison-border)",
          }}
        >
          <div
            className="flex items-center gap-3 mb-3 pb-3 border-b"
            style={{ borderColor: "var(--maison-border)" }}
          >
            <div
              className="flex h-9 w-9 flex-none items-center justify-center rounded-lg shadow-2xs"
              style={{
                background: "rgba(176,141,79,0.12)",
                color: "var(--maison-brass)",
              }}
            >
              <KeyRound className="h-4.5 w-4.5" />
            </div>
            <div>
              <h2
                className="text-base font-semibold tracking-tight"
                style={{
                  fontFamily: "var(--font-playfair), Georgia, serif",
                  color: "var(--maison-text-primary)",
                }}
              >
                Sécurité
              </h2>
              <p
                className="text-xs"
                style={{ color: "var(--maison-text-secondary)" }}
              >
                Mettre à jour votre mot de passe
              </p>
            </div>
          </div>
          <ChangePasswordForm />
        </article>
      </section>

      <div
        className="border-t pt-2"
        style={{ borderColor: "var(--maison-border-subtle)" }}
      />

      {/* Security note */}
      <div
        className="flex items-start gap-3 rounded-xl border p-4 shadow-sm"
        style={{
          background: "rgba(176,141,79,0.05)",
          borderColor: "var(--maison-border)",
        }}
      >
        <Shield
          className="mt-0.5 h-5 w-5 flex-none"
          style={{ color: "var(--maison-brass)" }}
        />
        <div>
          <p
            className="text-sm font-semibold"
            style={{ color: "var(--maison-text-primary)" }}
          >
            Configuration sécurisée
          </p>
          <p
            className="mt-1 text-xs md:text-sm leading-relaxed"
            style={{ color: "var(--maison-text-secondary)" }}
          >
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
            className="rounded-xl border p-5 shadow-sm dark:border-stone-800 dark:bg-stone-950"
            style={{
              background: "var(--maison-card)",
              borderColor: "var(--maison-border)",
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-10 w-10 flex-none items-center justify-center rounded-lg"
                  style={{
                    background: "var(--maison-border-subtle)",
                    color: "var(--maison-text-primary)",
                  }}
                >
                  {integration.icon}
                </div>
                <div>
                  <h2
                    className="text-sm font-semibold"
                    style={{ color: "var(--maison-text-primary)" }}
                  >
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

            <p
              className="mt-3 text-xs md:text-sm leading-relaxed"
              style={{ color: "var(--maison-text-secondary)" }}
            >
              {integration.description}
            </p>

            {integration.detail && (
              <p
                className="mt-3 rounded-lg px-3 py-2 text-xs font-mono border"
                style={{
                  background: "var(--maison-border-subtle)",
                  borderColor: "var(--maison-border)",
                  color: "var(--maison-text-primary)",
                }}
              >
                {integration.detail}
              </p>
            )}
          </article>
        ))}
      </div>

      {/* Environment variables reference */}
      <section className="space-y-3">
        <h2
          className="text-sm font-semibold uppercase tracking-wider"
          style={{ color: "var(--maison-brass)" }}
        >
          Variables d&apos;environnement attendues
        </h2>
        <div
          className="overflow-hidden rounded-xl border shadow-sm dark:border-stone-800 dark:bg-stone-950"
          style={{
            background: "var(--maison-card)",
            borderColor: "var(--maison-border)",
          }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr
                className="border-b"
                style={{
                  background: "var(--maison-border-subtle)",
                  borderColor: "var(--maison-border)",
                }}
              >
                <th
                  className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider"
                  style={{ color: "var(--maison-text-primary)" }}
                >
                  Variable
                </th>
                <th
                  className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider"
                  style={{ color: "var(--maison-text-primary)" }}
                >
                  Usage
                </th>
                <th
                  className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider"
                  style={{ color: "var(--maison-text-primary)" }}
                >
                  Visibilité
                </th>
              </tr>
            </thead>
            <tbody
              className="divide-y"
              style={{ borderColor: "var(--maison-border-subtle)" }}
            >
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
                  usage: "OAuth Google Drive & Calendar",
                  visibility: "Serveur uniquement",
                },
                {
                  name: "GOOGLE_CLIENT_SECRET",
                  usage: "OAuth Google Drive & Calendar",
                  visibility: "Serveur uniquement",
                },
                {
                  name: "SLACK_CLIENT_ID / SLACK_CLIENT_SECRET",
                  usage: "OAuth Slack futur",
                  visibility: "Serveur uniquement",
                },
                {
                  name: "WHATSAPP_BUSINESS_ACCOUNT_ID",
                  usage: "WhatsApp Business futur",
                  visibility: "Serveur uniquement",
                },
                {
                  name: "AUTH_ALLOWED_EMAILS",
                  usage: "Liste blanche utilisateurs",
                  visibility: "Serveur uniquement",
                },
              ].map((row) => (
                <tr key={row.name}>
                  <td
                    className="px-4 py-3 font-mono text-xs font-medium"
                    style={{ color: "var(--maison-text-primary)" }}
                  >
                    {row.name}
                  </td>
                  <td
                    className="px-4 py-3 text-xs"
                    style={{ color: "var(--maison-text-secondary)" }}
                  >
                    {row.usage}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        row.visibility === "Client"
                          ? "bg-blue-50 text-blue-700 border border-blue-200"
                          : "bg-amber-50 text-amber-800 border border-amber-200"
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
