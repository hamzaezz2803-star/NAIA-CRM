-- Read-only Gmail ingestion for Google Meet/Gemini notes. Imported content is
-- founder-only, source-provenanced and deduplicated by the immutable Gmail
-- message id. It never changes Gmail or creates CRM actions automatically.

create table if not exists public.meeting_external_artifacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  meeting_id uuid references public.meetings (id) on delete set null,
  provider text not null check (provider = 'google-gemini'),
  external_message_id text not null,
  external_thread_id text,
  title text not null,
  occurred_at timestamptz,
  notes_markdown text not null,
  document_file_id text,
  document_url text,
  document_text text,
  recording_url text,
  sender_email text not null,
  imported_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider, external_message_id),
  constraint meeting_external_artifacts_title_length_check
    check (char_length(title) between 1 and 300),
  constraint meeting_external_artifacts_notes_length_check
    check (char_length(notes_markdown) between 1 and 250000),
  constraint meeting_external_artifacts_document_text_length_check
    check (document_text is null or char_length(document_text) <= 1500000),
  constraint meeting_external_artifacts_sender_check
    check (lower(sender_email) in ('gemini-notes@google.com', 'meetings-noreply@google.com')),
  constraint meeting_external_artifacts_document_url_check
    check (document_url is null or document_url ~ '^https://docs\.google\.com/document/d/[A-Za-z0-9_-]+'),
  constraint meeting_external_artifacts_recording_url_check
    check (recording_url is null or recording_url ~ '^https://drive\.google\.com/file/d/[A-Za-z0-9_-]+')
);

create index if not exists meeting_external_artifacts_org_occurred_idx
  on public.meeting_external_artifacts (organization_id, occurred_at desc);

create index if not exists meeting_external_artifacts_meeting_idx
  on public.meeting_external_artifacts (organization_id, meeting_id, occurred_at desc)
  where meeting_id is not null;

create or replace function public.validate_meeting_external_artifact_tenant()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.meeting_id is not null and not exists (
    select 1
    from public.meetings meeting
    where meeting.id = new.meeting_id
      and meeting.organization_id = new.organization_id
  ) then
    raise exception 'Meeting artifact organization mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_meeting_external_artifact_tenant_trigger
on public.meeting_external_artifacts;
create trigger validate_meeting_external_artifact_tenant_trigger
before insert or update on public.meeting_external_artifacts
for each row execute function public.validate_meeting_external_artifact_tenant();

alter table public.meeting_external_artifacts enable row level security;

drop policy if exists meeting_external_artifacts_select_founders
on public.meeting_external_artifacts;
create policy meeting_external_artifacts_select_founders
on public.meeting_external_artifacts for select to authenticated
using (public.is_meeting_notes_cofounder(organization_id));

drop policy if exists meeting_external_artifacts_insert_founders
on public.meeting_external_artifacts;
create policy meeting_external_artifacts_insert_founders
on public.meeting_external_artifacts for insert to authenticated
with check (public.is_meeting_notes_cofounder(organization_id));

drop policy if exists meeting_external_artifacts_update_founders
on public.meeting_external_artifacts;
create policy meeting_external_artifacts_update_founders
on public.meeting_external_artifacts for update to authenticated
using (public.is_meeting_notes_cofounder(organization_id))
with check (public.is_meeting_notes_cofounder(organization_id));

revoke all on public.meeting_external_artifacts from public, anon, authenticated;
grant select, insert, update on public.meeting_external_artifacts to authenticated;
grant all privileges on public.meeting_external_artifacts to service_role;

comment on table public.meeting_external_artifacts is
  'Founder-only Google Meet/Gemini notes imported read-only from Gmail with immutable source provenance.';
