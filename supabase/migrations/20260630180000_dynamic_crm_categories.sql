-- Create crm_categories table
create table if not exists public.crm_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  status_key text not null,
  color text not null default 'gray',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_categories_org_status_key_unique unique (organization_id, status_key)
);

-- Enable RLS
alter table public.crm_categories enable row level security;

-- Policies for organization members
drop policy if exists "members can read crm categories" on public.crm_categories;
create policy "members can read crm categories" on public.crm_categories
  for select using (public.is_org_member(organization_id));

drop policy if exists "members can insert crm categories" on public.crm_categories;
create policy "members can insert crm categories" on public.crm_categories
  for insert with check (public.is_org_member(organization_id));

drop policy if exists "members can update crm categories" on public.crm_categories;
create policy "members can update crm categories" on public.crm_categories
  for update using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists "members can delete crm categories" on public.crm_categories;
create policy "members can delete crm categories" on public.crm_categories
  for delete using (public.is_org_member(organization_id));

grant select, insert, update, delete
on public.crm_categories
to authenticated;

grant all privileges
on public.crm_categories
to service_role;

-- Drop the check constraint on crm_leads status column
alter table public.crm_leads drop constraint if exists crm_leads_status_check;
