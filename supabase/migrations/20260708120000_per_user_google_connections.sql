-- Per-user Google Workspace connections, self-service RLS, and role provisioning.
--
-- Before this migration, integration_connections rows were unique per
-- (organization, provider, external_account_label): one shared Google
-- connection per organization, readable (raw tokens included) by every
-- member and writable only by admins. Each member now owns exactly one
-- connection per provider and can only read or manage their own row.

-- 1) Deduplicate rows so the new per-user unique constraint can be created,
--    keeping the most recently connected row per (org, provider, user).
with ranked as (
  select
    id,
    row_number() over (
      partition by organization_id, provider, connected_by_profile_id
      order by coalesce(connected_at, created_at) desc, id desc
    ) as rn
  from public.integration_connections
  where connected_by_profile_id is not null
)
delete from public.integration_connections
where id in (select id from ranked where rn > 1);

-- Ownerless legacy rows can no longer be read under the new policies; also
-- drop their token material so no unreachable row retains a live refresh
-- token.
update public.integration_connections
set status = 'revoked',
    encrypted_token_reference = null,
    updated_at = now()
where connected_by_profile_id is null;

-- 2) Connection identity is now the connecting user, not the external label.
do $$
declare
  legacy_constraint text;
begin
  select conname into legacy_constraint
  from pg_constraint
  where conrelid = 'public.integration_connections'::regclass
    and contype = 'u';

  if legacy_constraint is not null then
    execute format(
      'alter table public.integration_connections drop constraint %I',
      legacy_constraint
    );
  end if;
end $$;

alter table public.integration_connections
  add constraint integration_connections_org_provider_profile_key
  unique (organization_id, provider, connected_by_profile_id);

-- A connection without its owner is unreadable and unrevokable under the new
-- policies: delete it together with the profile instead of orphaning it.
alter table public.integration_connections
  drop constraint if exists integration_connections_connected_by_profile_id_fkey;
alter table public.integration_connections
  add constraint integration_connections_connected_by_profile_id_fkey
  foreign key (connected_by_profile_id) references public.profiles (id)
  on delete cascade;

-- 3) RLS: members manage only their own connections. Raw token references are
--    no longer visible to other organization members.
drop policy if exists "members can read integration connections"
  on public.integration_connections;
drop policy if exists "admins can manage integration connections"
  on public.integration_connections;

create policy "users can read their own integration connections"
on public.integration_connections for select
using (connected_by_profile_id = auth.uid());

create policy "users can manage their own integration connections"
on public.integration_connections for all
using (
  connected_by_profile_id = auth.uid()
  and public.is_org_member(organization_id)
)
with check (
  connected_by_profile_id = auth.uid()
  and public.is_org_member(organization_id)
);

-- 4) Provision profiles, memberships, and roles for the current team when the
--    matching auth.users rows exist (production). Cofounders are owners;
--    interns are members. Idempotent: reruns only reassert roles.
do $$
declare
  default_org_id uuid;
  founder_emails text[] := array['ali@qarizmi.com', 'nabil@qarizmi.com'];
  team_emails text[] := array[
    'ali@qarizmi.com',
    'nabil@qarizmi.com',
    'hamza@qarizmi.com',
    'wissal@qarizmi.com'
  ];
  target_email text;
  target_user_id uuid;
begin
  select id into default_org_id
  from public.organizations
  order by created_at asc
  limit 1;

  if default_org_id is null then
    insert into public.organizations (name, slug)
    values ('Qarizmi', 'naia-os')
    returning id into default_org_id;
  end if;

  foreach target_email in array team_emails loop
    select id into target_user_id
    from auth.users
    where lower(email) = target_email
    limit 1;

    if target_user_id is null then
      continue;
    end if;

    insert into public.profiles (id, email, full_name)
    values (
      target_user_id,
      target_email,
      initcap(split_part(target_email, '@', 1))
    )
    on conflict (id) do nothing;

    insert into public.organization_memberships (organization_id, profile_id, role)
    values (
      default_org_id,
      target_user_id,
      case when target_email = any (founder_emails) then 'owner' else 'member' end
    )
    on conflict (organization_id, profile_id)
    do update set role = excluded.role;
  end loop;
end $$;

-- 5) Auto-provision future @qarizmi.com sign-ins (Google login) as members of
--    the default organization. The domain mirrors the app-level allowlist
--    default in src/platform/auth/access.ts.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  default_org_id uuid;
begin
  if new.email is null or lower(new.email) not like '%@qarizmi.com' then
    return new;
  end if;

  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    lower(new.email),
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      initcap(split_part(new.email, '@', 1))
    )
  )
  on conflict (id) do nothing;

  select id into default_org_id
  from public.organizations
  order by created_at asc
  limit 1;

  if default_org_id is null then
    return new;
  end if;

  insert into public.organization_memberships (organization_id, profile_id, role)
  values (
    default_org_id,
    new.id,
    case
      when lower(new.email) in ('ali@qarizmi.com', 'nabil@qarizmi.com') then 'owner'
      else 'member'
    end
  )
  on conflict (organization_id, profile_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- 6) App-side provisioning for authorized users the domain trigger skips
--    (emails allowlisted via AUTH_ALLOWED_EMAILS outside @qarizmi.com, or
--    auth users created before this migration). Called by /auth/callback
--    after the application-level allowlist check passes.
create or replace function public.ensure_membership()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  default_org_id uuid;
  current_email text;
begin
  if auth.uid() is null then
    return;
  end if;

  select lower(email) into current_email
  from auth.users
  where id = auth.uid();

  -- Same domain allowlist as handle_new_user: PostgREST exposes this RPC to
  -- every authenticated user, so it must not provision accounts the app
  -- would reject. Emails allowlisted outside the domain (AUTH_ALLOWED_EMAILS)
  -- are provisioned manually by an admin.
  if current_email is null
     or current_email not like '%@qarizmi.com' then
    return;
  end if;

  insert into public.profiles (id, email, full_name)
  values (
    auth.uid(),
    current_email,
    initcap(split_part(current_email, '@', 1))
  )
  on conflict (id) do nothing;

  select id into default_org_id
  from public.organizations
  order by created_at asc
  limit 1;

  if default_org_id is null then
    return;
  end if;

  insert into public.organization_memberships (organization_id, profile_id, role)
  values (
    default_org_id,
    auth.uid(),
    case
      when current_email in ('ali@qarizmi.com', 'nabil@qarizmi.com') then 'owner'
      else 'member'
    end
  )
  on conflict (organization_id, profile_id) do nothing;
end;
$$;

grant execute on function public.ensure_membership() to authenticated;
