-- Live authorization and atomic attestation for founder-triggered meeting
-- archives, plus a durable per-founder cursor/lease for bounded Gemini sync.

create or replace function public.authorize_meeting_drive_archive(
  requested_organization_id uuid,
  requested_meeting_id uuid,
  requested_company_id uuid,
  requested_company_name text,
  requested_output_id uuid,
  expected_output_version integer,
  expected_review_revision integer
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select
    public.is_meeting_notes_cofounder(requested_organization_id)
    and exists (
      select 1
      from public.meetings meeting
      join public.crm_companies company
        on company.id = meeting.company_id
       and company.organization_id = meeting.organization_id
      join public.meeting_outputs output
        on output.meeting_id = meeting.id
       and output.organization_id = meeting.organization_id
      where meeting.id = requested_meeting_id
        and meeting.organization_id = requested_organization_id
        and meeting.company_id = requested_company_id
        and company.id = requested_company_id
        and company.organization_id = requested_organization_id
        and trim(company.name) = trim(requested_company_name)
        and output.id = requested_output_id
        and output.version = expected_output_version
        and output.review_revision = expected_review_revision
    );
$$;

revoke execute on function public.authorize_meeting_drive_archive(
  uuid, uuid, uuid, text, uuid, integer, integer
) from public, anon;
grant execute on function public.authorize_meeting_drive_archive(
  uuid, uuid, uuid, text, uuid, integer, integer
) to authenticated;

create or replace function public.finalize_meeting_drive_archive(
  requested_organization_id uuid,
  requested_meeting_id uuid,
  requested_company_id uuid,
  requested_company_name text,
  requested_output_id uuid,
  expected_output_version integer,
  expected_review_revision integer,
  requested_drive_folder_id text,
  requested_drive_folder_url text,
  archive_files jsonb,
  requested_output_warnings jsonb,
  requested_approval_warnings jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  archive_file jsonb;
  locked_actor_profile_id uuid;
  locked_meeting_id uuid;
  locked_output_id uuid;
  file_count integer;
begin
  if not public.authorize_meeting_drive_archive(
    requested_organization_id,
    requested_meeting_id,
    requested_company_id,
    requested_company_name,
    requested_output_id,
    expected_output_version,
    expected_review_revision
  ) then
    return false;
  end if;

  if nullif(trim(requested_drive_folder_id), '') is null
     or requested_drive_folder_url <> format(
       'https://drive.google.com/drive/folders/%s',
       trim(requested_drive_folder_id)
     )
     or jsonb_typeof(archive_files) <> 'array'
     or jsonb_typeof(requested_output_warnings) <> 'array'
     or jsonb_typeof(requested_approval_warnings) <> 'array' then
    return false;
  end if;

  file_count := jsonb_array_length(archive_files);
  if file_count not between 4 and 5 then
    return false;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(archive_files) file
    where nullif(trim(file->>'externalId'), '') is null
       or nullif(trim(file->>'name'), '') is null
       or nullif(trim(file->>'mimeType'), '') is null
       or nullif(trim(file->>'parentFolderId'), '') is null
       or file->>'parentFolderId' <> trim(requested_drive_folder_id)
       or coalesce(file->>'sha256', '') !~ '^[0-9a-f]{64}$'
       or coalesce(file->>'sizeBytes', '') !~ '^[0-9]+$'
       or file->>'kind' not in (
         'meeting-notes', 'transcript-text', 'transcript-srt', 'structured-output'
       )
       or not (
         (file->>'kind' = 'meeting-notes' and file->>'mimeType' = 'text/markdown')
         or (file->>'kind' = 'transcript-text' and file->>'mimeType' = 'text/plain')
         or (file->>'kind' = 'transcript-srt' and file->>'mimeType' = 'application/x-subrip')
         or (file->>'kind' = 'structured-output' and file->>'mimeType' = 'application/json')
       )
  ) then
    return false;
  end if;

  if (
    select count(distinct file->>'externalId') <> file_count
        or count(distinct file->>'name') <> file_count
    from jsonb_array_elements(archive_files) file
  ) then
    return false;
  end if;

  if (select count(*) from jsonb_array_elements(archive_files) file where file->>'kind' = 'meeting-notes') not between 1 and 2
     or (select count(*) from jsonb_array_elements(archive_files) file where file->>'kind' = 'transcript-text') <> 1
     or (select count(*) from jsonb_array_elements(archive_files) file where file->>'kind' = 'transcript-srt') <> 1
     or (select count(*) from jsonb_array_elements(archive_files) file where file->>'kind' = 'structured-output') <> 1 then
    return false;
  end if;

  select meeting.id, output.id, membership.profile_id
  into locked_meeting_id, locked_output_id, locked_actor_profile_id
  from public.meetings meeting
  join public.crm_companies company
    on company.id = meeting.company_id
   and company.organization_id = meeting.organization_id
  join public.meeting_outputs output
    on output.meeting_id = meeting.id
   and output.organization_id = meeting.organization_id
  join public.organization_memberships membership
    on membership.organization_id = meeting.organization_id
   and membership.profile_id = auth.uid()
   and membership.role = 'owner'
  join auth.users user_record
    on user_record.id = membership.profile_id
   and lower(user_record.email) in ('ali@qarizmi.com', 'nabil@qarizmi.com')
  where meeting.id = requested_meeting_id
    and meeting.organization_id = requested_organization_id
    and meeting.company_id = requested_company_id
    and trim(company.name) = trim(requested_company_name)
    and output.id = requested_output_id
    and output.version = expected_output_version
    and output.review_revision = expected_review_revision
  for update of meeting, company, output, membership, user_record;

  if locked_meeting_id is null
     or locked_output_id is null
     or locked_actor_profile_id is null then
    return false;
  end if;

  for archive_file in select value from jsonb_array_elements(archive_files)
  loop
    insert into public.meeting_assets as existing_asset (
      organization_id,
      meeting_id,
      kind,
      provider,
      display_name,
      external_id,
      url,
      mime_type,
      size_bytes,
      metadata,
      created_by_profile_id
    ) values (
      requested_organization_id,
      requested_meeting_id,
      archive_file->>'kind',
      'google-drive',
      archive_file->>'name',
      archive_file->>'externalId',
      nullif(archive_file->>'url', ''),
      archive_file->>'mimeType',
      (archive_file->>'sizeBytes')::bigint,
      jsonb_build_object(
        'outputId', requested_output_id,
        'outputVersion', expected_output_version,
        'reviewRevision', expected_review_revision,
        'parentFolderId', requested_drive_folder_id,
        'sha256', archive_file->>'sha256'
      ),
      locked_actor_profile_id
    ) on conflict (meeting_id, provider, external_id)
      where external_id is not null
    do update set
      kind = excluded.kind,
      display_name = excluded.display_name,
      url = excluded.url,
      mime_type = excluded.mime_type,
      size_bytes = excluded.size_bytes,
      metadata = coalesce(existing_asset.metadata, '{}'::jsonb) || excluded.metadata;
  end loop;

  update public.meetings meeting
  set drive_folder_id = trim(requested_drive_folder_id),
      drive_folder_url = requested_drive_folder_url,
      updated_at = now()
  where meeting.id = locked_meeting_id
    and meeting.organization_id = requested_organization_id
    and meeting.company_id = requested_company_id;
  if not found then
    raise exception 'meeting Drive archive CAS lost after row lock'
      using errcode = '40001';
  end if;

  update public.meeting_outputs output
  set warnings = requested_output_warnings,
      approval_warnings = requested_approval_warnings,
      updated_at = now()
  where output.id = locked_output_id
    and output.organization_id = requested_organization_id
    and output.meeting_id = requested_meeting_id
    and output.version = expected_output_version
    and output.review_revision = expected_review_revision;
  if not found then
    raise exception 'meeting output archive CAS lost after row lock'
      using errcode = '40001';
  end if;
  return true;
end;
$$;

revoke execute on function public.finalize_meeting_drive_archive(
  uuid, uuid, uuid, text, uuid, integer, integer, text, text, jsonb, jsonb, jsonb
) from public, anon;
grant execute on function public.finalize_meeting_drive_archive(
  uuid, uuid, uuid, text, uuid, integer, integer, text, text, jsonb, jsonb, jsonb
) to authenticated;

create or replace function public.authorize_worker_meeting_drive_archive(
  requested_job_id uuid,
  requested_worker_id text,
  requested_lease_token uuid,
  requested_organization_id uuid,
  requested_meeting_id uuid,
  requested_company_id uuid,
  requested_company_name text,
  requested_output_id uuid,
  expected_output_version integer,
  expected_review_revision integer
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select expected_review_revision = 0 and exists (
    select 1
    from public.meeting_processing_jobs job
    join public.meetings meeting
      on meeting.id = job.meeting_id
     and meeting.organization_id = job.organization_id
    join public.crm_companies company
      on company.id = meeting.company_id
     and company.organization_id = meeting.organization_id
    join public.meeting_outputs output
      on output.job_id = job.id
     and output.meeting_id = meeting.id
     and output.organization_id = meeting.organization_id
    join public.organization_memberships membership
      on membership.organization_id = job.organization_id
     and membership.profile_id = job.created_by_profile_id
     and membership.role = 'owner'
    join auth.users user_record
      on user_record.id = job.created_by_profile_id
     and lower(user_record.email) in ('ali@qarizmi.com', 'nabil@qarizmi.com')
    where job.id = requested_job_id
      and job.worker_id = trim(requested_worker_id)
      and job.lease_token = requested_lease_token
      and job.lease_expires_at > now()
      and job.status = 'finalizing'
      and job.organization_id = requested_organization_id
      and job.meeting_id = requested_meeting_id
      and meeting.company_id = requested_company_id
      and trim(company.name) = trim(requested_company_name)
      and output.id = requested_output_id
      and output.version = expected_output_version
      and output.review_revision = 0
  );
$$;

create or replace function public.calculate_meeting_archive_manifest_sha256(
  archive_files jsonb
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        coalesce(
          string_agg(
            concat_ws(
              chr(31),
              file->>'externalId',
              file->>'kind',
              file->>'mimeType',
              file->>'name',
              file->>'parentFolderId',
              file->>'sha256',
              file->>'sizeBytes',
              coalesce(file->>'url', '')
            ),
            chr(30) order by (file->>'externalId') collate "C"
          ),
          ''
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  from jsonb_array_elements(archive_files) file;
$$;

create or replace function public.finalize_worker_meeting_drive_archive(
  requested_job_id uuid,
  requested_worker_id text,
  requested_lease_token uuid,
  requested_organization_id uuid,
  requested_meeting_id uuid,
  requested_company_id uuid,
  requested_company_name text,
  requested_output_id uuid,
  expected_output_version integer,
  expected_review_revision integer,
  requested_drive_folder_id text,
  requested_drive_folder_url text,
  archive_files jsonb,
  archive_manifest_sha256 text,
  requested_output_warnings jsonb,
  requested_approval_warnings jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_profile_id uuid;
  finalized boolean;
begin
  if coalesce(archive_manifest_sha256, '') !~ '^[0-9a-f]{64}$'
     or public.calculate_meeting_archive_manifest_sha256(archive_files)
       <> archive_manifest_sha256 then
    return false;
  end if;

  select job.created_by_profile_id
  into actor_profile_id
  from public.meeting_processing_jobs job
  join public.meetings meeting
    on meeting.id = job.meeting_id
   and meeting.organization_id = job.organization_id
  join public.crm_companies company
    on company.id = meeting.company_id
   and company.organization_id = meeting.organization_id
  join public.meeting_outputs output
    on output.job_id = job.id
   and output.meeting_id = meeting.id
   and output.organization_id = meeting.organization_id
  join public.organization_memberships membership
    on membership.organization_id = job.organization_id
   and membership.profile_id = job.created_by_profile_id
   and membership.role = 'owner'
  join auth.users user_record
    on user_record.id = job.created_by_profile_id
   and lower(user_record.email) in ('ali@qarizmi.com', 'nabil@qarizmi.com')
  where job.id = requested_job_id
    and job.worker_id = trim(requested_worker_id)
    and job.lease_token = requested_lease_token
    and job.lease_expires_at > now()
    and job.status = 'finalizing'
    and job.organization_id = requested_organization_id
    and job.meeting_id = requested_meeting_id
    and meeting.company_id = requested_company_id
    and trim(company.name) = trim(requested_company_name)
    and output.id = requested_output_id
    and output.version = expected_output_version
    and output.review_revision = 0
    and expected_review_revision = 0
  for update of job, meeting, company, output, membership, user_record;

  if actor_profile_id is null then
    return false;
  end if;

  perform set_config('request.jwt.claim.sub', actor_profile_id::text, true);
  finalized := public.finalize_meeting_drive_archive(
    requested_organization_id,
    requested_meeting_id,
    requested_company_id,
    requested_company_name,
    requested_output_id,
    expected_output_version,
    expected_review_revision,
    requested_drive_folder_id,
    requested_drive_folder_url,
    archive_files,
    requested_output_warnings,
    requested_approval_warnings
  );
  return finalized;
end;
$$;

revoke execute on function public.authorize_worker_meeting_drive_archive(
  uuid, text, uuid, uuid, uuid, uuid, text, uuid, integer, integer
) from public, anon, authenticated;
revoke execute on function public.calculate_meeting_archive_manifest_sha256(jsonb)
from public, anon, authenticated;
revoke execute on function public.finalize_worker_meeting_drive_archive(
  uuid, text, uuid, uuid, uuid, uuid, text, uuid, integer, integer,
  text, text, jsonb, text, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.authorize_worker_meeting_drive_archive(
  uuid, text, uuid, uuid, uuid, uuid, text, uuid, integer, integer
) to service_role;
grant execute on function public.finalize_worker_meeting_drive_archive(
  uuid, text, uuid, uuid, uuid, uuid, text, uuid, integer, integer,
  text, text, jsonb, text, jsonb, jsonb
) to service_role;

create table public.meeting_gemini_sync_states (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  page_token text check (page_token is null or length(page_token) between 1 and 2048),
  lease_token uuid,
  lease_expires_at timestamptz,
  next_allowed_at timestamptz,
  run_started_at timestamptz,
  run_scanned integer not null default 0 check (run_scanned between 0 and 100),
  run_documents integer not null default 0 check (run_documents between 0 and 20),
  run_bytes bigint not null default 0 check (run_bytes between 0 and 10485760),
  last_completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, profile_id),
  constraint meeting_gemini_sync_lease_state_check check (
    (lease_token is null and lease_expires_at is null)
    or (lease_token is not null and lease_expires_at is not null)
  )
);

alter table public.meeting_gemini_sync_states enable row level security;
revoke all on public.meeting_gemini_sync_states from public, anon, authenticated;
grant all privileges on public.meeting_gemini_sync_states to service_role;

create or replace function public.claim_meeting_gemini_sync(
  requested_organization_id uuid,
  lease_seconds integer default 180
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  state public.meeting_gemini_sync_states%rowtype;
  new_lease_token uuid := gen_random_uuid();
  should_reset boolean;
  bounded_lease_seconds integer := least(greatest(coalesce(lease_seconds, 180), 30), 180);
  deadline_at timestamptz;
begin
  if not public.is_meeting_notes_cofounder(requested_organization_id)
     or auth.uid() is null then
    return jsonb_build_object('action', 'denied');
  end if;

  insert into public.meeting_gemini_sync_states (organization_id, profile_id)
  values (requested_organization_id, auth.uid())
  on conflict (organization_id, profile_id) do nothing;

  select sync_state.* into state
  from public.meeting_gemini_sync_states sync_state
  where sync_state.organization_id = requested_organization_id
    and sync_state.profile_id = auth.uid()
  for update;

  if state.lease_token is not null and state.lease_expires_at > now() then
    return jsonb_build_object('action', 'busy');
  end if;
  if state.next_allowed_at is not null and state.next_allowed_at > now() then
    return jsonb_build_object(
      'action', 'cooldown',
      'retryAfterMs', greatest(
        1,
        ceil(extract(epoch from (state.next_allowed_at - now())) * 1000)::integer
      )
    );
  end if;

  should_reset := state.run_started_at is null
    or state.run_started_at <= now() - interval '5 minutes'
    or state.run_scanned >= 100
    or state.run_documents >= 20
    or state.run_bytes >= 10485760
    or (state.page_token is null and state.run_scanned > 0);

  if should_reset then
    state.run_started_at := now();
    state.run_scanned := 0;
    state.run_documents := 0;
    state.run_bytes := 0;
  end if;
  deadline_at := least(
    state.run_started_at + interval '5 minutes',
    now() + interval '90 seconds'
  );

  update public.meeting_gemini_sync_states sync_state
  set lease_token = new_lease_token,
      lease_expires_at = now() + make_interval(secs => bounded_lease_seconds),
      run_started_at = state.run_started_at,
      run_scanned = state.run_scanned,
      run_documents = state.run_documents,
      run_bytes = state.run_bytes,
      last_error = null,
      updated_at = now()
  where sync_state.organization_id = requested_organization_id
    and sync_state.profile_id = auth.uid();

  return jsonb_build_object(
    'action', 'execute',
    'leaseToken', new_lease_token,
    'pageToken', state.page_token,
    'maxResults', least(25, 100 - state.run_scanned),
    'maxDocuments', 20 - state.run_documents,
    'maxBytes', 10485760 - state.run_bytes,
    'deadlineAt', deadline_at
  );
end;
$$;

create or replace function public.complete_meeting_gemini_sync(
  requested_organization_id uuid,
  requested_lease_token uuid,
  returned_page_token text,
  scanned_count integer,
  document_count integer,
  processed_bytes bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_meeting_notes_cofounder(requested_organization_id)
     or auth.uid() is null
     or scanned_count not between 0 and 25
     or document_count not between 0 and 20
     or processed_bytes not between 0 and 10485760
     or (returned_page_token is not null and length(trim(returned_page_token)) not between 1 and 2048) then
    return false;
  end if;

  update public.meeting_gemini_sync_states sync_state
  set page_token = nullif(trim(returned_page_token), ''),
      lease_token = null,
      lease_expires_at = null,
      next_allowed_at = now() + interval '2 seconds',
      run_scanned = sync_state.run_scanned + scanned_count,
      run_documents = sync_state.run_documents + document_count,
      run_bytes = sync_state.run_bytes + processed_bytes,
      last_completed_at = now(),
      last_error = null,
      updated_at = now()
  where sync_state.organization_id = requested_organization_id
    and sync_state.profile_id = auth.uid()
    and sync_state.lease_token = requested_lease_token
    and sync_state.lease_expires_at >= now()
    and sync_state.run_scanned + scanned_count <= 100
    and sync_state.run_documents + document_count <= 20
    and sync_state.run_bytes + processed_bytes <= 10485760;
  return found;
end;
$$;

create or replace function public.release_meeting_gemini_sync_claim(
  requested_organization_id uuid,
  requested_lease_token uuid,
  failure_message text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_meeting_notes_cofounder(requested_organization_id)
     or auth.uid() is null then
    return false;
  end if;
  update public.meeting_gemini_sync_states sync_state
  set lease_token = null,
      lease_expires_at = null,
      next_allowed_at = now() + interval '5 seconds',
      last_error = left(coalesce(failure_message, 'Gemini sync failed'), 1000),
      updated_at = now()
  where sync_state.organization_id = requested_organization_id
    and sync_state.profile_id = auth.uid()
    and sync_state.lease_token = requested_lease_token;
  return found;
end;
$$;

revoke execute on function public.claim_meeting_gemini_sync(uuid, integer)
from public, anon;
revoke execute on function public.complete_meeting_gemini_sync(
  uuid, uuid, text, integer, integer, bigint
) from public, anon;
revoke execute on function public.release_meeting_gemini_sync_claim(
  uuid, uuid, text
) from public, anon;
grant execute on function public.claim_meeting_gemini_sync(uuid, integer)
to authenticated;
grant execute on function public.complete_meeting_gemini_sync(
  uuid, uuid, text, integer, integer, bigint
) to authenticated;
grant execute on function public.release_meeting_gemini_sync_claim(
  uuid, uuid, text
) to authenticated;
