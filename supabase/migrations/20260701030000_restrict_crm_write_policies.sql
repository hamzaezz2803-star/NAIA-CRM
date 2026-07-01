-- Restrict CRM writes to contributors. Viewers keep read-only CRM access.

create or replace function public.is_org_contributor(target_organization_id uuid)
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
      and membership.role in ('owner', 'admin', 'member')
  );
$$;

grant execute on function public.is_org_contributor(uuid)
to authenticated, service_role;

drop policy if exists "members can create crm companies" on public.crm_companies;
drop policy if exists "contributors can create crm companies" on public.crm_companies;
create policy "contributors can create crm companies"
on public.crm_companies for insert
with check (public.is_org_contributor(organization_id));

drop policy if exists "members can update crm companies" on public.crm_companies;
drop policy if exists "contributors can update crm companies" on public.crm_companies;
create policy "contributors can update crm companies"
on public.crm_companies for update
using (public.is_org_contributor(organization_id))
with check (public.is_org_contributor(organization_id));

drop policy if exists "members can create crm contacts" on public.crm_contacts;
drop policy if exists "contributors can create crm contacts" on public.crm_contacts;
create policy "contributors can create crm contacts"
on public.crm_contacts for insert
with check (public.is_org_contributor(organization_id));

drop policy if exists "members can update crm contacts" on public.crm_contacts;
drop policy if exists "contributors can update crm contacts" on public.crm_contacts;
create policy "contributors can update crm contacts"
on public.crm_contacts for update
using (public.is_org_contributor(organization_id))
with check (public.is_org_contributor(organization_id));

drop policy if exists "members can create crm leads" on public.crm_leads;
drop policy if exists "contributors can create crm leads" on public.crm_leads;
create policy "contributors can create crm leads"
on public.crm_leads for insert
with check (public.is_org_contributor(organization_id));

drop policy if exists "members can update crm leads" on public.crm_leads;
drop policy if exists "contributors can update crm leads" on public.crm_leads;
create policy "contributors can update crm leads"
on public.crm_leads for update
using (public.is_org_contributor(organization_id))
with check (public.is_org_contributor(organization_id));
