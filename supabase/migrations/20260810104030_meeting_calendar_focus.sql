-- Calendar meetings are opened lazily from the focused note-taking workspace.
-- Keep double clicks and concurrent cofounder sessions idempotent without
-- touching historical CRM-backed meeting workspaces.
create unique index if not exists meetings_google_calendar_event_unique_idx
  on public.meetings (organization_id, calendar_event_id)
  where source = 'google-calendar' and calendar_event_id is not null;
