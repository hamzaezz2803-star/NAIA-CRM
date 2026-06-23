# Product Scope

Qarizmi is an AI, data science, automation, and software development consulting company. Qarizmi OS is the internal operating system for sales, delivery, hiring, finance, integrations, and AI-assisted workflows.

## Founding Team

- Ali El Abbassy: Head of Tech.
- Nabil: Head of Strategy.

Current contributors include Wissal on GLENCONTROL and Hamza on the first native CRM module.

## Planned Modules

1. Dashboard
2. CRM and Sales
3. Meetings
4. Proposals and Pitches
5. Projects and Delivery
6. HR and Recruitment
7. Finance and Expenses
8. Automations and Agents
9. Integrations
10. Settings and Administration

## Current Shell Scope

The current repository implements only platform shell foundations and boundaries. It does not implement business workflows for every module.

## CRM Direction

The first CRM module replaces Trello for lead management. It should have no runtime Trello dependency.

Initial lead statuses:

- Lead to contact
- Contacted
- To follow up
- Meeting booked
- Proposal sent
- Won
- Dead end

Hamza's Sprint 1 includes company, contact, lead, event, task, document, Kanban, lead detail, Add Lead Assistant, Follow-up Generator, and Google Drive Folder Creator work.

## Human Approval Rule

External actions such as sending emails, WhatsApp messages, proposals, contracts, internship offers, or invoices must initially require human review and approval.
