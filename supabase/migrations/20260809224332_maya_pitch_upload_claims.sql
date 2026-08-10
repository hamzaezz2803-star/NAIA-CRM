-- Durable, transactional idempotency for Maya's one permitted Drive write.
-- The database claim is acquired before the upload. A crashed/failed attempt
-- can be reclaimed, but the application must always reconcile the exact Drive
-- id and filename before retrying so an upload whose response was lost is
-- reused. The reserved Drive id is immutable for the lifetime of the claim.

create or replace function public.is_maya_pitch_owner(
  target_organization_id uuid
)
returns boolean
language sql
security definer
set search_path = ''
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

revoke execute on function public.is_maya_pitch_owner(uuid)
from public, anon;
grant execute on function public.is_maya_pitch_owner(uuid)
to authenticated;

create table public.maya_pitch_upload_claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  lead_id uuid references public.crm_leads (id) on delete set null,
  destination_pitch_folder_id text not null,
  draft_file_name text not null,
  reserved_drive_file_id text not null unique,
  template_drive_file_id text not null,
  template_sha256 text not null check (template_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'claim' check (status in ('claim', 'uploaded', 'failed')),
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer not null default 1 check (attempt_count > 0),
  draft_drive_file_id text,
  draft_file_url text,
  error text,
  claimed_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maya_pitch_upload_claims_destination_file_key
    unique (destination_pitch_folder_id, draft_file_name),
  constraint maya_pitch_upload_claims_state_check check (
    (
      status = 'claim'
      and lease_token is not null
      and lease_expires_at is not null
      and draft_drive_file_id is null
    )
    or (
      status = 'uploaded'
      and lease_token is null
      and lease_expires_at is null
      and draft_drive_file_id is not null
    )
    or (
      status = 'failed'
      and lease_token is null
      and lease_expires_at is null
      and draft_drive_file_id is null
      and error is not null
    )
  )
);

create index maya_pitch_upload_claims_lead_idx
  on public.maya_pitch_upload_claims (organization_id, lead_id, updated_at desc);

alter table public.maya_pitch_upload_claims enable row level security;

revoke all on table public.maya_pitch_upload_claims from anon, authenticated;
grant select on table public.maya_pitch_upload_claims to authenticated;

create policy "maya owners can read pitch upload claims"
on public.maya_pitch_upload_claims for select
to authenticated
using (public.is_maya_pitch_owner(organization_id));

create or replace function public.claim_maya_pitch_upload(
  requested_organization_id uuid,
  requested_lead_id uuid,
  requested_pitch_folder_id text,
  requested_draft_file_name text,
  requested_reserved_drive_file_id text,
  requested_template_drive_file_id text,
  requested_template_sha256 text,
  lease_seconds integer default 900
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed public.maya_pitch_upload_claims%rowtype;
  normalized_sha256 text := lower(trim(requested_template_sha256));
  new_lease_token uuid := gen_random_uuid();
begin
  if not public.is_maya_pitch_owner(requested_organization_id) then
    raise insufficient_privilege using
      message = 'Maya pitch upload claims are restricted to organization owners Ali and Nabil.';
  end if;

  if not exists (
    select 1
    from public.crm_leads lead
    where lead.id = requested_lead_id
      and lead.organization_id = requested_organization_id
  ) then
    raise foreign_key_violation using
      message = 'The Maya pitch lead is not in the authenticated organization.';
  end if;

  if nullif(trim(requested_pitch_folder_id), '') is null
     or nullif(trim(requested_draft_file_name), '') is null
     or nullif(trim(requested_reserved_drive_file_id), '') is null
     or nullif(trim(requested_template_drive_file_id), '') is null
     or normalized_sha256 !~ '^[0-9a-f]{64}$' then
    raise invalid_parameter_value using
      message = 'The Maya pitch upload claim payload is invalid.';
  end if;

  insert into public.maya_pitch_upload_claims (
    organization_id,
    lead_id,
    destination_pitch_folder_id,
    draft_file_name,
    reserved_drive_file_id,
    template_drive_file_id,
    template_sha256,
    status,
    lease_token,
    lease_expires_at,
    claimed_by_profile_id
  ) values (
    requested_organization_id,
    requested_lead_id,
    trim(requested_pitch_folder_id),
    trim(requested_draft_file_name),
    trim(requested_reserved_drive_file_id),
    trim(requested_template_drive_file_id),
    normalized_sha256,
    'claim',
    new_lease_token,
    now() + make_interval(
      secs => least(greatest(coalesce(lease_seconds, 900), 60), 3600)
    ),
    auth.uid()
  )
  on conflict (destination_pitch_folder_id, draft_file_name)
  do nothing
  returning * into claimed;

  if claimed.id is not null then
    return jsonb_build_object(
      'action', 'execute',
      'claimId', claimed.id,
      'leaseToken', claimed.lease_token,
      'reservedDriveFileId', claimed.reserved_drive_file_id,
      'status', claimed.status
    );
  end if;

  select existing.* into claimed
  from public.maya_pitch_upload_claims existing
  where existing.destination_pitch_folder_id = trim(requested_pitch_folder_id)
    and existing.draft_file_name = trim(requested_draft_file_name)
  for update;

  if claimed.organization_id <> requested_organization_id then
    raise insufficient_privilege using
      message = 'This Maya pitch destination is already bound to another organization.';
  end if;

  if claimed.template_drive_file_id <> trim(requested_template_drive_file_id)
     or claimed.template_sha256 <> normalized_sha256 then
    raise invalid_parameter_value using
      message = 'This Maya pitch filename is already bound to a different audited template.';
  end if;

  if claimed.status = 'uploaded' then
    return jsonb_build_object(
      'action', 'uploaded',
      'claimId', claimed.id,
      'driveFileId', claimed.draft_drive_file_id,
      'driveFileUrl', claimed.draft_file_url,
      'status', claimed.status
    );
  end if;

  if claimed.status = 'claim' and claimed.lease_expires_at > now() then
    return jsonb_build_object(
      'action', 'busy',
      'claimId', claimed.id,
      'status', claimed.status
    );
  end if;

  update public.maya_pitch_upload_claims upload_claim
  set lead_id = requested_lead_id,
      status = 'claim',
      lease_token = new_lease_token,
      lease_expires_at = now() + make_interval(
        secs => least(greatest(coalesce(lease_seconds, 900), 60), 3600)
      ),
      attempt_count = upload_claim.attempt_count + 1,
      draft_drive_file_id = null,
      draft_file_url = null,
      error = null,
      claimed_by_profile_id = auth.uid(),
      updated_at = now()
  where upload_claim.id = claimed.id
  returning * into claimed;

  return jsonb_build_object(
    'action', 'execute',
    'claimId', claimed.id,
    'leaseToken', claimed.lease_token,
    'reservedDriveFileId', claimed.reserved_drive_file_id,
    'status', claimed.status
  );
end;
$$;

create or replace function public.renew_maya_pitch_upload_claim(
  requested_claim_id uuid,
  requested_lease_token uuid,
  lease_seconds integer default 900
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  renewed boolean;
begin
  update public.maya_pitch_upload_claims upload_claim
  set lease_expires_at = now() + make_interval(
        secs => least(greatest(coalesce(lease_seconds, 900), 60), 3600)
      ),
      updated_at = now()
  where upload_claim.id = requested_claim_id
    and upload_claim.lease_token = requested_lease_token
    and upload_claim.status = 'claim'
    and public.is_maya_pitch_owner(upload_claim.organization_id)
  returning true into renewed;

  return coalesce(renewed, false);
end;
$$;

create or replace function public.complete_maya_pitch_upload_claim(
  requested_claim_id uuid,
  requested_lease_token uuid,
  requested_drive_file_id text,
  requested_drive_file_url text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  completed boolean;
begin
  if nullif(trim(requested_drive_file_id), '') is null then
    raise invalid_parameter_value using
      message = 'A Drive file id is required to complete a Maya pitch upload claim.';
  end if;

  update public.maya_pitch_upload_claims upload_claim
  set status = 'uploaded',
      lease_token = null,
      lease_expires_at = null,
      draft_drive_file_id = trim(requested_drive_file_id),
      draft_file_url = nullif(trim(requested_drive_file_url), ''),
      error = null,
      updated_at = now()
  where upload_claim.id = requested_claim_id
    and upload_claim.lease_token = requested_lease_token
    and upload_claim.status = 'claim'
    and public.is_maya_pitch_owner(upload_claim.organization_id)
  returning true into completed;

  return coalesce(completed, false);
end;
$$;

create or replace function public.fail_maya_pitch_upload_claim(
  requested_claim_id uuid,
  requested_lease_token uuid,
  failure_message text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  failed boolean;
begin
  update public.maya_pitch_upload_claims upload_claim
  set status = 'failed',
      lease_token = null,
      lease_expires_at = null,
      draft_drive_file_id = null,
      draft_file_url = null,
      error = left(coalesce(nullif(trim(failure_message), ''), 'Maya pitch upload failed.'), 4000),
      updated_at = now()
  where upload_claim.id = requested_claim_id
    and upload_claim.lease_token = requested_lease_token
    and upload_claim.status = 'claim'
    and public.is_maya_pitch_owner(upload_claim.organization_id)
  returning true into failed;

  return coalesce(failed, false);
end;
$$;

revoke execute on function public.claim_maya_pitch_upload(
  uuid, uuid, text, text, text, text, text, integer
) from public, anon;
grant execute on function public.claim_maya_pitch_upload(
  uuid, uuid, text, text, text, text, text, integer
) to authenticated;

revoke execute on function public.renew_maya_pitch_upload_claim(
  uuid, uuid, integer
) from public, anon;
grant execute on function public.renew_maya_pitch_upload_claim(
  uuid, uuid, integer
) to authenticated;

revoke execute on function public.complete_maya_pitch_upload_claim(
  uuid, uuid, text, text
) from public, anon;
grant execute on function public.complete_maya_pitch_upload_claim(
  uuid, uuid, text, text
) to authenticated;

revoke execute on function public.fail_maya_pitch_upload_claim(
  uuid, uuid, text
) from public, anon;
grant execute on function public.fail_maya_pitch_upload_claim(
  uuid, uuid, text
) to authenticated;
