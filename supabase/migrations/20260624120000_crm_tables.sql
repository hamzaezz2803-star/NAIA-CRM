-- CRM module tables: companies, contacts, leads
-- Scoped by organization_id with RLS matching platform_foundation policies

create table if not exists public.crm_companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  industry text,
  website text,
  drive_folder_url text,
  notes text,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_companies_organization_id_idx
  on public.crm_companies (organization_id);

create table if not exists public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  company_id uuid references public.crm_companies (id) on delete set null,
  name text not null,
  email text,
  phone text,
  job_title text,
  notes text,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_contacts_organization_id_idx
  on public.crm_contacts (organization_id);
create index if not exists crm_contacts_company_id_idx
  on public.crm_contacts (company_id);

create table if not exists public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  company_id uuid references public.crm_companies (id) on delete set null,
  contact_id uuid references public.crm_contacts (id) on delete set null,
  topic text not null,
  source text,
  status text not null default 'lead-to-contact' check (status in (
    'lead-to-contact',
    'contacted',
    'to-follow-up',
    'meeting-booked',
    'proposal-sent',
    'won',
    'dead-end'
  )),
  notes text,
  next_action text,
  next_action_date date,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_leads_organization_status_idx
  on public.crm_leads (organization_id, status, created_at desc);
create index if not exists crm_leads_company_id_idx
  on public.crm_leads (company_id);
create index if not exists crm_leads_contact_id_idx
  on public.crm_leads (contact_id);

-- Enable RLS on all CRM tables
alter table public.crm_companies enable row level security;
alter table public.crm_contacts enable row level security;
alter table public.crm_leads enable row level security;

-- crm_companies policies
drop policy if exists "members can read crm companies" on public.crm_companies;
create policy "members can read crm companies"
on public.crm_companies for select
using (public.is_org_member(organization_id));

drop policy if exists "members can create crm companies" on public.crm_companies;
create policy "members can create crm companies"
on public.crm_companies for insert
with check (public.is_org_member(organization_id));

drop policy if exists "members can update crm companies" on public.crm_companies;
create policy "members can update crm companies"
on public.crm_companies for update
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

drop policy if exists "admins can delete crm companies" on public.crm_companies;
create policy "admins can delete crm companies"
on public.crm_companies for delete
using (public.is_org_admin(organization_id));

-- crm_contacts policies
drop policy if exists "members can read crm contacts" on public.crm_contacts;
create policy "members can read crm contacts"
on public.crm_contacts for select
using (public.is_org_member(organization_id));

drop policy if exists "members can create crm contacts" on public.crm_contacts;
create policy "members can create crm contacts"
on public.crm_contacts for insert
with check (public.is_org_member(organization_id));

drop policy if exists "members can update crm contacts" on public.crm_contacts;
create policy "members can update crm contacts"
on public.crm_contacts for update
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

drop policy if exists "admins can delete crm contacts" on public.crm_contacts;
create policy "admins can delete crm contacts"
on public.crm_contacts for delete
using (public.is_org_admin(organization_id));

-- crm_leads policies
drop policy if exists "members can read crm leads" on public.crm_leads;
create policy "members can read crm leads"
on public.crm_leads for select
using (public.is_org_member(organization_id));

drop policy if exists "members can create crm leads" on public.crm_leads;
create policy "members can create crm leads"
on public.crm_leads for insert
with check (public.is_org_member(organization_id));

drop policy if exists "members can update crm leads" on public.crm_leads;
create policy "members can update crm leads"
on public.crm_leads for update
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

drop policy if exists "admins can delete crm leads" on public.crm_leads;
create policy "admins can delete crm leads"
on public.crm_leads for delete
using (public.is_org_admin(organization_id));

grant select, insert, update, delete
on public.crm_companies, public.crm_contacts, public.crm_leads
to authenticated;

grant all privileges
on public.crm_companies, public.crm_contacts, public.crm_leads
to service_role;
