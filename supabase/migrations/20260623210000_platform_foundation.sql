create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  unique (organization_id, profile_id)
);

create index if not exists organization_memberships_profile_id_idx
  on public.organization_memberships (profile_id);

create or replace function public.is_org_member(target_organization_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.profile_id = auth.uid()
  );
$$;

create or replace function public.is_org_admin(target_organization_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.profile_id = auth.uid()
      and membership.role in ('owner', 'admin')
  );
$$;

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  module text not null,
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_organization_created_at_idx
  on public.audit_events (organization_id, created_at desc);

create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null check (provider in ('google', 'slack', 'whatsapp', 'microsoft')),
  status text not null default 'not-connected' check (status in ('not-connected', 'connected', 'needs-review', 'revoked')),
  external_account_label text,
  scopes text[] not null default '{}',
  encrypted_token_reference text,
  connected_by_profile_id uuid references public.profiles (id) on delete set null,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider, external_account_label)
);

create table if not exists public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  source_module text not null,
  workflow_key text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'waiting-for-approval', 'completed', 'failed', 'cancelled')),
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  error text,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workflow_runs_organization_status_idx
  on public.workflow_runs (organization_id, status, created_at desc);

create table if not exists public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  workflow_run_id uuid references public.workflow_runs (id) on delete set null,
  source_module text not null,
  action_kind text not null check (action_kind in ('send-email', 'send-whatsapp', 'create-proposal', 'send-contract', 'send-invoice', 'send-offer')),
  status text not null default 'draft' check (status in ('draft', 'pending', 'approved', 'rejected', 'cancelled')),
  title text not null,
  draft_payload jsonb not null default '{}'::jsonb,
  requested_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  reviewed_by_profile_id uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists approval_requests_organization_status_idx
  on public.approval_requests (organization_id, status, created_at desc);

create table if not exists public.file_references (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  source_module text not null,
  entity_type text,
  entity_id uuid,
  provider text not null check (provider in ('google-drive', 'supabase-storage', 'external-url')),
  display_name text not null,
  url text,
  external_id text,
  mime_type text,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists file_references_entity_idx
  on public.file_references (organization_id, source_module, entity_type, entity_id);

create table if not exists public.domain_events_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  source_module text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'processing', 'processed', 'failed')),
  attempts integer not null default 0,
  last_error text,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  occurred_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists domain_events_outbox_status_idx
  on public.domain_events_outbox (status, occurred_at);

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.audit_events enable row level security;
alter table public.integration_connections enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.approval_requests enable row level security;
alter table public.file_references enable row level security;
alter table public.domain_events_outbox enable row level security;

create policy "members can read their organizations"
on public.organizations for select
using (public.is_org_member(id));

create policy "users can read their own profile"
on public.profiles for select
using (id = auth.uid());

create policy "users can update their own profile"
on public.profiles for update
using (id = auth.uid())
with check (id = auth.uid());

create policy "members can read memberships in their organizations"
on public.organization_memberships for select
using (public.is_org_member(organization_id));

create policy "admins can manage memberships"
on public.organization_memberships for all
using (public.is_org_admin(organization_id))
with check (public.is_org_admin(organization_id));

create policy "members can read audit events"
on public.audit_events for select
using (public.is_org_member(organization_id));

create policy "members can insert audit events"
on public.audit_events for insert
with check (public.is_org_member(organization_id));

create policy "members can read integration connections"
on public.integration_connections for select
using (public.is_org_member(organization_id));

create policy "admins can manage integration connections"
on public.integration_connections for all
using (public.is_org_admin(organization_id))
with check (public.is_org_admin(organization_id));

create policy "members can read workflow runs"
on public.workflow_runs for select
using (public.is_org_member(organization_id));

create policy "members can create workflow runs"
on public.workflow_runs for insert
with check (public.is_org_member(organization_id));

create policy "members can update workflow runs"
on public.workflow_runs for update
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

create policy "members can read approval requests"
on public.approval_requests for select
using (public.is_org_member(organization_id));

create policy "members can create approval requests"
on public.approval_requests for insert
with check (public.is_org_member(organization_id));

create policy "admins can review approval requests"
on public.approval_requests for update
using (public.is_org_admin(organization_id))
with check (public.is_org_admin(organization_id));

create policy "members can read file references"
on public.file_references for select
using (public.is_org_member(organization_id));

create policy "members can create file references"
on public.file_references for insert
with check (public.is_org_member(organization_id));

create policy "members can read domain events"
on public.domain_events_outbox for select
using (public.is_org_member(organization_id));

create policy "members can create domain events"
on public.domain_events_outbox for insert
with check (public.is_org_member(organization_id));
