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

NAIA can prepare internal CRM actions through `/api/naia/orchestrate`. CRM reads use `fetchLeadsAction()`. In local development, `CRM_DUMMY_DATA=enabled` can seed a sandbox CRM view when Supabase auth or CRM rows are unavailable; production should only enable this for isolated demo/sandbox environments. CRM writes are limited to explicit, validated actions such as `createLeadAction()` and `updateLeadStatusAction()` and are presented as human-approved actions before execution. Prospect/client meeting commands are CRM-first: Salma creates or updates the lead, then Adam can verify Google Calendar availability and create the event from the validated lead context. Personal reminder wording (for example, "rappelle-moi d'envoyer la présentation demain matin") creates a distinct transparent Calendar reminder and must not promote the CRM lead to `meeting-booked`. The short-lived HMAC approval token embeds the exact action payload that was shown for review; execution verifies and decodes that payload instead of asking the LLM to derive it again. Configure `NAIA_ACTION_APPROVAL_SECRET` for this signing key; the server-only Supabase service role key is only a fallback. NAIA must not read provider tokens or send external communications directly.

Web and conversational bridges share `planNaiaAssistant()` in `src/platform/naia/assistant.ts`. The pure orchestrator first classifies every turn as an `answer`, an `action`, or a `handoff`: deterministic CRM reads and all write plans remain authoritative, while Groq is only used for open questions that need a natural-language answer. The assistant receives a bounded eight-message conversation history, an organization-scoped CRM snapshot, the acting user's Calendar only when the question needs it, and an explicit source label for every context block. CRM and connected Google data are live; Finance, Projects, and HR still use simulated working data and every answer based on those fixtures must say so. Slack formatting is canonicalized before extraction so mentions, links, `mailto` and `tel` markup cannot pollute the CRM draft or hide contact details.

Groq text generation is centralized in `src/platform/ai/groq.ts`. Semantic orchestration and CRM extraction use `GROQ_ORCHESTRATOR_MODEL` (Qwen 3.6 by default with `reasoning_effort=none`); bounded low-risk copy uses `GROQ_FAST_MODEL` (GPT-OSS 20B); every provider error, malformed JSON, or Zod validation failure retries once through `GROQ_STRUCTURED_FALLBACK_MODEL` (GPT-OSS 120B with strict JSON Schema). Known retiring Llama/Qwen model IDs are ignored even when left in the legacy `GROQ_MODEL` variable, so an old Vercel setting cannot silently keep NAIA on a shutdown model. The model never has authority over writes: CRM statuses and relative dates are normalized deterministically after extraction, using `Africa/Casablanca`, before the structured draft reaches any approval surface. `GROQ_RESEARCH_MODEL` reserves Compound Mini for future public, cited lead research; it is not part of the private CRM/Calendar orchestration path.

Identity and explicit read-only questions use a deterministic personal-query lane before generic LLM routing. `Qui suis-je ?` is answered from the authenticated Qarizmi profile; Gmail access questions inspect the acting user's real OAuth connection; Gmail inbox and Google Calendar questions read only that user's account; and an explicit `meetings CRM` question stays on organization-scoped CRM data. Short follow-ups such as `et ceux hors CRM ?` preserve the previous Gmail/Calendar source. The user's explicit read request is the consent for an immediate read-only answer in the authenticated web cockpit, a Slack DM, or the private WhatsApp conversation; no provider write or send is performed. Shared Slack channel mentions never load or display profile, Gmail, Calendar, or CRM-meeting details and instead direct the user to NAIA's DM. Provider failures are reported without exposing OAuth tokens or raw provider payloads. CRM mutations, Calendar creation, email sending, and every other external write remain behind the existing signed human-approval flow.

For Ali and Nabil, NAIA can enrich open questions and `Qui suis-je ?` from the latest generic Qarizmi deck in the cofounders-only pitch-library Drive. `src/platform/naia/private-knowledge.ts` lists the Drive folder, detects the current generic PPTX version, downloads and indexes it only on a cold cache or source modification, removes the temporary file, and sends Groq at most four query-relevant slide excerpts. The authenticated founder's isolated profile excerpt is added only when the question explicitly concerns their own identity or background. The deck remains the source of truth: no CV or slide text is committed to Git, copied into Supabase, written to logs, or loaded for members, viewers, shared Slack mentions, or unauthenticated surfaces. Drive failures degrade to the normal NAIA answer path instead of blocking CRM, Gmail, Calendar, or approvals.

When Groq orchestration is enabled, `/api/naia/orchestrate` also injects the acting user's real Google Calendar agenda (next 7 days, read through their own per-user connection via `listGoogleCalendarEvents()`) into the LLM context as `realGoogleCalendar`, with the instruction that this real agenda overrides the dummy operating data for scheduling questions. Privacy implication: when `GROQ_API_KEY` is configured, the titles and dates of the user's upcoming calendar events are sent to Groq as part of that context. If the user has no Google connection, the context is silently omitted and orchestration falls back to CRM-only data. The `/meetings` page similarly reads the user's real agenda (14 days) server-side and shows it in a dedicated "Mon agenda Google" panel, deduplicated against CRM leads already synced to Calendar via the `[Google Calendar Event ID/Link: ...]` note markers.

NAIA voice uses `/api/naia/transcribe` for Groq Whisper input and `/api/naia/voice` for ElevenLabs output. Groq Whisper runs without a forced language so French/English mixed commands keep their original language, with a short business-context transcription prompt. Provider secrets remain server-only. `ELEVENLABS_VOICE_ID` is the only official primary NAIA voice: no voice ID is built into the application, and a client-supplied `voiceId` cannot override it. `ELEVENLABS_FALLBACK_VOICE_ID` is optional and must be distinct; the server uses it only as an explicit rescue when ElevenLabs rejects or cannot provide the primary voice, and marks rescued audio with `X-NAIA-Voice-Fallback`. If the primary configuration is missing or both ElevenLabs attempts fail, `/api/naia/voice` returns the existing browser-fallback response. Because ElevenLabs audio arrives long after the initiating click, the client primes a reusable audio element inside the user gesture (`primeVoicePlayback()` in `src/features/naia/voice-client.ts`) so Safari/WebKit allows the first playback of the session; both ElevenLabs playback and the speech-synthesis fallback run at the shared `VOICE_PLAYBACK_RATE` (1.25x). The client surfaces the provider failure reason before using browser speech synthesis instead of failing silently.

Google access is split into two lanes. Personal data (each employee's Calendar and Gmail) uses per-user OAuth tokens stored in `integration_connections`, unique per `(organization, provider, connected_by_profile_id)` with self-service RLS: a member can only read, reconnect, or delete their own connection from the integrations page, so NAIA agents always act on the acting user's own account. Organizational client IP uses a Google service account (`GOOGLE_SERVICE_ACCOUNT_KEY`, `src/platform/integrations/google-drive-service.ts`) that is a member of the cofounders-only shared drive: CRM client folders (one folder per client company, with the standard `01_Pitch` … `05_Delivery` subfolders) live under the `clients` folder (`MAYA_DRIVE_OUTPUT_FOLDER_ID`), and Maya reads the legacy founder knowledge library from `MAYA_DRIVE_SOURCE_FOLDER_ID`. Docs Generator pins its audited native PPTX through both `MAYA_PITCH_TEMPLATE_FILE_ID` and the mandatory `MAYA_PITCH_TEMPLATE_SHA256`; production stays fail-closed until an independently audited digest is configured. Google itself enforces the cofounder boundary through shared-drive membership. This replaces the earlier Hamza-created Drive target (`NAIA'S-INFOS`) and the per-lead folder naming.

The former Proposals module is now Docs Generator. Maya owns pitch generation when a lead reaches `meeting-booked` and proposal drafting after meeting completion, while CRM remains the source of lead status and customer context.

Meeting Intelligence is a transcript-first, founder-only workflow. The CRM trigger creates a first-class `meetings` row for every dated `meeting-booked` lead regardless of whether the lead came from web, Slack, WhatsApp, or another agent. Ali and Nabil upload recording chunks directly from the authenticated browser to the private `meeting-recordings` bucket. A Mac-local companion claims durable jobs through bearer-authenticated outbound HTTPS, keeps Whisper and Claude CLI local, and sends back the transcript, reviewed-notes draft, evidence timestamps, and typed recommendations. Pitch slides and CRM notes are contextual inputs only; the transcript remains the source of truth. Outputs archive under the client's private `02_Meeting Notes` Drive folder. CRM or Calendar writes are applied only after a founder selects each recommendation in the review UI. Worker failure, review locking, final approval, and idempotence markers are enforced transactionally in Supabase so retries cannot duplicate actions or overwrite a newer human CRM edit. See `docs/meeting-notes-companion.md`.

Maya Pitch Generator V1 lives in `src/features/maya` and is cofounder-only by design. Server actions call `requireMayaPitchGeneratorAccess()` and the Supabase migrations `20260708090000_maya_pitch_generator.sql` and `20260809224332_maya_pitch_upload_claims.sql` add RLS tables guarded by Ali/Nabil email plus organization membership. The Drive-writing action re-reads the lead inside the authenticated organization, resolves the destination only from `crm_leads.drive_folder_url` and `crm_companies.drive_folder_url`, rejects conflicting URLs, verifies that the linked folder is directly under `MAYA_DRIVE_OUTPUT_FOLDER_ID`, and requires exactly one existing `01_Pitch`. Maya never creates or repairs a folder during queue reads or pitch generation. Pitch copying never runs automatically: it requires a checked confirmation in Docs Generator or a separately signed NAIA approval and remains locked server-side to owner roles via `requireMayaPitchGenerationAccess()`.

The `pitch` family uses the audited client-neutral `Qarizmi_Introduction_Service as a software_Teaser.pptx` pinned by exact filename, `MAYA_PITCH_TEMPLATE_FILE_ID`, and `MAYA_PITCH_TEMPLATE_SHA256`. The source must be a native PPTX; Google Slides exports and any head revision whose downloaded bytes differ from the configured digest are rejected. The audited Teaser contains no client name and no client/industry placeholder: its Healthcare, Retail/Hospitality, Industrials/Transport/Logistics and Financial Services labels are generic credential-section headings, not fields to substitute. Docs Generator therefore states explicitly that only the output filename is adapted; it must not claim that a client name or industry was replaced inside the deck. Before any upload, Maya scans all textual OOXML parts (slides, tables, notes, comments, relationships and document properties) for blocked client residue, copies the package byte-for-byte, verifies the source, local copy and any reconciled Drive draft against the audited SHA-256, and adapts only the output filename. A transactional Supabase claim globally keyed by destination `01_Pitch` and output filename allows exactly one active upload; `claim`, `uploaded`, and `failed` states support safe retries that re-read and hash an existing file without deleting it. Each claim persists a Drive-pre-generated file ID, so a retry after an indeterminate create response reuses that ID and Drive returns a conflict instead of creating a duplicate. The lease is renewed transactionally immediately before the external write, so a stale worker cannot upload after another request reclaims its lease. Reconciliation also requires the expected name and parent folder and fails closed on duplicate names. It uploads one PPTX and no visible JSON manifest. `MAYA_OPENAI_API_KEY` and Groq are not called by this V1 flow. The `commercial-proposal` family is modeled separately but remains gated for manual review because the latest proposal contains client-specific scope, pricing, dates and legal content. Existing `*_vF.pptx` files remain visible as Nabil's final versions; no automatic content-learning mutation occurs in the faithful-clone path.

Integration readiness is centralized in `src/platform/integrations/readiness.ts`. Google Drive, Calendar event creation, and Calendar FreeBusy checks have OAuth and CRM actions today; Slack and WhatsApp now have inbound NAIA bridges (see below); Gmail API sending and Microsoft 365 must show as non-implemented or guarded until their runtime routes, scopes, tokens, sync jobs, and audit trails exist.

Slack is an organization-level server integration, not a per-user OAuth
connection. `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET` are configured only in
Vercel/server environment variables; no browser form, OAuth callback, or
`integration_connections` row may contain the workspace bot token. The
integrations page therefore reports server readiness but does not offer a fake
self-service disconnect: removing or rotating the Vercel credentials and the
Slack app installation is the actual administrative disconnect path.

## Brief privé NAIA à 09:30

`GET /api/cron/naia-daily-brief` construit un brief en lecture seule à partir
des tâches et relances CRM, du Calendar principal et des messages Gmail récents
du destinataire. La route Vercel Cron est protégée par `CRON_SECRET`, valide la
fenêtre locale `Africa/Casablanca`, refuse tout destinataire qui n'est pas Ali
ou Nabil avec le rôle `owner`, et envoie uniquement un DM Slack résolu par
email. La table service-role-only `naia_daily_brief_runs` assure l'idempotence
par profil et date locale : les échecs prouvés sans livraison sont reclaimables
atomiquement, tandis qu'un résultat Slack ambigu est verrouillé sans replay.
Aucun mail, événement ou changement CRM n'est créé.
Voir `docs/naia-daily-brief.md`.

## NAIA on Slack

Team members can talk to NAIA from Slack (DM to the bot or `@NAIA` mention) without opening the site. The flow keeps the exact same human-approval contract as the web cockpit:

1. `POST /api/slack/events` receives `message.im` and `app_mention` events. Both Slack routes are exempted from the auth middleware (they would otherwise be redirected to `/login`) and authenticate every request themselves against `SLACK_SIGNING_SECRET` (Slack `v0` HMAC SHA-256 signature plus a 5-minute timestamp tolerance against replays). Bot messages are ignored; `http_timeout` retries (`X-Slack-Retry-Num` + `X-Slack-Retry-Reason`) are acknowledged without reprocessing because the first delivery already scheduled the work, while other retry reasons go through. The route acks Slack in under 3 seconds and schedules the real work with Next `after()`.
2. The Slack user is mapped to a Qarizmi OS account by email: `users.info` (bot token, `users:read.email` scope) gives the Slack profile email, and `resolveBridgeUser` in `src/platform/naia/bridge.ts` matches it against `profiles` + `organization_memberships` through the server-only service-role Supabase client (`createServiceRoleSupabaseClient`). Unknown emails get a "compte non reconnu" reply and nothing else runs.
3. `planBridgeCommand` calls the same `planNaiaAssistant()` contract as the web cockpit with the real org-scoped CRM leads and up to eight recent messages from the DM or thread. Explicit read-only identity, Gmail, Calendar, and CRM questions answer directly in a DM; an `app_mention` is marked as a shared surface before planning and personal queries are redirected to DM without loading provider data. The bridge signs every proposed write action with the same HMAC approval tokens as the web route (`src/platform/naia/action-tokens.ts`, `NAIA_ACTION_APPROVAL_SECRET`, 5-minute TTL). The token embeds the full approved action (kind + payload + id) plus the command hash, so execution always runs exactly what was approved. NAIA answers in Slack with a direct answer or its analysis plus review controls for each action (Block Kit).
4. Button values only carry the serialized `{actionId, approvalToken, command}` triple inline (stateless, serverless-safe): the action itself is decoded from the verified token. Slack commands are truncated to 500 characters before planning so the value stays under Slack's 2000-character limit (long dictated notes are truncated on this channel); a pathologically oversized draft degrades to a "validate from the web cockpit" note instead of a broken button.
5. Lead actions render the complete structured draft (company, contact, job, email, phone, status, date, source, next action, and notes) before approval. "Vérifier / modifier" opens a Slack modal; `view_submission` validates the fields, signs the edited payload, and executes that exact version. `POST /api/slack/interactions` verifies the Slack signature, re-resolves the clicking user by email on every click (an unresolved account never executes), immediately rewrites the original message to "⏳ Validation en cours…", then executes through `executeBridgeAction`, which re-verifies the token, claims it as **single-use** in `naia_consumed_action_tokens` (migration `20260708153000`, service-role only: RLS enabled with no policy and API roles revoked — a duplicate claim aborts before any side effect), and checks the role with `hasPermission` for CRM writes. The shared message is then updated with the status line only; sensitive results (Gmail/Calendar summaries) are sent as an ephemeral reply visible only to the clicking user.

Executable actions from Slack are limited to `google.calendar.listEvents`, `google.gmail.listMessages`, `calendar.createReminder` (all through the acting user's Google connection), `crm.updateLeadStatus`, and `crm.createLead`. Other drafted kinds (Maya pitch, dev spec, follow-up drafts, Slack sends) answer with a pointer to the web cockpit. The bridge never sends external communications by itself.

The next durable orchestration step is a universal approval queue backed by `approval_requests`, immutable audit events, and capability packs for Gmail, Slack, Calendar, Drive, and CRM drafts. Provider sends, document sharing, invoices, offers, contracts, migrations, and PR creation should stay behind explicit approval.

## NAIA on WhatsApp

The cofounders can also talk to NAIA through one private Meta WhatsApp Business Cloud API number. The number may coexist temporarily with an operational WhatsApp Business line, but the webhook is not a guest assistant: only explicitly mapped founder senders are processed. The flow mirrors the Slack bridge and keeps the same human-approval contract:

1. `GET /api/whatsapp/webhook` answers Meta's verification handshake: `hub.mode=subscribe` plus a matching `hub.verify_token` (`WHATSAPP_VERIFY_TOKEN`) echoes `hub.challenge` as plain text; anything else gets 403. `POST` deliveries are verified against `WHATSAPP_APP_SECRET` with the `X-Hub-Signature-256` header (timing-safe HMAC SHA-256 of the raw body, read as text before any JSON.parse); invalid signatures get 401. The route acks fast and schedules the real work with Next `after()`. Delivery/read receipts (`value.statuses`) are acked without processing, and Meta's at-least-once redeliveries are deduplicated by `wamid` through the service-role-only `naia_processed_messages` table (migration `20260708170000`, 7-day retention, fail-open on transient errors so a command is never silently dropped). The path is listed in the middleware public prefixes because Meta calls it without a Supabase session; the route authenticates every request itself.
2. The webhook requires `payload.object=whatsapp_business_account`, `entry.id=WHATSAPP_BUSINESS_ACCOUNT_ID`, and `value.metadata.phone_number_id=WHATSAPP_PHONE_NUMBER_ID`, then treats the admin-controlled `WHATSAPP_USER_MAP` as its private sender allowlist and identity map (`"212661234567:ali@qarizmi.com,33612345678:nabil@qarizmi.com"`, international digits like the Cloud API `from` field). Unknown numbers are silently ignored before `after()` is scheduled: no reply, dedup row, history, provider read, CRM read, or LLM call occurs. A mapped email is re-resolved by `resolveBridgeUser` (`src/platform/naia/bridge.ts`) against `profiles` + `organization_memberships` on every message and must still have the `owner` role; missing or non-owner profiles are silently ignored before deduplication or provider work.
3. Text and voice-note messages go through `planBridgeCommand` (same orchestrator and HMAC approval tokens as web and Slack) with the full 2000-character command budget. Forwarded text is treated as normal text; images, documents, contacts, and other non-audio attachments are ignored in this first version. Voice notes are fetched from the official Meta media endpoint with `WHATSAPP_ACCESS_TOKEN`, capped at 10 MB, and transcribed by Groq Whisper; `GROQ_WHISPER_LANGUAGE=auto` preserves mixed French-English speech. The last eight founder commands are read from the service-role-only `naia_private_whatsapp_messages` table, scoped by both organization and profile and purged after 30 days. Assistant responses are not persisted because they may contain Gmail, Calendar, CRM, or private founder knowledge. NAIA replies with text plus one interactive reply-button message per drafted action ("✅ Valider" / "❌ Ignorer"); every structured CRM field is displayed in full before approval. If the review exceeds WhatsApp's 1024-character interactive-body limit, the complete review is sent as a separate text followed by a short approval prompt; an action that cannot fit in a complete 4096-character text is refused rather than presented with hidden content. Each action is delivered independently so one failed send never swallows the remaining actions.
4. WhatsApp reply-button ids are capped at 256 characters, far too small for the inline `{actionId, approvalToken, command}` value that Slack buttons carry. Drafts `{actionId, actionLabel, approvalToken, command}` are therefore parked in the service-role-only `naia_pending_actions` table (migration `20260708160000_naia_pending_actions.sql`: RLS enabled with no policies, grants revoked, `expires_at` TTL of 10 minutes) and the button id only carries `naia_approve:<uuid>` / `naia_dismiss:<uuid>`, durable across serverless instances and deploys.
5. A "Valider" tap claims the draft with a single-use delete filtered on the row id, the tapping profile, and a live expiry (expired rows are also purged on every read) — that is the UX layer: a tapped button stops working immediately. The security layer is `executeBridgeAction`, which re-verifies the 5-minute HMAC approval token, decodes the approved action from it, claims the token as single-use in `naia_consumed_action_tokens` before any side effect, and checks `hasPermission` for CRM writes; the formatted result or error is sent back as text. "Ignorer" deletes the draft and confirms the abandon. The executable action kinds are the same as Slack; everything else points back to the web cockpit.

Note: Meta only lets the business reply for 24 hours after the user's last message (customer-service window); NAIA is always reactive here, so replies stay inside the window opened by the incoming command.

The complete operational setup and acceptance test are documented in `docs/naia-private-whatsapp-setup.md`. The temporary business number must use an explicit coexistence flow if it needs to remain available in the WhatsApp Business mobile app; otherwise use Meta's test number until a dedicated NAIA line is ready.

## Current Trade-offs

- Auth user creation can happen through Google sign-in (with trigger-based provisioning) or remain manual in the Supabase dashboard; role upgrades stay manual.
- Legacy org-shared Google connections were revoked by migration `20260708120000`; each user reconnects by signing in with Google once. Client folders created before the per-client layout remain in the old Drive location and can be moved manually.
- The Dashboard shows foundation state only, not synthetic operational metrics.
- `npm audit` currently reports a moderate PostCSS advisory through Next.js 16.2.9's nested dependency. The latest stable Next release is already installed, and `npm audit fix --force` proposes a breaking downgrade, so this should be revisited when Next publishes a stable patched release.

## Intentionally Not Built

- Slack and WhatsApp per-user OAuth, Microsoft 365, and Gmail API OAuth provider flows. The Slack bridge uses a workspace bot token plus signing secret; the private WhatsApp bridge uses one Cloud API token plus the admin-controlled `WHATSAPP_USER_MAP` allowlist, not per-user OAuth.
- Rich profile and organization membership synchronization after login.
- Unbounded autonomous code modification. A future developer agent should create a spec, branch, and review request before implementation, not mutate production code without a human gate.
- Direct Gmail/Drive bulk ingestion in NAIA. Slack only reads a bounded recent DM/thread history when processing an explicit command; it does not crawl or index workspace channels. Beyond the command-driven Slack and WhatsApp bridges, the integration cards are readiness indicators until provider-specific OAuth, scopes, sync jobs, and audit trails are implemented.
