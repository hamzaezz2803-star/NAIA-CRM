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

Supabase is the authentication provider. The primary sign-in method is "Sign in with Google" through the Supabase Google provider (`signInWithGoogleAction`): one click authenticates the employee and captures Google Calendar/Gmail provider tokens, which `/auth/callback` persists as that user's own `integration_connections` row. The email magic link remains as a fallback. The `(app)` route group is protected by middleware and the app layout reads the authenticated Supabase user before rendering internal pages. Client code uses `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, with a legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` fallback for older projects.

Application access is also checked against `AUTH_ALLOWED_EMAILS` when it is set, otherwise against `AUTH_ALLOWED_EMAIL_DOMAIN`, which defaults to `qarizmi.com`. The Google Cloud OAuth consent screen should be set to Internal so only the qarizmi.com Workspace can authenticate; the `handle_new_user` trigger (migration `20260708120000`) auto-provisions a profile and a `member` membership for new `@qarizmi.com` sign-ins (cofounder emails become `owner`).

The current hosted Supabase project ref is `juqhonvapkrlylvseolu`.

The current production application URL is `https://os.qarizmi.com`.

Roles are modeled as `owner`, `admin`, `member`, and `viewer` in `src/platform/core/permissions.ts` and in the initial database migration. `getAppSession` resolves the real role from `organization_memberships` (unknown users fall back to `viewer`). Module access can be gated by role through `moduleAccessRequirements`/`canAccessModule`: the Docs Generator module (`/proposals`) and the CRM Drive folders page (`/dashboard/drives`) are owner-only (cofounders), enforced server-side in the pages and hidden from the navigation for other roles.

CRM write access is restricted to contributors (`owner`, `admin`, `member`) by the `public.is_org_contributor` helper and CRM RLS policies. `viewer` can keep read access through membership policies but cannot create or update CRM records.

## Workflows And Integrations

The platform defines contracts for workflow runs, approval requests, integration connections, and domain events. It does not implement a full workflow engine.

External actions must flow through human approval before provider execution.

NAIA can prepare internal CRM actions through `/api/naia/orchestrate`. CRM reads use `fetchLeadsAction()`. In local development, `CRM_DUMMY_DATA=enabled` can seed a sandbox CRM view when Supabase auth or CRM rows are unavailable; production should only enable this for isolated demo/sandbox environments. CRM writes are limited to explicit, validated actions such as `createLeadAction()` and `updateLeadStatusAction()` and are presented as human-approved actions before execution. Prospect/client meeting commands are CRM-first: Salma creates or updates the lead, then Adam can verify Google Calendar availability and create the event from the validated lead context. The route recomputes actions server-side from the submitted command and validates a short-lived HMAC approval token before writing. Configure `NAIA_ACTION_APPROVAL_SECRET` for this signing key; the server-only Supabase service role key is only a fallback. NAIA must not read provider tokens or send external communications directly.

When Groq orchestration is enabled, `/api/naia/orchestrate` also injects the acting user's real Google Calendar agenda (next 7 days, read through their own per-user connection via `listGoogleCalendarEvents()`) into the LLM context as `realGoogleCalendar`, with the instruction that this real agenda overrides the dummy operating data for scheduling questions. Privacy implication: when `GROQ_API_KEY` is configured, the titles and dates of the user's upcoming calendar events are sent to Groq as part of that context. If the user has no Google connection, the context is silently omitted and orchestration falls back to CRM-only data. The `/meetings` page similarly reads the user's real agenda (14 days) server-side and shows it in a dedicated "Mon agenda Google" panel, deduplicated against CRM leads already synced to Calendar via the `[Google Calendar Event ID/Link: ...]` note markers.

NAIA voice uses `/api/naia/transcribe` for Groq Whisper input and `/api/naia/voice` for ElevenLabs output. Groq Whisper runs without a forced language so French/English mixed commands keep their original language, with a short business-context transcription prompt. Provider secrets remain server-only. The default ElevenLabs voice is "Martin Dupont" (`a5n9pJUnAhX4fn7lx3uo`), used whenever `ELEVENLABS_VOICE_ID` is unset; `ELEVENLABS_FALLBACK_VOICE_ID` stays a distinct free-tier rescue voice. Because ElevenLabs audio arrives long after the initiating click, the client primes a reusable audio element inside the user gesture (`primeVoicePlayback()` in `src/features/naia/voice-client.ts`) so Safari/WebKit allows the first playback of the session; both ElevenLabs playback and the speech-synthesis fallback run at the shared `VOICE_PLAYBACK_RATE` (1.25x). If ElevenLabs is missing, blocked by the selected voice, or unreachable, the client surfaces the reason and falls back to browser speech synthesis instead of failing silently.

Google access is split into two lanes. Personal data (each employee's Calendar and Gmail) uses per-user OAuth tokens stored in `integration_connections`, unique per `(organization, provider, connected_by_profile_id)` with self-service RLS: a member can only read and manage their own connection, so NAIA agents always act on the acting user's own account. Organizational client IP uses a Google service account (`GOOGLE_SERVICE_ACCOUNT_KEY`, `src/platform/integrations/google-drive-service.ts`) that is a member of the cofounders-only shared drive: CRM client folders (one folder per client company, with the standard `01_Pitch` … `05_Delivery` subfolders) are created under the `clients` folder (`MAYA_DRIVE_OUTPUT_FOLDER_ID`), and Maya reads the pitch library from `MAYA_DRIVE_SOURCE_FOLDER_ID`. Google itself enforces the cofounder boundary through shared-drive membership. This replaces the earlier Hamza-created Drive target (`NAIA'S-INFOS`) and the per-lead folder naming.

The former Proposals module is now Docs Generator. Maya owns pitch generation when a lead reaches `meeting-booked` and proposal drafting after meeting completion, while CRM remains the source of lead status and customer context.

Maya Pitch Generator V1 lives in `src/features/maya` and is cofounder-only by design. Server actions call `requireMayaPitchGeneratorAccess()` and the Supabase migration `20260708090000_maya_pitch_generator.sql` adds RLS tables guarded by Ali/Nabil email plus organization membership. In production, Maya uses the organization Google service account to read `MAYA_DRIVE_SOURCE_FOLDER_ID` and write drafts into the client `01_Pitch` subfolder under `MAYA_DRIVE_OUTPUT_FOLDER_ID`; individual Google login no longer requests Drive scopes. Local development can still use the synced private Drive filesystem paths. Pitch generation never runs automatically: it is an explicit human action locked server-side to owner roles via `requireMayaPitchGenerationAccess()`, and the service-account Drive download handles Google-native formats (Slides/Docs are exported to pptx/docx, capped at 10 MB by the Drive API).

The draft generator starts from the latest `Qarizmi_Introduction_Service as a software_Generic.pptx`, removes credential slides Maya did not select, appends editable preliminary diagnostic/use-case slides from CRM context, and writes `maya-generation-manifest.json` next to the PPTX. When `MAYA_OPENAI_API_KEY` is configured, only Maya's cofounder-gated draft action calls OpenAI to enrich the credential selection, diagnostic outline, follow-up questions, and use-case bullets before PPTX generation; otherwise it falls back to deterministic planning. Nabil's final `*_vF.pptx` files remain the learning source: Maya compares draft vs final text to record slide additions/removals/copy changes without storing full raw deck contents.

Integration readiness is centralized in `src/platform/integrations/readiness.ts`. Google Drive, Calendar event creation, and Calendar FreeBusy checks have OAuth and CRM actions today; Slack now has an inbound NAIA bridge (see below); Gmail API sending, WhatsApp, and Microsoft 365 must show as non-implemented or guarded until their runtime routes, scopes, tokens, sync jobs, and audit trails exist.

## NAIA on Slack

Team members can talk to NAIA from Slack (DM to the bot or `@NAIA` mention) without opening the site. The flow keeps the exact same human-approval contract as the web cockpit:

1. `POST /api/slack/events` receives `message.im` and `app_mention` events. Both Slack routes are exempted from the auth middleware (they would otherwise be redirected to `/login`) and authenticate every request themselves against `SLACK_SIGNING_SECRET` (Slack `v0` HMAC SHA-256 signature plus a 5-minute timestamp tolerance against replays). Bot messages are ignored; `http_timeout` retries (`X-Slack-Retry-Num` + `X-Slack-Retry-Reason`) are acknowledged without reprocessing because the first delivery already scheduled the work, while other retry reasons go through. The route acks Slack in under 3 seconds and schedules the real work with Next `after()`.
2. The Slack user is mapped to a Qarizmi OS account by email: `users.info` (bot token, `users:read.email` scope) gives the Slack profile email, and `resolveBridgeUser` in `src/platform/naia/bridge.ts` matches it against `profiles` + `organization_memberships` through the server-only service-role Supabase client (`createServiceRoleSupabaseClient`). Unknown emails get a "compte non reconnu" reply and nothing else runs.
3. `planBridgeCommand` reuses the pure orchestrator (`orchestrateNaiaCommand`) with the real org-scoped CRM leads and signs every proposed action with the same HMAC approval tokens as the web route (`src/platform/naia/action-tokens.ts`, `NAIA_ACTION_APPROVAL_SECRET`, 5-minute TTL). The token embeds the full approved action (kind + payload + id) plus the command hash, so execution always runs exactly what was approved. NAIA answers in Slack with its analysis plus one "✅ Valider" (primary) / "❌ Ignorer" button pair per action (Block Kit).
4. Button values only carry the serialized `{actionId, approvalToken, command}` triple inline (stateless, serverless-safe): the action itself is decoded from the verified token. Slack commands are truncated to 500 characters before planning so the value stays under Slack's 2000-character limit (long dictated notes are truncated on this channel); a pathologically oversized draft degrades to a "validate from the web cockpit" note instead of a broken button.
5. `POST /api/slack/interactions` verifies the same signature, re-resolves the clicking user by email on every click (an unresolved account never executes), immediately rewrites the original message to "⏳ Validation en cours…", then executes through `executeBridgeAction`, which re-verifies the token, claims it as **single-use** in `naia_consumed_action_tokens` (migration `20260708153000`, service-role only: RLS enabled with no policy and API roles revoked — a duplicate claim aborts before any side effect), and checks the role with `hasPermission` for CRM writes. The shared message is then updated with the status line only; sensitive results (Gmail/Calendar summaries) are sent as an ephemeral reply visible only to the clicking user.

Executable actions from Slack are limited to `google.calendar.listEvents`, `google.gmail.listMessages` (per-user Google connections, resolved through an injected service-role context instead of cookies), `crm.updateLeadStatus`, and `crm.createLead`. Other drafted kinds (Maya pitch, dev spec, follow-up drafts, Slack sends) answer with a pointer to the web cockpit. The bridge never sends external communications by itself.

The next durable orchestration step is a universal approval queue backed by `approval_requests`, immutable audit events, and capability packs for Gmail, Slack, Calendar, Drive, and CRM drafts. Provider sends, document sharing, invoices, offers, contracts, migrations, and PR creation should stay behind explicit approval.

## Current Trade-offs

- Auth user creation can happen through Google sign-in (with trigger-based provisioning) or remain manual in the Supabase dashboard; role upgrades stay manual.
- Legacy org-shared Google connections were revoked by migration `20260708120000`; each user reconnects by signing in with Google once. Client folders created before the per-client layout remain in the old Drive location and can be moved manually.
- The Dashboard shows foundation state only, not synthetic operational metrics.
- `npm audit` currently reports a moderate PostCSS advisory through Next.js 16.2.9's nested dependency. The latest stable Next release is already installed, and `npm audit fix --force` proposes a breaking downgrade, so this should be revisited when Next publishes a stable patched release.

## Intentionally Not Built

- Slack per-user OAuth, WhatsApp, Microsoft 365, and Gmail API OAuth provider flows. The Slack bridge uses a workspace bot token plus signing secret, not per-user OAuth.
- Rich profile and organization membership synchronization after login.
- Unbounded autonomous code modification. A future developer agent should create a spec, branch, and review request before implementation, not mutate production code without a human gate.
- Direct Gmail/Drive ingestion in NAIA and Slack channel history ingestion. Beyond the command-driven Slack bridge, the integration cards are readiness indicators until provider-specific OAuth, scopes, sync jobs, and audit trails are implemented.
