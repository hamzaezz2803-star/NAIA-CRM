\set ON_ERROR_STOP on

-- Run immediately after 20260809221616, without applying 20260810000025.

begin;
set local statement_timeout = '10s';

do $assertions$
begin
  if (
    select count(*)
    from public.crm_leads
    where id in (
      '51000000-0000-0000-0000-000000000001',
      '51000000-0000-0000-0000-000000000002'
    )
      and access_scope = 'cofounders'
  ) <> 2 then
    raise exception '21616 did not backfill category/tag-derived lead scope';
  end if;
  if not exists (
    select 1
    from public.crm_contacts
    where id = '41000000-0000-0000-0000-000000000001'
      and access_scope = 'cofounders'
  ) or not exists (
    select 1
    from public.crm_tasks
    where id = '61000000-0000-0000-0000-000000000001'
      and access_scope = 'cofounders'
  ) then
    raise exception '21616 did not backfill tag-derived contact/task scope';
  end if;
end
$assertions$;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '21000000-0000-0000-0000-000000000002',
  true
);

do $assertions$
begin
  if exists (
    select 1
    from public.crm_leads
    where id in (
      '51000000-0000-0000-0000-000000000001',
      '51000000-0000-0000-0000-000000000002'
    )
  ) then
    raise exception 'Non-cofounder can read classifier-derived leads after 21616';
  end if;
  if exists (
    select 1
    from public.crm_contacts
    where id = '41000000-0000-0000-0000-000000000001'
  ) or exists (
    select 1
    from public.crm_tasks
    where id = '61000000-0000-0000-0000-000000000001'
  ) then
    raise exception 'Non-cofounder can read tag-derived contacts/tasks after 21616';
  end if;
end
$assertions$;

reset role;

-- Durable category propagation after the intermediate migration commits.
insert into public.crm_categories (
  id, organization_id, name, status_key, color, position, access_scope
)
values (
  '71000000-0000-0000-0000-000000000002',
  '11000000-0000-0000-0000-000000000001',
  'Ordinary category',
  'later-intermediate-private',
  'gray',
  1,
  'organization'
);
insert into public.crm_leads (
  id, organization_id, topic, status, access_scope
)
values (
  '51000000-0000-0000-0000-000000000003',
  '11000000-0000-0000-0000-000000000001',
  'Later category lead',
  'later-intermediate-private',
  'organization'
);
update public.crm_categories
set name = 'Intern category'
where id = '71000000-0000-0000-0000-000000000002';

-- Durable tag-relation propagation after the intermediate migration commits.
insert into public.crm_tags (
  id, organization_id, name, color, access_scope
)
values (
  '81000000-0000-0000-0000-000000000002',
  '11000000-0000-0000-0000-000000000001',
  'Intern follow-up',
  'teal',
  'organization'
);
insert into public.crm_leads (
  id, organization_id, topic, status, access_scope
)
values (
  '51000000-0000-0000-0000-000000000004',
  '11000000-0000-0000-0000-000000000001',
  'Later tag lead',
  'contacted',
  'organization'
);
insert into public.crm_lead_tags (lead_id, tag_id)
values (
  '51000000-0000-0000-0000-000000000004',
  '81000000-0000-0000-0000-000000000002'
);

do $assertions$
begin
  if exists (
    select 1
    from public.crm_leads
    where id in (
      '51000000-0000-0000-0000-000000000003',
      '51000000-0000-0000-0000-000000000004'
    )
      and access_scope <> 'cofounders'
  ) then
    raise exception '21616 classifier propagation is not durable';
  end if;
end
$assertions$;

rollback;
