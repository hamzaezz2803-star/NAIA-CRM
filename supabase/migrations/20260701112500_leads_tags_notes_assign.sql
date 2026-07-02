-- Lead tags, assignment, and notes schema changes

-- 1. Create tags table
create table if not exists public.crm_tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  color text not null default 'teal',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

-- 2. Create lead-to-tag junction table
create table if not exists public.crm_lead_tags (
  lead_id uuid not null references public.crm_leads (id) on delete cascade,
  tag_id uuid not null references public.crm_tags (id) on delete cascade,
  primary key (lead_id, tag_id)
);

-- 3. Add assignee and last updated columns to crm_leads
alter table public.crm_leads
  add column if not exists assigned_to_profile_id uuid references public.profiles (id) on delete set null,
  add column if not exists last_updated_by_profile_id uuid references public.profiles (id) on delete set null,
  add column if not exists last_updated_at timestamptz default now();

-- 4. Create lead notes table
create table if not exists public.crm_lead_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  lead_id uuid not null references public.crm_leads (id) on delete cascade,
  content text not null,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 5. Enable Row Level Security (RLS)
alter table public.crm_tags enable row level security;
alter table public.crm_lead_tags enable row level security;
alter table public.crm_lead_notes enable row level security;

-- 6. RLS Policies
drop policy if exists "members can do all on crm_tags" on public.crm_tags;
create policy "members can do all on crm_tags"
  on public.crm_tags for all
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists "members can do all on crm_lead_tags" on public.crm_lead_tags;
create policy "members can do all on crm_lead_tags"
  on public.crm_lead_tags for all
  using (exists (
    select 1 from public.crm_leads l
    where l.id = lead_id
      and public.is_org_member(l.organization_id)
  ))
  with check (exists (
    select 1 from public.crm_leads l
    where l.id = lead_id
      and public.is_org_member(l.organization_id)
  ));

drop policy if exists "members can do all on crm_lead_notes" on public.crm_lead_notes;
create policy "members can do all on crm_lead_notes"
  on public.crm_lead_notes for all
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

grant select, insert, update, delete
on public.crm_tags, public.crm_lead_tags, public.crm_lead_notes
to authenticated;

grant all privileges
on public.crm_tags, public.crm_lead_tags, public.crm_lead_notes
to service_role;
