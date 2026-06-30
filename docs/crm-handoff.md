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

```text
Client - Company Name
  01_Pitch
  02_Meeting Notes
  03_Proposal
  04_Contract
  05_Delivery
```

Store the resulting Drive folder URL on the relevant company or lead.

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
