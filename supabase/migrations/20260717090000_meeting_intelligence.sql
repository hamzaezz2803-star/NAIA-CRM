-- Founder-only meeting intelligence: dedicated meetings, private recordings,
-- durable local-worker jobs, reviewable outputs, and CRM meeting backfill.

create or replace function public.is_meeting_notes_cofounder(target_organization_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    join auth.users user_record on user_record.id = membership.profile_id
    where membership.organization_id = target_organization_id
      and membership.profile_id = auth.uid()
      and membership.role = 'owner'
      and lower(user_record.email) in ('ali@qarizmi.com', 'nabil@qarizmi.com')
  );
$$;

revoke execute on function public.is_meeting_notes_cofounder(uuid) from public, anon;
grant execute on function public.is_meeting_notes_cofounder(uuid) to authenticated, service_role;

create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  lead_id uuid references public.crm_leads (id) on delete set null,
  company_id uuid references public.crm_companies (id) on delete set null,
  contact_id uuid references public.crm_contacts (id) on delete set null,
  title text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  attendees jsonb not null default '[]'::jsonb,
  location text,
  source text not null default 'crm' check (source in ('crm', 'google-calendar', 'manual')),
  status text not null default 'scheduled' check (status in (
    'scheduled', 'recording', 'uploaded', 'queued', 'processing',
    'review-ready', 'approved', 'failed', 'cancelled'
  )),
  calendar_event_id text,
  calendar_event_url text,
  support_drive_file_id text,
  support_file_name text,
  support_file_url text,
  drive_folder_id text,
  drive_folder_url text,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists meetings_crm_lead_unique_idx
  on public.meetings (organization_id, lead_id)
  where source = 'crm' and lead_id is not null;

create index if not exists meetings_org_start_idx
  on public.meetings (organization_id, starts_at desc);

create table if not exists public.meeting_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  kind text not null check (kind in (
    'audio-recording', 'support', 'transcript-text', 'transcript-srt',
    'meeting-notes', 'structured-output', 'notes-pdf'
  )),
  provider text not null check (provider in ('supabase-storage', 'google-drive')),
  display_name text not null,
  storage_path text,
  external_id text,
  url text,
  mime_type text,
  size_bytes bigint,
  metadata jsonb not null default '{}'::jsonb,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists meeting_assets_meeting_kind_idx
  on public.meeting_assets (organization_id, meeting_id, kind, created_at desc);

create unique index if not exists meeting_assets_external_unique_idx
  on public.meeting_assets (meeting_id, provider, external_id)
  where external_id is not null;

create table if not exists public.meeting_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  audio_asset_id uuid not null references public.meeting_assets (id) on delete cascade,
  status text not null default 'queued' check (status in (
    'queued', 'claimed', 'transcribing', 'analyzing', 'uploading', 'finalizing',
    'review-ready', 'completed', 'failed', 'cancelled'
  )),
  progress integer not null default 0 check (progress between 0 and 100),
  message text not null default 'En attente du companion local',
  worker_id text,
  lease_token uuid,
  lease_expires_at timestamptz,
  attempts integer not null default 0,
  error text,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists meeting_processing_jobs_active_meeting_idx
  on public.meeting_processing_jobs (meeting_id)
  where status in ('queued', 'claimed', 'transcribing', 'analyzing', 'uploading', 'finalizing');

create index if not exists meeting_processing_jobs_queue_idx
  on public.meeting_processing_jobs (status, created_at);

create table if not exists public.meeting_outputs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  job_id uuid references public.meeting_processing_jobs (id) on delete set null,
  version integer not null default 1 check (version > 0),
  notes_markdown text not null,
  transcript_text text not null,
  transcript_srt text not null,
  structured_output jsonb not null default '{}'::jsonb,
  engine_metadata jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  review_status text not null default 'draft' check (review_status in ('draft', 'reviewing', 'approved')),
  review_revision integer not null default 0 check (review_revision >= 0),
  review_lock_token uuid,
  review_lock_expires_at timestamptz,
  review_previous_status text check (review_previous_status in ('draft', 'approved')),
  reviewed_notes_markdown text,
  applied_recommendation_ids text[] not null default '{}'::text[],
  approval_warnings jsonb not null default '[]'::jsonb,
  reviewed_by_profile_id uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meeting_id, version)
);

create index if not exists meeting_outputs_meeting_version_idx
  on public.meeting_outputs (organization_id, meeting_id, version desc);

create unique index if not exists meeting_outputs_job_unique_idx
  on public.meeting_outputs (job_id)
  where job_id is not null;

create table if not exists public.meeting_action_executions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  output_id uuid not null references public.meeting_outputs (id) on delete cascade,
  recommendation_id text not null,
  action_kind text not null,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  error text,
  result jsonb not null default '{}'::jsonb,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (output_id, recommendation_id)
);

create index if not exists meeting_action_executions_meeting_idx
  on public.meeting_action_executions (organization_id, meeting_id, updated_at desc);

create unique index if not exists meeting_action_executions_org_id_idx
  on public.meeting_action_executions (organization_id, id);

-- Bind additive CRM effects to their approved meeting recommendation. This
-- makes a retry safe even when PostgREST committed the first insert but the
-- HTTP response was lost before the caller could observe it.
alter table public.crm_lead_notes
  add column if not exists meeting_action_execution_id uuid;

alter table public.crm_tasks
  add column if not exists meeting_action_execution_id uuid;

alter table public.crm_leads
  add column if not exists next_action_meeting_execution_id uuid,
  add column if not exists status_meeting_execution_id uuid;

alter table public.crm_lead_notes
  add constraint crm_lead_notes_meeting_execution_fk
  foreign key (organization_id, meeting_action_execution_id)
  references public.meeting_action_executions (organization_id, id)
  on delete restrict;

alter table public.crm_tasks
  add constraint crm_tasks_meeting_execution_fk
  foreign key (organization_id, meeting_action_execution_id)
  references public.meeting_action_executions (organization_id, id)
  on delete restrict;

alter table public.crm_leads
  add constraint crm_leads_next_action_meeting_execution_fk
  foreign key (organization_id, next_action_meeting_execution_id)
  references public.meeting_action_executions (organization_id, id)
  on delete restrict;

alter table public.crm_leads
  add constraint crm_leads_status_meeting_execution_fk
  foreign key (organization_id, status_meeting_execution_id)
  references public.meeting_action_executions (organization_id, id)
  on delete restrict;

create unique index if not exists crm_lead_notes_meeting_action_execution_idx
  on public.crm_lead_notes (meeting_action_execution_id)
  where meeting_action_execution_id is not null;

create unique index if not exists crm_tasks_meeting_action_execution_idx
  on public.crm_tasks (meeting_action_execution_id)
  where meeting_action_execution_id is not null;

-- Defense in depth: IDs are globally unique, but every relation must also
-- belong to the same organization as the row being written.
create or replace function public.validate_meeting_tenant_links()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.lead_id is not null and not exists (
    select 1 from public.crm_leads lead
    where lead.id = new.lead_id and lead.organization_id = new.organization_id
  ) then
    raise exception 'Cross-organization meeting lead is forbidden' using errcode = '23514';
  end if;
  if new.company_id is not null and not exists (
    select 1 from public.crm_companies company
    where company.id = new.company_id and company.organization_id = new.organization_id
  ) then
    raise exception 'Cross-organization meeting company is forbidden' using errcode = '23514';
  end if;
  if new.contact_id is not null and not exists (
    select 1 from public.crm_contacts contact
    where contact.id = new.contact_id and contact.organization_id = new.organization_id
  ) then
    raise exception 'Cross-organization meeting contact is forbidden' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.validate_meeting_child_tenant()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  row_data jsonb := to_jsonb(new);
  linked_meeting_id uuid := nullif(row_data ->> 'meeting_id', '')::uuid;
  linked_audio_asset_id uuid := nullif(row_data ->> 'audio_asset_id', '')::uuid;
  linked_job_id uuid := nullif(row_data ->> 'job_id', '')::uuid;
  linked_output_id uuid := nullif(row_data ->> 'output_id', '')::uuid;
begin
  if linked_meeting_id is not null and not exists (
    select 1 from public.meetings meeting
    where meeting.id = linked_meeting_id and meeting.organization_id = new.organization_id
  ) then
    raise exception 'Cross-organization meeting child is forbidden' using errcode = '23514';
  end if;
  if linked_audio_asset_id is not null and not exists (
    select 1 from public.meeting_assets asset
    where asset.id = linked_audio_asset_id
      and asset.organization_id = new.organization_id
      and (linked_meeting_id is null or asset.meeting_id = linked_meeting_id)
  ) then
    raise exception 'Cross-meeting audio asset is forbidden' using errcode = '23514';
  end if;
  if linked_job_id is not null and not exists (
    select 1 from public.meeting_processing_jobs job
    where job.id = linked_job_id
      and job.organization_id = new.organization_id
      and (linked_meeting_id is null or job.meeting_id = linked_meeting_id)
  ) then
    raise exception 'Cross-meeting processing job is forbidden' using errcode = '23514';
  end if;
  if linked_output_id is not null and not exists (
    select 1 from public.meeting_outputs output
    where output.id = linked_output_id
      and output.organization_id = new.organization_id
      and (linked_meeting_id is null or output.meeting_id = linked_meeting_id)
  ) then
    raise exception 'Cross-meeting output is forbidden' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.validate_meeting_crm_execution_target()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.meeting_action_execution_id is not null and not exists (
    select 1
    from public.meeting_action_executions execution
    join public.meetings meeting on meeting.id = execution.meeting_id
    where execution.id = new.meeting_action_execution_id
      and execution.organization_id = new.organization_id
      and meeting.organization_id = new.organization_id
      and meeting.lead_id = new.lead_id
  ) then
    raise exception 'Meeting action execution does not belong to this CRM lead'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.validate_meeting_crm_lead_markers()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.next_action_meeting_execution_id is not null and not exists (
    select 1
    from public.meeting_action_executions execution
    join public.meetings meeting on meeting.id = execution.meeting_id
    where execution.id = new.next_action_meeting_execution_id
      and execution.organization_id = new.organization_id
      and meeting.organization_id = new.organization_id
      and meeting.lead_id = new.id
  ) then
    raise exception 'Next-action execution does not belong to this CRM lead'
      using errcode = '23514';
  end if;
  if new.status_meeting_execution_id is not null and not exists (
    select 1
    from public.meeting_action_executions execution
    join public.meetings meeting on meeting.id = execution.meeting_id
    where execution.id = new.status_meeting_execution_id
      and execution.organization_id = new.organization_id
      and meeting.organization_id = new.organization_id
      and meeting.lead_id = new.id
  ) then
    raise exception 'Status execution does not belong to this CRM lead'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_meeting_tenant_links_trigger on public.meetings;
create trigger validate_meeting_tenant_links_trigger
before insert or update of organization_id, lead_id, company_id, contact_id
on public.meetings
for each row execute function public.validate_meeting_tenant_links();

drop trigger if exists validate_meeting_asset_tenant_trigger on public.meeting_assets;
create trigger validate_meeting_asset_tenant_trigger
before insert or update on public.meeting_assets
for each row execute function public.validate_meeting_child_tenant();

drop trigger if exists validate_meeting_job_tenant_trigger on public.meeting_processing_jobs;
create trigger validate_meeting_job_tenant_trigger
before insert or update on public.meeting_processing_jobs
for each row execute function public.validate_meeting_child_tenant();

drop trigger if exists validate_meeting_output_tenant_trigger on public.meeting_outputs;
create trigger validate_meeting_output_tenant_trigger
before insert or update on public.meeting_outputs
for each row execute function public.validate_meeting_child_tenant();

drop trigger if exists validate_meeting_action_tenant_trigger on public.meeting_action_executions;
create trigger validate_meeting_action_tenant_trigger
before insert or update on public.meeting_action_executions
for each row execute function public.validate_meeting_child_tenant();

drop trigger if exists validate_meeting_crm_note_execution_trigger on public.crm_lead_notes;
create trigger validate_meeting_crm_note_execution_trigger
before insert or update of organization_id, lead_id, meeting_action_execution_id
on public.crm_lead_notes
for each row execute function public.validate_meeting_crm_execution_target();

drop trigger if exists validate_meeting_crm_task_execution_trigger on public.crm_tasks;
create trigger validate_meeting_crm_task_execution_trigger
before insert or update of organization_id, lead_id, meeting_action_execution_id
on public.crm_tasks
for each row execute function public.validate_meeting_crm_execution_target();

drop trigger if exists validate_meeting_crm_lead_markers_trigger on public.crm_leads;
create trigger validate_meeting_crm_lead_markers_trigger
before insert or update of organization_id, next_action_meeting_execution_id, status_meeting_execution_id
on public.crm_leads
for each row execute function public.validate_meeting_crm_lead_markers();

alter table public.meetings enable row level security;
alter table public.meeting_assets enable row level security;
alter table public.meeting_processing_jobs enable row level security;
alter table public.meeting_outputs enable row level security;
alter table public.meeting_action_executions enable row level security;

create policy "cofounders can read meetings"
on public.meetings for select to authenticated
using (public.is_meeting_notes_cofounder(organization_id));

create policy "cofounders can create meetings"
on public.meetings for insert to authenticated
with check (public.is_meeting_notes_cofounder(organization_id));

create policy "cofounders can update meetings"
on public.meetings for update to authenticated
using (public.is_meeting_notes_cofounder(organization_id))
with check (public.is_meeting_notes_cofounder(organization_id));

create policy "cofounders can manage meeting assets"
on public.meeting_assets for all to authenticated
using (public.is_meeting_notes_cofounder(organization_id))
with check (public.is_meeting_notes_cofounder(organization_id));

create policy "cofounders can manage meeting jobs"
on public.meeting_processing_jobs for all to authenticated
using (public.is_meeting_notes_cofounder(organization_id))
with check (public.is_meeting_notes_cofounder(organization_id));

create policy "cofounders can manage meeting outputs"
on public.meeting_outputs for all to authenticated
using (public.is_meeting_notes_cofounder(organization_id))
with check (public.is_meeting_notes_cofounder(organization_id));

create policy "cofounders can manage meeting action executions"
on public.meeting_action_executions for all to authenticated
using (public.is_meeting_notes_cofounder(organization_id))
with check (public.is_meeting_notes_cofounder(organization_id));

grant select, insert, update, delete
on public.meetings, public.meeting_assets, public.meeting_processing_jobs, public.meeting_outputs, public.meeting_action_executions
to authenticated;

grant all privileges
on public.meetings, public.meeting_assets, public.meeting_processing_jobs, public.meeting_outputs, public.meeting_action_executions
to service_role;

-- Queue creation is a single transaction so an asset can never be committed
-- without its processing job (or a queued meeting without either row).
create or replace function public.queue_meeting_processing_job(
  requested_organization_id uuid,
  requested_meeting_id uuid,
  recording_display_name text,
  recording_mime_type text,
  recording_total_bytes bigint,
  recording_storage_path text,
  recording_manifest jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  queued_asset_id uuid;
  queued_job_id uuid;
begin
  if auth.uid() is null
     or not public.is_meeting_notes_cofounder(requested_organization_id) then
    raise exception 'Meeting Intelligence access denied' using errcode = '42501';
  end if;

  if nullif(trim(recording_display_name), '') is null
     or nullif(trim(recording_storage_path), '') is null
     or recording_total_bytes <= 0 then
    raise exception 'Invalid meeting recording metadata' using errcode = '22023';
  end if;

  perform 1
  from public.meetings meeting
  where meeting.id = requested_meeting_id
    and meeting.organization_id = requested_organization_id
  for update;

  if not found then
    raise exception 'Meeting not found' using errcode = 'P0002';
  end if;

  insert into public.meeting_assets (
    organization_id,
    meeting_id,
    kind,
    provider,
    display_name,
    storage_path,
    mime_type,
    size_bytes,
    metadata,
    created_by_profile_id
  ) values (
    requested_organization_id,
    requested_meeting_id,
    'audio-recording',
    'supabase-storage',
    recording_display_name,
    recording_storage_path,
    recording_mime_type,
    recording_total_bytes,
    jsonb_build_object('manifest', coalesce(recording_manifest, '{}'::jsonb)),
    auth.uid()
  )
  returning id into queued_asset_id;

  insert into public.meeting_processing_jobs (
    organization_id,
    meeting_id,
    audio_asset_id,
    created_by_profile_id
  ) values (
    requested_organization_id,
    requested_meeting_id,
    queued_asset_id,
    auth.uid()
  )
  returning id into queued_job_id;

  update public.meetings meeting
  set status = 'queued', updated_at = now()
  where meeting.id = requested_meeting_id
    and meeting.organization_id = requested_organization_id;

  return queued_job_id;
end;
$$;

revoke execute on function public.queue_meeting_processing_job(
  uuid, uuid, text, text, bigint, text, jsonb
) from public, anon;
grant execute on function public.queue_meeting_processing_job(
  uuid, uuid, text, text, bigint, text, jsonb
) to authenticated;

-- Atomic outbound claim used only by the trusted local companion through a
-- service-role server route. Expired leases can be reclaimed after a crash.
create or replace function public.claim_next_meeting_processing_job(
  requested_worker_id text,
  lease_seconds integer default 1800
)
returns setof public.meeting_processing_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_job_id uuid;
begin
  select job.id into selected_job_id
  from public.meeting_processing_jobs job
  where job.status = 'queued'
     or (
       job.status in ('claimed', 'transcribing', 'analyzing', 'uploading', 'finalizing')
       and job.lease_expires_at < now()
     )
  order by job.created_at
  for update skip locked
  limit 1;

  if selected_job_id is null then
    return;
  end if;

  return query
  update public.meeting_processing_jobs job
  set status = 'claimed',
      progress = greatest(job.progress, 1),
      message = 'Pris en charge par le companion local',
      worker_id = requested_worker_id,
      lease_token = gen_random_uuid(),
      lease_expires_at = now() + make_interval(secs => greatest(lease_seconds, 60)),
      attempts = job.attempts + 1,
      error = null,
      updated_at = now()
  where job.id = selected_job_id
  returning job.*;
end;
$$;

revoke execute on function public.claim_next_meeting_processing_job(text, integer) from public, anon, authenticated;
grant execute on function public.claim_next_meeting_processing_job(text, integer) to service_role;

create or replace function public.fail_meeting_processing_job(
  requested_job_id uuid,
  requested_worker_id text,
  requested_lease_token uuid,
  failure_message text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  failed_meeting_id uuid;
  failed_organization_id uuid;
begin
  update public.meeting_processing_jobs job
  set error = left(coalesce(failure_message, 'Le companion local a rencontré une erreur.'), 4000),
      lease_expires_at = null,
      message = 'Traitement en échec',
      status = 'failed',
      updated_at = now()
  where job.id = requested_job_id
    and job.worker_id = requested_worker_id
    and job.lease_token = requested_lease_token
    and job.status in ('claimed', 'transcribing', 'analyzing', 'uploading')
  returning job.meeting_id, job.organization_id
  into failed_meeting_id, failed_organization_id;

  if failed_meeting_id is null then
    return false;
  end if;

  update public.meetings meeting
  set status = 'failed', updated_at = now()
  where meeting.id = failed_meeting_id
    and meeting.organization_id = failed_organization_id
    and not exists (
      select 1
      from public.meeting_processing_jobs active_job
      where active_job.meeting_id = failed_meeting_id
        and active_job.id <> requested_job_id
        and active_job.status in (
          'queued', 'claimed', 'transcribing', 'analyzing', 'uploading', 'finalizing'
        )
    );

  return true;
end;
$$;

revoke execute on function public.fail_meeting_processing_job(uuid, text, uuid, text)
from public, anon, authenticated;
grant execute on function public.fail_meeting_processing_job(uuid, text, uuid, text)
to service_role;

create or replace function public.claim_meeting_output_review(
  requested_output_id uuid,
  requested_organization_id uuid,
  expected_version integer,
  expected_review_revision integer,
  lease_seconds integer default 900
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_token uuid := gen_random_uuid();
begin
  if not public.is_meeting_notes_cofounder(requested_organization_id) then
    return null;
  end if;

  update public.meeting_outputs output
  set review_status = 'reviewing',
      review_previous_status = case
        when output.review_status = 'reviewing'
          then coalesce(output.review_previous_status, 'draft')
        else output.review_status
      end,
      review_lock_token = claimed_token,
      review_lock_expires_at = now() + make_interval(secs => greatest(lease_seconds, 60)),
      updated_at = now()
  where output.id = requested_output_id
    and output.organization_id = requested_organization_id
    and output.version = expected_version
    and output.review_revision = expected_review_revision
    and output.review_status in ('draft', 'reviewing', 'approved')
    and (
      output.review_lock_token is null
      or output.review_lock_expires_at is null
      or output.review_lock_expires_at < now()
    );

  if not found then
    return null;
  end if;
  return claimed_token;
end;
$$;

create or replace function public.release_meeting_output_review(
  requested_output_id uuid,
  requested_organization_id uuid,
  requested_lock_token uuid,
  applied_ids text[],
  review_warnings jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_meeting_notes_cofounder(requested_organization_id) then
    return false;
  end if;

  update public.meeting_outputs output
  set applied_recommendation_ids = coalesce(applied_ids, '{}'::text[]),
      approval_warnings = coalesce(review_warnings, '[]'::jsonb),
      review_status = coalesce(output.review_previous_status, 'draft'),
      review_lock_token = null,
      review_lock_expires_at = null,
      review_previous_status = null,
      updated_at = now()
  where output.id = requested_output_id
    and output.organization_id = requested_organization_id
    and output.review_status = 'reviewing'
    and output.review_lock_token = requested_lock_token;
  return found;
end;
$$;

create or replace function public.finalize_meeting_output_review(
  requested_output_id uuid,
  requested_organization_id uuid,
  requested_lock_token uuid,
  reviewed_notes text,
  applied_ids text[],
  review_warnings jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  reviewed_meeting_id uuid;
begin
  if not public.is_meeting_notes_cofounder(requested_organization_id) then
    return false;
  end if;

  update public.meeting_outputs output
  set applied_recommendation_ids = coalesce(applied_ids, '{}'::text[]),
      approval_warnings = coalesce(review_warnings, '[]'::jsonb),
      review_status = 'approved',
      review_lock_token = null,
      review_lock_expires_at = null,
      review_previous_status = null,
      review_revision = output.review_revision + 1,
      reviewed_at = now(),
      reviewed_by_profile_id = auth.uid(),
      reviewed_notes_markdown = reviewed_notes,
      updated_at = now()
  where output.id = requested_output_id
    and output.organization_id = requested_organization_id
    and output.review_status = 'reviewing'
    and output.review_lock_token = requested_lock_token
  returning output.meeting_id into reviewed_meeting_id;

  if reviewed_meeting_id is null then
    return false;
  end if;

  update public.meetings meeting
  set status = 'approved', updated_at = now()
  where meeting.id = reviewed_meeting_id
    and meeting.organization_id = requested_organization_id;
  return true;
end;
$$;

revoke execute on function public.claim_meeting_output_review(uuid, uuid, integer, integer, integer)
from public, anon;
revoke execute on function public.release_meeting_output_review(uuid, uuid, uuid, text[], jsonb)
from public, anon;
revoke execute on function public.finalize_meeting_output_review(uuid, uuid, uuid, text, text[], jsonb)
from public, anon;
grant execute on function public.claim_meeting_output_review(uuid, uuid, integer, integer, integer)
to authenticated, service_role;
grant execute on function public.release_meeting_output_review(uuid, uuid, uuid, text[], jsonb)
to authenticated, service_role;
grant execute on function public.finalize_meeting_output_review(uuid, uuid, uuid, text, text[], jsonb)
to authenticated, service_role;

-- Every CRM-first meeting becomes a durable meeting workspace regardless of
-- whether it was created from the web, Slack, WhatsApp, or another agent.
create or replace function public.sync_meeting_from_crm_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'meeting-booked' and new.lead_date is not null then
    insert into public.meetings (
      organization_id,
      lead_id,
      company_id,
      contact_id,
      title,
      starts_at,
      source,
      status,
      calendar_event_id,
      calendar_event_url,
      created_by_profile_id
    ) values (
      new.organization_id,
      new.id,
      new.company_id,
      new.contact_id,
      new.topic,
      new.lead_date,
      'crm',
      'scheduled',
      (regexp_match(coalesce(new.notes, ''), '\[Google Calendar Event ID:[[:space:]]*([^]]+)\]'))[1],
      (regexp_match(coalesce(new.notes, ''), '\[Google Calendar Event Link:[[:space:]]*([^]]+)\]'))[1],
      new.created_by_profile_id
    )
    on conflict (organization_id, lead_id)
      where source = 'crm' and lead_id is not null
    do update set
      company_id = excluded.company_id,
      contact_id = excluded.contact_id,
      title = excluded.title,
      starts_at = excluded.starts_at,
      calendar_event_id = coalesce(excluded.calendar_event_id, meetings.calendar_event_id),
      calendar_event_url = coalesce(excluded.calendar_event_url, meetings.calendar_event_url),
      updated_at = now();
  end if;

  return new;
end;
$$;

drop trigger if exists sync_meeting_from_crm_lead_trigger on public.crm_leads;
create trigger sync_meeting_from_crm_lead_trigger
after insert or update of status, lead_date, topic, company_id, contact_id, notes
on public.crm_leads
for each row execute function public.sync_meeting_from_crm_lead();

insert into public.meetings (
  organization_id,
  lead_id,
  company_id,
  contact_id,
  title,
  starts_at,
  source,
  status,
  calendar_event_id,
  calendar_event_url,
  created_by_profile_id
)
select
  lead.organization_id,
  lead.id,
  lead.company_id,
  lead.contact_id,
  lead.topic,
  lead.lead_date,
  'crm',
  'scheduled',
  (regexp_match(coalesce(lead.notes, ''), '\[Google Calendar Event ID:[[:space:]]*([^]]+)\]'))[1],
  (regexp_match(coalesce(lead.notes, ''), '\[Google Calendar Event Link:[[:space:]]*([^]]+)\]'))[1],
  lead.created_by_profile_id
from public.crm_leads lead
where lead.status = 'meeting-booked'
  and lead.lead_date is not null
on conflict (organization_id, lead_id)
  where source = 'crm' and lead_id is not null
do update set
  company_id = excluded.company_id,
  contact_id = excluded.contact_id,
  title = excluded.title,
  starts_at = excluded.starts_at,
  calendar_event_id = coalesce(excluded.calendar_event_id, meetings.calendar_event_id),
  calendar_event_url = coalesce(excluded.calendar_event_url, meetings.calendar_event_url),
  updated_at = now();

-- Raw recording chunks are uploaded directly from the authenticated browser,
-- avoiding Vercel request-size limits. The bucket is never public.
insert into storage.buckets (id, name, public, file_size_limit)
values ('meeting-recordings', 'meeting-recordings', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create policy "cofounders can upload meeting recordings"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'meeting-recordings'
  and exists (
    select 1
    from public.meetings meeting
    where meeting.organization_id::text = split_part(name, '/', 1)
      and meeting.id::text = split_part(name, '/', 2)
      and public.is_meeting_notes_cofounder(meeting.organization_id)
  )
);

create policy "cofounders can read meeting recordings"
on storage.objects for select to authenticated
using (
  bucket_id = 'meeting-recordings'
  and exists (
    select 1
    from public.meetings meeting
    where meeting.organization_id::text = split_part(name, '/', 1)
      and meeting.id::text = split_part(name, '/', 2)
      and public.is_meeting_notes_cofounder(meeting.organization_id)
  )
);

create policy "cofounders can delete meeting recordings"
on storage.objects for delete to authenticated
using (
  bucket_id = 'meeting-recordings'
  and exists (
    select 1
    from public.meetings meeting
    where meeting.organization_id::text = split_part(name, '/', 1)
      and meeting.id::text = split_part(name, '/', 2)
      and public.is_meeting_notes_cofounder(meeting.organization_id)
  )
);
