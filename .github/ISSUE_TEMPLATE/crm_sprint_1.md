---
name: CRM Sprint 1
about: Hamza's first native CRM implementation scope
title: "CRM Sprint 1: native lead pipeline foundation"
labels: ["crm", "sprint"]
assignees: []
---

## Objective

Build CRM Sprint 1 as the first native Qarizmi CRM module with no runtime Trello dependency.

## Scope

- [ ] Company records
- [ ] Contact records
- [ ] Lead records
- [ ] Lead events and activity history
- [ ] Tasks and next actions
- [ ] Associated documents
- [ ] Kanban pipeline
- [ ] Lead detail page
- [ ] Add Lead Assistant
- [ ] Follow-up Generator
- [ ] Google Drive Folder Creator

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

## Pipeline Statuses

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

- [ ] CRM records are organization-scoped.
- [ ] Kanban pipeline and lead detail page work.
- [ ] AI-assisted outputs are drafts and require human approval before external sending.
- [ ] `npm run ci` passes.
