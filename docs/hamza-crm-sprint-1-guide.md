# Hamza CRM Sprint 1 Guide

This is the working guide for Hamza's first Qarizmi OS sprint.

## Objective

Build the first native Qarizmi CRM module inside Qarizmi OS.

The CRM should replace the founders' current Trello-based lead tracking with a native module. Trello is useful product context, but it is not a runtime dependency for Sprint 1.

## What Changed From The Earlier Todo

The earlier note mentioned Trello sync and Trello card creation. That is no longer the direction for Sprint 1.

Do not implement:

- Trello API connection
- Trello card creation
- Trello-to-Supabase sync
- Trello links as required CRM fields

A one-time import from Trello may happen later, but it should not shape the first CRM architecture.

## Current Production Context

- App: `https://os.qarizmi.com`
- GitHub repo: `https://github.com/ali-qarizmi/qarizmi-os`
- Supabase project ref: `juqhonvapkrlylvseolu`
- Main branch: `main`
- CRM issue: `https://github.com/ali-qarizmi/qarizmi-os/issues/1`

## First Local Setup

After Ali invites you to the GitHub repository:

```bash
git clone https://github.com/ali-qarizmi/qarizmi-os.git
cd qarizmi-os
npm install
cp .env.example .env.local
npm run ci
```

Ask Ali for the local Supabase public environment values. Do not commit `.env.local`.

Create your feature branch:

```bash
git switch -c hamza/crm-sprint-1
```

## Files You Own

Work mainly in:

- `src/features/crm`
- `src/app/(app)/crm`
- CRM-specific migrations in `supabase/migrations`
- CRM-specific tests near the code they verify

## Files To Avoid Without Coordination

Coordinate with Ali before changing:

- `src/components/layout/app-shell.tsx`
- `src/platform/core/modules.ts`
- `src/platform/core/permissions.ts`
- `src/platform/core/events.ts`
- `src/platform/workflow/contracts.ts`
- `src/platform/integrations/contracts.ts`
- existing platform migrations
- GitHub Actions and repository workflow files

## Sprint 1 Scope

Implement:

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

The first lead model should support:

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

## Pipeline Statuses

Use these statuses:

- Lead to contact
- Contacted
- To follow up
- Meeting booked
- Proposal sent
- Won
- Dead end

The typed status constants already exist in `src/features/crm/contracts.ts`.

## Recommended Database Tables

Create a CRM migration with organization-scoped tables:

- `crm_companies`
- `crm_contacts`
- `crm_leads`
- `crm_lead_events`
- `crm_tasks`
- `crm_documents`

Rules:

- every business table includes `organization_id`
- use UUID primary keys
- include `created_at` and `updated_at`
- enable RLS
- use policies based on organization membership
- do not store OAuth tokens, API keys, or provider secrets in CRM tables

## AI-assisted Features

### Add Lead Assistant

Input example:

```text
J'ai parle a Achraf Hakimi d'Afriquia, potentiel sujet IA service client, a relancer vendredi.
```

Expected behavior:

- Extract company, contact, topic, status, next action date, and notes.
- Show a structured draft before saving if confidence is low.
- Create CRM records in Supabase after validation.
- Do not create Trello cards.

### Follow-up Generator

From a selected lead, generate:

- short email draft
- WhatsApp draft
- recommended next action

Do not send anything automatically. External communications need human approval.

### Google Drive Folder Creator

Create this folder structure:

```text
Client - Company Name
  01_Pitch
  02_Meeting Notes
  03_Proposal
  04_Contract
  05_Delivery
```

Store the resulting Drive folder URL on the relevant company or lead.

## Suggested PR Sequence

1. CRM database migration, domain types, validation schemas, and smoke tests.
2. CRM list, pipeline, lead detail page, and basic CRUD.
3. Add Lead Assistant as a draft-to-save workflow.
4. Follow-up Generator as draft-only output.
5. Google Drive Folder Creator behind an explicit user action.

Keep each pull request small enough to review.

## Definition Of Done For Sprint 1

- `npm run ci` passes.
- CRM data is organization-scoped.
- Users can create and update companies, contacts, and leads.
- Pipeline and lead detail page are usable.
- Lead events/activity history are visible.
- Tasks and next actions are tracked.
- AI outputs remain drafts until a human validates them.
- Drive folder creation stores the folder URL.
- No Trello runtime dependency exists.
