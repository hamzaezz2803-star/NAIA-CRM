-- One-step meeting capture: founder draft, informed-consent marker and
-- recoverable capture metadata. Existing meeting RLS remains authoritative.

alter table public.meetings
  add column if not exists live_notes_markdown text not null default '',
  add column if not exists consent_confirmed_at timestamptz,
  add column if not exists recording_started_at timestamptz,
  add column if not exists recording_ended_at timestamptz;

alter table public.meetings
  drop constraint if exists meetings_live_notes_markdown_length_check;

alter table public.meetings
  add constraint meetings_live_notes_markdown_length_check
  check (char_length(live_notes_markdown) <= 500000);

create unique index if not exists meeting_assets_storage_path_unique_idx
  on public.meeting_assets (meeting_id, provider, storage_path)
  where provider = 'supabase-storage' and storage_path is not null;

comment on column public.meetings.live_notes_markdown is
  'Founder-only notes captured during the meeting; never copied to CRM automatically.';

comment on column public.meetings.consent_confirmed_at is
  'Timestamp at which the recorder confirmed participants had been informed.';
