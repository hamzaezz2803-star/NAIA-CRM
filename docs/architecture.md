# Architecture

## Chosen Stack

Qarizmi OS uses Next.js App Router, TypeScript, Tailwind CSS, Supabase, npm, Vitest, ESLint, and Prettier.

The stack matches the baseline already discussed with Hamza while staying simple for a small consulting team. It avoids premature microservices and keeps infrastructure overhead low.

## Shape

The application is a modular monolith.

- `src/app`: route entry points and layouts.
- `src/components`: shared UI and shell components.
- `src/platform`: shared platform contracts for auth, modules, permissions, events, integrations, workflows, and approvals.
- `src/features`: business feature modules. CRM starts in `src/features/crm`.
- `supabase/migrations`: version-controlled database schema.
- `docs`: architecture, onboarding, product scope, and handoff materials.

## Module Boundaries

Navigation is driven by `src/platform/core/modules.ts`. Feature teams should consume the registry rather than hard-coding shell navigation.

The CRM module has a stable route at `/crm` and a developer handoff page at `/crm/handoff`. Hamza can add CRM screens below the CRM route and feature folder without editing the app shell.

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

## Workflows And Integrations

The platform defines contracts for workflow runs, approval requests, integration connections, and domain events. It does not implement a full workflow engine.

External actions must flow through human approval before provider execution.

## Current Trade-offs

- Auth user creation and invite policy still live in the Supabase dashboard.
- The Dashboard shows foundation state only, not synthetic operational metrics.
- CRM business tables are not created yet to keep Hamza's implementation isolated.
- No Trello runtime dependency exists.
- `npm audit` currently reports a moderate PostCSS advisory through Next.js 16.2.9's nested dependency. The latest stable Next release is already installed, and `npm audit fix --force` proposes a breaking downgrade, so this should be revisited when Next publishes a stable patched release.

## Intentionally Not Built

- Complete CRM business logic.
- Trello import.
- AI assistants.
- OAuth provider flows.
- Rich profile and organization membership synchronization after login.
- Complex multi-agent orchestration.
