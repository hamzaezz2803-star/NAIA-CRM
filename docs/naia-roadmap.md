# NAIA Operations Roadmap

NAIA should feel like a controlled operating command center: it removes
operational drag while keeping external actions behind a visible human gate.

## Now

- Keep the `/naia` home as the voice cockpit with the sphere, agent orbit, CRM
  snapshot, console, and approval cards.
- Use Salma CRM as the proof point: natural-language lead commands, lead
  creation, status movement, pitch/proposal next actions, and server-signed
  approvals.
- Route all prospect/client meetings through CRM first, then let Adam verify
  Google Calendar availability and create the event after validation.
- Keep Nora, Ilyas, Yasmine, Idriss, Lina, Omar, and Rayan visible as agents
  with clear live or guarded status.
- Show approval and integration health signals even before provider sends are
  enabled.

## Next

- Implement a universal approval queue backed by `approval_requests` and audit
  events for email, WhatsApp, proposal, invoice, contract, offer, Slack, Drive,
  Calendar, and CRM write actions.
- Add capability pack manifests for Gmail triage, Slack recap, Calendar brief,
  Drive document summary, CRM next action, and project-risk scan.
- Add a memory kernel with organization-scoped immutable facts, corrections,
  confidence, and source links.
- Add proactive operations briefs from CRM, cash, delivery, HR, Gmail, Slack,
  Calendar, and Drive collectors.

## Later

- Add durable missions with worker logs, verifier checks, retry/resume/kill
  controls, and approval checkpoints.
- Add a guarded developer agent that can prepare a spec, branch proposal, test
  plan, migration review, and PR checklist. Actual code changes, migrations,
  shell/module registry edits, and PR creation require Ali approval.
- Expand Slack/Gmail/Microsoft OAuth with scoped tokens, sync health, and
  provider-specific failure states. Google Workspace already has the first
  scoped OAuth foundation for Drive, Calendar events, and FreeBusy.

## Guardrails

- Never expose provider tokens to client components.
- Never send external communications automatically.
- Never let a generated payload bypass server recomputation, permission checks,
  approval tokens, RLS, and audit trails.
- Finance forecasts are scenarios, not accounting truth.
- Developer-agent work must run in isolated branches with CI and docs updates.
