# Qarizmi OS

Qarizmi OS is the internal operating system and AI workflow platform for Qarizmi. It starts as a pragmatic modular monolith for the Qarizmi team and keeps enough structure to support future client-facing modules.

## Current Scope

This repository currently contains the platform shell and shared foundations:

- Responsive authenticated app shell and `/login` scaffold.
- Navigation for Dashboard, CRM, Meetings, Proposals, Projects, HR, Finance, Automations, Integrations, and Settings.
- Honest Dashboard empty state with no fake business metrics.
- CRM route and handoff boundary for Hamza's Sprint 1.
- Shared module registry, permissions, domain events, integration contracts, workflow approvals, and Supabase migration foundation.
- Documentation, CI workflow, issue templates, and local quality scripts.

CRM business functionality is intentionally not implemented in this shell task.

## Stack

- Next.js App Router with TypeScript
- React
- Tailwind CSS
- Supabase for PostgreSQL, authentication, storage, and backend primitives
- Vitest for foundation tests
- ESLint and Prettier
- npm for package management

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000.

The app runs with a local auth scaffold when Supabase variables are blank.

## Environment Variables

Copy `.env.example` to `.env.local`.

Required for real Supabase authentication:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` for server-only privileged tasks when implemented

Current hosted Supabase project:

- Project URL: `https://juqhonvapkrlylvseolu.supabase.co`
- Project ref: `juqhonvapkrlylvseolu`

Production application URL:

- `https://os.qarizmi.com`

Do not commit `.env.local`, service keys, refresh tokens, provider secrets, or real client data.

## Database Setup

Supabase migrations live in `supabase/migrations`.

The initial migration creates organization, profile, membership, audit, integration, workflow, approval, file reference, and domain-event outbox foundations with RLS enabled.

When a Supabase project exists:

```bash
supabase link --project-ref <project-ref>
supabase db push
```

Install the Supabase CLI separately if it is not already available.

## Commands

```bash
npm run dev
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
npm run ci
```

## Contribution Workflow

Use `main` as the protected baseline. Build substantial work on feature branches, open a pull request, and keep platform changes separate from CRM feature work where possible.

Hamza should start from `docs/crm-handoff.md` and work primarily in:

- `src/app/(app)/crm`
- `src/features/crm`
- CRM-specific Supabase migrations

## Deployment Overview

The production app is deployed on Vercel at `https://os.qarizmi.com`. Connect Supabase through environment variables in Vercel. Hosted Supabase and Vercel project ownership should remain under Qarizmi-controlled accounts.

## Documentation

- `docs/architecture.md`
- `docs/product-scope.md`
- `docs/crm-handoff.md`
- `docs/hamza-crm-sprint-1-guide.md`
- `docs/onboarding.md`
- `docs/adr/0001-platform-stack.md`
