-- Add last_contacted_at column to crm_leads
alter table public.crm_leads
  add column if not exists last_contacted_at timestamptz;

-- Create crm_lead_follow_ups table
create table if not exists public.crm_lead_follow_ups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  lead_id uuid not null references public.crm_leads (id) on delete cascade,
  contacted_at timestamptz not null default now(),
  comment text,
  created_by_profile_id uuid references public.profiles (id) on delete set null
);

-- Enable RLS on crm_lead_follow_ups
alter table public.crm_lead_follow_ups enable row level security;

-- Add RLS policies for crm_lead_follow_ups
drop policy if exists "members can do all on crm_lead_follow_ups" on public.crm_lead_follow_ups;
create policy "members can do all on crm_lead_follow_ups"
  on public.crm_lead_follow_ups for all
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

grant select, insert, update, delete
on public.crm_lead_follow_ups
to authenticated;

grant all privileges
on public.crm_lead_follow_ups
to service_role;
