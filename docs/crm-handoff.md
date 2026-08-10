# CRM Handoff

This document is Hamza's starting point for CRM Sprint 1.

For the day-to-day implementation plan, also read `docs/hamza-crm-sprint-1-guide.md`.

## Objective

Build the first native Qarizmi CRM with no runtime Trello dependency, inspired by how Qarizmi currently manages leads in Trello.

Trello references in older planning notes are historical context only. Do not add a Trello runtime dependency in Sprint 1.

## Hamza Owns

- `src/features/crm`
- `src/app/(app)/crm` below the existing route boundary
- CRM-specific components, services, validation schemas, tests, and fixtures
- CRM-specific Supabase migrations, named after the timestamp and CRM scope

## Existing Route Boundary

- `/crm`: module entry and current empty state
- `/crm/handoff`: developer handoff summary
- `/dashboard/leads`: current production CRM pipeline and shell CRM entry target

Add subroutes such as:

- `/crm/companies`
- `/crm/contacts`
- `/crm/leads`
- `/crm/leads/[leadId]`
- `/crm/pipeline`

## Do Not Change Without Coordination

- `src/components/layout/app-shell.tsx`
- `src/platform/core/modules.ts`
- `src/platform/core/permissions.ts`
- `src/platform/core/events.ts`
- `src/platform/workflow/contracts.ts`
- `src/platform/integrations/contracts.ts`
- existing platform migrations
- CI and repository workflow files

## Shared Components And Contracts To Consume

- `src/components/layout/page-header.tsx`
- `src/components/layout/empty-state.tsx`
- `src/components/ui/*`
- `src/features/crm/contracts.ts`
- `src/platform/core/events.ts`
- `src/platform/workflow/contracts.ts`
- `src/platform/integrations/contracts.ts`

## CRM Sprint 1 Scope

Implement:

- Company records
- Contact records
- Lead records
- Lead events and activity history
- Tasks and next actions
- Associated documents
- Kanban pipeline
- Lead detail page

Lead fields should include:

- Company
- Contact name
- Email
- Phone
- Job title
- Lead source
- Topic or opportunity
- Status
- Notes
- Next action
- Next action date
- Creation and update timestamps

Initial pipeline statuses:

- Lead to contact
- Contacted
- To follow up
- Meeting booked
- Proposal sent
- Won
- Dead end

## AI-assisted CRM Features

Build behind explicit human-review boundaries:

1. Add Lead Assistant: parse a natural-language note into a structured lead draft.
2. Follow-up Generator: generate email draft, WhatsApp draft, and recommended next action.
3. Google Drive Folder Creator: create client folder structure and store the folder URL.

Do not send external communications automatically.

The shared Groq client lives in `src/platform/ai/groq.ts`. CRM extraction uses Qwen 3.6 in fast non-reasoning mode, validates the complete result with Zod, and falls back once to GPT-OSS 120B strict JSON Schema. Follow-up copy uses GPT-OSS 20B with the same strict fallback. Do not add model IDs directly to CRM actions: configure `GROQ_ORCHESTRATOR_MODEL`, `GROQ_FAST_MODEL`, and `GROQ_STRUCTURED_FALLBACK_MODEL`. After extraction, `src/features/crm/extraction.ts` remains authoritative for pipeline status and planned-date normalization; relative French/English dates are resolved in `Africa/Casablanca`, and a model-proposed date is rejected when the user never mentioned one.

NAIA read routing must keep data sources explicit. Questions such as `quels sont mes meetings CRM ?` read only organization-scoped leads at `meeting-booked`; questions that name Google Calendar read the acting user's personal Calendar connection. Calendar events already linked to a CRM lead are identified through the `[Google Calendar Event ID: ...]` and `[Google Calendar Event Link: ...]` markers in lead notes, which allows `Calendar hors CRM` to exclude them without changing CRM rows. These reads never create or update a lead; every CRM mutation continues through a reviewed action.

Founder/company background is a separate read-only context, not CRM data. NAIA may index the latest generic deck from `MAYA_DRIVE_SOURCE_FOLDER_ID` only for an authenticated `owner` whose email passes the existing Maya cofounder allowlist. The bounded excerpts may enrich a private web, Slack DM, or private WhatsApp answer, but must never be copied into lead notes, approval payloads, shared-channel prompts, or CRM snapshots. A Drive timeout or parsing failure must fall back silently to the normal assistant path.

The WhatsApp surface is private and fail-closed. `WHATSAPP_BUSINESS_ACCOUNT_ID` plus `WHATSAPP_PHONE_NUMBER_ID` pin the Meta account and destination number, while `WHATSAPP_USER_MAP` is the sender authorization boundary. Every mapped sender is re-resolved and must have the `owner` role. Unmapped, missing-profile, or non-owner numbers receive no NAIA response and trigger no dedup row, CRM/provider read, storage, or LLM call. Only founder commands live in `naia_private_whatsapp_messages`, scoped by `organization_id` plus `profile_id` and service-role only; assistant outputs are never copied into Supabase. See `docs/naia-private-whatsapp-setup.md` for onboarding and revocation.

## Google Drive Folder Structure

One folder per client company (not per lead) lives inside the cofounders
shared-drive `clients` folder (`MAYA_DRIVE_OUTPUT_FOLDER_ID`). The CRM stores
the authoritative URL on the company and/or lead. Docs Generator must use that
stored URL, verify the folder's parent and require one existing `01_Pitch`; it
must never search, create, repair, or deduplicate folders by client name.

```text
Company Name
  01_Pitch
  02_Meeting Notes
  03_Proposal
  04_Contract
  05_Delivery
```

Store the resulting Drive folder URL on the relevant company or lead. All
Drive calls go through `src/platform/integrations/google-drive-service.ts`
(service account), never through a user's personal token.

## Database Rules

CRM tables should:

- include `organization_id`
- use UUID primary keys
- include `created_at` and `updated_at`
- enable RLS
- use policies based on organization membership
- avoid storing provider secrets or raw OAuth tokens

Recommended table names:

- `crm_companies`
- `crm_contacts`
- `crm_leads`
- `crm_lead_events`
- `crm_tasks`
- `crm_documents`

## Module Registration

The shell already registers CRM in `src/platform/core/modules.ts`. Do not edit the registry for normal CRM screens. Add pages under the CRM route instead.

The app shell links the CRM parent item directly to `/dashboard/leads`. The pipeline page is intentionally compact and full-width: avoid reintroducing large KPI cards or wide page gutters above the Kanban unless Ali asks for a dashboard view.

Cards inside one Kanban column have a durable priority order. Keep
`pipeline_position` scoped by `(organization_id, status)`, render the column
through `sortCrmPipelineColumn()`, and persist a drag only through
`reorderCrmPipelineLeadsAction()` / `reorder_crm_pipeline_leads`. Never send an
organization id from the browser, loop over individual updates, or change
`updated_at` for a visual reorder. Concurrent stale drops must fail and reload
the server snapshot. Pointer, touch and keyboard users share the same drag
handle; moving a card to another status keeps the existing reviewed status
action and places it at the top of the destination column.

If CRM later needs dashboard widgets, expose a CRM-owned widget descriptor from `src/features/crm` and coordinate with Ali before adding it to the Dashboard.

## Events And Workflows

CRM-generated events should use the domain-event foundation:

- `crm.company.created`
- `crm.contact.created`
- `crm.lead.created`
- `crm.lead.updated`
- `crm.lead.status_changed`
- `crm.task.created`
- `crm.document.attached`

Future workflows can subscribe to these events through the outbox table. Do not call integration providers directly from UI components.

## NAIA CRM Orchestration

NAIA routes CRM intents through the Salma agent. The route handler is
`src/app/api/naia/orchestrate/route.ts`, with pure intent logic in
`src/features/naia/orchestrator.ts`.

Safe defaults:

- Read CRM context with `fetchLeadsAction()`.
- Use `CRM_DUMMY_DATA=enabled` only for local or sandbox demo CRM data when
  Supabase auth/rows are unavailable.
- Prepare drafts for status changes and lead creation.
- Execute CRM writes only after an explicit UI validation step.
- Canonicalize conversational input before extraction. Slack mentions and
  `mailto`/`tel` markup must be converted back to readable text before Salma
  derives company, contact, phone, email, job title, or notes.
- Preserve deterministic contact-card fields when an LLM extraction is
  partial. An explicit email, phone, person, company, or job title in the
  command takes precedence over an omitted or conflicting model field.
- Keep model routing inside `src/platform/ai/groq.ts`; CRM code must not
  hard-code a provider model or bypass Zod/schema validation and the strict
  fallback.
- Normalize relative dates and CRM statuses after model extraction. The model
  can propose fields, but code decides that a personal reminder is not a
  client meeting and that a spoken contact is not `lead-to-contact`.
- Show the complete structured lead draft before approval. Slack uses the
  "Vérifier / modifier" modal; the web cockpit uses the inline editable card.
  Execution must use the reviewed payload, not a newly generated draft.
- When an existing contact is reused, fill only its missing email, phone, job
  title, and LinkedIn fields. Never overwrite an already populated value from
  a new conversational draft.
- Execute status-only updates through `updateLeadStatusAction()` so NAIA does not trigger provider side effects such as Calendar sync from generic lead updates.
- Treat prospect/client meetings as CRM-first. A command like "j'ai parlé à X de Y, meeting vendredi" should create or update the CRM lead in `meeting-booked`; Adam/Meetings then checks Google Calendar from that validated lead context.
- Treat personal reminders separately. "Crée un meeting demain matin pour me
  rappeler d'envoyer la présentation" keeps the contacted CRM status and
  prepares a distinct `calendar.createReminder` action; it is not a client
  meeting and must not trigger Maya.
- For leads with a planned meeting date, Calendar sync must check Google FreeBusy before event creation and return a suggested alternative if the requested slot is busy.
- Trigger Google Calendar only after an explicit UI validation step, either through `syncLeadToGoogleCalendarAction()` or the validated NAIA lead creation flow. Calendar and Gmail always use the acting user's own per-user connection (`connected_by_profile_id`), never a shared org token.
- Create Drive client folders through the organization service account under
  the cofounders shared-drive `clients` folder (`MAYA_DRIVE_OUTPUT_FOLDER_ID`),
  one folder per client company — not the earlier shared Hamza folder and not
  per-lead folders. Keep pitch and proposal IP scoped to co-founder access:
  `/proposals` and `/dashboard/drives` are owner-only.
- Keep provider actions such as email, WhatsApp, Google Drive, Calendar sync,
  and delete flows behind a human approval foundation.
- Treat `viewer` as read-only. CRM insert/update policies use
  `public.is_org_contributor()` so only `owner`, `admin`, and `member` roles can
  write records.

## Meeting Intelligence handoff

- `meeting-booked` leads with a date are synchronized into `meetings` by the database trigger in `20260717090000_meeting_intelligence.sql`; do not add channel-specific meeting creation code. These historical CRM-backed workspaces are retained for their private outputs but are intentionally hidden from the focused capture selector; this UI change deletes no CRM or meeting row.
- `/meetings` is an Ali/Nabil-only focus route without the application shell, sidebar or floating assistant. It offers only the acting founder's Calendar events for the current `Africa/Casablanca` day plus an explicit "Nouveau meeting" path for appointments outside Calendar or when Google is unavailable.
- A Calendar workspace is created lazily only after the selected event is re-read server-side through the acting founder's own connection. Migration `20260810104030_meeting_calendar_focus.sql` adds a partial unique index on `(organization_id, calendar_event_id)` for non-null `google-calendar` rows so double clicks and concurrent founder sessions cannot create duplicates; it does not touch CRM-backed rows.
- Recording and transcript data are founder-only. Intern/member CRM screens must not query `meeting_outputs`, `meeting_assets`, or `meeting-recordings`.
- The capture UI may prefill title, time, attendees and the Meet link from the acting founder's Calendar event, but it must never start the microphone automatically. The consent checkbox is intentionally absent because the founder informs participants systematically; the explicit start action is the capture boundary.
- The focused capture follows `Mockup Notes Taking app`: live notes dominate the page, two colored dots are the only recording-state affordance, and there is no play/pause control, capture text, timer, red stop marker, support-file panel or lower post-meeting dashboard. A separate neutral `Traiter` action with a non-audio pictogram ends the capture and queues processing.
- `/meetings/history` is the post-meeting route, protected by the Ali/Nabil allowlist and owner membership. It lists only meetings with a processing job or generated output, newest first. Failed processing and Drive archives can be retried there; a ready output retains editable founder review, explicit recommendation selection and approval. Transcript is fetched only on demand after the server validates the meeting, output, version and organization. Gemini sync and Ask NAIA also live there, while the former CRM capture selector remains absent.
- Gmail/Gemini import is founder-only and read-only. Accept only exact Google notification senders, deduplicate on `(organization_id, provider, external_message_id)`, keep ambiguous matches unassigned, and require a founder action to associate them. Never label, archive, mark read, draft or send mail from this flow.
- `meeting_external_artifacts` stores bounded Gemini email notes and optional bounded text exported from the exact linked Google Doc. It is protected by the existing Ali/Nabil cofounder gate, has a tenant-consistency trigger, and grants no authenticated delete. Gemini documents are supporting context; they do not override local timestamped transcript evidence.
- Live notes, capture-boundary timestamps, crash-recovery audio, and historical supporting artifacts stay private. Support upload is not part of the focused capture surface. Do not copy private meeting material into normal CRM rows; only a recommendation explicitly selected during founder review may cross that boundary.
- The transcript is authoritative. Deck slides and historical CRM notes are supporting context and must never be presented as statements made during the meeting without timestamped transcript evidence.
- Recommendations are typed (`crm-note`, `crm-next-action`, `crm-status`, `task`, `calendar-follow-up`, `proposal-input`) and are inert until Ali or Nabil reviews and selects them.
- A selected CRM recommendation intentionally crosses from the private meeting workspace into the organization-visible CRM. Keep this explicit in UI wording and do not auto-copy full private notes.
- Local processing setup and operations live in `docs/meeting-notes-companion.md`.

When a lead moves to `meeting-booked`, NAIA prepares a decision-maker pitch
through Maya / Docs Generator. When a lead moves to `proposal-sent`, Maya
prepares the proposal next action. The CRM action itself remains
organization-scoped through the existing CRM server actions.

Maya pitch generation is implemented in `src/features/maya` and stays outside
CRM ownership. CRM provides the organization-scoped lead, company/contact and
the authoritative client Drive URL. The `pitch` family clones the audited
native PPTX pinned by exact filename, `MAYA_PITCH_TEMPLATE_FILE_ID`, and the
mandatory `MAYA_PITCH_TEMPLATE_SHA256` byte-for-byte, changes only the output
filename, scans all textual OOXML parts for client residue, and writes one PPTX
after explicit founder confirmation. Production must remain blocked until the
digest of the independently reviewed binary is configured. A transactional
Supabase claim globally keyed by destination `01_Pitch` and filename allows one
active upload and reconciles retries by reading and hashing the existing Drive
file. The claim persists a pre-generated Drive file ID: a retry after an
indeterminate create response reuses that ID instead of creating a duplicate.
Its lease is renewed transactionally immediately before the external write, so
a reclaimed stale worker cannot upload; reconciliation requires the expected
name and parent and fails closed on duplicate names. It never deletes or
deduplicates Drive content. It does not
call OpenAI or Groq and does not upload `maya-generation-manifest.json`. The
audited Teaser contains no client or industry placeholder; its sector labels
are generic credential headings and must not be presented as substitutions.
The `commercial-proposal` family remains manual because commercial scope, pricing,
dates and legal terms require human review. Do not copy pitch source decks into
a stagiaire-visible folder, broaden Drive sharing for debugging, or bypass the
stored CRM URL when resolving a destination.

To activate pitch copying, independently review and download the native Teaser
without editing it, calculate its digest locally with
`shasum -a 256 <approved-teaser.pptx>`, then set the lowercase result as the
server-only `MAYA_PITCH_TEMPLATE_SHA256`. The read-only Drive capture verified
on 2026-08-09 is
`7e499cb1dcfb92167cf223f6e1ef91a5bb3167c62c3524998b7354f32a5f03ab`.
Never derive or update that value from an automatic generation request. Changing
the Drive file requires a fresh human review and a deliberate digest rotation;
leaving the variable blank keeps both the queue and the write action blocked.

NAIA action approvals are signed server-side in `/api/naia/orchestrate`; the
client sends only the original command, action id, and approval token. Do not
reintroduce client-supplied action payload execution.

NAIA page context is published by the active CRM or Meetings client view, then
rebuilt and allow-listed server-side before orchestration. CRM list filters only
scope contextual questions such as "combien de leads sont visibles ici"; an
explicit whole-CRM request must read the complete organization pipeline. Kanban
and Calendar do not publish list-only company/status filters. Meetings publishes
its `upcoming` or `past` period so deterministic CRM meeting answers match the
visible tab. A selected lead may be used for referential commands such as "ce
lead" or "son pitch", but a different unmatched company/contact name must
produce a clarification instead of silently targeting the selected lead.

The official NAIA voice is configured only through the server-side
`ELEVENLABS_VOICE_ID`. The browser cannot override it. The POST-only route
makes at most one paid provider call; browser speech synthesis is the explicit
fallback when that voice is unavailable.

## NAIA Daily Brief Integration

The private daily brief reads organization-scoped active CRM tasks and leads,
then combines them with the configured founder's own Calendar and Gmail read
results. Only Ali or Nabil with the `owner` role can be configured, and the
output is sent to the exact Slack account resolved by email. No CRM, Gmail, or
Calendar mutation is part of this workflow.

Both CRM reads explicitly require `archived_at is null`, including when the
brief runs with a service-role client that bypasses RLS. Archiving a demo lead
and its generated task therefore removes them from both the pipeline and future
briefs without deleting Calendar, Drive or meeting records.

Production activation has two prerequisites that are not performed by a Vercel
Preview or by repository CI: apply
`supabase/migrations/20260809221355_naia_daily_brief_runs.sql`, then configure a
high-entropy `CRON_SECRET` in the Vercel Production environment before the
production deployment registers `vercel.json`. The migration creates the
service-role-only ledger and the atomic `reclaim_naia_daily_brief_run` RPC.
Only rows in the explicit `failed` state can be reclaimed; `sending`, `sent`,
and `delivery_uncertain` remain non-retryable to prevent duplicate Slack DMs.
See `docs/naia-daily-brief.md` for the full release sequence and acceptance
checks.

## GitHub Issue Body

Use this if the issue cannot be created automatically:

```markdown
## Objective

Build CRM Sprint 1 as the first native Qarizmi CRM module with no runtime Trello dependency.

## Scope

- Company records
- Contact records
- Lead records
- Lead events and activity history
- Tasks and next actions
- Associated documents
- Kanban pipeline
- Lead detail page
- Add Lead Assistant
- Follow-up Generator
- Google Drive Folder Creator

## Lead Fields

- Company
- Contact name
- Email
- Phone
- Job title
- Lead source
- Topic or opportunity
- Status
- Notes
- Next action
- Next action date
- Creation and update timestamps

## Statuses

- Lead to contact
- Contacted
- To follow up
- Meeting booked
- Proposal sent
- Won
- Dead end

## Boundaries

Work primarily in `src/features/crm`, `src/app/(app)/crm`, and CRM-specific migrations. Do not change platform shell files without coordination.

## Acceptance Criteria

- CRM records are organization-scoped.
- Kanban pipeline and lead detail page work.
- AI-assisted outputs are drafts and require human approval before external sending.
- Checks pass with `npm run ci`.
```

## Branch Start

```bash
git fetch origin
git switch main
git pull
git switch -c hamza/crm-sprint-1
npm install
npm run ci
```

---

## Sprint 1 Implementation Summary (Hamza)

The following features and security updates have been successfully implemented:

### 1. CRM Lead & Activity Core

- Built CRM features including database tables, models, and actions for Companies, Contacts, and Leads.
- Created lead activity events logs and Kanban pipeline board view.
- Added `lead_date` (planned action date) with fallback to `next_action_date` for retro-compatibility.

### 2. AI Lead Assistant & Voice Transcription

- **AI Extraction** : Implemented natural language lead note parsing using Groq AI.
- **Audio Transcription** : Implemented user audio voice recording transcription using Groq Whisper (`whisper-large-v3`).
- **Security Check** : Secured the transcription API route with explicit Supabase session authentication and a maximum audio file size limit of 10MB to prevent denial of service / abuse.

### 3. Notification Engine & RLS Policies

- Implemented persistent database-backed notifications and real-time banner alerts.
- **RLS Policy Hardening** : Added a new migration (`20260630122000_secure_notifications_policies.sql`) to restrict `INSERT`, `UPDATE` (mark as read), and `DELETE` (dismiss) operations on `public.notifications` strictly to the owner (`profile_id = auth.uid()`).
- Added automatic client-side rollback if deletion fails in database (to prevent notifications from reappearing on refresh).

### 4. Tag Management & Note Assignments (Hamza - Sprint 1 Extension)

- **Gestion des Tags** : Implemented custom tags management (add, edit, delete tags inline) and expanded tagging capabilities:
  - **Tagging Leads**: Enabled associating tags to Leads in creation and edition flows.
  - **Tagging Contacts**: Added junction table `crm_contact_tags` and implemented tagging Contacts directly on creation and in the new contact editor.
- **Gestion des Notes** :
  - **Note Collaborator Assignment**: Added `assigned_to_profile_id` column to `crm_lead_notes` table to allow assigning notes to a specific teammate.
  - **Note Modification Date**: Track and display the last updated timestamp (_"Modifié le : [date]"_) when a note's content or assignee is updated.
- **Contact Edit & Delete CRUD**: Added the ability to edit and delete contacts from the client detail view, with seamless tag synchronization.
