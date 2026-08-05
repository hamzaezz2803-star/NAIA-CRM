# Release Readiness - 2026-08-05

## Scope

This consolidation was prepared from a fresh clone of `main` and covers the
four pull requests that were still open:

- PR #82: NAIA redesign and contextual assistant, retained and hardened.
- PR #83: superseded UI/integration prototype, not merged as-is.
- PR #84: superseded disconnect prototype, not merged as-is.
- PR #90: rejected fake FlowNote and OAuth paths, not merged as-is.

The retained integration behavior stays truthful: Google is user-scoped OAuth,
Slack is an organization-level server configuration, and external writes still
require the existing human approval controls.

## Automated Validation

Run from a clean `npm ci` installation:

- Prettier: all files formatted.
- ESLint: zero warnings.
- Next route generation and TypeScript: passed.
- Vitest: 60 files and 491 tests passed.
- Next.js 16.3.0 Webpack production build: 47 routes compiled and generated.
- `npm audit`: zero known vulnerabilities.
- Diff secret scan: no API key, token, or private-key pattern found.

The local sandbox does not allow the Turbopack CSS worker to bind its internal
port. The exact `npm run build` Turbopack command therefore remains a required
GitHub CI check on the pull request, where it runs on an unrestricted Node 24
runner.

## Browser Validation

The application was started without production secrets, with authentication
development bypass and `CRM_DUMMY_DATA=enabled`. No real external write was
performed.

- 29 routes at 1440 x 1000 and 390 x 844: 58 checks passed.
- Every route returned meaningful content with no error overlay.
- No page error, console error, or root viewport overflow was detected.
- Dynamic client detail rendered its company, contact, and opportunity on both
  desktop and mobile.
- A synthetic lead was created through the real form and appeared in the list.
- CRM list filters constrained NAIA's visible-count answer.
- An explicit whole-CRM question bypassed the visible filters as requested.
- Switching from list to Kanban cleared the list-only context.
- An unknown named lead produced a clarification instead of mutating the
  selected lead.
- Meetings history matched the three rows visible in the current view.
- General questions stayed with NAIA instead of being forced to the CRM agent.
- Mobile navigation and dark mode were exercised successfully.

## Live Integration Boundary

The automated suite verifies authentication guards, readiness contracts,
server-only configuration, OAuth fallback routing, and approval boundaries.
It deliberately does not send real Gmail, Calendar, Slack, WhatsApp, Drive, or
ElevenLabs requests. Those require a non-destructive smoke test by an authorized
user in the deployed environment.

## Merge Gate

Merge only when all GitHub checks, including the exact Turbopack build and
Vercel Preview, are green. After merge, verify the production deployment and
smoke-test login, Dashboard, CRM, Meetings, Integrations, and NAIA on
`https://os.qarizmi.com`.
