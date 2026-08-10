-- CRM confidentiality boundary and one-shot Trello migration ledger.
--
-- This migration is deliberately data-preserving:
--   * existing CRM rows are preserved; sensitive rows are scope-escalated;
--   * import/rollback functions never DELETE business rows;
--   * confidential records are visible only to the two exact cofounder
--     identities stored in auth.users (profiles.email is intentionally not
--     trusted because users can update their own profile row).

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

create or replace function private.is_crm_cofounder(
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
      and membership.profile_id = (select auth.uid())
      and lower(user_record.email) in ('ali@qarizmi.com', 'nabil@qarizmi.com')
  );
$$;

create or replace function private.is_crm_cofounder_profile(
  target_organization_id uuid,
  target_profile_id uuid
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
      and membership.profile_id = target_profile_id
      and lower(user_record.email) in ('ali@qarizmi.com', 'nabil@qarizmi.com')
  );
$$;

create or replace function private.can_read_crm_record(
  target_organization_id uuid,
  target_access_scope text
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
    where membership.organization_id = target_organization_id
      and membership.profile_id = (select auth.uid())
  ) and (
    target_access_scope = 'organization'
    or private.is_crm_cofounder(target_organization_id)
  );
$$;

create or replace function private.can_write_crm_record(
  target_organization_id uuid,
  target_access_scope text
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
    where membership.organization_id = target_organization_id
      and membership.profile_id = (select auth.uid())
      and membership.role in ('owner', 'admin', 'member')
  ) and (
    target_access_scope = 'organization'
    or private.is_crm_cofounder(target_organization_id)
  );
$$;

create or replace function private.can_delete_crm_record(
  target_organization_id uuid,
  target_access_scope text
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
    where membership.organization_id = target_organization_id
      and membership.profile_id = (select auth.uid())
      and membership.role in ('owner', 'admin')
  ) and (
    target_access_scope = 'organization'
    or private.is_crm_cofounder(target_organization_id)
  );
$$;

create or replace function private.crm_normalize_match_text(input_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(btrim(coalesce(input_value, '')), '\s+', ' ', 'g'));
$$;

create or replace function private.crm_text_requires_cofounder(input_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(coalesce(input_value, '')) ~
    '(^|[^[:alnum:]_])(stagiaires?|stages?|interns?|internships?|trainees?|apprentices?|apprenti(e|es|s)?|apprentissages?|alternances?|alternants?|alternantes?|candidat(e|es|s)?|candidatures?|recrutement|ressources[[:space:]]+humaines|human[[:space:]]+resources|graduate[[:space:]]+interns?|pfe|cv|rh|hr)([^[:alnum:]_]|$)';
$$;

revoke execute on function private.is_crm_cofounder(uuid) from public, anon;
revoke execute on function private.is_crm_cofounder_profile(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.can_read_crm_record(uuid, text) from public, anon;
revoke execute on function private.can_write_crm_record(uuid, text) from public, anon;
revoke execute on function private.can_delete_crm_record(uuid, text) from public, anon;
revoke execute on function private.crm_normalize_match_text(text) from public, anon, authenticated;
revoke execute on function private.crm_text_requires_cofounder(text) from public, anon, authenticated;
grant execute on function private.is_crm_cofounder(uuid) to authenticated, service_role;
grant execute on function private.is_crm_cofounder_profile(uuid, uuid) to service_role;
grant execute on function private.can_read_crm_record(uuid, text) to authenticated, service_role;
grant execute on function private.can_write_crm_record(uuid, text) to authenticated, service_role;
grant execute on function private.can_delete_crm_record(uuid, text) to authenticated, service_role;

-- Narrow service-role RPC used by non-cookie bridges before they decide
-- whether a service-role query may include confidential rows.
create or replace function public.crm_bridge_actor_is_cofounder(
  target_organization_id uuid,
  target_profile_id uuid
)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select private.is_crm_cofounder_profile(
    target_organization_id,
    target_profile_id
  );
$$;

revoke execute on function public.crm_bridge_actor_is_cofounder(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.crm_bridge_actor_is_cofounder(uuid, uuid)
to service_role;

-- Root CRM entities carry the confidentiality scope. Children inherit it
-- through their parent policy below.
alter table public.crm_companies
  add column if not exists access_scope text not null default 'organization',
  add column if not exists archived_at timestamptz;
alter table public.crm_contacts
  add column if not exists access_scope text not null default 'organization',
  add column if not exists archived_at timestamptz;
alter table public.crm_leads
  add column if not exists access_scope text not null default 'organization',
  add column if not exists archived_at timestamptz;
alter table public.crm_categories
  add column if not exists access_scope text not null default 'organization',
  add column if not exists archived_at timestamptz;
alter table public.crm_tags
  add column if not exists access_scope text not null default 'organization',
  add column if not exists archived_at timestamptz;
alter table public.crm_tasks
  add column if not exists access_scope text not null default 'organization',
  add column if not exists archived_at timestamptz;

alter table public.crm_lead_tags add column if not exists archived_at timestamptz;
alter table public.crm_contact_tags add column if not exists archived_at timestamptz;
alter table public.crm_task_tags add column if not exists archived_at timestamptz;

alter table public.crm_companies drop constraint if exists crm_companies_access_scope_check;
alter table public.crm_companies add constraint crm_companies_access_scope_check
  check (access_scope in ('organization', 'cofounders'));
alter table public.crm_contacts drop constraint if exists crm_contacts_access_scope_check;
alter table public.crm_contacts add constraint crm_contacts_access_scope_check
  check (access_scope in ('organization', 'cofounders'));
alter table public.crm_leads drop constraint if exists crm_leads_access_scope_check;
alter table public.crm_leads add constraint crm_leads_access_scope_check
  check (access_scope in ('organization', 'cofounders'));
alter table public.crm_categories drop constraint if exists crm_categories_access_scope_check;
alter table public.crm_categories add constraint crm_categories_access_scope_check
  check (access_scope in ('organization', 'cofounders'));
alter table public.crm_tags drop constraint if exists crm_tags_access_scope_check;
alter table public.crm_tags add constraint crm_tags_access_scope_check
  check (access_scope in ('organization', 'cofounders'));
alter table public.crm_tasks drop constraint if exists crm_tasks_access_scope_check;
alter table public.crm_tasks add constraint crm_tasks_access_scope_check
  check (access_scope in ('organization', 'cofounders'));

-- Reject every cross-organization root reference before installing the
-- durable write boundary. Existing data is never rewritten to another
-- organization: an inconsistency aborts the migration for manual review.
do $boundaries$
begin
  if exists (
    select 1
    from public.crm_contacts contact
    join public.crm_companies company on company.id = contact.company_id
    where contact.organization_id <> company.organization_id
  ) then
    raise exception 'CRM boundary violation: contact references a company from another organization';
  end if;
  if exists (
    select 1
    from public.crm_leads lead
    join public.crm_companies company on company.id = lead.company_id
    where lead.organization_id <> company.organization_id
  ) then
    raise exception 'CRM boundary violation: lead references a company from another organization';
  end if;
  if exists (
    select 1
    from public.crm_leads lead
    join public.crm_contacts contact on contact.id = lead.contact_id
    where lead.organization_id <> contact.organization_id
  ) then
    raise exception 'CRM boundary violation: lead references a contact from another organization';
  end if;
  if exists (
    select 1
    from public.crm_tasks task
    join public.crm_leads lead on lead.id = task.lead_id
    where task.organization_id <> lead.organization_id
  ) then
    raise exception 'CRM boundary violation: task references a lead from another organization';
  end if;
  if exists (
    select 1
    from public.crm_lead_notes note
    join public.crm_leads lead on lead.id = note.lead_id
    where note.organization_id <> lead.organization_id
  ) or exists (
    select 1
    from public.crm_lead_follow_ups follow_up
    join public.crm_leads lead on lead.id = follow_up.lead_id
    where follow_up.organization_id <> lead.organization_id
  ) then
    raise exception 'CRM boundary violation: lead child belongs to another organization';
  end if;
  if exists (
    select 1
    from public.crm_lead_tags relation
    join public.crm_leads lead on lead.id = relation.lead_id
    join public.crm_tags tag on tag.id = relation.tag_id
    where lead.organization_id <> tag.organization_id
  ) or exists (
    select 1
    from public.crm_contact_tags relation
    join public.crm_contacts contact on contact.id = relation.contact_id
    join public.crm_tags tag on tag.id = relation.tag_id
    where contact.organization_id <> tag.organization_id
  ) or exists (
    select 1
    from public.crm_task_tags relation
    join public.crm_tasks task on task.id = relation.task_id
    join public.crm_tags tag on tag.id = relation.tag_id
    where task.organization_id <> tag.organization_id
  ) then
    raise exception 'CRM boundary violation: tag relation crosses organizations';
  end if;
end
$boundaries$;

-- Preserve all existing rows while escalating sensitive manual records and
-- descendants of confidential parents. Scope is one-way: it can never be
-- downgraded by a later edit.
update public.crm_companies
set access_scope = 'cofounders'
where access_scope <> 'cofounders'
  and private.crm_text_requires_cofounder(
    concat_ws(E'\n', name, industry, notes)
  );

update public.crm_contacts contact
set access_scope = 'cofounders'
where contact.access_scope <> 'cofounders'
  and (
    private.crm_text_requires_cofounder(
      concat_ws(E'\n', contact.name, contact.email, contact.phone,
        contact.job_title, contact.notes)
    )
    or exists (
      select 1 from public.crm_companies company
      where company.id = contact.company_id
        and company.organization_id = contact.organization_id
        and company.access_scope = 'cofounders'
    )
  );

update public.crm_leads lead
set access_scope = 'cofounders'
where lead.access_scope <> 'cofounders'
  and (
    private.crm_text_requires_cofounder(
      concat_ws(E'\n', lead.topic, lead.source, lead.notes, lead.next_action,
        lead.contact_job_title)
    )
    or exists (
      select 1 from public.crm_companies company
      where company.id = lead.company_id
        and company.organization_id = lead.organization_id
        and company.access_scope = 'cofounders'
    )
    or exists (
      select 1 from public.crm_contacts contact
      where contact.id = lead.contact_id
        and contact.organization_id = lead.organization_id
        and contact.access_scope = 'cofounders'
    )
  );

update public.crm_categories
set access_scope = 'cofounders'
where access_scope <> 'cofounders'
  and private.crm_text_requires_cofounder(concat_ws(E'\n', name, status_key));

update public.crm_tags
set access_scope = 'cofounders'
where access_scope <> 'cofounders'
  and private.crm_text_requires_cofounder(name);

update public.crm_tasks task
set access_scope = 'cofounders'
where task.access_scope <> 'cofounders'
  and (
    private.crm_text_requires_cofounder(
      concat_ws(E'\n', task.title, task.description)
    )
    or exists (
      select 1 from public.crm_leads lead
      where lead.id = task.lead_id
        and lead.organization_id = task.organization_id
        and lead.access_scope = 'cofounders'
    )
  );

create or replace function private.enforce_crm_root_boundary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_organization_id uuid;
  parent_access_scope text;
  sensitive_text text;
begin
  if tg_op = 'UPDATE' and old.access_scope = 'cofounders' then
    new.access_scope := 'cofounders';
  end if;

  -- A parent may move only when all existing descendants and tag relations
  -- already belong to the destination organization. This closes the reverse
  -- path where updating a parent would otherwise create a cross-org FK.
  if tg_op = 'UPDATE' and old.organization_id <> new.organization_id then
    if tg_table_name = 'crm_companies' and (
      exists (
        select 1 from public.crm_contacts contact
        where contact.company_id = new.id
          and contact.organization_id <> new.organization_id
      )
      or exists (
        select 1 from public.crm_leads lead
        where lead.company_id = new.id
          and lead.organization_id <> new.organization_id
      )
    ) then
      raise exception 'CRM boundary violation: company move strands descendants';
    elsif tg_table_name = 'crm_contacts' and (
      exists (
        select 1 from public.crm_leads lead
        where lead.contact_id = new.id
          and lead.organization_id <> new.organization_id
      )
      or exists (
        select 1
        from public.crm_contact_tags relation
        join public.crm_tags tag on tag.id = relation.tag_id
        where relation.contact_id = new.id
          and tag.organization_id <> new.organization_id
      )
    ) then
      raise exception 'CRM boundary violation: contact move strands descendants';
    elsif tg_table_name = 'crm_leads' and (
      exists (
        select 1 from public.crm_tasks task
        where task.lead_id = new.id
          and task.organization_id <> new.organization_id
      )
      or exists (
        select 1 from public.crm_lead_notes note
        where note.lead_id = new.id
          and note.organization_id <> new.organization_id
      )
      or exists (
        select 1 from public.crm_lead_follow_ups follow_up
        where follow_up.lead_id = new.id
          and follow_up.organization_id <> new.organization_id
      )
      or exists (
        select 1
        from public.crm_lead_tags relation
        join public.crm_tags tag on tag.id = relation.tag_id
        where relation.lead_id = new.id
          and tag.organization_id <> new.organization_id
      )
    ) then
      raise exception 'CRM boundary violation: lead move strands descendants';
    elsif tg_table_name = 'crm_tasks' and exists (
      select 1
      from public.crm_task_tags relation
      join public.crm_tags tag on tag.id = relation.tag_id
      where relation.task_id = new.id
        and tag.organization_id <> new.organization_id
    ) then
      raise exception 'CRM boundary violation: task move strands tag relations';
    elsif tg_table_name = 'crm_tags' and (
      exists (
        select 1
        from public.crm_lead_tags relation
        join public.crm_leads lead on lead.id = relation.lead_id
        where relation.tag_id = new.id
          and lead.organization_id <> new.organization_id
      )
      or exists (
        select 1
        from public.crm_contact_tags relation
        join public.crm_contacts contact on contact.id = relation.contact_id
        where relation.tag_id = new.id
          and contact.organization_id <> new.organization_id
      )
      or exists (
        select 1
        from public.crm_task_tags relation
        join public.crm_tasks task on task.id = relation.task_id
        where relation.tag_id = new.id
          and task.organization_id <> new.organization_id
      )
    ) then
      raise exception 'CRM boundary violation: tag move strands relations';
    end if;
  end if;

  if tg_table_name = 'crm_companies' then
    sensitive_text := concat_ws(E'\n', new.name, new.industry, new.notes);
  elsif tg_table_name = 'crm_contacts' then
    sensitive_text := concat_ws(E'\n', new.name, new.email, new.phone,
      new.job_title, new.notes);
    if new.company_id is not null then
      select company.organization_id, company.access_scope
      into parent_organization_id, parent_access_scope
      from public.crm_companies company
      where company.id = new.company_id;
      if not found or parent_organization_id <> new.organization_id then
        raise exception 'CRM boundary violation: contact/company organization mismatch';
      end if;
      if parent_access_scope = 'cofounders' then
        new.access_scope := 'cofounders';
      end if;
    end if;
  elsif tg_table_name = 'crm_leads' then
    sensitive_text := concat_ws(E'\n', new.topic, new.source, new.notes,
      new.next_action, new.contact_job_title);
    if new.company_id is not null then
      select company.organization_id, company.access_scope
      into parent_organization_id, parent_access_scope
      from public.crm_companies company
      where company.id = new.company_id;
      if not found or parent_organization_id <> new.organization_id then
        raise exception 'CRM boundary violation: lead/company organization mismatch';
      end if;
      if parent_access_scope = 'cofounders' then
        new.access_scope := 'cofounders';
      end if;
    end if;
    if new.contact_id is not null then
      select contact.organization_id, contact.access_scope
      into parent_organization_id, parent_access_scope
      from public.crm_contacts contact
      where contact.id = new.contact_id;
      if not found or parent_organization_id <> new.organization_id then
        raise exception 'CRM boundary violation: lead/contact organization mismatch';
      end if;
      if parent_access_scope = 'cofounders' then
        new.access_scope := 'cofounders';
      end if;
    end if;
  elsif tg_table_name = 'crm_categories' then
    sensitive_text := concat_ws(E'\n', new.name, new.status_key);
  elsif tg_table_name = 'crm_tags' then
    sensitive_text := new.name;
  elsif tg_table_name = 'crm_tasks' then
    sensitive_text := concat_ws(E'\n', new.title, new.description);
    if new.lead_id is not null then
      select lead.organization_id, lead.access_scope
      into parent_organization_id, parent_access_scope
      from public.crm_leads lead
      where lead.id = new.lead_id;
      if not found or parent_organization_id <> new.organization_id then
        raise exception 'CRM boundary violation: task/lead organization mismatch';
      end if;
      if parent_access_scope = 'cofounders' then
        new.access_scope := 'cofounders';
      end if;
    end if;
  else
    raise exception 'Unsupported CRM root boundary table: %', tg_table_name;
  end if;

  if private.crm_text_requires_cofounder(sensitive_text) then
    new.access_scope := 'cofounders';
  end if;

  -- Escalating a parent also escalates every existing descendant in the same
  -- organization. These writes are part of the caller's transaction, so an
  -- outer RLS rejection rolls the entire propagation back atomically.
  if tg_op = 'UPDATE'
    and old.access_scope <> 'cofounders'
    and new.access_scope = 'cofounders' then
    if tg_table_name = 'crm_companies' then
      update public.crm_contacts
      set access_scope = 'cofounders'
      where company_id = new.id
        and organization_id = new.organization_id
        and access_scope <> 'cofounders';
      update public.crm_leads
      set access_scope = 'cofounders'
      where company_id = new.id
        and organization_id = new.organization_id
        and access_scope <> 'cofounders';
    elsif tg_table_name = 'crm_contacts' then
      update public.crm_leads
      set access_scope = 'cofounders'
      where contact_id = new.id
        and organization_id = new.organization_id
        and access_scope <> 'cofounders';
    elsif tg_table_name = 'crm_leads' then
      update public.crm_tasks
      set access_scope = 'cofounders'
      where lead_id = new.id
        and organization_id = new.organization_id
        and access_scope <> 'cofounders';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.enforce_crm_root_boundary()
from public, anon, authenticated, service_role;

do $triggers$
declare
  table_name text;
begin
  foreach table_name in array array[
    'crm_companies', 'crm_contacts', 'crm_leads',
    'crm_categories', 'crm_tags', 'crm_tasks'
  ]
  loop
    execute format(
      'drop trigger if exists enforce_crm_root_boundary_trigger on public.%I',
      table_name
    );
    execute format(
      'create trigger enforce_crm_root_boundary_trigger before insert or update on public.%I for each row execute function private.enforce_crm_root_boundary()',
      table_name
    );
  end loop;
end
$triggers$;

-- This migration must be safe as a release boundary on its own. Derive lead
-- scope from the active category/status and tags now, rather than relying on a
-- later additive migration to close an observable intermediate state.
create or replace function private.derive_crm_lead_access_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.crm_categories category
    where category.organization_id = new.organization_id
      and category.status_key = new.status
      and category.archived_at is null
      and category.access_scope = 'cofounders'
  ) or (
    tg_op = 'UPDATE'
    and exists (
      select 1
      from public.crm_lead_tags relation
      join public.crm_tags tag on tag.id = relation.tag_id
      where relation.lead_id = new.id
        and relation.archived_at is null
        and tag.organization_id = new.organization_id
        and tag.archived_at is null
        and tag.access_scope = 'cofounders'
    )
  ) then
    new.access_scope := 'cofounders';
  end if;

  return new;
end;
$$;

revoke execute on function private.derive_crm_lead_access_scope()
from public, anon, authenticated, service_role;

drop trigger if exists derive_crm_lead_access_scope_trigger
on public.crm_leads;
create trigger derive_crm_lead_access_scope_trigger
before insert or update on public.crm_leads
for each row execute function private.derive_crm_lead_access_scope();

-- Classifier edits are durable: a category/status or tag that becomes
-- confidential immediately escalates every active target in the same tenant.
create or replace function private.propagate_crm_classifier_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.access_scope <> 'cofounders' then
    return new;
  end if;

  if tg_table_name = 'crm_categories' then
    if new.archived_at is null then
      update public.crm_leads
      set access_scope = 'cofounders'
      where organization_id = new.organization_id
        and status = new.status_key
        and archived_at is null
        and access_scope <> 'cofounders';
    end if;
  elsif tg_table_name = 'crm_tags' then
    if new.archived_at is null then
      update public.crm_leads lead
      set access_scope = 'cofounders'
      from public.crm_lead_tags relation
      where relation.tag_id = new.id
        and relation.lead_id = lead.id
        and relation.archived_at is null
        and lead.organization_id = new.organization_id
        and lead.archived_at is null
        and lead.access_scope <> 'cofounders';

      update public.crm_contacts contact
      set access_scope = 'cofounders'
      from public.crm_contact_tags relation
      where relation.tag_id = new.id
        and relation.contact_id = contact.id
        and relation.archived_at is null
        and contact.organization_id = new.organization_id
        and contact.archived_at is null
        and contact.access_scope <> 'cofounders';

      update public.crm_tasks task
      set access_scope = 'cofounders'
      from public.crm_task_tags relation
      where relation.tag_id = new.id
        and relation.task_id = task.id
        and relation.archived_at is null
        and task.organization_id = new.organization_id
        and task.archived_at is null
        and task.access_scope <> 'cofounders';
    end if;
  else
    raise exception 'Unsupported CRM classifier table: %', tg_table_name;
  end if;

  return new;
end;
$$;

revoke execute on function private.propagate_crm_classifier_scope()
from public, anon, authenticated, service_role;

drop trigger if exists propagate_crm_classifier_scope_trigger
on public.crm_categories;
create trigger propagate_crm_classifier_scope_trigger
after insert or update on public.crm_categories
for each row execute function private.propagate_crm_classifier_scope();

drop trigger if exists propagate_crm_classifier_scope_trigger
on public.crm_tags;
create trigger propagate_crm_classifier_scope_trigger
after insert or update on public.crm_tags
for each row execute function private.propagate_crm_classifier_scope();

-- Service-role writes bypass RLS, so relation triggers enforce active rows and
-- tenant equality before a confidential tag can propagate.
create or replace function private.enforce_crm_tag_relation_boundary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_organization_id uuid;
  tag_organization_id uuid;
begin
  if new.archived_at is not null then
    return new;
  end if;

  select tag.organization_id
  into tag_organization_id
  from public.crm_tags tag
  where tag.id = new.tag_id
    and tag.archived_at is null;
  if not found then
    raise exception 'CRM tag relation references a missing or archived tag'
      using errcode = '23514';
  end if;

  if tg_table_name = 'crm_lead_tags' then
    select lead.organization_id into parent_organization_id
    from public.crm_leads lead
    where lead.id = new.lead_id and lead.archived_at is null;
  elsif tg_table_name = 'crm_contact_tags' then
    select contact.organization_id into parent_organization_id
    from public.crm_contacts contact
    where contact.id = new.contact_id and contact.archived_at is null;
  elsif tg_table_name = 'crm_task_tags' then
    select task.organization_id into parent_organization_id
    from public.crm_tasks task
    where task.id = new.task_id and task.archived_at is null;
  else
    raise exception 'Unsupported CRM tag relation table: %', tg_table_name;
  end if;

  if not found then
    raise exception 'CRM tag relation references a missing or archived target'
      using errcode = '23514';
  end if;
  if parent_organization_id <> tag_organization_id then
    raise exception 'CRM tag relation crosses organizations'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke execute on function private.enforce_crm_tag_relation_boundary()
from public, anon, authenticated, service_role;

do $relation_boundary_triggers$
declare
  relation_table text;
begin
  foreach relation_table in array array[
    'crm_lead_tags', 'crm_contact_tags', 'crm_task_tags'
  ]
  loop
    execute format(
      'drop trigger if exists enforce_crm_tag_relation_boundary_trigger on public.%I',
      relation_table
    );
    execute format(
      'create trigger enforce_crm_tag_relation_boundary_trigger before insert or update on public.%I for each row execute function private.enforce_crm_tag_relation_boundary()',
      relation_table
    );
  end loop;
end
$relation_boundary_triggers$;

create or replace function private.propagate_crm_tag_relation_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  tag_scope text;
begin
  if new.archived_at is not null then
    return new;
  end if;

  select tag.access_scope into tag_scope
  from public.crm_tags tag
  where tag.id = new.tag_id and tag.archived_at is null;

  if tag_scope <> 'cofounders' then
    return new;
  end if;

  if tg_table_name = 'crm_lead_tags' then
    update public.crm_leads
    set access_scope = 'cofounders'
    where id = new.lead_id
      and archived_at is null
      and access_scope <> 'cofounders';
  elsif tg_table_name = 'crm_contact_tags' then
    update public.crm_contacts
    set access_scope = 'cofounders'
    where id = new.contact_id
      and archived_at is null
      and access_scope <> 'cofounders';
  elsif tg_table_name = 'crm_task_tags' then
    update public.crm_tasks
    set access_scope = 'cofounders'
    where id = new.task_id
      and archived_at is null
      and access_scope <> 'cofounders';
  else
    raise exception 'Unsupported CRM tag relation table: %', tg_table_name;
  end if;

  return new;
end;
$$;

revoke execute on function private.propagate_crm_tag_relation_scope()
from public, anon, authenticated, service_role;

do $relation_scope_triggers$
declare
  relation_table text;
begin
  foreach relation_table in array array[
    'crm_lead_tags', 'crm_contact_tags', 'crm_task_tags'
  ]
  loop
    execute format(
      'drop trigger if exists propagate_crm_tag_relation_scope_trigger on public.%I',
      relation_table
    );
    execute format(
      'create trigger propagate_crm_tag_relation_scope_trigger after insert or update of tag_id, archived_at on public.%I for each row execute function private.propagate_crm_tag_relation_scope()',
      relation_table
    );
  end loop;
end
$relation_scope_triggers$;

-- Categories and tags are classified after the first lead backfill above.
-- Close that ordering gap before this migration is allowed to commit.
update public.crm_leads lead
set access_scope = 'cofounders'
where lead.archived_at is null
  and lead.access_scope <> 'cofounders'
  and (
    exists (
      select 1
      from public.crm_categories category
      where category.organization_id = lead.organization_id
        and category.status_key = lead.status
        and category.archived_at is null
        and category.access_scope = 'cofounders'
    )
    or exists (
      select 1
      from public.crm_lead_tags relation
      join public.crm_tags tag on tag.id = relation.tag_id
      where relation.lead_id = lead.id
        and relation.archived_at is null
        and tag.organization_id = lead.organization_id
        and tag.archived_at is null
      and tag.access_scope = 'cofounders'
    )
  );

update public.crm_contacts contact
set access_scope = 'cofounders'
where contact.archived_at is null
  and contact.access_scope <> 'cofounders'
  and exists (
    select 1
    from public.crm_contact_tags relation
    join public.crm_tags tag on tag.id = relation.tag_id
    where relation.contact_id = contact.id
      and relation.archived_at is null
      and tag.organization_id = contact.organization_id
      and tag.archived_at is null
      and tag.access_scope = 'cofounders'
  );

update public.crm_tasks task
set access_scope = 'cofounders'
where task.archived_at is null
  and task.access_scope <> 'cofounders'
  and exists (
    select 1
    from public.crm_task_tags relation
    join public.crm_tags tag on tag.id = relation.tag_id
    where relation.task_id = task.id
      and relation.archived_at is null
      and tag.organization_id = task.organization_id
      and tag.archived_at is null
      and tag.access_scope = 'cofounders'
  );

do $classifier_preflight$
begin
  if exists (
    select 1
    from public.crm_leads lead
    where lead.archived_at is null
      and lead.access_scope <> 'cofounders'
      and (
        exists (
          select 1
          from public.crm_categories category
          where category.organization_id = lead.organization_id
            and category.status_key = lead.status
            and category.archived_at is null
            and category.access_scope = 'cofounders'
        )
        or exists (
          select 1
          from public.crm_lead_tags relation
          join public.crm_tags tag on tag.id = relation.tag_id
          where relation.lead_id = lead.id
            and relation.archived_at is null
            and tag.organization_id = lead.organization_id
            and tag.archived_at is null
            and tag.access_scope = 'cofounders'
        )
      )
  ) then
    raise exception 'CRM confidentiality preflight: a classifier-derived lead remains organization-visible';
  end if;
  if exists (
    select 1
    from public.crm_contacts contact
    where contact.archived_at is null
      and contact.access_scope <> 'cofounders'
      and exists (
        select 1
        from public.crm_contact_tags relation
        join public.crm_tags tag on tag.id = relation.tag_id
        where relation.contact_id = contact.id
          and relation.archived_at is null
          and tag.organization_id = contact.organization_id
          and tag.archived_at is null
          and tag.access_scope = 'cofounders'
      )
  ) or exists (
    select 1
    from public.crm_tasks task
    where task.archived_at is null
      and task.access_scope <> 'cofounders'
      and exists (
        select 1
        from public.crm_task_tags relation
        join public.crm_tags tag on tag.id = relation.tag_id
        where relation.task_id = task.id
          and relation.archived_at is null
          and tag.organization_id = task.organization_id
          and tag.archived_at is null
          and tag.access_scope = 'cofounders'
      )
  ) then
    raise exception 'CRM confidentiality preflight: a tag-derived contact/task remains organization-visible';
  end if;
end
$classifier_preflight$;

create index if not exists crm_companies_scope_active_idx
  on public.crm_companies (organization_id, access_scope) where archived_at is null;
create index if not exists crm_contacts_scope_active_idx
  on public.crm_contacts (organization_id, access_scope) where archived_at is null;
create index if not exists crm_leads_scope_created_active_idx
  on public.crm_leads (organization_id, access_scope, created_at desc) where archived_at is null;
create index if not exists crm_categories_scope_position_active_idx
  on public.crm_categories (organization_id, access_scope, position) where archived_at is null;
create index if not exists crm_tags_scope_name_active_idx
  on public.crm_tags (organization_id, access_scope, name) where archived_at is null;
create index if not exists crm_tasks_scope_due_active_idx
  on public.crm_tasks (organization_id, access_scope, due_date) where archived_at is null;
create index if not exists crm_tasks_lead_id_idx
  on public.crm_tasks (lead_id) where lead_id is not null;
create index if not exists crm_lead_tags_active_idx
  on public.crm_lead_tags (lead_id, tag_id) where archived_at is null;
create index if not exists crm_contact_tags_active_idx
  on public.crm_contact_tags (contact_id, tag_id) where archived_at is null;
create index if not exists crm_task_tags_active_idx
  on public.crm_task_tags (task_id, tag_id) where archived_at is null;

-- Remove every legacy root policy, including the viewer-write policies.
drop policy if exists "members can read crm companies" on public.crm_companies;
drop policy if exists "members can create crm companies" on public.crm_companies;
drop policy if exists "members can update crm companies" on public.crm_companies;
drop policy if exists "contributors can create crm companies" on public.crm_companies;
drop policy if exists "contributors can update crm companies" on public.crm_companies;
drop policy if exists "admins can delete crm companies" on public.crm_companies;

drop policy if exists "members can read crm contacts" on public.crm_contacts;
drop policy if exists "members can create crm contacts" on public.crm_contacts;
drop policy if exists "members can update crm contacts" on public.crm_contacts;
drop policy if exists "contributors can create crm contacts" on public.crm_contacts;
drop policy if exists "contributors can update crm contacts" on public.crm_contacts;
drop policy if exists "admins can delete crm contacts" on public.crm_contacts;

drop policy if exists "members can read crm leads" on public.crm_leads;
drop policy if exists "members can create crm leads" on public.crm_leads;
drop policy if exists "members can update crm leads" on public.crm_leads;
drop policy if exists "contributors can create crm leads" on public.crm_leads;
drop policy if exists "contributors can update crm leads" on public.crm_leads;
drop policy if exists "admins can delete crm leads" on public.crm_leads;

drop policy if exists "members can read crm categories" on public.crm_categories;
drop policy if exists "members can insert crm categories" on public.crm_categories;
drop policy if exists "members can update crm categories" on public.crm_categories;
drop policy if exists "members can delete crm categories" on public.crm_categories;
drop policy if exists "members can do all on crm_tags" on public.crm_tags;
drop policy if exists "members can do all on crm_tasks" on public.crm_tasks;

do $policy$
declare
  table_name text;
begin
  foreach table_name in array array[
    'crm_companies',
    'crm_contacts',
    'crm_leads',
    'crm_categories',
    'crm_tags'
  ]
  loop
    execute format('drop policy if exists "crm scoped select" on public.%I', table_name);
    execute format('drop policy if exists "crm scoped insert" on public.%I', table_name);
    execute format('drop policy if exists "crm scoped update" on public.%I', table_name);
    execute format('drop policy if exists "crm scoped delete" on public.%I', table_name);
    execute format(
      'create policy "crm scoped select" on public.%I for select to authenticated using (archived_at is null and private.can_read_crm_record(organization_id, access_scope))',
      table_name
    );
    execute format(
      'create policy "crm scoped insert" on public.%I for insert to authenticated with check (archived_at is null and private.can_write_crm_record(organization_id, access_scope))',
      table_name
    );
    execute format(
      'create policy "crm scoped update" on public.%I for update to authenticated using (archived_at is null and private.can_write_crm_record(organization_id, access_scope)) with check (archived_at is null and private.can_write_crm_record(organization_id, access_scope))',
      table_name
    );
    execute format(
      'create policy "crm scoped delete" on public.%I for delete to authenticated using (archived_at is null and private.can_delete_crm_record(organization_id, access_scope))',
      table_name
    );
  end loop;
end
$policy$;

-- Tasks inherit confidentiality from a linked lead in addition to their own
-- access_scope.
drop policy if exists "crm scoped select" on public.crm_tasks;
drop policy if exists "crm scoped insert" on public.crm_tasks;
drop policy if exists "crm scoped update" on public.crm_tasks;
drop policy if exists "crm scoped delete" on public.crm_tasks;
create policy "crm scoped select" on public.crm_tasks for select to authenticated
using (
  archived_at is null
  and private.can_read_crm_record(organization_id, access_scope)
  and (
    lead_id is null
    or exists (
      select 1 from public.crm_leads lead
      where lead.id = crm_tasks.lead_id
        and lead.organization_id = crm_tasks.organization_id
        and lead.archived_at is null
        and private.can_read_crm_record(lead.organization_id, lead.access_scope)
    )
  )
);
create policy "crm scoped insert" on public.crm_tasks for insert to authenticated
with check (
  archived_at is null
  and private.can_write_crm_record(organization_id, access_scope)
  and (
    lead_id is null
    or exists (
      select 1 from public.crm_leads lead
      where lead.id = crm_tasks.lead_id
        and lead.organization_id = crm_tasks.organization_id
        and lead.archived_at is null
        and private.can_write_crm_record(lead.organization_id, lead.access_scope)
    )
  )
);
create policy "crm scoped update" on public.crm_tasks for update to authenticated
using (archived_at is null and private.can_write_crm_record(organization_id, access_scope))
with check (
  archived_at is null
  and private.can_write_crm_record(organization_id, access_scope)
  and (
    lead_id is null
    or exists (
      select 1 from public.crm_leads lead
      where lead.id = crm_tasks.lead_id
        and lead.organization_id = crm_tasks.organization_id
        and lead.archived_at is null
        and private.can_write_crm_record(lead.organization_id, lead.access_scope)
    )
  )
);
create policy "crm scoped delete" on public.crm_tasks for delete to authenticated
using (
  archived_at is null
  and private.can_delete_crm_record(organization_id, access_scope)
  and (
    lead_id is null
    or exists (
      select 1 from public.crm_leads lead
      where lead.id = crm_tasks.lead_id
        and lead.organization_id = crm_tasks.organization_id
        and lead.archived_at is null
        and private.can_delete_crm_record(lead.organization_id, lead.access_scope)
    )
  )
);

-- Child records inherit their parent scope. Junction policies also check the
-- tag, preventing a confidential tag name from leaking through an accessible
-- lead/contact/task.
drop policy if exists "members can do all on crm_lead_tags" on public.crm_lead_tags;
drop policy if exists "crm inherited select" on public.crm_lead_tags;
drop policy if exists "crm inherited insert" on public.crm_lead_tags;
drop policy if exists "crm inherited update" on public.crm_lead_tags;
drop policy if exists "crm inherited delete" on public.crm_lead_tags;
create policy "crm inherited select" on public.crm_lead_tags for select to authenticated
using (
  archived_at is null
  and exists (
    select 1
    from public.crm_leads lead
    join public.crm_tags tag on tag.id = crm_lead_tags.tag_id
    where lead.id = crm_lead_tags.lead_id
      and lead.archived_at is null
      and tag.archived_at is null
      and lead.organization_id = tag.organization_id
      and private.can_read_crm_record(lead.organization_id, lead.access_scope)
      and private.can_read_crm_record(tag.organization_id, tag.access_scope)
  )
);
create policy "crm inherited insert" on public.crm_lead_tags for insert to authenticated
with check (
  archived_at is null
  and exists (
    select 1
    from public.crm_leads lead
    join public.crm_tags tag on tag.id = crm_lead_tags.tag_id
    where lead.id = crm_lead_tags.lead_id
      and lead.archived_at is null
      and tag.archived_at is null
      and lead.organization_id = tag.organization_id
      and private.can_write_crm_record(lead.organization_id, lead.access_scope)
      and private.can_read_crm_record(tag.organization_id, tag.access_scope)
  )
);
create policy "crm inherited update" on public.crm_lead_tags for update to authenticated
using (archived_at is null and exists (
  select 1
  from public.crm_leads lead
  join public.crm_tags tag on tag.id = crm_lead_tags.tag_id
  where lead.id = crm_lead_tags.lead_id
    and lead.archived_at is null
    and tag.archived_at is null
    and lead.organization_id = tag.organization_id
    and private.can_write_crm_record(lead.organization_id, lead.access_scope)
    and private.can_read_crm_record(tag.organization_id, tag.access_scope)
))
with check (archived_at is null and exists (
  select 1
  from public.crm_leads lead
  join public.crm_tags tag on tag.id = crm_lead_tags.tag_id
  where lead.id = crm_lead_tags.lead_id
    and lead.archived_at is null
    and tag.archived_at is null
    and lead.organization_id = tag.organization_id
    and private.can_write_crm_record(lead.organization_id, lead.access_scope)
    and private.can_read_crm_record(tag.organization_id, tag.access_scope)
));
create policy "crm inherited delete" on public.crm_lead_tags for delete to authenticated
using (exists (
  select 1
  from public.crm_leads lead
  join public.crm_tags tag on tag.id = crm_lead_tags.tag_id
  where lead.id = crm_lead_tags.lead_id
    and lead.archived_at is null
    and tag.archived_at is null
    and lead.organization_id = tag.organization_id
    and private.can_write_crm_record(lead.organization_id, lead.access_scope)
    and private.can_read_crm_record(tag.organization_id, tag.access_scope)
));

drop policy if exists "members can do all on crm_contact_tags" on public.crm_contact_tags;
drop policy if exists "crm inherited select" on public.crm_contact_tags;
drop policy if exists "crm inherited insert" on public.crm_contact_tags;
drop policy if exists "crm inherited update" on public.crm_contact_tags;
drop policy if exists "crm inherited delete" on public.crm_contact_tags;
create policy "crm inherited select" on public.crm_contact_tags for select to authenticated
using (
  archived_at is null
  and exists (
    select 1
    from public.crm_contacts contact
    join public.crm_tags tag on tag.id = crm_contact_tags.tag_id
    where contact.id = crm_contact_tags.contact_id
      and contact.archived_at is null
      and tag.archived_at is null
      and contact.organization_id = tag.organization_id
      and private.can_read_crm_record(contact.organization_id, contact.access_scope)
      and private.can_read_crm_record(tag.organization_id, tag.access_scope)
  )
);
create policy "crm inherited insert" on public.crm_contact_tags for insert to authenticated
with check (
  archived_at is null
  and exists (
    select 1
    from public.crm_contacts contact
    join public.crm_tags tag on tag.id = crm_contact_tags.tag_id
    where contact.id = crm_contact_tags.contact_id
      and contact.archived_at is null
      and tag.archived_at is null
      and contact.organization_id = tag.organization_id
      and private.can_write_crm_record(contact.organization_id, contact.access_scope)
      and private.can_read_crm_record(tag.organization_id, tag.access_scope)
  )
);
create policy "crm inherited update" on public.crm_contact_tags for update to authenticated
using (archived_at is null and exists (
  select 1
  from public.crm_contacts contact
  join public.crm_tags tag on tag.id = crm_contact_tags.tag_id
  where contact.id = crm_contact_tags.contact_id
    and contact.archived_at is null
    and tag.archived_at is null
    and contact.organization_id = tag.organization_id
    and private.can_write_crm_record(contact.organization_id, contact.access_scope)
    and private.can_read_crm_record(tag.organization_id, tag.access_scope)
))
with check (archived_at is null and exists (
  select 1
  from public.crm_contacts contact
  join public.crm_tags tag on tag.id = crm_contact_tags.tag_id
  where contact.id = crm_contact_tags.contact_id
    and contact.archived_at is null
    and tag.archived_at is null
    and contact.organization_id = tag.organization_id
    and private.can_write_crm_record(contact.organization_id, contact.access_scope)
    and private.can_read_crm_record(tag.organization_id, tag.access_scope)
));
create policy "crm inherited delete" on public.crm_contact_tags for delete to authenticated
using (exists (
  select 1
  from public.crm_contacts contact
  join public.crm_tags tag on tag.id = crm_contact_tags.tag_id
  where contact.id = crm_contact_tags.contact_id
    and contact.archived_at is null
    and tag.archived_at is null
    and contact.organization_id = tag.organization_id
    and private.can_write_crm_record(contact.organization_id, contact.access_scope)
    and private.can_read_crm_record(tag.organization_id, tag.access_scope)
));

drop policy if exists "members can do all on crm_task_tags" on public.crm_task_tags;
drop policy if exists "crm inherited select" on public.crm_task_tags;
drop policy if exists "crm inherited insert" on public.crm_task_tags;
drop policy if exists "crm inherited update" on public.crm_task_tags;
drop policy if exists "crm inherited delete" on public.crm_task_tags;
create policy "crm inherited select" on public.crm_task_tags for select to authenticated
using (
  archived_at is null
  and exists (
    select 1
    from public.crm_tasks task
    join public.crm_tags tag on tag.id = crm_task_tags.tag_id
    where task.id = crm_task_tags.task_id
      and task.archived_at is null
      and tag.archived_at is null
      and task.organization_id = tag.organization_id
      and private.can_read_crm_record(task.organization_id, task.access_scope)
      and private.can_read_crm_record(tag.organization_id, tag.access_scope)
  )
);
create policy "crm inherited insert" on public.crm_task_tags for insert to authenticated
with check (
  archived_at is null
  and exists (
    select 1
    from public.crm_tasks task
    join public.crm_tags tag on tag.id = crm_task_tags.tag_id
    where task.id = crm_task_tags.task_id
      and task.archived_at is null
      and tag.archived_at is null
      and task.organization_id = tag.organization_id
      and private.can_write_crm_record(task.organization_id, task.access_scope)
      and private.can_read_crm_record(tag.organization_id, tag.access_scope)
  )
);
create policy "crm inherited update" on public.crm_task_tags for update to authenticated
using (archived_at is null and exists (
  select 1
  from public.crm_tasks task
  join public.crm_tags tag on tag.id = crm_task_tags.tag_id
  where task.id = crm_task_tags.task_id
    and task.archived_at is null
    and tag.archived_at is null
    and task.organization_id = tag.organization_id
    and private.can_write_crm_record(task.organization_id, task.access_scope)
    and private.can_read_crm_record(tag.organization_id, tag.access_scope)
))
with check (archived_at is null and exists (
  select 1
  from public.crm_tasks task
  join public.crm_tags tag on tag.id = crm_task_tags.tag_id
  where task.id = crm_task_tags.task_id
    and task.archived_at is null
    and tag.archived_at is null
    and task.organization_id = tag.organization_id
    and private.can_write_crm_record(task.organization_id, task.access_scope)
    and private.can_read_crm_record(tag.organization_id, tag.access_scope)
));
create policy "crm inherited delete" on public.crm_task_tags for delete to authenticated
using (exists (
  select 1
  from public.crm_tasks task
  join public.crm_tags tag on tag.id = crm_task_tags.tag_id
  where task.id = crm_task_tags.task_id
    and task.archived_at is null
    and tag.archived_at is null
    and task.organization_id = tag.organization_id
    and private.can_write_crm_record(task.organization_id, task.access_scope)
    and private.can_read_crm_record(tag.organization_id, tag.access_scope)
));

drop policy if exists "members can do all on crm_lead_notes" on public.crm_lead_notes;
drop policy if exists "crm inherited select" on public.crm_lead_notes;
drop policy if exists "crm inherited insert" on public.crm_lead_notes;
drop policy if exists "crm inherited update" on public.crm_lead_notes;
drop policy if exists "crm inherited delete" on public.crm_lead_notes;
create policy "crm inherited select" on public.crm_lead_notes for select to authenticated
using (exists (
  select 1 from public.crm_leads lead
  where lead.id = crm_lead_notes.lead_id
    and lead.organization_id = crm_lead_notes.organization_id
    and lead.archived_at is null
    and private.can_read_crm_record(lead.organization_id, lead.access_scope)
));
create policy "crm inherited insert" on public.crm_lead_notes for insert to authenticated
with check (exists (
  select 1 from public.crm_leads lead
  where lead.id = crm_lead_notes.lead_id
    and lead.organization_id = crm_lead_notes.organization_id
    and private.can_write_crm_record(lead.organization_id, lead.access_scope)
));
create policy "crm inherited update" on public.crm_lead_notes for update to authenticated
using (exists (
  select 1 from public.crm_leads lead where lead.id = crm_lead_notes.lead_id
    and private.can_write_crm_record(lead.organization_id, lead.access_scope)
))
with check (exists (
  select 1 from public.crm_leads lead where lead.id = crm_lead_notes.lead_id
    and lead.organization_id = crm_lead_notes.organization_id
    and private.can_write_crm_record(lead.organization_id, lead.access_scope)
));
create policy "crm inherited delete" on public.crm_lead_notes for delete to authenticated
using (exists (
  select 1 from public.crm_leads lead where lead.id = crm_lead_notes.lead_id
    and private.can_write_crm_record(lead.organization_id, lead.access_scope)
));

drop policy if exists "members can do all on crm_lead_follow_ups" on public.crm_lead_follow_ups;
drop policy if exists "crm inherited select" on public.crm_lead_follow_ups;
drop policy if exists "crm inherited insert" on public.crm_lead_follow_ups;
drop policy if exists "crm inherited update" on public.crm_lead_follow_ups;
drop policy if exists "crm inherited delete" on public.crm_lead_follow_ups;
create policy "crm inherited select" on public.crm_lead_follow_ups for select to authenticated
using (exists (
  select 1 from public.crm_leads lead
  where lead.id = crm_lead_follow_ups.lead_id
    and lead.organization_id = crm_lead_follow_ups.organization_id
    and lead.archived_at is null
    and private.can_read_crm_record(lead.organization_id, lead.access_scope)
));
create policy "crm inherited insert" on public.crm_lead_follow_ups for insert to authenticated
with check (exists (
  select 1 from public.crm_leads lead
  where lead.id = crm_lead_follow_ups.lead_id
    and lead.organization_id = crm_lead_follow_ups.organization_id
    and private.can_write_crm_record(lead.organization_id, lead.access_scope)
));
create policy "crm inherited update" on public.crm_lead_follow_ups for update to authenticated
using (exists (
  select 1 from public.crm_leads lead where lead.id = crm_lead_follow_ups.lead_id
    and private.can_write_crm_record(lead.organization_id, lead.access_scope)
))
with check (exists (
  select 1 from public.crm_leads lead where lead.id = crm_lead_follow_ups.lead_id
    and lead.organization_id = crm_lead_follow_ups.organization_id
    and private.can_write_crm_record(lead.organization_id, lead.access_scope)
));
create policy "crm inherited delete" on public.crm_lead_follow_ups for delete to authenticated
using (exists (
  select 1 from public.crm_leads lead where lead.id = crm_lead_follow_ups.lead_id
    and private.can_write_crm_record(lead.organization_id, lead.access_scope)
));

-- One-shot Trello import ledger. Only normalized, bounded fields belong in
-- staging; raw exports, member payloads and credentials never do.
create or replace function private.crm_jsonb_has_forbidden_key(document jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case jsonb_typeof(document)
    when 'object' then exists (
      select 1
      from jsonb_each(document) field
      where (
        regexp_replace(lower(field.key), '[^a-z0-9]', '', 'g')
          in ('auth', 'code', 'key', 'sig', 'ticket', 'raw', 'members', 'actions')
        or regexp_replace(lower(field.key), '[^a-z0-9]', '', 'g') ~
          '(token|apikey|secret|password|authorization|cookie|signature|credential|accesskey|accessid|keypairid|session|jwt|bearer|oauth|privatekey|presigned|policy)'
        or private.crm_jsonb_has_forbidden_key(field.value)
      )
    )
    when 'array' then exists (
      select 1
      from jsonb_array_elements(document) element
      where private.crm_jsonb_has_forbidden_key(element)
    )
    else false
  end;
$$;

revoke execute on function private.crm_jsonb_has_forbidden_key(jsonb)
from public, anon, authenticated;

create table if not exists public.crm_import_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  provider text not null default 'trello' check (provider = 'trello'),
  source_external_id text not null,
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'staged'
    check (status in ('staged', 'applied', 'rolled-back', 'failed')),
  dry_run boolean not null default true,
  summary jsonb not null default '{}'::jsonb,
  expected_item_count integer not null
    check (expected_item_count between 0 and 125000),
  staging_hash text not null check (staging_hash ~ '^[a-f0-9]{64}$'),
  created_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  rolled_back_at timestamptz,
  constraint crm_import_runs_id_organization_unique unique (id, organization_id)
);

create table if not exists public.crm_import_staging (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  run_id uuid not null,
  entity_type text not null check (entity_type in ('category', 'tag', 'lead')),
  external_id text not null,
  parent_external_id text,
  access_scope text not null default 'cofounders'
    check (access_scope in ('organization', 'cofounders')),
  normalized_payload jsonb not null check (jsonb_typeof(normalized_payload) = 'object'),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  privacy_reasons jsonb not null default '[]'::jsonb
    check (jsonb_typeof(privacy_reasons) = 'array'),
  validation_errors jsonb not null default '[]'::jsonb
    check (jsonb_typeof(validation_errors) = 'array'),
  created_at timestamptz not null default now(),
  unique (run_id, entity_type, external_id),
  constraint crm_import_staging_run_organization_fk
    foreign key (run_id, organization_id)
    references public.crm_import_runs (id, organization_id) on delete restrict,
  check (not private.crm_jsonb_has_forbidden_key(normalized_payload))
);

alter table public.crm_import_staging
  add column if not exists privacy_reasons jsonb not null default '[]'::jsonb
    check (jsonb_typeof(privacy_reasons) = 'array');

create table if not exists public.crm_external_refs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  provider text not null default 'trello' check (provider = 'trello'),
  external_type text not null check (external_type in ('category', 'tag', 'lead')),
  external_id text not null,
  local_table text not null check (local_table in ('crm_categories', 'crm_tags', 'crm_leads')),
  local_id uuid not null,
  access_scope text not null check (access_scope in ('organization', 'cofounders')),
  source_hash text not null,
  first_run_id uuid not null,
  last_run_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, provider, external_type, external_id),
  constraint crm_external_refs_id_organization_unique unique (id, organization_id),
  constraint crm_external_refs_first_run_organization_fk
    foreign key (first_run_id, organization_id)
    references public.crm_import_runs (id, organization_id) on delete restrict,
  constraint crm_external_refs_last_run_organization_fk
    foreign key (last_run_id, organization_id)
    references public.crm_import_runs (id, organization_id) on delete restrict
);

create table if not exists public.crm_import_changes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  run_id uuid not null,
  external_ref_id uuid,
  local_table text not null,
  local_id uuid,
  operation text not null
    check (operation in ('created', 'linked', 'revived', 'linked-relation', 'unchanged', 'conflict', 'soft-archived')),
  before_snapshot jsonb,
  after_snapshot jsonb,
  created_at timestamptz not null default now(),
  constraint crm_import_changes_run_organization_fk
    foreign key (run_id, organization_id)
    references public.crm_import_runs (id, organization_id) on delete restrict,
  constraint crm_import_changes_ref_organization_fk
    foreign key (external_ref_id, organization_id)
    references public.crm_external_refs (id, organization_id) on delete restrict
);

create index if not exists crm_import_runs_org_created_idx
  on public.crm_import_runs (organization_id, created_at desc);
create unique index if not exists crm_import_runs_active_source_unique_idx
  on public.crm_import_runs (organization_id, provider, source_external_id, source_hash)
  where status in ('staged', 'applied');
create index if not exists crm_import_staging_run_entity_idx
  on public.crm_import_staging (organization_id, run_id, entity_type);
create index if not exists crm_external_refs_lookup_idx
  on public.crm_external_refs (organization_id, provider, external_type, external_id)
  where archived_at is null;
create index if not exists crm_import_changes_run_created_idx
  on public.crm_import_changes (run_id, created_at);

alter table public.crm_import_runs enable row level security;
alter table public.crm_import_staging enable row level security;
alter table public.crm_external_refs enable row level security;
alter table public.crm_import_changes enable row level security;

do $policy$
declare
  table_name text;
begin
  foreach table_name in array array[
    'crm_import_runs',
    'crm_import_staging',
    'crm_external_refs',
    'crm_import_changes'
  ]
  loop
    execute format('drop policy if exists "cofounders can read crm import ledger" on public.%I', table_name);
    execute format('drop policy if exists "cofounders can insert crm import ledger" on public.%I', table_name);
    execute format('drop policy if exists "cofounders can update crm import ledger" on public.%I', table_name);
    execute format(
      'create policy "cofounders can read crm import ledger" on public.%I for select to authenticated using (private.is_crm_cofounder(organization_id))',
      table_name
    );
  end loop;
end
$policy$;

revoke all on public.crm_import_runs, public.crm_import_staging,
  public.crm_external_refs, public.crm_import_changes from anon, authenticated;
grant select on public.crm_import_runs, public.crm_import_staging,
  public.crm_external_refs, public.crm_import_changes to authenticated;
grant select on public.crm_import_runs, public.crm_import_staging,
  public.crm_external_refs, public.crm_import_changes to service_role;

create or replace function private.crm_text_array_hash(input_value jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        '[' || coalesce(
          (
            select string_agg(
              to_jsonb(element.value)::text,
              ',' order by element.ordinality
            )
            from jsonb_array_elements_text(input_value)
              with ordinality as element(value, ordinality)
          ),
          ''
        ) || ']',
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

revoke execute on function private.crm_text_array_hash(jsonb)
from public, anon, authenticated;

create or replace function private.crm_staging_attestation(
  target_run_id uuid,
  target_organization_id uuid
)
returns table(item_count bigint, staging_hash text)
language sql
security definer
set search_path = ''
stable
as $$
  select
    count(*) as item_count,
    encode(
      extensions.digest(
        convert_to(
          coalesce(
            string_agg(
              stage.entity_type || chr(31) || stage.external_id || chr(31) ||
                stage.payload_hash || chr(31) ||
                private.crm_text_array_hash(stage.validation_errors),
              E'\n' order by stage.entity_type, stage.external_id
            ),
            ''
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ) as staging_hash
  from public.crm_import_staging stage
  where stage.run_id = target_run_id
    and stage.organization_id = target_organization_id;
$$;

revoke execute on function private.crm_staging_attestation(uuid, uuid)
from public, anon, authenticated;

-- Run creation and staging happen in one database transaction. Authenticated
-- clients have no direct INSERT/UPDATE privilege on the ledger, so a partial
-- or subsequently tampered staging set cannot be attested as complete.
create or replace function public.stage_crm_trello_import(
  requested_organization_id uuid,
  requested_source_external_id text,
  requested_source_hash text,
  requested_staging_hash text,
  requested_expected_item_count integer,
  requested_summary jsonb,
  requested_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  import_run public.crm_import_runs%rowtype;
  actual_item_count bigint;
  actual_staging_hash text;
begin
  if (select auth.uid()) is null
    or not private.is_crm_cofounder(requested_organization_id) then
    raise exception 'CRM import staging not authorized';
  end if;
  if requested_organization_id is null
    or requested_source_external_id is null
    or length(btrim(requested_source_external_id)) not between 1 and 256
    or requested_source_hash !~ '^[a-f0-9]{64}$'
    or requested_staging_hash !~ '^[a-f0-9]{64}$'
    or requested_expected_item_count not between 0 and 125000 then
    raise exception 'CRM import staging metadata is invalid';
  end if;
  if jsonb_typeof(requested_summary) <> 'object'
    or octet_length(requested_summary::text) > 200000
    or jsonb_typeof(requested_rows) <> 'array'
    or octet_length(requested_rows::text) > 50000000
    or jsonb_array_length(requested_rows) <> requested_expected_item_count then
    raise exception 'CRM import staging count or summary is invalid';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(requested_rows) row_value
    where jsonb_typeof(row_value) <> 'object'
      or jsonb_typeof(row_value -> 'entity_type') <> 'string'
      or row_value ->> 'entity_type' not in ('category', 'tag', 'lead')
      or jsonb_typeof(row_value -> 'external_id') <> 'string'
      or length(row_value ->> 'external_id') not between 1 and 256
      or (
        row_value ? 'parent_external_id'
        and row_value -> 'parent_external_id' <> 'null'::jsonb
        and (
          jsonb_typeof(row_value -> 'parent_external_id') <> 'string'
          or length(row_value ->> 'parent_external_id') not between 1 and 256
        )
      )
      or jsonb_typeof(row_value -> 'access_scope') <> 'string'
      or row_value ->> 'access_scope' not in ('organization', 'cofounders')
      or jsonb_typeof(row_value -> 'normalized_payload') <> 'object'
      or octet_length((row_value -> 'normalized_payload')::text) > 2000000
      or private.crm_jsonb_has_forbidden_key(row_value -> 'normalized_payload')
      or jsonb_typeof(row_value -> 'payload_hash') <> 'string'
      or (row_value ->> 'payload_hash') !~ '^[a-f0-9]{64}$'
      or jsonb_typeof(row_value -> 'privacy_reasons') <> 'array'
      or jsonb_typeof(row_value -> 'validation_errors') <> 'array'
      or (
        row_value ->> 'entity_type' = 'lead'
        and coalesce(row_value ->> 'parent_external_id', '') = ''
      )
  ) then
    raise exception 'CRM import contains an invalid or forbidden staging row';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(requested_rows) row_value
    cross join lateral jsonb_array_elements(
      (row_value -> 'privacy_reasons') || (row_value -> 'validation_errors')
    ) reason
    where jsonb_typeof(reason) <> 'string'
      or length(reason #>> '{}') > 500
  ) then
    raise exception 'CRM import staging reasons are invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      requested_organization_id::text || E'\n' ||
        requested_source_external_id || E'\n' || requested_source_hash,
      0
    )
  );

  select * into import_run
  from public.crm_import_runs run
  where run.organization_id = requested_organization_id
    and run.provider = 'trello'
    and run.source_external_id = requested_source_external_id
    and run.source_hash = requested_source_hash
    and run.status in ('staged', 'applied')
  order by run.created_at desc
  limit 1
  for update;

  if found then
    if import_run.expected_item_count <> requested_expected_item_count
      or import_run.staging_hash <> requested_staging_hash then
      raise exception 'Existing CRM import attestation differs; create a reviewed export version';
    end if;
    select attestation.item_count, attestation.staging_hash
    into actual_item_count, actual_staging_hash
    from private.crm_staging_attestation(
      import_run.id,
      import_run.organization_id
    ) attestation;
    if actual_item_count <> import_run.expected_item_count
      or actual_staging_hash <> import_run.staging_hash then
      raise exception 'Existing CRM import staging attestation is invalid';
    end if;
    return jsonb_build_object(
      'runId', import_run.id,
      'reused', true,
      'status', import_run.status
    );
  end if;

  insert into public.crm_import_runs (
    organization_id, provider, source_external_id, source_hash, status,
    dry_run, summary, expected_item_count, staging_hash,
    created_by_profile_id
  ) values (
    requested_organization_id, 'trello', requested_source_external_id,
    requested_source_hash, 'staged', true, requested_summary,
    requested_expected_item_count, requested_staging_hash, (select auth.uid())
  ) returning * into import_run;

  insert into public.crm_import_staging (
    organization_id, run_id, entity_type, external_id, parent_external_id,
    access_scope, normalized_payload, payload_hash, privacy_reasons,
    validation_errors
  )
  select
    requested_organization_id,
    import_run.id,
    row_record.entity_type,
    row_record.external_id,
    row_record.parent_external_id,
    row_record.access_scope,
    row_record.normalized_payload,
    row_record.payload_hash,
    row_record.privacy_reasons,
    row_record.validation_errors
  from jsonb_to_recordset(requested_rows) as row_record(
    entity_type text,
    external_id text,
    parent_external_id text,
    access_scope text,
    normalized_payload jsonb,
    payload_hash text,
    privacy_reasons jsonb,
    validation_errors jsonb
  );

  select attestation.item_count, attestation.staging_hash
  into actual_item_count, actual_staging_hash
  from private.crm_staging_attestation(
    import_run.id,
    import_run.organization_id
  ) attestation;
  if actual_item_count <> import_run.expected_item_count
    or actual_staging_hash <> import_run.staging_hash then
    raise exception 'CRM import staging attestation failed';
  end if;

  return jsonb_build_object(
    'runId', import_run.id,
    'reused', false,
    'status', import_run.status
  );
end;
$$;

-- Transactional one-shot apply. Existing imported entities are never
-- overwritten: a changed hash becomes an auditable conflict. Replaying the
-- exact same export is an idempotent no-op.
create or replace function public.apply_crm_trello_import(requested_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  import_run public.crm_import_runs%rowtype;
  staged public.crm_import_staging%rowtype;
  existing_ref public.crm_external_refs%rowtype;
  created_ref public.crm_external_refs%rowtype;
  category_row public.crm_categories%rowtype;
  tag_row public.crm_tags%rowtype;
  lead_row public.crm_leads%rowtype;
  resolved_tag_id uuid;
  label_external_id text;
  candidate_count integer;
  staged_match_count integer;
  previous_relation_archived_at timestamptz;
  relation_existed boolean;
  local_was_archived boolean;
  created_count integer := 0;
  linked_count integer := 0;
  revived_count integer := 0;
  unchanged_count integer := 0;
  conflict_count integer := 0;
  attested_item_count bigint;
  attested_staging_hash text;
begin
  select * into import_run
  from public.crm_import_runs
  where id = requested_run_id
  for update;

  if not found or not private.is_crm_cofounder(import_run.organization_id) then
    raise exception 'CRM import not found or not authorized';
  end if;

  select attestation.item_count, attestation.staging_hash
  into attested_item_count, attested_staging_hash
  from private.crm_staging_attestation(
    import_run.id,
    import_run.organization_id
  ) attestation;
  if attested_item_count <> import_run.expected_item_count
    or attested_staging_hash <> import_run.staging_hash then
    raise exception 'CRM import staging attestation is incomplete or invalid';
  end if;

  if import_run.status = 'applied' then
    return import_run.summary || jsonb_build_object('idempotentReplay', true);
  end if;
  if import_run.status <> 'staged' then
    raise exception 'CRM import run must be staged before apply';
  end if;
  if exists (
    select 1 from public.crm_import_staging stage
    where stage.run_id = import_run.id
      and stage.organization_id = import_run.organization_id
      and jsonb_array_length(stage.validation_errors) > 0
  ) then
    raise exception 'CRM import has validation errors';
  end if;

  for staged in
    select * from public.crm_import_staging
    where organization_id = import_run.organization_id
      and run_id = import_run.id
      and entity_type = 'category'
    order by coalesce((normalized_payload ->> 'position')::integer, 0), external_id
  loop
    select * into existing_ref
    from public.crm_external_refs ref
    where ref.organization_id = import_run.organization_id
      and ref.provider = 'trello'
      and ref.external_type = staged.entity_type
      and ref.external_id = staged.external_id
    order by (ref.archived_at is null) desc, ref.updated_at desc
    limit 1;

    if found then
      if existing_ref.local_table <> 'crm_categories' then
        raise exception 'Trello category reference targets an unexpected table';
      end if;
      select * into category_row
      from public.crm_categories category
      where category.id = existing_ref.local_id
        and category.organization_id = import_run.organization_id;
      if not found then
        raise exception 'Trello category reference is broken';
      end if;

      if existing_ref.archived_at is not null then
        if existing_ref.source_hash <> staged.payload_hash then
          raise exception 'Rolled-back Trello category changed; stage a reviewed reconciliation';
        end if;
        local_was_archived := category_row.archived_at is not null;
        if local_was_archived then
          update public.crm_categories
          set archived_at = null, updated_at = now()
          where id = category_row.id
            and organization_id = import_run.organization_id
          returning * into category_row;
        end if;
        update public.crm_external_refs
        set archived_at = null,
            access_scope = category_row.access_scope,
            last_run_id = import_run.id,
            source_hash = staged.payload_hash,
            updated_at = now()
        where id = existing_ref.id
          and organization_id = import_run.organization_id
        returning * into existing_ref;
        insert into public.crm_import_changes (
          organization_id, run_id, external_ref_id, local_table, local_id,
          operation, after_snapshot
        ) values (
          import_run.organization_id, import_run.id, existing_ref.id,
          'crm_categories', category_row.id,
          case when local_was_archived then 'revived' else 'linked' end,
          to_jsonb(category_row)
        );
        if local_was_archived then
          revived_count := revived_count + 1;
        else
          linked_count := linked_count + 1;
        end if;
      elsif existing_ref.source_hash = staged.payload_hash then
        unchanged_count := unchanged_count + 1;
        insert into public.crm_import_changes (
          organization_id, run_id, external_ref_id, local_table, local_id, operation
        ) values (
          import_run.organization_id, import_run.id, existing_ref.id,
          existing_ref.local_table, existing_ref.local_id, 'unchanged'
        );
      else
        conflict_count := conflict_count + 1;
        insert into public.crm_import_changes (
          organization_id, run_id, external_ref_id, local_table, local_id,
          operation, before_snapshot, after_snapshot
        ) values (
          import_run.organization_id, import_run.id, existing_ref.id,
          existing_ref.local_table, existing_ref.local_id, 'conflict',
          jsonb_build_object('sourceHash', existing_ref.source_hash),
          jsonb_build_object('sourceHash', staged.payload_hash)
        );
      end if;
      continue;
    end if;

    select count(*) into candidate_count
    from public.crm_categories category
    where category.organization_id = import_run.organization_id
      and category.status_key = staged.normalized_payload ->> 'statusKey'
      and category.archived_at is null
      and not exists (
        select 1 from public.crm_external_refs ref
        where ref.organization_id = import_run.organization_id
          and ref.local_table = 'crm_categories'
          and ref.local_id = category.id
      );
    if candidate_count > 1 then
      raise exception 'Ambiguous existing CRM category match';
    elsif candidate_count = 1 then
      select * into category_row
      from public.crm_categories category
      where category.organization_id = import_run.organization_id
        and category.status_key = staged.normalized_payload ->> 'statusKey'
        and category.archived_at is null
        and not exists (
          select 1 from public.crm_external_refs ref
          where ref.organization_id = import_run.organization_id
            and ref.local_table = 'crm_categories'
            and ref.local_id = category.id
        );
      if category_row.access_scope <> staged.access_scope then
        raise exception 'Existing CRM category scope mismatch';
      end if;
      insert into public.crm_external_refs (
        organization_id, external_type, external_id, local_table, local_id,
        access_scope, source_hash, first_run_id, last_run_id
      ) values (
        import_run.organization_id, staged.entity_type, staged.external_id,
        'crm_categories', category_row.id, category_row.access_scope,
        staged.payload_hash, import_run.id, import_run.id
      ) returning * into created_ref;
      insert into public.crm_import_changes (
        organization_id, run_id, external_ref_id, local_table, local_id,
        operation, after_snapshot
      ) values (
        import_run.organization_id, import_run.id, created_ref.id,
        'crm_categories', category_row.id, 'linked', to_jsonb(category_row)
      );
      linked_count := linked_count + 1;
      continue;
    end if;

    insert into public.crm_categories (
      organization_id, name, status_key, color, position, access_scope
    ) values (
      import_run.organization_id,
      staged.normalized_payload ->> 'name',
      staged.normalized_payload ->> 'statusKey',
      coalesce(staged.normalized_payload ->> 'color', 'gray'),
      coalesce((staged.normalized_payload ->> 'position')::integer, 0),
      staged.access_scope
    ) returning * into category_row;

    insert into public.crm_external_refs (
      organization_id, external_type, external_id, local_table, local_id,
      access_scope, source_hash, first_run_id, last_run_id
    ) values (
      import_run.organization_id, staged.entity_type, staged.external_id,
      'crm_categories', category_row.id, staged.access_scope,
      staged.payload_hash, import_run.id, import_run.id
    ) returning * into created_ref;

    insert into public.crm_import_changes (
      organization_id, run_id, external_ref_id, local_table, local_id,
      operation, after_snapshot
    ) values (
      import_run.organization_id, import_run.id, created_ref.id,
      'crm_categories', category_row.id, 'created', to_jsonb(category_row)
    );
    created_count := created_count + 1;
  end loop;

  for staged in
    select * from public.crm_import_staging
    where organization_id = import_run.organization_id
      and run_id = import_run.id
      and entity_type = 'tag'
    order by external_id
  loop
    select * into existing_ref
    from public.crm_external_refs ref
    where ref.organization_id = import_run.organization_id
      and ref.provider = 'trello'
      and ref.external_type = staged.entity_type
      and ref.external_id = staged.external_id
    order by (ref.archived_at is null) desc, ref.updated_at desc
    limit 1;

    if found then
      if existing_ref.local_table <> 'crm_tags' then
        raise exception 'Trello tag reference targets an unexpected table';
      end if;
      select * into tag_row
      from public.crm_tags tag
      where tag.id = existing_ref.local_id
        and tag.organization_id = import_run.organization_id;
      if not found then
        raise exception 'Trello tag reference is broken';
      end if;

      if existing_ref.archived_at is not null then
        if existing_ref.source_hash <> staged.payload_hash then
          raise exception 'Rolled-back Trello tag changed; stage a reviewed reconciliation';
        end if;
        local_was_archived := tag_row.archived_at is not null;
        if local_was_archived then
          update public.crm_tags
          set archived_at = null, updated_at = now()
          where id = tag_row.id
            and organization_id = import_run.organization_id
          returning * into tag_row;
        end if;
        update public.crm_external_refs
        set archived_at = null,
            access_scope = tag_row.access_scope,
            last_run_id = import_run.id,
            source_hash = staged.payload_hash,
            updated_at = now()
        where id = existing_ref.id
          and organization_id = import_run.organization_id
        returning * into existing_ref;
        insert into public.crm_import_changes (
          organization_id, run_id, external_ref_id, local_table, local_id,
          operation, after_snapshot
        ) values (
          import_run.organization_id, import_run.id, existing_ref.id,
          'crm_tags', tag_row.id,
          case when local_was_archived then 'revived' else 'linked' end,
          to_jsonb(tag_row)
        );
        if local_was_archived then
          revived_count := revived_count + 1;
        else
          linked_count := linked_count + 1;
        end if;
      else
        if existing_ref.source_hash = staged.payload_hash then
          unchanged_count := unchanged_count + 1;
        else
          conflict_count := conflict_count + 1;
        end if;
        insert into public.crm_import_changes (
          organization_id, run_id, external_ref_id, local_table, local_id, operation
        ) values (
          import_run.organization_id, import_run.id, existing_ref.id,
          existing_ref.local_table, existing_ref.local_id,
          case when existing_ref.source_hash = staged.payload_hash then 'unchanged' else 'conflict' end
        );
      end if;
      continue;
    end if;

    select count(*) into candidate_count
    from public.crm_tags tag
    where tag.organization_id = import_run.organization_id
      and private.crm_normalize_match_text(tag.name) =
        private.crm_normalize_match_text(staged.normalized_payload ->> 'name')
      and tag.archived_at is null
      and not exists (
        select 1 from public.crm_external_refs ref
        where ref.organization_id = import_run.organization_id
          and ref.local_table = 'crm_tags'
          and ref.local_id = tag.id
      );
    select count(*) into staged_match_count
    from public.crm_import_staging other_stage
    where other_stage.organization_id = import_run.organization_id
      and other_stage.run_id = import_run.id
      and other_stage.entity_type = 'tag'
      and private.crm_normalize_match_text(other_stage.normalized_payload ->> 'name') =
        private.crm_normalize_match_text(staged.normalized_payload ->> 'name');
    if candidate_count > 1 then
      raise exception 'Ambiguous existing CRM tag match';
    elsif candidate_count = 1 and staged_match_count > 1 then
      raise exception 'Ambiguous staged Trello tag name for existing CRM tag';
    end if;

    select * into tag_row
    from public.crm_tags tag
    where tag.organization_id = import_run.organization_id
      and private.crm_normalize_match_text(tag.name) =
        private.crm_normalize_match_text(staged.normalized_payload ->> 'name')
      and tag.archived_at is null
      and not exists (
        select 1 from public.crm_external_refs ref
        where ref.organization_id = import_run.organization_id
          and ref.local_table = 'crm_tags'
          and ref.local_id = tag.id
      )
    limit 1;

    if found then
      if tag_row.access_scope <> staged.access_scope then
        raise exception 'Existing CRM tag scope mismatch';
      end if;
      insert into public.crm_external_refs (
        organization_id, external_type, external_id, local_table, local_id,
        access_scope, source_hash, first_run_id, last_run_id
      ) values (
        import_run.organization_id, staged.entity_type, staged.external_id,
        'crm_tags', tag_row.id, tag_row.access_scope,
        staged.payload_hash, import_run.id, import_run.id
      ) returning * into created_ref;
      insert into public.crm_import_changes (
        organization_id, run_id, external_ref_id, local_table, local_id,
        operation, after_snapshot
      ) values (
        import_run.organization_id, import_run.id, created_ref.id,
        'crm_tags', tag_row.id, 'linked', to_jsonb(tag_row)
      );
      linked_count := linked_count + 1;
      continue;
    end if;

    insert into public.crm_tags (organization_id, name, color, access_scope)
    values (
      import_run.organization_id,
      staged.normalized_payload ->> 'name',
      coalesce(staged.normalized_payload ->> 'color', 'teal'),
      staged.access_scope
    ) returning * into tag_row;
    insert into public.crm_external_refs (
      organization_id, external_type, external_id, local_table, local_id,
      access_scope, source_hash, first_run_id, last_run_id
    ) values (
      import_run.organization_id, staged.entity_type, staged.external_id,
      'crm_tags', tag_row.id, staged.access_scope,
      staged.payload_hash, import_run.id, import_run.id
    ) returning * into created_ref;
    insert into public.crm_import_changes (
      organization_id, run_id, external_ref_id, local_table, local_id,
      operation, after_snapshot
    ) values (
      import_run.organization_id, import_run.id, created_ref.id,
      'crm_tags', tag_row.id, 'created', to_jsonb(tag_row)
    );
    created_count := created_count + 1;
  end loop;

  for staged in
    select * from public.crm_import_staging
    where organization_id = import_run.organization_id
      and run_id = import_run.id
      and entity_type = 'lead'
    order by external_id
  loop
    select * into existing_ref
    from public.crm_external_refs ref
    where ref.organization_id = import_run.organization_id
      and ref.provider = 'trello'
      and ref.external_type = staged.entity_type
      and ref.external_id = staged.external_id
    order by (ref.archived_at is null) desc, ref.updated_at desc
    limit 1;

    if found then
      if existing_ref.local_table <> 'crm_leads' then
        raise exception 'Trello lead reference targets an unexpected table';
      end if;
      select * into lead_row
      from public.crm_leads lead
      where lead.id = existing_ref.local_id
        and lead.organization_id = import_run.organization_id;
      if not found then
        raise exception 'Trello lead reference is broken';
      end if;

      if existing_ref.archived_at is not null then
        if existing_ref.source_hash <> staged.payload_hash then
          raise exception 'Rolled-back Trello lead changed; stage a reviewed reconciliation';
        end if;
        local_was_archived := lead_row.archived_at is not null;
        if local_was_archived then
          update public.crm_leads
          set archived_at = null, updated_at = now()
          where id = lead_row.id
            and organization_id = import_run.organization_id
          returning * into lead_row;
        end if;
        update public.crm_external_refs
        set archived_at = null,
            access_scope = lead_row.access_scope,
            last_run_id = import_run.id,
            source_hash = staged.payload_hash,
            updated_at = now()
        where id = existing_ref.id
          and organization_id = import_run.organization_id
        returning * into existing_ref;
        insert into public.crm_import_changes (
          organization_id, run_id, external_ref_id, local_table, local_id,
          operation, after_snapshot
        ) values (
          import_run.organization_id, import_run.id, existing_ref.id,
          'crm_leads', lead_row.id,
          case when local_was_archived then 'revived' else 'linked' end,
          to_jsonb(lead_row)
        );
        if local_was_archived then
          revived_count := revived_count + 1;
        else
          linked_count := linked_count + 1;
        end if;
      else
        if existing_ref.source_hash = staged.payload_hash then
          unchanged_count := unchanged_count + 1;
        else
          conflict_count := conflict_count + 1;
        end if;
        insert into public.crm_import_changes (
          organization_id, run_id, external_ref_id, local_table, local_id, operation
        ) values (
          import_run.organization_id, import_run.id, existing_ref.id,
          existing_ref.local_table, existing_ref.local_id,
          case when existing_ref.source_hash = staged.payload_hash then 'unchanged' else 'conflict' end
        );
        continue;
      end if;
    else
      select count(*) into candidate_count
      from public.crm_leads lead
      where lead.organization_id = import_run.organization_id
        and private.crm_normalize_match_text(lead.topic) =
          private.crm_normalize_match_text(staged.normalized_payload ->> 'topic')
        and lead.archived_at is null
        and not exists (
          select 1 from public.crm_external_refs ref
          where ref.organization_id = import_run.organization_id
            and ref.local_table = 'crm_leads'
            and ref.local_id = lead.id
        );
      select count(*) into staged_match_count
      from public.crm_import_staging other_stage
      where other_stage.organization_id = import_run.organization_id
        and other_stage.run_id = import_run.id
        and other_stage.entity_type = 'lead'
        and private.crm_normalize_match_text(other_stage.normalized_payload ->> 'topic') =
          private.crm_normalize_match_text(staged.normalized_payload ->> 'topic');
      if candidate_count > 1 or (candidate_count = 1 and staged_match_count > 1) then
        raise exception 'Ambiguous existing CRM lead match';
      elsif candidate_count = 1 then
        select * into lead_row
        from public.crm_leads lead
        where lead.organization_id = import_run.organization_id
          and private.crm_normalize_match_text(lead.topic) =
            private.crm_normalize_match_text(staged.normalized_payload ->> 'topic')
          and lead.archived_at is null
          and not exists (
            select 1 from public.crm_external_refs ref
            where ref.organization_id = import_run.organization_id
              and ref.local_table = 'crm_leads'
              and ref.local_id = lead.id
          );
        if lead_row.access_scope <> staged.access_scope then
          raise exception 'Existing CRM lead scope mismatch';
        end if;
        insert into public.crm_external_refs (
          organization_id, external_type, external_id, local_table, local_id,
          access_scope, source_hash, first_run_id, last_run_id
        ) values (
          import_run.organization_id, staged.entity_type, staged.external_id,
          'crm_leads', lead_row.id, lead_row.access_scope,
          staged.payload_hash, import_run.id, import_run.id
        ) returning * into created_ref;
        insert into public.crm_import_changes (
          organization_id, run_id, external_ref_id, local_table, local_id,
          operation, after_snapshot
        ) values (
          import_run.organization_id, import_run.id, created_ref.id,
          'crm_leads', lead_row.id, 'linked', to_jsonb(lead_row)
        );
        linked_count := linked_count + 1;
      else
        insert into public.crm_leads (
          organization_id, topic, source, status, notes, next_action, lead_date,
          access_scope, created_by_profile_id
        ) values (
          import_run.organization_id,
          staged.normalized_payload ->> 'topic',
          coalesce(staged.normalized_payload ->> 'source', 'Trello'),
          staged.normalized_payload ->> 'status',
          nullif(staged.normalized_payload ->> 'notes', ''),
          nullif(staged.normalized_payload ->> 'nextAction', ''),
          nullif(staged.normalized_payload ->> 'leadDate', '')::timestamptz,
          staged.access_scope,
          (select auth.uid())
        ) returning * into lead_row;
        insert into public.crm_external_refs (
          organization_id, external_type, external_id, local_table, local_id,
          access_scope, source_hash, first_run_id, last_run_id
        ) values (
          import_run.organization_id, staged.entity_type, staged.external_id,
          'crm_leads', lead_row.id, staged.access_scope,
          staged.payload_hash, import_run.id, import_run.id
        ) returning * into created_ref;
        insert into public.crm_import_changes (
          organization_id, run_id, external_ref_id, local_table, local_id,
          operation, after_snapshot
        ) values (
          import_run.organization_id, import_run.id, created_ref.id,
          'crm_leads', lead_row.id, 'created', to_jsonb(lead_row)
        );
        created_count := created_count + 1;
      end if;
    end if;

    for label_external_id in
      select jsonb_array_elements_text(
        coalesce(staged.normalized_payload -> 'labelExternalIds', '[]'::jsonb)
      )
    loop
      select ref.local_id into resolved_tag_id
      from public.crm_external_refs ref
      where ref.organization_id = import_run.organization_id
        and ref.provider = 'trello'
        and ref.external_type = 'tag'
        and ref.external_id = label_external_id
        and ref.archived_at is null;
      if resolved_tag_id is null then
        raise exception 'Trello lead references an unresolved tag';
      end if;

      select relation.archived_at into previous_relation_archived_at
      from public.crm_lead_tags relation
      where relation.lead_id = lead_row.id
        and relation.tag_id = resolved_tag_id;
      relation_existed := found;
      if not relation_existed then
        insert into public.crm_lead_tags (lead_id, tag_id, archived_at)
        values (lead_row.id, resolved_tag_id, null);
        insert into public.crm_import_changes (
          organization_id, run_id, local_table, operation,
          before_snapshot, after_snapshot
        ) values (
          import_run.organization_id, import_run.id, 'crm_lead_tags',
          'linked-relation', jsonb_build_object('wasPresent', false),
          jsonb_build_object('leadId', lead_row.id, 'tagId', resolved_tag_id)
        );
      elsif previous_relation_archived_at is not null then
        update public.crm_lead_tags
        set archived_at = null
        where lead_id = lead_row.id and tag_id = resolved_tag_id;
        insert into public.crm_import_changes (
          organization_id, run_id, local_table, operation,
          before_snapshot, after_snapshot
        ) values (
          import_run.organization_id, import_run.id, 'crm_lead_tags',
          'linked-relation',
          jsonb_build_object(
            'wasPresent', true,
            'previousArchivedAt', previous_relation_archived_at
          ),
          jsonb_build_object('leadId', lead_row.id, 'tagId', resolved_tag_id)
        );
      end if;
    end loop;
  end loop;

  update public.crm_import_runs
  set status = 'applied',
      dry_run = false,
      applied_at = now(),
      summary = summary || jsonb_build_object(
        'created', created_count,
        'linked', linked_count,
        'revived', revived_count,
        'unchanged', unchanged_count,
        'conflicts', conflict_count
      )
  where id = import_run.id
    and organization_id = import_run.organization_id
  returning * into import_run;

  return import_run.summary;
end;
$$;

-- Compensating rollback: creations and relationships are soft-archived. No
-- CRM or ledger row is deleted, so recovery remains possible for founders.
create or replace function public.rollback_crm_trello_import(requested_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  import_run public.crm_import_runs%rowtype;
  change_record public.crm_import_changes%rowtype;
  rolled_back_count integer := 0;
begin
  select * into import_run
  from public.crm_import_runs
  where id = requested_run_id
  for update;

  if not found or not private.is_crm_cofounder(import_run.organization_id) then
    raise exception 'CRM import not found or not authorized';
  end if;
  if import_run.status = 'rolled-back' then
    return import_run.summary || jsonb_build_object('idempotentRollback', true);
  end if;
  if import_run.status <> 'applied' then
    raise exception 'Only applied CRM imports can be rolled back';
  end if;

  for change_record in
    select * from public.crm_import_changes
    where organization_id = import_run.organization_id
      and run_id = import_run.id
    order by created_at desc, id desc
  loop
    if change_record.operation = 'linked-relation' then
      if coalesce(change_record.before_snapshot ->> 'wasPresent', 'false')::boolean then
        update public.crm_lead_tags relation
        set archived_at = (change_record.before_snapshot ->> 'previousArchivedAt')::timestamptz
        where relation.lead_id = (change_record.after_snapshot ->> 'leadId')::uuid
          and relation.tag_id = (change_record.after_snapshot ->> 'tagId')::uuid
          and exists (
            select 1
            from public.crm_leads lead
            join public.crm_tags tag
              on tag.id = (change_record.after_snapshot ->> 'tagId')::uuid
            where lead.id = (change_record.after_snapshot ->> 'leadId')::uuid
              and lead.organization_id = import_run.organization_id
              and tag.organization_id = import_run.organization_id
          );
      else
        update public.crm_lead_tags relation
        set archived_at = now()
        where relation.lead_id = (change_record.after_snapshot ->> 'leadId')::uuid
          and relation.tag_id = (change_record.after_snapshot ->> 'tagId')::uuid
          and relation.archived_at is null
          and exists (
            select 1
            from public.crm_leads lead
            join public.crm_tags tag
              on tag.id = (change_record.after_snapshot ->> 'tagId')::uuid
            where lead.id = (change_record.after_snapshot ->> 'leadId')::uuid
              and lead.organization_id = import_run.organization_id
              and tag.organization_id = import_run.organization_id
          );
      end if;
      if found then rolled_back_count := rolled_back_count + 1; end if;
    elsif change_record.operation in ('created', 'revived') and change_record.local_table = 'crm_leads' then
      update public.crm_leads set archived_at = now(), updated_at = now()
      where id = change_record.local_id
        and organization_id = import_run.organization_id
        and archived_at is null;
      if found then rolled_back_count := rolled_back_count + 1; end if;
    elsif change_record.operation in ('created', 'revived') and change_record.local_table = 'crm_categories' then
      update public.crm_categories set archived_at = now(), updated_at = now()
      where id = change_record.local_id
        and organization_id = import_run.organization_id
        and archived_at is null;
      if found then rolled_back_count := rolled_back_count + 1; end if;
    elsif change_record.operation in ('created', 'revived') and change_record.local_table = 'crm_tags' then
      update public.crm_tags set archived_at = now(), updated_at = now()
      where id = change_record.local_id
        and organization_id = import_run.organization_id
        and archived_at is null;
      if found then rolled_back_count := rolled_back_count + 1; end if;
    end if;
  end loop;

  update public.crm_external_refs
  set archived_at = now(), updated_at = now()
  where organization_id = import_run.organization_id
    and last_run_id = import_run.id
    and archived_at is null;

  update public.crm_import_runs
  set status = 'rolled-back',
      rolled_back_at = now(),
      summary = summary || jsonb_build_object('softArchivedOnRollback', rolled_back_count)
  where id = import_run.id
    and organization_id = import_run.organization_id
  returning * into import_run;

  return import_run.summary;
end;
$$;

revoke execute on function public.stage_crm_trello_import(
  uuid, text, text, text, integer, jsonb, jsonb
) from public, anon;
revoke execute on function public.apply_crm_trello_import(uuid) from public, anon;
revoke execute on function public.rollback_crm_trello_import(uuid) from public, anon;
grant execute on function public.stage_crm_trello_import(
  uuid, text, text, text, integer, jsonb, jsonb
) to authenticated;
grant execute on function public.apply_crm_trello_import(uuid) to authenticated;
grant execute on function public.rollback_crm_trello_import(uuid) to authenticated;
grant execute on function public.apply_crm_trello_import(uuid) to service_role;
grant execute on function public.rollback_crm_trello_import(uuid) to service_role;
