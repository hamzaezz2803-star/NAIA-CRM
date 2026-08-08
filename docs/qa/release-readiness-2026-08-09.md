# Release Readiness - 2026-08-09

## Scope

This release pass reviewed, corrected, and merged the final production changes
through PR #96. The tested application commit is
`98091453a5912f9af76f7216e47225e069a75098`.

- PR #92 removed fake Slack OAuth behavior and restored user-scoped Google
  connection handling.
- PR #93 updated vulnerable transitive dependencies and brought `npm audit` to
  zero known vulnerabilities.
- PR #94 removed anonymous execution rights from privileged Supabase RPCs and
  trigger functions.
- PR #95 added baseline HTTP response security headers.
- PR #96 made protected APIs return explicit JSON authorization errors and
  removed the anonymous identity fallback from `/api/naia/user`.

## Automated Validation

Validation was run from an isolated local clone with a clean dependency
installation, then repeated by GitHub Actions on Node 24 and by Vercel.

- Prettier: passed.
- ESLint: passed with zero warnings.
- Next route generation and TypeScript: passed.
- Vitest: 66 files and 516 tests passed.
- Next.js 16.3.0 Webpack production build: 48 routes compiled and generated.
- GitHub CI run `31284620067`: the default Turbopack build and all preceding
  checks passed on `main`.
- `npm audit`: zero known vulnerabilities.
- Supabase: the full 24-migration chain rebuilt from scratch and schema lint
  passed against the local Docker stack.
- The production hardening migration was applied and its RPC grant matrix was
  verified: privileged helpers are no longer executable by `anon`.

The local Codex sandbox prevents Turbopack's CSS worker from binding its
internal helper port. The exact default build is therefore validated by the
green GitHub CI and Vercel builds rather than the local sandbox.

## Browser And Functional QA

No real Gmail, Calendar, Slack, WhatsApp, Drive, or CRM write was performed
during automated QA.

- Route crawl: 30 routes at desktop and mobile widths, 60 of 60 checks passed.
- Functional suite: 24 of 24 scenarios passed.
- Production anonymous smoke: 20 of 20 checks passed against
  `https://os.qarizmi.com`.
- CRM covered Kanban, Calendar and List modes, synthetic local lead creation,
  lead reopening, dark mode, notifications, and mobile navigation.
- NAIA answered a general capability question as the orchestrator, retained
  the human-approval boundary, and handled missing local voice configuration
  with the intended browser fallback.
- Meetings covered weekly, list, and history views.
- Integrations displayed their real configuration state and exposed no fake
  Slack authorization flow.
- Login covered desktop and mobile, Google and magic-link options, hidden
  password access, protected-path preservation, and no root viewport overflow.
- Protected NAIA and integration APIs returned JSON `401` responses to
  anonymous requests.
- No browser console error, page error, Next.js overlay, or production `5xx`
  was detected. Vercel also reported no runtime error or `5xx` during the final
  verification window.

## Production Verification

Vercel deployment `dpl_7CAPsTj1noQD4imnViPHVvnGS1ta` was promoted to
production from `main` and served the tested commit as `READY`.

Verified response protections include:

- HSTS;
- `X-Content-Type-Options: nosniff`;
- `X-Frame-Options: DENY`;
- strict-origin referrer policy;
- camera, geolocation, payment, and USB restrictions, with microphone access
  limited to the application itself.

## Live Integration Boundary

Before the Monday or Tuesday operational session, an authorized Qarizmi user
should perform one non-destructive smoke pass for the provider paths that
cannot be safely exercised by anonymous automation:

1. Sign in with Google and confirm the user-specific Calendar and Gmail
   connection.
2. Read a Calendar slot and a Gmail thread without sending or modifying data.
3. Confirm one Slack inbound command reaches NAIA and stops at the approval
   boundary before an external write.
4. Confirm one WhatsApp inbound message from an allowlisted number reaches
   NAIA and likewise requires approval for a write.
5. Play one ElevenLabs response with the configured NAIA voice.
6. Confirm the Drive service account can read the source folder and create a
   test output only in the authorized client folder.
7. Confirm the meeting companion can authenticate and view its queue without
   claiming a real job.

## Remaining Non-Blocking Work

Supabase still reports configuration and performance recommendations rather
than release-blocking security failures:

- leaked-password protection is disabled;
- only one MFA method is available;
- eight RLS policies can avoid repeated auth-function initialization;
- seventeen tables have overlapping permissive policies that can be
  consolidated for performance.

These items should be scheduled as a dedicated hardening and performance pass.
They do not expose privileged RPCs to anonymous users and did not block the
validated production flows.

## Readiness Decision

The code, database migration, CI, deployment, anonymous access controls, and
automated product flows are ready for the planned production window. The only
remaining release gate is the short authorized-provider smoke pass above,
because automated QA intentionally avoided external side effects.
