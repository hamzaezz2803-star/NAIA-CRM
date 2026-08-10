-- Persist a user-defined priority order inside each CRM pipeline column.
-- Reordering is isolated from business timestamps so a visual priority change
-- is not mistaken for a new CRM interaction by NAIA or the daily brief.

alter table public.crm_leads
  add column if not exists pipeline_position bigint;

with ranked as (
  select
    lead.id,
    row_number() over (
      partition by lead.organization_id, lead.status
      order by lead.created_at desc, lead.id
    ) * 1024 as pipeline_position
  from public.crm_leads lead
)
update public.crm_leads lead
set pipeline_position = ranked.pipeline_position
from ranked
where lead.id = ranked.id
  and lead.pipeline_position is null;

alter table public.crm_leads
  alter column pipeline_position set default 0,
  alter column pipeline_position set not null;

create index if not exists crm_leads_pipeline_order_active_idx
  on public.crm_leads (
    organization_id,
    status,
    pipeline_position,
    created_at desc,
    id
  )
  where archived_at is null;

create or replace function private.reset_crm_pipeline_position_on_status_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        new.organization_id::text || ':' || new.status,
        0
      )
    );

    select coalesce(min(lead.pipeline_position), 1024) - 1024
    into new.pipeline_position
    from public.crm_leads lead
    where lead.organization_id = new.organization_id
      and lead.status = new.status
      and lead.archived_at is null
      and lead.id is distinct from new.id;
  end if;

  return new;
end;
$$;

revoke execute on function private.reset_crm_pipeline_position_on_status_change()
from public, anon, authenticated, service_role;

drop trigger if exists reset_crm_pipeline_position_on_status_change_trigger
on public.crm_leads;
create trigger reset_crm_pipeline_position_on_status_change_trigger
before insert or update of status on public.crm_leads
for each row execute function private.reset_crm_pipeline_position_on_status_change();

create or replace function public.reorder_crm_pipeline_leads(
  requested_organization_id uuid,
  requested_status text,
  expected_ordered_ids uuid[],
  requested_ordered_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_order uuid[];
  final_order uuid[];
  item_count integer;
begin
  if requested_organization_id is null
    or requested_status is null
    or btrim(requested_status) = ''
    or expected_ordered_ids is null
    or requested_ordered_ids is null then
    raise exception 'CRM pipeline reorder payload is incomplete'
      using errcode = '22023';
  end if;

  item_count := cardinality(expected_ordered_ids);
  if item_count <> cardinality(requested_ordered_ids)
    or item_count > 5000 then
    raise exception 'CRM pipeline reorder payload has an invalid size'
      using errcode = '22023';
  end if;

  if item_count <> (
    select count(distinct item_id)
    from unnest(expected_ordered_ids) item(item_id)
  ) or item_count <> (
    select count(distinct item_id)
    from unnest(requested_ordered_ids) item(item_id)
  ) then
    raise exception 'CRM pipeline reorder payload contains duplicates'
      using errcode = '22023';
  end if;

  if exists (
    (select item_id from unnest(expected_ordered_ids) item(item_id)
      except
     select item_id from unnest(requested_ordered_ids) item(item_id))
    union all
    (select item_id from unnest(requested_ordered_ids) item(item_id)
      except
     select item_id from unnest(expected_ordered_ids) item(item_id))
  ) then
    raise exception 'CRM pipeline reorder payload is not a permutation'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      requested_organization_id::text || ':' || requested_status,
      0
    )
  );

  select array_agg(locked.id order by locked.pipeline_position, locked.created_at desc, locked.id)
  into current_order
  from (
    select lead.id, lead.pipeline_position, lead.created_at
    from public.crm_leads lead
    where lead.organization_id = requested_organization_id
      and lead.status = requested_status
      and lead.archived_at is null
    for update
  ) locked;

  current_order := coalesce(current_order, '{}'::uuid[]);
  if current_order is distinct from expected_ordered_ids then
    raise exception 'CRM pipeline order changed concurrently'
      using errcode = '40001';
  end if;

  with desired as (
    select item_id, ordinality
    from unnest(requested_ordered_ids) with ordinality item(item_id, ordinality)
  )
  update public.crm_leads lead
  set pipeline_position = desired.ordinality * 1024
  from desired
  where lead.id = desired.item_id
    and lead.organization_id = requested_organization_id
    and lead.status = requested_status
    and lead.archived_at is null
    and lead.pipeline_position is distinct from desired.ordinality * 1024;

  select array_agg(lead.id order by lead.pipeline_position, lead.created_at desc, lead.id)
  into final_order
  from public.crm_leads lead
  where lead.organization_id = requested_organization_id
    and lead.status = requested_status
    and lead.archived_at is null;

  if coalesce(final_order, '{}'::uuid[]) is distinct from requested_ordered_ids then
    raise exception 'CRM pipeline reorder could not be verified'
      using errcode = '40001';
  end if;
end;
$$;

revoke all on function public.reorder_crm_pipeline_leads(uuid, text, uuid[], uuid[])
from public, anon;
grant execute on function public.reorder_crm_pipeline_leads(uuid, text, uuid[], uuid[])
to authenticated, service_role;
