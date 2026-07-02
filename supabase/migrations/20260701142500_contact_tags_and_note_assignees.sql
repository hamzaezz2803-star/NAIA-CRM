-- Create crm_contact_tags junction table
create table if not exists public.crm_contact_tags (
  contact_id uuid not null references public.crm_contacts (id) on delete cascade,
  tag_id uuid not null references public.crm_tags (id) on delete cascade,
  primary key (contact_id, tag_id)
);

-- Enable RLS on crm_contact_tags
alter table public.crm_contact_tags enable row level security;

-- Add RLS policies for crm_contact_tags
drop policy if exists "members can do all on crm_contact_tags" on public.crm_contact_tags;
create policy "members can do all on crm_contact_tags"
  on public.crm_contact_tags for all
  using (exists (
    select 1 from public.crm_contacts c
    where c.id = contact_id
      and public.is_org_member(c.organization_id)
  ))
  with check (exists (
    select 1 from public.crm_contacts c
    where c.id = contact_id
      and public.is_org_member(c.organization_id)
  ));

-- Add assigned_to_profile_id column to crm_lead_notes
alter table public.crm_lead_notes
  add column if not exists assigned_to_profile_id uuid references public.profiles (id) on delete set null;

grant select, insert, update, delete
on public.crm_contact_tags
to authenticated;

grant all privileges
on public.crm_contact_tags
to service_role;
