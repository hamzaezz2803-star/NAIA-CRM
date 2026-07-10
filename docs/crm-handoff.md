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

## Google Drive Folder Structure

One folder per client company (not per lead), created by the organization
service account inside the cofounders shared-drive `clients` folder
(`MAYA_DRIVE_OUTPUT_FOLDER_ID`). If a folder with the client's name already
exists there, it is reused instead of duplicated.

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

When a lead moves to `meeting-booked`, NAIA prepares a decision-maker pitch
through Maya / Docs Generator. When a lead moves to `proposal-sent`, Maya
prepares the proposal next action. The CRM action itself remains
organization-scoped through the existing CRM server actions.

Maya pitch generation is implemented in `src/features/maya` and should stay
outside CRM ownership. CRM provides the lead, company/contact fields, notes,
status, and meeting context; Maya owns the private pitch library, PPTX deck
planning, OpenAI-enhanced draft generation, and Nabil final-version learning
loop. Do not copy pitch source decks into a stagiaire-visible folder, broaden
Drive sharing for debugging, or reuse `MAYA_OPENAI_API_KEY` outside Maya's
cofounder-gated draft generation action. If a lead is missing
website/objective/contact details, Maya should surface smart follow-up questions
instead of guessing silently.

NAIA action approvals are signed server-side in `/api/naia/orchestrate`; the
client sends only the original command, action id, and approval token. Do not
reintroduce client-supplied action payload execution.

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
