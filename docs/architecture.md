# Architecture

## Chosen Stack

Qarizmi OS uses Next.js App Router, TypeScript, Tailwind CSS, Supabase, npm, Vitest, ESLint, and Prettier.

The stack matches the baseline already discussed with Hamza while staying simple for a small consulting team. It avoids premature microservices and keeps infrastructure overhead low.

## Shape

The application is a modular monolith.

- `src/app`: route entry points and layouts.
- `src/components`: shared UI and shell components.
- `src/platform`: shared platform contracts for auth, modules, permissions, events, integrations, workflows, and approvals.
- `src/features`: business feature modules. CRM starts in `src/features/crm`; NAIA orchestration lives in `src/features/naia`.
- `supabase/migrations`: version-controlled database schema.
- `docs`: architecture, onboarding, product scope, and handoff materials.

## Module Boundaries

Navigation is driven by `src/platform/core/modules.ts`. Feature teams should consume the registry rather than hard-coding shell navigation.

The CRM module has a stable route at `/crm` and a developer handoff page at `/crm/handoff`. Hamza can add CRM screens below the CRM route and feature folder without editing the app shell.

The shell CRM entry opens the working pipeline directly at `/dashboard/leads`. That route intentionally uses a denser full-width shell layout so the Kanban can show all CRM columns at once on desktop instead of centering a narrow dashboard canvas.

NAIA has a stable route at `/naia`. It is the voice-first orchestrator for the platform modules and routes user intent to specialized agents such as CRM, finance, delivery, HR, integrations, and developer workflow. The NAIA home uses the imported Jarvis wake/sphere visual in `src/features/naia/vendor/jarvis` with a local notice; review AGPL obligations before public redistribution.

NAIA agent pages currently live under `/naia/leads`, `/naia/cash-flow`, `/naia/crm`, `/naia/projects`, and `/naia/hr`. The home cockpit keeps the sphere/orbit experience and routes voice/text commands to these modules.

## Data Ownership

Business data must be organization-scoped. The first migration creates:

- organizations
- profiles
- organization memberships
- audit events
- integration connections
- workflow runs
- approval requests
- file references
- domain event outbox

CRM-specific tables should be introduced in a later CRM migration and include `organization_id`.

## Authentication And Permissions

Supabase is the authentication provider. The `(app)` route group is protected by middleware and the app layout reads the authenticated Supabase user before rendering internal pages. Client code uses `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, with a legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` fallback for older projects.

Application access is also checked against `AUTH_ALLOWED_EMAILS` when it is set, otherwise against `AUTH_ALLOWED_EMAIL_DOMAIN`, which defaults to `qarizmi.com`. Production should keep public signup disabled in Supabase and invite users explicitly.

The current hosted Supabase project ref is `juqhonvapkrlylvseolu`.

The current production application URL is `https://os.qarizmi.com`.

Roles are modeled as `owner`, `admin`, `member`, and `viewer` in `src/platform/core/permissions.ts` and in the initial database migration.

CRM write access is restricted to contributors (`owner`, `admin`, `member`) by the `public.is_org_contributor` helper and CRM RLS policies. `viewer` can keep read access through membership policies but cannot create or update CRM records.

## Workflows And Integrations

The platform defines contracts for workflow runs, approval requests, integration connections, and domain events. It does not implement a full workflow engine.

External actions must flow through human approval before provider execution.

NAIA can prepare internal CRM actions through `/api/naia/orchestrate`. CRM reads use `fetchLeadsAction()`. In local development, `CRM_DUMMY_DATA=enabled` can seed a sandbox CRM view when Supabase auth or CRM rows are unavailable; production should only enable this for isolated demo/sandbox environments. CRM writes are limited to explicit, validated actions such as `createLeadAction()` and `updateLeadStatusAction()` and are presented as human-approved actions before execution. Prospect/client meeting commands are CRM-first: Salma creates or updates the lead, then Adam can verify Google Calendar availability and create the event from the validated lead context. The route recomputes actions server-side from the submitted command and validates a short-lived HMAC approval token before writing. Configure `NAIA_ACTION_APPROVAL_SECRET` for this signing key; the server-only Supabase service role key is only a fallback. NAIA must not read provider tokens or send external communications directly.

NAIA voice uses `/api/naia/transcribe` for Groq Whisper input and `/api/naia/voice` for ElevenLabs output. Groq Whisper defaults to `fr` via `GROQ_WHISPER_LANGUAGE` to avoid translating French commands into English; set `GROQ_WHISPER_LANGUAGE=auto` only if automatic multilingual detection is preferred. The transcription prompt still preserves mixed French/English business terms, CRM terms, company names, people names, dates, and times. Provider secrets remain server-only. If ElevenLabs is missing, blocked by the selected voice, or unreachable, the client surfaces the reason and falls back to browser speech synthesis instead of failing silently.

Integration readiness is centralized in `src/platform/integrations/readiness.ts`. Google Drive, Calendar event creation, and Calendar FreeBusy checks have OAuth and CRM actions today; Gmail API, Slack, WhatsApp, and Microsoft 365 must show as non-implemented or guarded until their runtime routes, scopes, tokens, sync jobs, and audit trails exist.

The next durable orchestration step is a universal approval queue backed by `approval_requests`, immutable audit events, and capability packs for Gmail, Slack, Calendar, Drive, and CRM drafts. Provider sends, document sharing, invoices, offers, contracts, migrations, and PR creation should stay behind explicit approval.

## Current Trade-offs

- Auth user creation and invite policy still live in the Supabase dashboard.
- The Dashboard shows foundation state only, not synthetic operational metrics.
- `npm audit` currently reports a moderate PostCSS advisory through Next.js 16.2.9's nested dependency. The latest stable Next release is already installed, and `npm audit fix --force` proposes a breaking downgrade, so this should be revisited when Next publishes a stable patched release.

## Intentionally Not Built

- Slack, WhatsApp, Microsoft 365, and Gmail API OAuth provider flows.
- Rich profile and organization membership synchronization after login.
- Unbounded autonomous code modification. A future developer agent should create a spec, branch, and review request before implementation, not mutate production code without a human gate.
- Direct Slack/Gmail/Drive ingestion in NAIA. The integration cards are readiness indicators until provider-specific OAuth, scopes, sync jobs, and audit trails are implemented.
