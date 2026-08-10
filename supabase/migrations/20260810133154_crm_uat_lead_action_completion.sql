-- CRM UAT: a lead's next-action completion is independent from its pipeline
-- stage, and its task projection is explicit rather than inferred at read time.
--
-- This migration is deliberately data preserving:
--   * no CRM row or relation is physically removed;
--   * legacy/manual tasks are left untouched unless they exactly match the
--     historical generated-task shape;
--   * a lead completion never writes status or pipeline_position;
--   * Trello Ali/Nabil labels are converted through trusted natural keys, not
--     hard-coded local profile UUIDs.

alter table public.crm_leads
  add column if not exists next_action_state text default 'pending',
  add column if not exists next_action_completed_at timestamptz,
  add column if not exists next_action_completed_by_profile_id uuid;

update public.crm_leads
set next_action_state = 'pending'
where next_action_state is null;

alter table public.crm_leads
  alter column next_action_state set default 'pending',
  alter column next_action_state set not null;

do $constraints$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = 'public.crm_leads'::regclass
      and constraint_record.conname =
        'crm_leads_next_action_completed_by_profile_fk'
  ) then
    alter table public.crm_leads
      add constraint crm_leads_next_action_completed_by_profile_fk
      foreign key (next_action_completed_by_profile_id)
      references public.profiles (id)
      on delete set null;
  end if;
end
$constraints$;

alter table public.crm_leads
  drop constraint if exists crm_leads_next_action_state_check,
  drop constraint if exists crm_leads_next_action_completion_shape_check;

alter table public.crm_leads
  add constraint crm_leads_next_action_state_check
    check (next_action_state in ('pending', 'done')),
  add constraint crm_leads_next_action_completion_shape_check
    check (
      next_action_state = 'done'
      or (
        next_action_completed_at is null
        and next_action_completed_by_profile_id is null
      )
    );

alter table public.crm_tasks
  add column if not exists task_kind text default 'manual';

update public.crm_tasks
set task_kind = 'manual'
where task_kind is null;

alter table public.crm_tasks
  alter column task_kind set default 'manual',
  alter column task_kind set not null;

alter table public.crm_tasks
  drop constraint if exists crm_tasks_task_kind_check,
  drop constraint if exists crm_tasks_lead_next_action_shape_check;

alter table public.crm_tasks
  add constraint crm_tasks_task_kind_check
    check (task_kind in (
      'manual',
      'lead-next-action',
      'meeting-recommendation'
    )),
  add constraint crm_tasks_lead_next_action_shape_check
    check (
      task_kind <> 'lead-next-action'
      or (
        lead_id is not null
        and meeting_action_execution_id is null
      )
    );

-- A meeting execution is an explicit, durable provenance marker. Classifying
-- those tasks does not change their status, assignment, timestamps or scope.
update public.crm_tasks
set task_kind = 'meeting-recommendation'
where task_kind = 'manual'
  and meeting_action_execution_id is not null;

-- Historical lead-task generation had no provenance column. Its stable
-- signature is an active TODO linked to a live same-tenant lead, with no
-- meeting execution and the generated description prefix. Title, due date and
-- assignee are deliberately not compared because those projection fields may
-- have drifted; linked tasks without this signature remain manual.
update public.crm_tasks task
set task_kind = 'lead-next-action'
from public.crm_leads lead
where task.task_kind = 'manual'
  and task.archived_at is null
  and task.meeting_action_execution_id is null
  and task.lead_id = lead.id
  and task.organization_id = lead.organization_id
  and lead.archived_at is null
  and nullif(btrim(lead.next_action), '') is not null
  and task.status = 'todo'
  and task.description like 'Tâche de suivi pour le lead:%'
  and not exists (
    select 1
    from public.crm_tasks active_projection
    where active_projection.organization_id = task.organization_id
      and active_projection.lead_id = task.lead_id
      and active_projection.task_kind = 'lead-next-action'
      and active_projection.archived_at is null
  );

-- A partially deployed revision may already have more than one active
-- projection. Preserve the most recently maintained row and soft-archive all
-- older projections before installing the uniqueness boundary.
with ranked_projections as (
  select
    task.id,
    row_number() over (
      partition by task.organization_id, task.lead_id
      order by task.updated_at desc, task.created_at desc, task.id
    ) as projection_rank
  from public.crm_tasks task
  where task.task_kind = 'lead-next-action'
    and task.archived_at is null
)
update public.crm_tasks task
set archived_at = now(),
    updated_at = now()
from ranked_projections ranked
where ranked.id = task.id
  and ranked.projection_rank > 1;

create unique index if not exists crm_tasks_active_lead_next_action_unique_idx
  on public.crm_tasks (organization_id, lead_id)
  where task_kind = 'lead-next-action'
    and archived_at is null;

create index if not exists crm_leads_pending_next_action_due_idx
  on public.crm_leads (
    organization_id,
    next_action_state,
    lead_date,
    next_action_date
  )
  where archived_at is null
    and next_action_state = 'pending'
    and next_action is not null;

-- Completion metadata is canonicalized for every write, including direct
-- table updates. Authenticated transitions record the authenticated actor;
-- service-role/import backfills may intentionally retain a null timestamp and
-- actor when the source does not provide trustworthy completion metadata.
create or replace function private.guard_crm_lead_next_action_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  action_changed boolean := false;
  authenticated_profile_id uuid := (select auth.uid());
begin
  if tg_op = 'UPDATE' then
    action_changed :=
      old.next_action is distinct from new.next_action
      or old.lead_date is distinct from new.lead_date
      or old.next_action_date is distinct from new.next_action_date;
  end if;

  if action_changed
    or (
      nullif(btrim(new.next_action), '') is null
      and new.lead_date is null
      and new.next_action_date is null
    ) then
    new.next_action_state := 'pending';
    new.next_action_completed_at := null;
    new.next_action_completed_by_profile_id := null;
    return new;
  end if;

  if new.next_action_state = 'pending' then
    new.next_action_completed_at := null;
    new.next_action_completed_by_profile_id := null;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if authenticated_profile_id is not null then
      new.next_action_completed_at := now();
      new.next_action_completed_by_profile_id := authenticated_profile_id;
    end if;
    return new;
  end if;

  if old.next_action_state is distinct from new.next_action_state then
    if authenticated_profile_id is not null then
      new.next_action_completed_at := now();
      new.next_action_completed_by_profile_id := authenticated_profile_id;
    end if;
  else
    -- Completion evidence is immutable until the state itself changes.
    new.next_action_completed_at := old.next_action_completed_at;
    new.next_action_completed_by_profile_id :=
      old.next_action_completed_by_profile_id;
  end if;

  return new;
end;
$$;

revoke execute on function private.guard_crm_lead_next_action_completion()
from public, anon, authenticated, service_role;

drop trigger if exists guard_crm_lead_next_action_completion_trigger
on public.crm_leads;
create trigger guard_crm_lead_next_action_completion_trigger
before insert or update of
  next_action,
  next_action_date,
  lead_date,
  next_action_state,
  next_action_completed_at,
  next_action_completed_by_profile_id
on public.crm_leads
for each row execute function private.guard_crm_lead_next_action_completion();

-- Keep exactly one lead-next-action task as a projection of the lead. Manual
-- and meeting-recommendation tasks are never selected by this function.
create or replace function private.project_crm_lead_next_action_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  action_changed boolean := true;
  effective_due_date timestamptz;
  projection_id uuid;
  projection_status text;
begin
  if tg_op = 'UPDATE' then
    action_changed :=
      old.next_action is distinct from new.next_action
      or old.lead_date is distinct from new.lead_date
      or old.next_action_date is distinct from new.next_action_date;
  end if;

  if new.archived_at is not null
    or nullif(btrim(new.next_action), '') is null then
    update public.crm_tasks task
    set archived_at = coalesce(task.archived_at, now()),
        updated_at = now()
    where task.organization_id = new.organization_id
      and task.lead_id = new.id
      and task.task_kind = 'lead-next-action'
      and task.archived_at is null;
    return new;
  end if;

  effective_due_date := coalesce(
    new.lead_date,
    new.next_action_date::timestamp at time zone 'Africa/Casablanca'
  );

  select task.id, task.status
  into projection_id, projection_status
  from public.crm_tasks task
  where task.organization_id = new.organization_id
    and task.lead_id = new.id
    and task.task_kind = 'lead-next-action'
    and task.archived_at is null
  for update;

  if found then
    update public.crm_tasks task
    set title = btrim(new.next_action),
        description = 'Tâche de suivi pour le lead: ' || new.topic,
        status = case
          when new.next_action_state = 'done' then 'done'
          when action_changed or projection_status = 'done' then 'todo'
          else projection_status
        end,
        due_date = effective_due_date,
        assigned_to_profile_id = new.assigned_to_profile_id,
        access_scope = new.access_scope,
        updated_at = now()
    where task.id = projection_id;
    return new;
  end if;

  -- Prefer reviving one classified historical projection over creating a new
  -- row. Its previous status is intentionally reset from archived history.
  select task.id
  into projection_id
  from public.crm_tasks task
  where task.organization_id = new.organization_id
    and task.lead_id = new.id
    and task.task_kind = 'lead-next-action'
    and task.archived_at is not null
  order by task.updated_at desc, task.created_at desc, task.id
  limit 1
  for update;

  if found then
    update public.crm_tasks task
    set title = btrim(new.next_action),
        description = 'Tâche de suivi pour le lead: ' || new.topic,
        status = case
          when new.next_action_state = 'done' then 'done'
          else 'todo'
        end,
        due_date = effective_due_date,
        assigned_to_profile_id = new.assigned_to_profile_id,
        access_scope = new.access_scope,
        archived_at = null,
        updated_at = now()
    where task.id = projection_id;
    return new;
  end if;

  insert into public.crm_tasks (
    organization_id,
    title,
    description,
    status,
    due_date,
    lead_id,
    assigned_to_profile_id,
    created_by_profile_id,
    access_scope,
    task_kind
  ) values (
    new.organization_id,
    btrim(new.next_action),
    'Tâche de suivi pour le lead: ' || new.topic,
    case when new.next_action_state = 'done' then 'done' else 'todo' end,
    effective_due_date,
    new.id,
    new.assigned_to_profile_id,
    coalesce(new.last_updated_by_profile_id, new.created_by_profile_id),
    new.access_scope,
    'lead-next-action'
  );

  return new;
end;
$$;

revoke execute on function private.project_crm_lead_next_action_task()
from public, anon, authenticated, service_role;

drop trigger if exists project_crm_lead_next_action_task_trigger
on public.crm_leads;
create trigger project_crm_lead_next_action_task_trigger
after insert or update of
  next_action,
  next_action_date,
  lead_date,
  next_action_state,
  assigned_to_profile_id,
  access_scope,
  topic,
  organization_id,
  archived_at
on public.crm_leads
for each row execute function private.project_crm_lead_next_action_task();

-- Future reviewed Trello payloads may carry operational fields that are not
-- visible CRM tags. Apply them only when the external ref is attested by the
-- exact staging row, run and payload hash that created/updated the ref.
create or replace function private.apply_crm_trello_lead_operational_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  assigned_email text;
  assigned_profile_count integer;
  assigned_profile_id uuid;
  has_assigned_email boolean;
  has_next_action_state boolean;
  lead_row public.crm_leads%rowtype;
  requested_next_action_state text;
  staged_payload jsonb;
begin
  if new.provider <> 'trello'
    or new.external_type <> 'lead'
    or new.local_table <> 'crm_leads'
    or new.archived_at is not null then
    return new;
  end if;

  select staging.normalized_payload
  into staged_payload
  from public.crm_import_staging staging
  where staging.organization_id = new.organization_id
    and staging.run_id = new.last_run_id
    and staging.entity_type = 'lead'
    and staging.external_id = new.external_id
    and staging.payload_hash = new.source_hash
  for share;

  if not found then
    return new;
  end if;

  has_assigned_email := staged_payload ? 'assignedToEmail';
  has_next_action_state := staged_payload ? 'nextActionState';

  -- Legacy payloads intentionally remain a no-op.
  if not has_assigned_email and not has_next_action_state then
    return new;
  end if;

  if has_assigned_email then
    if jsonb_typeof(staged_payload -> 'assignedToEmail')
      is distinct from 'string' then
      raise exception 'Trello assignedToEmail must be a string'
        using errcode = '22023';
    end if;
    assigned_email := lower(btrim(staged_payload ->> 'assignedToEmail'));
    if assigned_email is null or assigned_email = '' then
      raise exception 'Trello assignedToEmail cannot be empty'
        using errcode = '22023';
    end if;

    select count(*)
    into assigned_profile_count
    from public.organization_memberships membership
    join auth.users user_record on user_record.id = membership.profile_id
    where membership.organization_id = new.organization_id
      and membership.role in ('owner', 'admin', 'member')
      and lower(user_record.email) = assigned_email;

    if assigned_profile_count <> 1 then
      raise exception 'Trello assignedToEmail does not resolve to exactly one active organization contributor'
        using errcode = '23514';
    end if;

    select membership.profile_id
    into assigned_profile_id
    from public.organization_memberships membership
    join auth.users user_record on user_record.id = membership.profile_id
    where membership.organization_id = new.organization_id
      and membership.role in ('owner', 'admin', 'member')
      and lower(user_record.email) = assigned_email;
  end if;

  if has_next_action_state then
    if jsonb_typeof(staged_payload -> 'nextActionState')
      is distinct from 'string' then
      raise exception 'Trello nextActionState must be a string'
        using errcode = '22023';
    end if;
    requested_next_action_state :=
      lower(btrim(staged_payload ->> 'nextActionState'));
    if requested_next_action_state not in ('pending', 'done') then
      raise exception 'Trello nextActionState is invalid'
        using errcode = '22023';
    end if;
  end if;

  select lead.*
  into lead_row
  from public.crm_leads lead
  where lead.id = new.local_id
    and lead.organization_id = new.organization_id
    and lead.archived_at is null
  for update;

  if not found then
    raise exception 'Trello lead ref points to a missing, archived, or cross-organization CRM lead'
      using errcode = '23514';
  end if;

  if has_assigned_email
    and lead_row.assigned_to_profile_id is not null
    and lead_row.assigned_to_profile_id <> assigned_profile_id then
    raise exception 'Trello assignedToEmail conflicts with the current CRM assignee'
      using errcode = '23514';
  end if;

  if has_next_action_state
    and requested_next_action_state = 'done'
    and nullif(btrim(lead_row.next_action), '') is null
    and lead_row.lead_date is null
    and lead_row.next_action_date is null then
    raise exception 'Trello cannot complete a CRM lead without an action or due date'
      using errcode = '23514';
  end if;

  if (has_assigned_email
      and lead_row.assigned_to_profile_id is distinct from assigned_profile_id)
    or (has_next_action_state
      and lead_row.next_action_state is distinct from
        requested_next_action_state) then
    update public.crm_leads lead
    set assigned_to_profile_id = case
          when has_assigned_email then assigned_profile_id
          else lead.assigned_to_profile_id
        end,
        next_action_state = case
          when has_next_action_state then requested_next_action_state
          else lead.next_action_state
        end,
        last_updated_by_profile_id = coalesce(
          (select auth.uid()),
          lead.last_updated_by_profile_id
        ),
        last_updated_at = now(),
        updated_at = now()
    where lead.id = new.local_id
      and lead.organization_id = new.organization_id
      and lead.archived_at is null;

    if not found then
      raise exception 'Trello CRM lead changed while operational fields were applied'
        using errcode = '40001';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function private.apply_crm_trello_lead_operational_fields()
from public, anon, authenticated, service_role;

drop trigger if exists apply_crm_trello_lead_operational_fields_trigger
on public.crm_external_refs;
create trigger apply_crm_trello_lead_operational_fields_trigger
after insert or update of source_hash, last_run_id, archived_at
on public.crm_external_refs
for each row execute function
  private.apply_crm_trello_lead_operational_fields();

-- Convert the two reviewed Trello assignment labels to canonical organization
-- members. Exact external IDs and exact auth.users emails are trusted natural
-- keys; local tag/profile UUIDs are resolved at migration time.
do $trello_assignment_backfill$
declare
  assignment_record record;
  target_profile_id uuid;
  target_profile_count integer;
begin
  -- Fail closed if a known assignment external ref points to an unexpected
  -- local object. Successfully archived refs are ignored on a repeated run.
  if exists (
    select 1
    from public.crm_external_refs ref
    join (
      values
        ('69de18c5a11891f0f0aae8f0', 'ali'),
        ('69de18c5a11891f0f0aae8ec', 'nabil')
    ) expected(external_id, expected_tag_name)
      on expected.external_id = ref.external_id
    left join public.crm_tags tag
      on tag.id = ref.local_id
      and tag.organization_id = ref.organization_id
    where ref.provider = 'trello'
      and ref.external_type = 'tag'
      and ref.local_table = 'crm_tags'
      and ref.archived_at is null
      and (
        tag.id is null
        or tag.archived_at is not null
        or private.crm_normalize_match_text(tag.name) <>
          expected.expected_tag_name
      )
  ) then
    raise exception 'Trello assignment label reference does not match its expected CRM tag'
      using errcode = '23514';
  end if;

  -- A card carrying both founder labels is ambiguous and must never be
  -- assigned by migration order.
  if exists (
    with assignment_refs as (
      select ref.organization_id, ref.local_id as tag_id, expected.actor_email
      from public.crm_external_refs ref
      join (
        values
          ('69de18c5a11891f0f0aae8f0', 'ali@qarizmi.com'),
          ('69de18c5a11891f0f0aae8ec', 'nabil@qarizmi.com')
      ) expected(external_id, actor_email)
        on expected.external_id = ref.external_id
      join public.crm_tags tag
        on tag.id = ref.local_id
        and tag.organization_id = ref.organization_id
        and tag.archived_at is null
      where ref.provider = 'trello'
        and ref.external_type = 'tag'
        and ref.local_table = 'crm_tags'
        and ref.archived_at is null
    )
    select 1
    from public.crm_lead_tags relation
    join public.crm_leads lead
      on lead.id = relation.lead_id
      and lead.archived_at is null
    join assignment_refs assignment
      on assignment.tag_id = relation.tag_id
      and assignment.organization_id = lead.organization_id
    where relation.archived_at is null
    group by relation.lead_id
    having count(distinct assignment.actor_email) > 1
  ) then
    raise exception 'A Trello lead has both Ali and Nabil assignment labels'
      using errcode = '23514';
  end if;

  for assignment_record in
    select
      ref.organization_id,
      ref.local_id as tag_id,
      expected.actor_email
    from public.crm_external_refs ref
    join (
      values
        ('69de18c5a11891f0f0aae8f0', 'ali@qarizmi.com'),
        ('69de18c5a11891f0f0aae8ec', 'nabil@qarizmi.com')
    ) expected(external_id, actor_email)
      on expected.external_id = ref.external_id
    join public.crm_tags tag
      on tag.id = ref.local_id
      and tag.organization_id = ref.organization_id
      and tag.archived_at is null
    where ref.provider = 'trello'
      and ref.external_type = 'tag'
      and ref.local_table = 'crm_tags'
      and ref.archived_at is null
      and exists (
        select 1
        from public.crm_lead_tags relation
        join public.crm_leads lead on lead.id = relation.lead_id
        where relation.tag_id = ref.local_id
          and relation.archived_at is null
          and lead.organization_id = ref.organization_id
          and lead.archived_at is null
      )
    order by ref.organization_id, expected.actor_email
  loop
    select count(*)
    into target_profile_count
    from public.organization_memberships membership
    join auth.users user_record
      on user_record.id = membership.profile_id
    where membership.organization_id = assignment_record.organization_id
      and membership.role in ('owner', 'admin', 'member')
      and lower(user_record.email) = assignment_record.actor_email;

    if target_profile_count <> 1 then
      raise exception 'Expected exactly one active organization member for Trello assignee %',
        assignment_record.actor_email
        using errcode = '23514';
    end if;

    select membership.profile_id
    into target_profile_id
    from public.organization_memberships membership
    join auth.users user_record
      on user_record.id = membership.profile_id
    where membership.organization_id = assignment_record.organization_id
      and membership.role in ('owner', 'admin', 'member')
      and lower(user_record.email) = assignment_record.actor_email;

    if exists (
      select 1
      from public.crm_lead_tags relation
      join public.crm_leads lead on lead.id = relation.lead_id
      where relation.tag_id = assignment_record.tag_id
        and relation.archived_at is null
        and lead.organization_id = assignment_record.organization_id
        and lead.archived_at is null
        and lead.assigned_to_profile_id is not null
        and lead.assigned_to_profile_id <> target_profile_id
    ) then
      raise exception 'Trello assignment label conflicts with an existing CRM assignee'
        using errcode = '23514';
    end if;

    update public.crm_leads lead
    set assigned_to_profile_id = target_profile_id,
        updated_at = now()
    from public.crm_lead_tags relation
    where relation.lead_id = lead.id
      and relation.tag_id = assignment_record.tag_id
      and relation.archived_at is null
      and lead.organization_id = assignment_record.organization_id
      and lead.archived_at is null
      and lead.assigned_to_profile_id is distinct from target_profile_id;
  end loop;

  update public.crm_lead_tags relation
  set archived_at = now()
  where relation.archived_at is null
    and exists (
      select 1
      from public.crm_external_refs ref
      where ref.provider = 'trello'
        and ref.external_type = 'tag'
        and ref.local_table = 'crm_tags'
        and ref.external_id in (
          '69de18c5a11891f0f0aae8f0',
          '69de18c5a11891f0f0aae8ec'
        )
        and ref.local_id = relation.tag_id
        and ref.archived_at is null
    );

  update public.crm_contact_tags relation
  set archived_at = now()
  where relation.archived_at is null
    and exists (
      select 1
      from public.crm_external_refs ref
      where ref.provider = 'trello'
        and ref.external_type = 'tag'
        and ref.local_table = 'crm_tags'
        and ref.external_id in (
          '69de18c5a11891f0f0aae8f0',
          '69de18c5a11891f0f0aae8ec'
        )
        and ref.local_id = relation.tag_id
        and ref.archived_at is null
    );

  update public.crm_task_tags relation
  set archived_at = now()
  where relation.archived_at is null
    and exists (
      select 1
      from public.crm_external_refs ref
      where ref.provider = 'trello'
        and ref.external_type = 'tag'
        and ref.local_table = 'crm_tags'
        and ref.external_id in (
          '69de18c5a11891f0f0aae8f0',
          '69de18c5a11891f0f0aae8ec'
        )
        and ref.local_id = relation.tag_id
        and ref.archived_at is null
    );

  update public.crm_tags tag
  set archived_at = now(),
      updated_at = now()
  where tag.archived_at is null
    and exists (
      select 1
      from public.crm_external_refs ref
      where ref.provider = 'trello'
        and ref.external_type = 'tag'
        and ref.local_table = 'crm_tags'
        and ref.external_id in (
          '69de18c5a11891f0f0aae8f0',
          '69de18c5a11891f0f0aae8ec'
        )
        and ref.organization_id = tag.organization_id
        and ref.local_id = tag.id
        and ref.archived_at is null
    );

  update public.crm_external_refs ref
  set archived_at = now(),
      updated_at = now()
  where ref.provider = 'trello'
    and ref.external_type = 'tag'
    and ref.local_table = 'crm_tags'
    and ref.external_id in (
      '69de18c5a11891f0f0aae8f0',
      '69de18c5a11891f0f0aae8ec'
    )
    and ref.archived_at is null;
end
$trello_assignment_backfill$;

-- Reconcile every current lead once. Updating only the new state column avoids
-- fabricating CRM activity timestamps while still invoking both new triggers.
update public.crm_leads
set next_action_state = next_action_state
where archived_at is null
   or exists (
     select 1
     from public.crm_tasks task
     where task.organization_id = crm_leads.organization_id
       and task.lead_id = crm_leads.id
       and task.task_kind = 'lead-next-action'
       and task.archived_at is null
   );

-- Completion is a dedicated atomic operation. The function is SECURITY
-- DEFINER only so the lead row and its projection can be changed as one unit;
-- it independently validates the authenticated actor, active membership,
-- tenant, archived state and confidentiality boundary before the first write.
create or replace function public.set_crm_lead_next_action_state(
  requested_organization_id uuid,
  requested_actor_profile_id uuid,
  requested_lead_id uuid,
  requested_state text,
  expected_next_action text default null,
  expected_due_date timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_is_cofounder boolean;
  actor_role text;
  effective_due_date timestamptz;
  lead_row public.crm_leads%rowtype;
  result_completed_at timestamptz;
  result_completed_by_profile_id uuid;
  result_state text;
begin
  if requested_organization_id is null
    or requested_actor_profile_id is null
    or requested_lead_id is null
    or requested_state is null
    or requested_state not in ('pending', 'done') then
    raise exception 'CRM next-action completion payload is invalid'
      using errcode = '22023';
  end if;

  if (select auth.uid()) is not null
    and (select auth.uid()) <> requested_actor_profile_id then
    raise exception 'CRM actor does not match the authenticated user'
      using errcode = '42501';
  end if;

  select
    membership.role,
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

  select lead.*
  into lead_row
  from public.crm_leads lead
  where lead.id = requested_lead_id
    and lead.organization_id = requested_organization_id
    and lead.archived_at is null
  for update;

  if not found then
    raise exception 'CRM lead is missing, archived, or belongs to another organization'
      using errcode = '23514';
  end if;

  if lead_row.access_scope = 'cofounders' and not actor_is_cofounder then
    raise exception 'Only a cofounder may update a confidential CRM lead family'
      using errcode = '42501';
  end if;

  if expected_next_action is not null
    and lead_row.next_action is distinct from expected_next_action then
    raise exception 'CRM next action changed while completion was requested'
      using errcode = '40001';
  end if;

  effective_due_date := coalesce(
    lead_row.lead_date,
    lead_row.next_action_date::timestamp at time zone 'Africa/Casablanca'
  );

  if expected_due_date is not null
    and effective_due_date is distinct from expected_due_date then
    raise exception 'CRM next-action due date changed while completion was requested'
      using errcode = '40001';
  end if;

  update public.crm_leads lead
  set next_action_state = requested_state,
      next_action_completed_at = case
        when requested_state = 'pending' then null
        when lead.next_action_state = 'done'
          then lead.next_action_completed_at
        else now()
      end,
      next_action_completed_by_profile_id = case
        when requested_state = 'pending' then null
        when lead.next_action_state = 'done'
          then lead.next_action_completed_by_profile_id
        else requested_actor_profile_id
      end,
      last_updated_by_profile_id = requested_actor_profile_id,
      last_updated_at = now(),
      updated_at = now()
  where lead.id = requested_lead_id
    and lead.organization_id = requested_organization_id
    and lead.archived_at is null
  returning
    lead.next_action_state,
    lead.next_action_completed_at,
    lead.next_action_completed_by_profile_id
  into
    result_state,
    result_completed_at,
    result_completed_by_profile_id;

  if not found then
    raise exception 'CRM lead changed while completion was being updated'
      using errcode = '40001';
  end if;

  return jsonb_build_object(
    'lead_id', requested_lead_id,
    'next_action_state', result_state,
    'next_action_completed_at', result_completed_at,
    'next_action_completed_by_profile_id',
      result_completed_by_profile_id
  );
end;
$$;

revoke execute on function public.set_crm_lead_next_action_state(
  uuid, uuid, uuid, text, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.set_crm_lead_next_action_state(
  uuid, uuid, uuid, text, text, timestamptz
) to authenticated, service_role;

-- UAT wrapper for canonical company/contact coordinates. Null email/phone
-- means "not supplied". Service/import calls without an authenticated actor
-- may only fill empty coordinates or repeat an equivalent value; authenticated
-- contributors remain free to correct or clear them under the normal RLS rules.
-- The existing atomic function remains the sole owner of lead/company/contact
-- linking and confidentiality checks; this wrapper adds the two structured
-- contact fields in the same transaction under normal RLS.
create or replace function public.update_crm_lead_uat_atomic(
  requested_organization_id uuid,
  requested_actor_profile_id uuid,
  requested_lead_id uuid,
  requested_updates jsonb,
  requested_company_name text default null,
  requested_contact_name text default null,
  requested_contact_email text default null,
  requested_contact_phone text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  contact_id_value uuid;
  existing_contact_email text;
  existing_contact_phone text;
  result_payload jsonb;
begin
  result_payload := public.update_crm_lead_atomic(
    requested_organization_id,
    requested_actor_profile_id,
    requested_lead_id,
    requested_updates,
    requested_company_name,
    requested_contact_name
  );

  contact_id_value := nullif(result_payload ->> 'contact_id', '')::uuid;

  if (requested_contact_email is not null
      or requested_contact_phone is not null)
    and contact_id_value is null then
    raise exception 'CRM contact coordinates require a canonical contact'
      using errcode = '23514';
  end if;

  if requested_contact_email is not null
    or requested_contact_phone is not null then
    select contact.email, contact.phone
    into existing_contact_email, existing_contact_phone
    from public.crm_contacts contact
    where contact.id = contact_id_value
      and contact.organization_id = requested_organization_id
      and contact.archived_at is null
    for update;

    if not found then
      raise exception 'CRM contact changed or is not writable by this actor'
        using errcode = '40001';
    end if;

    if (select auth.uid()) is null
      and requested_contact_email is not null
      and nullif(btrim(existing_contact_email), '') is not null
      and lower(btrim(existing_contact_email))
        is distinct from lower(btrim(requested_contact_email)) then
      raise exception 'CRM contact email conflicts with the canonical value'
        using errcode = '23514';
    end if;

    if (select auth.uid()) is null
      and requested_contact_phone is not null
      and nullif(
        regexp_replace(existing_contact_phone, '[^0-9]', '', 'g'),
        ''
      ) is not null
      and regexp_replace(existing_contact_phone, '[^0-9]', '', 'g')
        is distinct from regexp_replace(
          requested_contact_phone,
          '[^0-9]',
          '',
          'g'
        ) then
      raise exception 'CRM contact phone conflicts with the canonical value'
        using errcode = '23514';
    end if;

    update public.crm_contacts contact
    set email = case
          when requested_contact_email is null then contact.email
          else nullif(btrim(requested_contact_email), '')
        end,
        phone = case
          when requested_contact_phone is null then contact.phone
          else nullif(btrim(requested_contact_phone), '')
        end,
        updated_at = now()
    where contact.id = contact_id_value
      and contact.organization_id = requested_organization_id
      and contact.archived_at is null;

    if not found then
      raise exception 'CRM contact changed or is not writable by this actor'
        using errcode = '40001';
    end if;
  end if;

  return result_payload;
end;
$$;

revoke execute on function public.update_crm_lead_uat_atomic(
  uuid, uuid, uuid, jsonb, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.update_crm_lead_uat_atomic(
  uuid, uuid, uuid, jsonb, text, text, text, text
) to authenticated, service_role;
