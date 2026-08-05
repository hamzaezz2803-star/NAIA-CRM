<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Qarizmi OS Repository Guidance

## Commands

- Install: `npm install`
- Dev: `npm run dev`
- Format check: `npm run format:check`
- Lint: `npm run lint`
- Type check: `npm run typecheck`
- Tests: `npm run test`
- Build: `npm run build`
- Full local CI: `npm run ci`

## Boundaries

- Platform shell and shared contracts live in `src/components`, `src/platform`, and `src/app/(app)` layout files.
- CRM business work belongs in `src/features/crm` and `src/app/(app)/crm`.
- Do not edit the module registry, app shell, migrations, or permission contracts from a feature branch without updating docs and coordinating with Ali.

## Migrations

- Use timestamped SQL files in `supabase/migrations`.
- Scope business data by `organization_id`.
- Enable RLS for organization-owned tables.
- Never rely on undocumented manual database changes.

## Security

- Never commit secrets, API keys, refresh tokens, or real customer data.
- Server-only credentials must not appear in client components or `NEXT_PUBLIC_*` variables.
- External actions such as email, WhatsApp, contracts, offers, invoices, and proposal sending require human approval foundations.

## Documentation

Update `docs/architecture.md` and `docs/crm-handoff.md` when module boundaries, routes, migrations, permissions, integrations, or workflow contracts change.
