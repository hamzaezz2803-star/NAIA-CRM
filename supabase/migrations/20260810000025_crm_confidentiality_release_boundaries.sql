-- Final CRM confidentiality release boundaries.
--
-- This migration is additive and data-preserving. It closes four gaps left by
-- the initial confidentiality migration:
--   * a lead inherits an irreversible cofounders scope from its status/category
--     and from every active tag relation;
--   * manual lead creation is one database transaction, including company,
--     contact and tag links;
--   * a confidential lead escalates its complete CRM family;
--   * bridge approvals are claimed only after revalidating the exact actor,
--     organization, active record and current confidentiality scope.

alter table public.naia_consumed_action_tokens
  add column if not exists actor_profile_id uuid
    references public.profiles (id) on delete restrict;

create index if not exists naia_consumed_action_tokens_actor_idx
  on public.naia_consumed_action_tokens (
    organization_id,
    actor_profile_id,
    consumed_at desc
  );

-- The import-ledger table predates its attestation columns in already-running
-- environments. CREATE TABLE IF NOT EXISTS in the preceding migration cannot
-- add those columns, so upgrade and attest legacy runs before making them
-- mandatory. No staged or imported row is removed.
alter table public.crm_import_runs
  add column if not exists expected_item_count integer,
  add column if not exists staging_hash text;

update public.crm_import_runs import_run
set expected_item_count = coalesce(
      import_run.expected_item_count,
      (
        select attestation.item_count::integer
        from private.crm_staging_attestation(
          import_run.id,
          import_run.organization_id
        ) attestation
      )
    ),
    staging_hash = coalesce(
      import_run.staging_hash,
      (
        select attestation.staging_hash
        from private.crm_staging_attestation(
          import_run.id,
          import_run.organization_id
        ) attestation
      )
    )
where import_run.expected_item_count is null
  or import_run.staging_hash is null;

alter table public.crm_import_runs
  alter column expected_item_count set not null,
  alter column staging_hash set not null;

alter table public.crm_import_runs
  drop constraint if exists crm_import_runs_expected_item_count_check,
  drop constraint if exists crm_import_runs_staging_hash_check;
alter table public.crm_import_runs
  add constraint crm_import_runs_expected_item_count_check
    check (expected_item_count between 0 and 125000),
  add constraint crm_import_runs_staging_hash_check
    check (staging_hash ~ '^[a-f0-9]{64}$');

-- Derive lead confidentiality at every write. The original root trigger still
-- provides the one-way anti-downgrade rule and parent (company/contact)
-- inheritance; this trigger adds category/status and active-tag inheritance.
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

-- Replace the previously deployed root trigger function in-place. Earlier
-- revisions propagated descendants from this BEFORE trigger, which can
-- recurse against a parent row that still exposes its old scope. Propagation
-- is handled by the convergent AFTER triggers below instead.
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
    sensitive_text := concat_ws(E'\n', new.topic, new.status, new.source,
      new.notes, new.next_action, new.contact_job_title);
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

  -- Descendant propagation deliberately runs in an AFTER trigger installed by
  -- the release-boundaries migration. Updating descendants from this BEFORE
  -- trigger can recurse when a confidential lead escalates its parent while
  -- that parent row still exposes its old scope to nested statements.
  return new;
end;
$$;

revoke execute on function private.enforce_crm_root_boundary()
from public, anon, authenticated, service_role;

-- Confidential leads and tasks may only be unassigned or assigned to one of
-- the exact cofounders. The trigger name sorts after the existing derivation
-- and root-boundary triggers, so it validates the final derived scope even
-- when a parent, category, or tag caused the escalation.
do $preflight$
begin
  if exists (
    select 1
    from public.crm_leads lead
    where lead.access_scope = 'cofounders'
      and lead.assigned_to_profile_id is not null
      and not private.is_crm_cofounder_profile(
        lead.organization_id,
        lead.assigned_to_profile_id
      )
  ) or exists (
    select 1
    from public.crm_tasks task
    where task.access_scope = 'cofounders'
      and task.assigned_to_profile_id is not null
      and not private.is_crm_cofounder_profile(
        task.organization_id,
        task.assigned_to_profile_id
      )
  ) then
    raise exception 'CRM confidentiality preflight: a cofounders lead/task is assigned to a non-cofounder';
  end if;
end
$preflight$;

create or replace function private.enforce_crm_confidential_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_to_profile_id is not null
    and not exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = new.organization_id
        and membership.profile_id = new.assigned_to_profile_id
    ) then
    raise exception 'CRM assignee must belong to the record organization'
      using errcode = '23514';
  end if;

  if new.access_scope = 'cofounders'
    and new.assigned_to_profile_id is not null
    and not private.is_crm_cofounder_profile(
      new.organization_id,
      new.assigned_to_profile_id
    ) then
    raise exception 'A confidential CRM % cannot be assigned to a non-cofounder',
      case when tg_table_name = 'crm_leads' then 'lead' else 'task' end
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke execute on function private.enforce_crm_confidential_assignee()
from public, anon, authenticated, service_role;

drop trigger if exists zz_enforce_crm_confidential_assignee_trigger
on public.crm_leads;
create trigger zz_enforce_crm_confidential_assignee_trigger
before insert or update on public.crm_leads
for each row execute function private.enforce_crm_confidential_assignee();

drop trigger if exists zz_enforce_crm_confidential_assignee_trigger
on public.crm_tasks;
create trigger zz_enforce_crm_confidential_assignee_trigger
before insert or update on public.crm_tasks
for each row execute function private.enforce_crm_confidential_assignee();

-- Notes and follow-up comments inherit the lead's confidentiality boundary.
-- Sensitive child text escalates the parent before the child can commit; a
-- cross-tenant reference or non-founder assignee is rejected even when the
-- caller is service_role and therefore bypasses RLS.
create or replace function private.enforce_crm_lead_child_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  child_assignee_profile_id uuid;
  child_text text;
  parent_scope text;
begin
  if tg_table_name = 'crm_lead_notes' then
    child_text := new.content;
    child_assignee_profile_id := nullif(
      to_jsonb(new) ->> 'assigned_to_profile_id',
      ''
    )::uuid;
  elsif tg_table_name = 'crm_lead_follow_ups' then
    child_text := new.comment;
    child_assignee_profile_id := null;
  else
    raise exception 'Unsupported CRM lead child table: %', tg_table_name;
  end if;

  select lead.access_scope
  into parent_scope
  from public.crm_leads lead
  where lead.id = new.lead_id
    and lead.organization_id = new.organization_id
    and lead.archived_at is null
  for update;

  if not found then
    raise exception 'CRM lead child references a missing, archived, or cross-organization lead'
      using errcode = '23514';
  end if;

  if private.crm_text_requires_cofounder(child_text) then
    update public.crm_leads
    set access_scope = 'cofounders'
    where id = new.lead_id
      and organization_id = new.organization_id
      and access_scope <> 'cofounders';
    parent_scope := 'cofounders';
  end if;

  if child_assignee_profile_id is not null
    and not exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = new.organization_id
        and membership.profile_id = child_assignee_profile_id
    ) then
    raise exception 'CRM note assignee must belong to the lead organization'
      using errcode = '23514';
  end if;

  if parent_scope = 'cofounders'
    and child_assignee_profile_id is not null
    and not private.is_crm_cofounder_profile(
      new.organization_id,
      child_assignee_profile_id
    ) then
    raise exception 'A confidential CRM note cannot be assigned to a non-cofounder'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke execute on function private.enforce_crm_lead_child_scope()
from public, anon, authenticated, service_role;

drop trigger if exists enforce_crm_lead_child_scope_trigger
on public.crm_lead_notes;
create trigger enforce_crm_lead_child_scope_trigger
before insert or update on public.crm_lead_notes
for each row execute function private.enforce_crm_lead_child_scope();

drop trigger if exists enforce_crm_lead_child_scope_trigger
on public.crm_lead_follow_ups;
create trigger enforce_crm_lead_child_scope_trigger
before insert or update on public.crm_lead_follow_ups
for each row execute function private.enforce_crm_lead_child_scope();

-- Parent-to-descendant propagation must run AFTER the parent row is stored.
-- This makes bidirectional family escalation convergent: when a lead escalates
-- its parent, the parent's nested descendant updates see the parent already at
-- cofounders and every attempted upward write becomes a no-op.
create or replace function private.propagate_crm_parent_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.access_scope <> 'cofounders'
    or (tg_op = 'UPDATE' and old.access_scope = 'cofounders') then
    return new;
  end if;

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
  else
    raise exception 'Unsupported CRM parent scope table: %', tg_table_name;
  end if;

  return new;
end;
$$;

revoke execute on function private.propagate_crm_parent_scope()
from public, anon, authenticated, service_role;

drop trigger if exists propagate_crm_parent_scope_trigger
on public.crm_companies;
create trigger propagate_crm_parent_scope_trigger
after insert or update on public.crm_companies
for each row execute function private.propagate_crm_parent_scope();

drop trigger if exists propagate_crm_parent_scope_trigger
on public.crm_contacts;
create trigger propagate_crm_parent_scope_trigger
after insert or update on public.crm_contacts
for each row execute function private.propagate_crm_parent_scope();

-- Once a lead becomes confidential, its company, contact and tasks become
-- confidential in the same transaction. Existing root triggers then propagate
-- the parent escalation to every other descendant. No row is deleted or
-- downgraded.
create or replace function private.propagate_crm_lead_family_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.access_scope <> 'cofounders'
    or (tg_op = 'UPDATE' and old.access_scope = 'cofounders') then
    return new;
  end if;

  if new.company_id is not null then
    update public.crm_companies
    set access_scope = 'cofounders'
    where id = new.company_id
      and organization_id = new.organization_id
      and access_scope <> 'cofounders';
  end if;

  if new.contact_id is not null then
    update public.crm_contacts
    set access_scope = 'cofounders'
    where id = new.contact_id
      and organization_id = new.organization_id
      and access_scope <> 'cofounders';
  end if;

  update public.crm_tasks
  set access_scope = 'cofounders'
  where lead_id = new.id
    and organization_id = new.organization_id
    and access_scope <> 'cofounders';

  return new;
end;
$$;

revoke execute on function private.propagate_crm_lead_family_scope()
from public, anon, authenticated, service_role;

drop trigger if exists propagate_crm_lead_family_scope_trigger
on public.crm_leads;
create trigger propagate_crm_lead_family_scope_trigger
after insert or update on public.crm_leads
for each row execute function private.propagate_crm_lead_family_scope();

-- Changing a status/category or tag to cofounders immediately and durably
-- escalates every active linked lead. Renaming a confidential category/status
-- also applies the scope to the new status key.
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
after insert or update
on public.crm_categories
for each row execute function private.propagate_crm_classifier_scope();

drop trigger if exists propagate_crm_classifier_scope_trigger
on public.crm_tags;
create trigger propagate_crm_classifier_scope_trigger
after insert or update on public.crm_tags
for each row execute function private.propagate_crm_classifier_scope();

-- A confidential tag cannot be attached while leaving its target public. The
-- BEFORE boundary below validates tenant and active-row consistency even for
-- service-role writes (which bypass RLS) before this AFTER trigger runs.
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
    select lead.organization_id
    into parent_organization_id
    from public.crm_leads lead
    where lead.id = new.lead_id
      and lead.archived_at is null;
  elsif tg_table_name = 'crm_contact_tags' then
    select contact.organization_id
    into parent_organization_id
    from public.crm_contacts contact
    where contact.id = new.contact_id
      and contact.archived_at is null;
  elsif tg_table_name = 'crm_task_tags' then
    select task.organization_id
    into parent_organization_id
    from public.crm_tasks task
    where task.id = new.task_id
      and task.archived_at is null;
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

drop trigger if exists enforce_crm_tag_relation_boundary_trigger
on public.crm_lead_tags;
create trigger enforce_crm_tag_relation_boundary_trigger
before insert or update on public.crm_lead_tags
for each row execute function private.enforce_crm_tag_relation_boundary();

drop trigger if exists enforce_crm_tag_relation_boundary_trigger
on public.crm_contact_tags;
create trigger enforce_crm_tag_relation_boundary_trigger
before insert or update on public.crm_contact_tags
for each row execute function private.enforce_crm_tag_relation_boundary();

drop trigger if exists enforce_crm_tag_relation_boundary_trigger
on public.crm_task_tags;
create trigger enforce_crm_tag_relation_boundary_trigger
before insert or update on public.crm_task_tags
for each row execute function private.enforce_crm_tag_relation_boundary();

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

  select tag.access_scope
  into tag_scope
  from public.crm_tags tag
  where tag.id = new.tag_id
    and tag.archived_at is null;

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

drop trigger if exists propagate_crm_tag_relation_scope_trigger
on public.crm_lead_tags;
create trigger propagate_crm_tag_relation_scope_trigger
after insert or update of tag_id, archived_at on public.crm_lead_tags
for each row execute function private.propagate_crm_tag_relation_scope();

drop trigger if exists propagate_crm_tag_relation_scope_trigger
on public.crm_contact_tags;
create trigger propagate_crm_tag_relation_scope_trigger
after insert or update of tag_id, archived_at on public.crm_contact_tags
for each row execute function private.propagate_crm_tag_relation_scope();

drop trigger if exists propagate_crm_tag_relation_scope_trigger
on public.crm_task_tags;
create trigger propagate_crm_tag_relation_scope_trigger
after insert or update of tag_id, archived_at on public.crm_task_tags
for each row execute function private.propagate_crm_tag_relation_scope();

-- Backfill leads missed by the first migration because categories and tags were
-- classified after the lead backfill. The triggers above escalate each family.
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

-- Existing sensitive notes/follow-ups must classify their parent too. If a
-- lead is currently assigned to a non-founder, the assignee trigger aborts
-- this whole additive migration instead of committing a partially hardened
-- state; the preceding immutable migration remains fully intact.
update public.crm_leads lead
set access_scope = 'cofounders'
where lead.archived_at is null
  and lead.access_scope <> 'cofounders'
  and (
    exists (
      select 1
      from public.crm_lead_notes note
      where note.lead_id = lead.id
        and note.organization_id = lead.organization_id
        and private.crm_text_requires_cofounder(note.content)
    )
    or exists (
      select 1
      from public.crm_lead_follow_ups follow_up
      where follow_up.lead_id = lead.id
        and follow_up.organization_id = lead.organization_id
        and private.crm_text_requires_cofounder(follow_up.comment)
    )
  );

do $child_assignee_preflight$
begin
  if exists (
    select 1
    from public.crm_lead_notes note
    join public.crm_leads lead
      on lead.id = note.lead_id
     and lead.organization_id = note.organization_id
    where lead.archived_at is null
      and lead.access_scope = 'cofounders'
      and note.assigned_to_profile_id is not null
      and not private.is_crm_cofounder_profile(
        note.organization_id,
        note.assigned_to_profile_id
      )
  ) then
    raise exception 'CRM confidentiality preflight: a confidential note is assigned to a non-cofounder';
  end if;
end
$child_assignee_preflight$;

-- Transactional manual creation API. PostgreSQL executes a function call in a
-- single transaction: any validation or RLS-style authorization exception
-- rolls back company/contact enrichment, lead insertion and tag relations.
-- SECURITY DEFINER is required for service-role bridge calls, so every actor,
-- tenant, related row and scope is revalidated explicitly before the first
-- write. The function is exposed only to authenticated and service_role.
create or replace function public.create_crm_lead_atomic(
  requested_organization_id uuid,
  requested_actor_profile_id uuid,
  requested_topic text,
  requested_company_id uuid default null,
  requested_company_name text default null,
  requested_contact_id uuid default null,
  requested_contact_email text default null,
  requested_contact_name text default null,
  requested_contact_phone text default null,
  requested_source text default null,
  requested_status text default 'lead-to-contact',
  requested_notes text default null,
  requested_next_action text default null,
  requested_lead_date timestamptz default null,
  requested_contact_job_title text default null,
  requested_contact_linkedin_url text default null,
  requested_assigned_to_profile_id uuid default null,
  requested_tag_ids uuid[] default '{}'::uuid[],
  requested_tag_names text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_is_cofounder boolean;
  actor_role text;
  company_id_value uuid := requested_company_id;
  company_name_value text := nullif(btrim(requested_company_name), '');
  company_scope text;
  contact_id_value uuid := requested_contact_id;
  contact_company_id uuid;
  contact_scope text;
  final_scope text := 'organization';
  lead_id_value uuid;
  normalized_tag_ids uuid[];
  normalized_tag_names text[];
  tag_id_value uuid;
  tag_name_value text;
begin
  if requested_organization_id is null
    or requested_actor_profile_id is null
    or nullif(btrim(requested_topic), '') is null
    or nullif(btrim(requested_status), '') is null then
    raise exception 'CRM lead payload is incomplete' using errcode = '22023';
  end if;

  if (select auth.uid()) is not null
    and (select auth.uid()) <> requested_actor_profile_id then
    raise exception 'CRM actor does not match the authenticated user'
      using errcode = '42501';
  end if;

  select membership.role,
    private.is_crm_cofounder_profile(
      requested_organization_id,
      requested_actor_profile_id
    )
  into actor_role, actor_is_cofounder
  from public.organization_memberships membership
  join auth.users user_record on user_record.id = membership.profile_id
  where membership.organization_id = requested_organization_id
    and membership.profile_id = requested_actor_profile_id
  for update of membership, user_record;

  if not found or actor_role not in ('owner', 'admin', 'member') then
    raise exception 'CRM actor is not an active contributor in this organization'
      using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct tag_id order by tag_id), '{}'::uuid[])
  into normalized_tag_ids
  from unnest(coalesce(requested_tag_ids, '{}'::uuid[])) tag_id;

  select coalesce(array_agg(distinct tag_name order by tag_name), '{}'::text[])
  into normalized_tag_names
  from (
    select nullif(btrim(tag_name), '') as tag_name
    from unnest(coalesce(requested_tag_names, '{}'::text[])) tag_name
  ) normalized
  where tag_name is not null;

  if exists (
    select 1
    from unnest(normalized_tag_ids) requested_tag_id
    where not exists (
      select 1
      from public.crm_tags tag
      where tag.id = requested_tag_id
        and tag.organization_id = requested_organization_id
        and tag.archived_at is null
    )
  ) then
    raise exception 'CRM tag is missing, archived, or belongs to another organization'
      using errcode = '23514';
  end if;

  if company_id_value is not null then
    select company.name, company.access_scope
    into company_name_value, company_scope
    from public.crm_companies company
    where company.id = company_id_value
      and company.organization_id = requested_organization_id
      and company.archived_at is null;
    if not found then
      raise exception 'CRM company is missing, archived, or belongs to another organization'
        using errcode = '23514';
    end if;
  elsif company_name_value is not null then
    select company.id, company.access_scope
    into company_id_value, company_scope
    from public.crm_companies company
    where company.organization_id = requested_organization_id
      and company.archived_at is null
      and private.crm_normalize_match_text(company.name) =
        private.crm_normalize_match_text(company_name_value)
    order by company.created_at, company.id
    limit 1;
  end if;

  if contact_id_value is not null then
    select contact.company_id, contact.access_scope
    into contact_company_id, contact_scope
    from public.crm_contacts contact
    where contact.id = contact_id_value
      and contact.organization_id = requested_organization_id
      and contact.archived_at is null;
    if not found then
      raise exception 'CRM contact is missing, archived, or belongs to another organization'
        using errcode = '23514';
    end if;

    if company_id_value is null and contact_company_id is not null then
      company_id_value := contact_company_id;
      select company.name, company.access_scope
      into company_name_value, company_scope
      from public.crm_companies company
      where company.id = company_id_value
        and company.organization_id = requested_organization_id
        and company.archived_at is null;
      if not found then
        raise exception 'CRM contact references an unavailable company'
          using errcode = '23514';
      end if;
    elsif company_id_value is not null
      and contact_company_id is not null
      and contact_company_id <> company_id_value then
      raise exception 'CRM contact does not belong to the selected company'
        using errcode = '23514';
    end if;
  end if;

  if company_scope = 'cofounders'
    or contact_scope = 'cofounders'
    or private.crm_text_requires_cofounder(concat_ws(E'\n',
      requested_topic,
      requested_status,
      company_name_value,
      requested_contact_name,
      requested_contact_email,
      requested_contact_phone,
      requested_contact_job_title,
      requested_source,
      requested_notes,
      requested_next_action,
      array_to_string(normalized_tag_names, E'\n')
    ))
    or exists (
      select 1
      from public.crm_categories category
      where category.organization_id = requested_organization_id
        and category.status_key = requested_status
        and category.archived_at is null
        and category.access_scope = 'cofounders'
    )
    or exists (
      select 1
      from public.crm_tags tag
      where tag.id = any(normalized_tag_ids)
        and tag.organization_id = requested_organization_id
        and tag.archived_at is null
        and tag.access_scope = 'cofounders'
    )
    or exists (
      select 1
      from public.crm_tags tag
      where tag.organization_id = requested_organization_id
        and tag.archived_at is null
        and tag.access_scope = 'cofounders'
        and private.crm_normalize_match_text(tag.name) = any (
          select private.crm_normalize_match_text(tag_name)
          from unnest(normalized_tag_names) tag_name
        )
    ) then
    final_scope := 'cofounders';
  end if;

  -- Fail before the first write. This is the decisive no-partial-write guard
  -- for a non-founder attempting to create a sensitive lead family.
  if final_scope = 'cofounders' and not actor_is_cofounder then
    raise exception 'Only a cofounder may create a confidential CRM lead family'
      using errcode = '42501';
  end if;

  if requested_assigned_to_profile_id is not null and not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = requested_organization_id
      and membership.profile_id = requested_assigned_to_profile_id
  ) then
    raise exception 'CRM assignee is not a member of this organization'
      using errcode = '23514';
  end if;

  if final_scope = 'cofounders'
    and requested_assigned_to_profile_id is not null
    and not private.is_crm_cofounder_profile(
      requested_organization_id,
      requested_assigned_to_profile_id
    ) then
    raise exception 'A confidential CRM lead cannot be assigned to a non-cofounder'
      using errcode = '42501';
  end if;

  if company_id_value is null and company_name_value is not null then
    insert into public.crm_companies (
      organization_id,
      name,
      access_scope,
      created_by_profile_id
    ) values (
      requested_organization_id,
      company_name_value,
      final_scope,
      requested_actor_profile_id
    )
    returning id into company_id_value;
  elsif company_id_value is not null and final_scope = 'cofounders' then
    update public.crm_companies
    set access_scope = 'cofounders'
    where id = company_id_value
      and organization_id = requested_organization_id
      and access_scope <> 'cofounders';
  end if;

  if contact_id_value is null
    and company_id_value is not null
    and nullif(btrim(requested_contact_name), '') is not null then
    select contact.id, contact.access_scope
    into contact_id_value, contact_scope
    from public.crm_contacts contact
    where contact.organization_id = requested_organization_id
      and contact.company_id = company_id_value
      and contact.archived_at is null
      and private.crm_normalize_match_text(contact.name) =
        private.crm_normalize_match_text(requested_contact_name)
    order by contact.created_at, contact.id
    limit 1;
  end if;

  if contact_id_value is null
    and company_id_value is not null
    and nullif(btrim(requested_contact_name), '') is not null then
    insert into public.crm_contacts (
      organization_id,
      company_id,
      name,
      email,
      phone,
      job_title,
      linkedin_url,
      access_scope,
      created_by_profile_id
    ) values (
      requested_organization_id,
      company_id_value,
      btrim(requested_contact_name),
      nullif(btrim(requested_contact_email), ''),
      nullif(btrim(requested_contact_phone), ''),
      nullif(btrim(requested_contact_job_title), ''),
      nullif(btrim(requested_contact_linkedin_url), ''),
      final_scope,
      requested_actor_profile_id
    )
    returning id into contact_id_value;
  elsif contact_id_value is not null then
    update public.crm_contacts
    set email = case
          when email is null then nullif(btrim(requested_contact_email), '')
          else email
        end,
        phone = case
          when phone is null then nullif(btrim(requested_contact_phone), '')
          else phone
        end,
        job_title = case
          when job_title is null then nullif(btrim(requested_contact_job_title), '')
          else job_title
        end,
        linkedin_url = case
          when linkedin_url is null then nullif(btrim(requested_contact_linkedin_url), '')
          else linkedin_url
        end,
        access_scope = case
          when final_scope = 'cofounders' then 'cofounders'
          else access_scope
        end
    where id = contact_id_value
      and organization_id = requested_organization_id;
  end if;

  -- Resolve or create requested tag names inside this same transaction. This
  -- prevents a rejected lead from leaving a pre-created orphan tag behind.
  foreach tag_name_value in array normalized_tag_names
  loop
    select tag.id
    into tag_id_value
    from public.crm_tags tag
    where tag.organization_id = requested_organization_id
      and tag.archived_at is null
      and private.crm_normalize_match_text(tag.name) =
        private.crm_normalize_match_text(tag_name_value)
    order by tag.created_at, tag.id
    limit 1;

    if not found then
      insert into public.crm_tags (
        organization_id,
        name,
        color,
        access_scope
      ) values (
        requested_organization_id,
        tag_name_value,
        'teal',
        final_scope
      )
      returning id into tag_id_value;
    end if;

    normalized_tag_ids := array_append(normalized_tag_ids, tag_id_value);
  end loop;

  select coalesce(array_agg(distinct tag_id order by tag_id), '{}'::uuid[])
  into normalized_tag_ids
  from unnest(normalized_tag_ids) tag_id;

  insert into public.crm_leads (
    organization_id,
    topic,
    company_id,
    contact_id,
    source,
    status,
    notes,
    next_action,
    lead_date,
    contact_job_title,
    contact_linkedin_url,
    assigned_to_profile_id,
    last_updated_by_profile_id,
    last_updated_at,
    created_by_profile_id,
    access_scope
  ) values (
    requested_organization_id,
    btrim(requested_topic),
    company_id_value,
    contact_id_value,
    nullif(btrim(requested_source), ''),
    btrim(requested_status),
    nullif(requested_notes, ''),
    nullif(btrim(requested_next_action), ''),
    requested_lead_date,
    nullif(btrim(requested_contact_job_title), ''),
    nullif(btrim(requested_contact_linkedin_url), ''),
    requested_assigned_to_profile_id,
    requested_actor_profile_id,
    now(),
    requested_actor_profile_id,
    final_scope
  )
  returning id, access_scope into lead_id_value, final_scope;

  insert into public.crm_lead_tags (lead_id, tag_id, archived_at)
  select lead_id_value, tag_id, null
  from unnest(normalized_tag_ids) tag_id
  on conflict (lead_id, tag_id) do update
    set archived_at = null;

  -- Re-read after every trigger has run. This closes races where a category or
  -- tag becomes confidential after the preflight but before its statement and
  -- guarantees a non-founder never commits a newly escalated family.
  select lead.access_scope
  into final_scope
  from public.crm_leads lead
  where lead.id = lead_id_value
    and lead.organization_id = requested_organization_id
    and lead.archived_at is null;

  if final_scope = 'cofounders' and not actor_is_cofounder then
    raise exception 'Only a cofounder may create a confidential CRM lead family'
      using errcode = '42501';
  end if;

  if final_scope = 'cofounders' and (
    (company_id_value is not null and exists (
      select 1 from public.crm_companies company
      where company.id = company_id_value
        and company.access_scope <> 'cofounders'
    ))
    or (contact_id_value is not null and exists (
      select 1 from public.crm_contacts contact
      where contact.id = contact_id_value
        and contact.access_scope <> 'cofounders'
    ))
  ) then
    raise exception 'Confidential CRM family propagation did not converge'
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'access_scope', final_scope,
    'company_id', company_id_value,
    'contact_id', contact_id_value,
    'lead_id', lead_id_value
  );
end;
$$;

revoke execute on function public.create_crm_lead_atomic(
  uuid, uuid, text, uuid, text, uuid, text, text, text, text, text, text,
  text, timestamptz, text, text, uuid, uuid[], text[]
) from public, anon;
grant execute on function public.create_crm_lead_atomic(
  uuid, uuid, text, uuid, text, uuid, text, text, text, text, text, text,
  text, timestamptz, text, text, uuid, uuid[], text[]
) to authenticated, service_role;

-- Replace a lead's active tag set without hard-deleting a junction row. The
-- entire archive/revive operation is atomic, tenant checked and revalidates a
-- possible confidentiality escalation before it can commit.
create or replace function public.replace_crm_lead_tags_atomic(
  requested_organization_id uuid,
  requested_actor_profile_id uuid,
  requested_lead_id uuid,
  requested_tag_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_is_cofounder boolean;
  final_scope text;
  normalized_tag_ids uuid[];
  resolved_actor_role text;
begin
  if requested_organization_id is null
    or requested_actor_profile_id is null
    or requested_lead_id is null then
    raise exception 'CRM tag replacement payload is incomplete'
      using errcode = '22023';
  end if;

  if (select auth.uid()) is not null
    and (select auth.uid()) <> requested_actor_profile_id then
    raise exception 'CRM actor does not match the authenticated user'
      using errcode = '42501';
  end if;

  select membership.role,
    private.is_crm_cofounder_profile(
      requested_organization_id,
      requested_actor_profile_id
    )
  into resolved_actor_role, actor_is_cofounder
  from public.organization_memberships membership
  join auth.users user_record on user_record.id = membership.profile_id
  where membership.organization_id = requested_organization_id
    and membership.profile_id = requested_actor_profile_id;

  if not found or resolved_actor_role not in ('owner', 'admin', 'member') then
    raise exception 'CRM actor cannot replace lead tags in this organization'
      using errcode = '42501';
  end if;

  select lead.access_scope
  into final_scope
  from public.crm_leads lead
  where lead.id = requested_lead_id
    and lead.organization_id = requested_organization_id
    and lead.archived_at is null;

  if not found then
    raise exception 'CRM lead is missing, archived, or belongs to another organization'
      using errcode = '23514';
  end if;

  if final_scope = 'cofounders' and not actor_is_cofounder then
    raise exception 'Only a cofounder may replace tags on a confidential lead'
      using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct tag_id order by tag_id), '{}'::uuid[])
  into normalized_tag_ids
  from unnest(coalesce(requested_tag_ids, '{}'::uuid[])) tag_id;

  if exists (
    select 1
    from unnest(normalized_tag_ids) requested_tag_id
    where not exists (
      select 1
      from public.crm_tags tag
      where tag.id = requested_tag_id
        and tag.organization_id = requested_organization_id
        and tag.archived_at is null
    )
  ) then
    raise exception 'CRM tag is missing, archived, or belongs to another organization'
      using errcode = '23514';
  end if;

  if not actor_is_cofounder and exists (
    select 1
    from public.crm_tags tag
    where tag.id = any(normalized_tag_ids)
      and tag.organization_id = requested_organization_id
      and tag.archived_at is null
      and tag.access_scope = 'cofounders'
  ) then
    raise exception 'Only a cofounder may attach a confidential CRM tag'
      using errcode = '42501';
  end if;

  update public.crm_lead_tags relation
  set archived_at = now()
  where relation.lead_id = requested_lead_id
    and relation.archived_at is null
    and not (relation.tag_id = any(normalized_tag_ids));

  insert into public.crm_lead_tags (lead_id, tag_id, archived_at)
  select requested_lead_id, tag_id, null
  from unnest(normalized_tag_ids) tag_id
  on conflict (lead_id, tag_id) do update
    set archived_at = null;

  select lead.access_scope
  into final_scope
  from public.crm_leads lead
  where lead.id = requested_lead_id
    and lead.organization_id = requested_organization_id
    and lead.archived_at is null;

  if not found
    or (final_scope = 'cofounders' and not actor_is_cofounder) then
    raise exception 'CRM lead became unavailable during tag replacement'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'access_scope', final_scope,
    'active_tag_count', cardinality(normalized_tag_ids),
    'lead_id', requested_lead_id
  );
end;
$$;

revoke execute on function public.replace_crm_lead_tags_atomic(
  uuid, uuid, uuid, uuid[]
) from public, anon;
grant execute on function public.replace_crm_lead_tags_atomic(
  uuid, uuid, uuid, uuid[]
) to authenticated, service_role;

-- Cookie-authenticated web approvals use the same durable single-use ledger
-- as Slack. auth.uid() is the authority: a token bound to another actor or
-- organization cannot be claimed, shared, or replayed concurrently.
create or replace function public.claim_naia_web_action(
  requested_token_hash text,
  requested_organization_id uuid,
  requested_actor_profile_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_actor_role text;
begin
  if requested_token_hash !~ '^[0-9a-f]{64}$'
    or requested_organization_id is null
    or requested_actor_profile_id is null
    or (select auth.uid()) is null
    or (select auth.uid()) <> requested_actor_profile_id then
    raise exception 'Invalid web approval claim' using errcode = '42501';
  end if;

  select membership.role
  into resolved_actor_role
  from public.organization_memberships membership
  join auth.users user_record on user_record.id = membership.profile_id
  where membership.organization_id = requested_organization_id
    and membership.profile_id = requested_actor_profile_id
  for update of membership, user_record;

  if not found
    or resolved_actor_role not in ('owner', 'admin', 'member', 'viewer') then
    raise exception 'Web approval actor is no longer active in this organization'
      using errcode = '42501';
  end if;

  insert into public.naia_consumed_action_tokens (
    token_hash,
    organization_id,
    actor_profile_id
  ) values (
    requested_token_hash,
    requested_organization_id,
    requested_actor_profile_id
  );

  return resolved_actor_role;
end;
$$;

revoke execute on function public.claim_naia_web_action(text, uuid, uuid)
from public, anon, service_role;
grant execute on function public.claim_naia_web_action(text, uuid, uuid)
to authenticated;

-- The bridge claims a token and revalidates the current actor/organization and
-- optional CRM record in one transaction. A stale role, removed membership,
-- archived lead, cross-tenant ID or confidential lead/non-founder combination
-- fails before the token claim and before any provider or CRM side effect.
create or replace function public.claim_crm_bridge_action(
  requested_token_hash text,
  requested_organization_id uuid,
  requested_actor_profile_id uuid,
  requested_actor_email text,
  requested_crm_lead_id uuid default null
)
returns table (
  actor_role text,
  actor_is_cofounder boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_actor_role text;
  current_is_cofounder boolean;
  lead_scope text;
begin
  if requested_token_hash !~ '^[0-9a-f]{64}$'
    or requested_organization_id is null
    or requested_actor_profile_id is null
    or nullif(lower(btrim(requested_actor_email)), '') is null then
    raise exception 'Invalid bridge claim payload' using errcode = '22023';
  end if;

  select membership.role,
    lower(user_record.email) in ('ali@qarizmi.com', 'nabil@qarizmi.com')
  into resolved_actor_role, current_is_cofounder
  from public.organization_memberships membership
  join auth.users user_record on user_record.id = membership.profile_id
  where membership.organization_id = requested_organization_id
    and membership.profile_id = requested_actor_profile_id
    and lower(user_record.email) = lower(btrim(requested_actor_email))
  for update of membership, user_record;

  if not found or resolved_actor_role not in ('owner', 'admin', 'member', 'viewer') then
    raise exception 'Bridge actor is no longer active in this organization'
      using errcode = '42501';
  end if;

  if requested_crm_lead_id is not null then
    select lead.access_scope
    into lead_scope
    from public.crm_leads lead
    where lead.id = requested_crm_lead_id
      and lead.organization_id = requested_organization_id
      and lead.archived_at is null
    for update;

    if not found then
      raise exception 'Bridge CRM lead is missing, archived, or cross-organization'
        using errcode = '42501';
    end if;

    if lead_scope = 'cofounders' and not current_is_cofounder then
      raise exception 'Bridge actor cannot access this confidential CRM lead'
        using errcode = '42501';
    end if;
  end if;

  insert into public.naia_consumed_action_tokens (
    token_hash,
    organization_id,
    actor_profile_id
  ) values (
    requested_token_hash,
    requested_organization_id,
    requested_actor_profile_id
  );

  return query select resolved_actor_role, current_is_cofounder;
end;
$$;

revoke execute on function public.claim_crm_bridge_action(
  text, uuid, uuid, text, uuid
) from public, anon, authenticated;
grant execute on function public.claim_crm_bridge_action(
  text, uuid, uuid, text, uuid
) to service_role;

-- Status execution combines token claim, current authorization, target-scope
-- validation and the CRM update in one transaction. This removes the race that
-- would exist if a service-role action claimed first and updated an archived or
-- newly confidential lead in a later PostgREST request.
create or replace function public.execute_crm_bridge_lead_status_action(
  requested_token_hash text,
  requested_organization_id uuid,
  requested_actor_profile_id uuid,
  requested_actor_email text,
  requested_crm_lead_id uuid,
  requested_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_actor_role text;
  current_is_cofounder boolean;
  final_scope text;
begin
  if nullif(btrim(requested_status), '') is null then
    raise exception 'Invalid CRM status' using errcode = '22023';
  end if;

  select claim.actor_role, claim.actor_is_cofounder
  into resolved_actor_role, current_is_cofounder
  from public.claim_crm_bridge_action(
    requested_token_hash,
    requested_organization_id,
    requested_actor_profile_id,
    requested_actor_email,
    requested_crm_lead_id
  ) claim;

  if resolved_actor_role not in ('owner', 'admin', 'member') then
    raise exception 'Bridge actor cannot update CRM leads'
      using errcode = '42501';
  end if;

  if not current_is_cofounder and exists (
    select 1
    from public.crm_categories category
    where category.organization_id = requested_organization_id
      and category.status_key = btrim(requested_status)
      and category.archived_at is null
      and category.access_scope = 'cofounders'
  ) then
    raise exception 'Bridge actor cannot move a lead into a confidential status'
      using errcode = '42501';
  end if;

  update public.crm_leads
  set status = btrim(requested_status),
      last_updated_by_profile_id = requested_actor_profile_id,
      last_updated_at = now(),
      updated_at = now()
  where id = requested_crm_lead_id
    and organization_id = requested_organization_id
    and archived_at is null
  returning access_scope into final_scope;

  if not found then
    raise exception 'Bridge CRM lead changed or became unavailable'
      using errcode = '42501';
  end if;

  if final_scope = 'cofounders' and not current_is_cofounder then
    raise exception 'Bridge actor cannot update a confidential CRM lead'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'actor_role', resolved_actor_role,
    'access_scope', final_scope,
    'lead_id', requested_crm_lead_id,
    'status', btrim(requested_status)
  );
end;
$$;

revoke execute on function public.execute_crm_bridge_lead_status_action(
  text, uuid, uuid, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.execute_crm_bridge_lead_status_action(
  text, uuid, uuid, text, uuid, text
) to service_role;
