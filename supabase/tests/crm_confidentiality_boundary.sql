\set ON_ERROR_STOP on

begin;

set local statement_timeout = '10s';

-- Reuse the shared local Supabase identities when they already exist. The
-- transaction still rolls every fixture mutation back at the end of the test.
select
  coalesce(
    (select id::text from auth.users where lower(email) = 'ali@qarizmi.com' limit 1),
    '20000000-0000-0000-0000-000000000001'
  ) as founder_id,
  coalesce(
    (select id::text from auth.users where lower(email) = 'member@qarizmi.com' limit 1),
    '20000000-0000-0000-0000-000000000002'
  ) as member_id
\gset

select set_config('crm.qa_founder_id', :'founder_id', true);
select set_config('crm.qa_member_id', :'member_id', true);

insert into public.organizations (id, name, slug, created_at)
values
  ('10000000-0000-0000-0000-000000000001', 'CRM QA One', 'crm-qa-one', '2026-08-10T00:00:00Z'),
  ('10000000-0000-0000-0000-000000000002', 'CRM QA Two', 'crm-qa-two', '2026-08-10T00:00:01Z');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    :'founder_id',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'ali@qarizmi.com', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    :'member_id',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'member@qarizmi.com', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (id, email, full_name)
values
  (:'founder_id', 'ali@qarizmi.com', 'Ali QA'),
  (:'member_id', 'member@qarizmi.com', 'Member QA')
on conflict (id) do update set email = excluded.email;

insert into public.organization_memberships (
  organization_id, profile_id, role
)
values
  (
    '10000000-0000-0000-0000-000000000001',
    :'founder_id',
    'owner'
  ),
  (
    '10000000-0000-0000-0000-000000000001',
    :'member_id',
    'member'
  )
on conflict (organization_id, profile_id) do update set role = excluded.role;

insert into public.crm_companies (id, organization_id, name, access_scope)
values
  (
    '30000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'Apprentice programme',
    'organization'
  ),
  (
    '30000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000002',
    'Other tenant company',
    'organization'
  );

do $assertions$
declare
  actual_scope text;
begin
  select access_scope into actual_scope
  from public.crm_companies
  where id = '30000000-0000-0000-0000-000000000001';
  if actual_scope <> 'cofounders' then
    raise exception 'Sensitive manual company was not escalated';
  end if;

  update public.crm_companies
  set name = 'Ordinary company', access_scope = 'organization'
  where id = '30000000-0000-0000-0000-000000000001';
  select access_scope into actual_scope
  from public.crm_companies
  where id = '30000000-0000-0000-0000-000000000001';
  if actual_scope <> 'cofounders' then
    raise exception 'Founder-only scope was downgraded';
  end if;

  begin
    insert into public.crm_contacts (
      organization_id, company_id, name, access_scope
    ) values (
      '10000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000002',
      'Cross tenant contact', 'organization'
    );
    raise exception 'Expected contact/company boundary rejection';
  exception when others then
    if sqlerrm not like '%contact/company organization mismatch%' then
      raise;
    end if;
  end;

  begin
    insert into public.crm_leads (
      organization_id, company_id, topic, access_scope
    ) values (
      '10000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000002',
      'Cross tenant lead/company', 'organization'
    );
    raise exception 'Expected lead/company boundary rejection';
  exception when others then
    if sqlerrm not like '%lead/company organization mismatch%' then
      raise;
    end if;
  end;
end
$assertions$;

insert into public.crm_contacts (
  id, organization_id, company_id, name, access_scope
)
values (
  '40000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  'Ordinary child contact',
  'organization'
);

insert into public.crm_contacts (id, organization_id, name, access_scope)
values (
  '40000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000002',
  'Other tenant contact',
  'organization'
);

do $assertions$
declare
  actual_scope text;
begin
  select access_scope into actual_scope
  from public.crm_contacts
  where id = '40000000-0000-0000-0000-000000000001';
  if actual_scope <> 'cofounders' then
    raise exception 'Confidential company scope was not inherited by contact';
  end if;

  begin
    insert into public.crm_leads (
      organization_id, contact_id, topic, access_scope
    ) values (
      '10000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000002',
      'Cross tenant lead/contact', 'organization'
    );
    raise exception 'Expected lead/contact boundary rejection';
  exception when others then
    if sqlerrm not like '%lead/contact organization mismatch%' then
      raise;
    end if;
  end;
end
$assertions$;

insert into public.crm_leads (id, organization_id, topic, access_scope)
values (
  '50000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002',
  'Other tenant lead',
  'organization'
);

do $assertions$
begin
  begin
    insert into public.crm_leads (
      organization_id, topic, assigned_to_profile_id, access_scope
    ) values (
      '10000000-0000-0000-0000-000000000002',
      'Cross-organization assignee lead',
      current_setting('crm.qa_member_id')::uuid,
      'organization'
    );
    raise exception 'Expected cross-organization lead assignee rejection';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.crm_tasks (
      organization_id, lead_id, title, assigned_to_profile_id, access_scope
    ) values (
      '10000000-0000-0000-0000-000000000002',
      '50000000-0000-0000-0000-000000000001',
      'Cross-organization assignee task',
      current_setting('crm.qa_member_id')::uuid,
      'organization'
    );
    raise exception 'Expected cross-organization task assignee rejection';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.crm_lead_notes (
      organization_id, lead_id, content, assigned_to_profile_id
    ) values (
      '10000000-0000-0000-0000-000000000002',
      '50000000-0000-0000-0000-000000000001',
      'Ordinary cross-organization note assignment',
      current_setting('crm.qa_member_id')::uuid
    );
    raise exception 'Expected cross-organization note assignee rejection';
  exception when check_violation then
    null;
  end;
end
$assertions$;

insert into public.crm_companies (id, organization_id, name, access_scope)
values (
  '30000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001',
  'Initially ordinary company',
  'organization'
);
insert into public.crm_contacts (
  id, organization_id, company_id, name, access_scope
)
values (
  '40000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000003',
  'Initially ordinary contact',
  'organization'
);
insert into public.crm_leads (
  id, organization_id, company_id, contact_id, topic, access_scope
)
values (
  '50000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000003',
  '40000000-0000-0000-0000-000000000003',
  'Initially ordinary lead',
  'organization'
);
insert into public.crm_tasks (
  id, organization_id, lead_id, title, access_scope
)
values (
  '60000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000003',
  'Initially ordinary task',
  'organization'
);

update public.crm_companies
set name = 'Trainee programme'
where id = '30000000-0000-0000-0000-000000000003';

do $assertions$
begin
  if exists (
    select 1
    from (
      select access_scope from public.crm_companies
      where id = '30000000-0000-0000-0000-000000000003'
      union all
      select access_scope from public.crm_contacts
      where id = '40000000-0000-0000-0000-000000000003'
      union all
      select access_scope from public.crm_leads
      where id = '50000000-0000-0000-0000-000000000003'
      union all
      select access_scope from public.crm_tasks
      where id = '60000000-0000-0000-0000-000000000003'
    ) scopes
    where scopes.access_scope <> 'cofounders'
  ) then
    raise exception 'Confidential scope did not propagate to every descendant';
  end if;

  begin
    update public.crm_companies
    set organization_id = '10000000-0000-0000-0000-000000000002'
    where id = '30000000-0000-0000-0000-000000000003';
    raise exception 'Expected parent organization move rejection';
  exception when others then
    if sqlerrm not like '%company move strands descendants%' then
      raise;
    end if;
  end;
end
$assertions$;

do $assertions$
begin
  begin
    insert into public.crm_tasks (
      organization_id, lead_id, title, access_scope
    ) values (
      '10000000-0000-0000-0000-000000000001',
      '50000000-0000-0000-0000-000000000001',
      'Cross tenant task', 'organization'
    );
    raise exception 'Expected task/lead boundary rejection';
  exception when others then
    if sqlerrm not like '%task/lead organization mismatch%' then
      raise;
    end if;
  end;
end
$assertions$;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  :'member_id',
  true
);

do $assertions$
begin
  begin
    insert into public.crm_companies (organization_id, name, access_scope)
    values (
      '10000000-0000-0000-0000-000000000001',
      'Trainee evaluation',
      'organization'
    );
    raise exception 'Expected non-founder sensitive write rejection';
  exception when others then
    if sqlerrm not like '%row-level security%' then
      raise;
    end if;
  end;
end
$assertions$;

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  :'founder_id',
  true
);

select public.stage_crm_trello_import(
  '10000000-0000-0000-0000-000000000001',
  'qa-board-valid',
  repeat('1', 64),
  encode(
    extensions.digest(
      convert_to(
        'lead' || chr(31) || 'qa-card-1' || chr(31) || repeat('a', 64) ||
          chr(31) || encode(
            extensions.digest(convert_to('[]', 'UTF8'), 'sha256'),
            'hex'
          ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ),
  1,
  '{"boardName":"QA"}'::jsonb,
  jsonb_build_array(jsonb_build_object(
    'entity_type', 'lead',
    'external_id', 'qa-card-1',
    'parent_external_id', 'qa-list-1',
    'access_scope', 'organization',
    'normalized_payload', jsonb_build_object(
      'topic', 'QA lead',
      'status', 'contacted',
      'labelExternalIds', jsonb_build_array()
    ),
    'payload_hash', repeat('a', 64),
    'privacy_reasons', jsonb_build_array(),
    'validation_errors', jsonb_build_array()
  ))
);

select public.stage_crm_trello_import(
  '10000000-0000-0000-0000-000000000001',
  'qa-board-validation-error',
  repeat('8', 64),
  encode(
    extensions.digest(
      convert_to(
        'tag' || chr(31) || 'qa-tag-validation' || chr(31) || repeat('9', 64) ||
          chr(31) || encode(
            extensions.digest(
              convert_to('["existing-crm:ambiguous-tag-match"]', 'UTF8'),
              'sha256'
            ),
            'hex'
          ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ),
  1,
  '{"boardName":"QA validation"}'::jsonb,
  jsonb_build_array(jsonb_build_object(
    'entity_type', 'tag',
    'external_id', 'qa-tag-validation',
    'parent_external_id', null,
    'access_scope', 'organization',
    'normalized_payload', jsonb_build_object('name', 'QA validation'),
    'payload_hash', repeat('9', 64),
    'privacy_reasons', jsonb_build_array(),
    'validation_errors', jsonb_build_array(
      'existing-crm:ambiguous-tag-match'
    )
  ))
);

do $assertions$
declare
  validation_run_id uuid;
begin
  select id into validation_run_id
  from public.crm_import_runs
  where source_external_id = 'qa-board-validation-error';
  begin
    perform public.apply_crm_trello_import(validation_run_id);
    raise exception 'Expected reviewed validation error rejection';
  exception when others then
    if sqlerrm not like '%CRM import has validation errors%' then
      raise;
    end if;
  end;

  begin
    update public.crm_import_staging set payload_hash = repeat('b', 64)
    where external_id = 'qa-card-1';
    raise exception 'Expected direct staging mutation rejection';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.stage_crm_trello_import(
      '10000000-0000-0000-0000-000000000001',
      'qa-board-forbidden', repeat('2', 64), repeat('2', 64), 1,
      '{}'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'entity_type', 'tag',
        'external_id', 'qa-tag-secret',
        'parent_external_id', null,
        'access_scope', 'organization',
        'normalized_payload', jsonb_build_object('AWSAccessKeyId', 'secret'),
        'payload_hash', repeat('b', 64),
        'privacy_reasons', jsonb_build_array(),
        'validation_errors', jsonb_build_array()
      ))
    );
    raise exception 'Expected forbidden staging rejection';
  exception when others then
    if sqlerrm not like '%invalid or forbidden staging row%' then
      raise;
    end if;
  end;

  begin
    perform public.stage_crm_trello_import(
      '10000000-0000-0000-0000-000000000001',
      'qa-board-bad-attestation', repeat('3', 64), repeat('0', 64), 1,
      '{}'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'entity_type', 'tag',
        'external_id', 'qa-tag-1',
        'parent_external_id', null,
        'access_scope', 'organization',
        'normalized_payload', jsonb_build_object('name', 'QA'),
        'payload_hash', repeat('c', 64),
        'privacy_reasons', jsonb_build_array(),
        'validation_errors', jsonb_build_array()
      ))
    );
    raise exception 'Expected staging attestation rejection';
  exception when others then
    if sqlerrm not like '%staging attestation failed%' then
      raise;
    end if;
  end;
end
$assertions$;

reset role;

do $assertions$
begin
  if exists (
    select 1 from public.crm_import_runs
    where source_external_id in (
      'qa-board-forbidden', 'qa-board-bad-attestation'
    )
  ) then
    raise exception 'Failed staging transaction left a partial import run';
  end if;

  update public.crm_import_staging
  set payload_hash = repeat('b', 64)
  where external_id = 'qa-card-1';
end
$assertions$;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  :'founder_id',
  true
);

do $assertions$
declare
  target_run_id uuid;
begin
  select id into target_run_id
  from public.crm_import_runs
  where source_external_id = 'qa-board-valid';
  begin
    perform public.apply_crm_trello_import(target_run_id);
    raise exception 'Expected apply attestation rejection';
  exception when others then
    if sqlerrm not like '%attestation is incomplete or invalid%' then
      raise;
    end if;
  end;
end
$assertions$;

reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  :'founder_id',
  true
);

with canonical(row_text) as (
  values
    (
      'category' || chr(31) || 'qa-category-full' || chr(31) ||
        repeat('d', 64) || chr(31) || encode(
          extensions.digest(convert_to('[]', 'UTF8'), 'sha256'),
          'hex'
        )
    ),
    (
      'lead' || chr(31) || 'qa-lead-full' || chr(31) || repeat('e', 64) ||
        chr(31) || encode(
          extensions.digest(convert_to('[]', 'UTF8'), 'sha256'),
          'hex'
        )
    ),
    (
      'tag' || chr(31) || 'qa-tag-full' || chr(31) || repeat('f', 64) ||
        chr(31) || encode(
          extensions.digest(convert_to('[]', 'UTF8'), 'sha256'),
          'hex'
        )
    )
), attestation as (
  select encode(
    extensions.digest(
      convert_to(string_agg(row_text, E'\n' order by row_text), 'UTF8'),
      'sha256'
    ),
    'hex'
  ) as staging_hash
  from canonical
)
select public.stage_crm_trello_import(
  '10000000-0000-0000-0000-000000000001',
  'qa-board-full',
  repeat('4', 64),
  attestation.staging_hash,
  3,
  '{"boardName":"Full QA"}'::jsonb,
  jsonb_build_array(
    jsonb_build_object(
      'entity_type', 'category',
      'external_id', 'qa-category-full',
      'parent_external_id', null,
      'access_scope', 'organization',
      'normalized_payload', jsonb_build_object(
        'name', 'Full QA category',
        'statusKey', 'qa-full',
        'color', 'gray',
        'position', 1
      ),
      'payload_hash', repeat('d', 64),
      'privacy_reasons', jsonb_build_array(),
      'validation_errors', jsonb_build_array()
    ),
    jsonb_build_object(
      'entity_type', 'tag',
      'external_id', 'qa-tag-full',
      'parent_external_id', null,
      'access_scope', 'organization',
      'normalized_payload', jsonb_build_object(
        'name', 'Urgent',
        'color', 'red'
      ),
      'payload_hash', repeat('f', 64),
      'privacy_reasons', jsonb_build_array(),
      'validation_errors', jsonb_build_array()
    ),
    jsonb_build_object(
      'entity_type', 'lead',
      'external_id', 'qa-lead-full',
      'parent_external_id', 'qa-category-full',
      'access_scope', 'organization',
      'normalized_payload', jsonb_build_object(
        'topic', 'Full QA lead',
        'source', 'Trello',
        'status', 'qa-full',
        'labelExternalIds', jsonb_build_array('qa-tag-full'),
        'sourceMeta', jsonb_build_object(
          'assignedMemberExternalIds', jsonb_build_array('member-qa')
        )
      ),
      'payload_hash', repeat('e', 64),
      'privacy_reasons', jsonb_build_array(),
      'validation_errors', jsonb_build_array()
    )
  )
)
from attestation;

do $assertions$
declare
  target_run_id uuid;
  result jsonb;
begin
  select id into strict target_run_id
  from public.crm_import_runs
  where source_external_id = 'qa-board-full'
    and source_hash = repeat('4', 64)
    and status = 'staged';

  result := public.apply_crm_trello_import(target_run_id);
  if (result ->> 'created')::integer <> 3 then
    raise exception 'Full apply did not create all attested entities: %', result;
  end if;
  if (
    select count(*) from public.crm_external_refs
    where last_run_id = target_run_id and archived_at is null
  ) <> 3 then
    raise exception 'Full apply did not create three active references';
  end if;
end
$assertions$;

-- A distinct board revision reuses three active mappings and adds one delta.
-- Its postconditions must include both old and newly touched references, while
-- its rollback may archive only the delta and must preserve run A.
with canonical(row_text) as (
  values
    (
      'category' || chr(31) || 'qa-category-full' || chr(31) ||
        repeat('d', 64) || chr(31) || encode(
          extensions.digest(convert_to('[]', 'UTF8'), 'sha256'), 'hex'
        )
    ),
    (
      'lead' || chr(31) || 'qa-lead-full' || chr(31) || repeat('e', 64) ||
        chr(31) || encode(
          extensions.digest(convert_to('[]', 'UTF8'), 'sha256'), 'hex'
        )
    ),
    (
      'tag' || chr(31) || 'qa-tag-delta' || chr(31) || repeat('1', 64) ||
        chr(31) || encode(
          extensions.digest(convert_to('[]', 'UTF8'), 'sha256'), 'hex'
        )
    ),
    (
      'tag' || chr(31) || 'qa-tag-full' || chr(31) || repeat('f', 64) ||
        chr(31) || encode(
          extensions.digest(convert_to('[]', 'UTF8'), 'sha256'), 'hex'
        )
    )
), attestation as (
  select encode(
    extensions.digest(
      convert_to(string_agg(row_text, E'\n' order by row_text), 'UTF8'),
      'sha256'
    ),
    'hex'
  ) as staging_hash
  from canonical
), first_run as (
  select run.*
  from public.crm_import_runs run
  where run.source_external_id = 'qa-board-full'
    and run.source_hash = repeat('4', 64)
    and run.status = 'applied'
), requested_rows as (
  select jsonb_agg(
    jsonb_build_object(
      'entity_type', stage.entity_type,
      'external_id', stage.external_id,
      'parent_external_id', stage.parent_external_id,
      'access_scope', stage.access_scope,
      'normalized_payload', stage.normalized_payload,
      'payload_hash', stage.payload_hash,
      'privacy_reasons', stage.privacy_reasons,
      'validation_errors', stage.validation_errors
    ) order by stage.entity_type, stage.external_id
  ) || jsonb_build_array(jsonb_build_object(
    'entity_type', 'tag',
    'external_id', 'qa-tag-delta',
    'parent_external_id', null,
    'access_scope', 'organization',
    'normalized_payload', jsonb_build_object(
      'name', 'Delta',
      'color', 'blue'
    ),
    'payload_hash', repeat('1', 64),
    'privacy_reasons', jsonb_build_array(),
    'validation_errors', jsonb_build_array()
  )) as rows
  from first_run
  join public.crm_import_staging stage
    on stage.run_id = first_run.id
    and stage.organization_id = first_run.organization_id
)
select public.stage_crm_trello_import(
  first_run.organization_id,
  first_run.source_external_id,
  repeat('5', 64),
  attestation.staging_hash,
  4,
  '{"boardName":"Full QA delta"}'::jsonb,
  requested_rows.rows
)
from first_run cross join requested_rows cross join attestation;

do $assertions$
declare
  run_a_id uuid;
  run_b_id uuid;
  result jsonb;
begin
  select id into strict run_a_id
  from public.crm_import_runs
  where source_external_id = 'qa-board-full'
    and source_hash = repeat('4', 64)
    and status = 'applied';
  select id into strict run_b_id
  from public.crm_import_runs
  where source_external_id = 'qa-board-full'
    and source_hash = repeat('5', 64)
    and status = 'staged';

  result := public.apply_crm_trello_import(run_b_id);
  if (result ->> 'unchanged')::integer <> 3
    or (result ->> 'created')::integer <> 1
    or (result ->> 'conflicts')::integer <> 0 then
    raise exception 'Delta apply did not separate unchanged and touched refs: %', result;
  end if;

  if (
    select count(*)
    from public.crm_import_staging stage
    join public.crm_import_runs run
      on run.id = stage.run_id
      and run.organization_id = stage.organization_id
    join public.crm_external_refs ref
      on ref.organization_id = stage.organization_id
      and ref.provider = run.provider
      and ref.external_type = stage.entity_type
      and ref.external_id = stage.external_id
    where run.id = run_b_id
      and ref.archived_at is null
      and ref.source_hash = stage.payload_hash
      and ref.access_scope = stage.access_scope
  ) <> 4 then
    raise exception 'Delta apply postconditions missed unchanged active mappings';
  end if;

  if (
    select count(*) from public.crm_external_refs
    where last_run_id = run_b_id and archived_at is null
  ) <> 1 or (
    select count(*) from public.crm_external_refs
    where last_run_id = run_a_id and archived_at is null
  ) <> 3 then
    raise exception 'Delta apply corrupted first/last run provenance';
  end if;

  result := public.rollback_crm_trello_import(run_b_id);
  if exists (
    select 1 from public.crm_external_refs
    where last_run_id = run_b_id and archived_at is null
  ) or (
    select count(*) from public.crm_external_refs
    where last_run_id = run_a_id and archived_at is null
  ) <> 3 then
    raise exception 'Delta rollback did not preserve run A mappings: %', result;
  end if;

  if exists (
    select 1
    from public.crm_external_refs ref
    where ref.last_run_id = run_a_id
      and ref.archived_at is null
      and not exists (
        select 1 from public.crm_import_staging stage
        where stage.run_id = run_b_id
          and stage.organization_id = ref.organization_id
          and stage.entity_type = ref.external_type
          and stage.external_id = ref.external_id
      )
  ) or not exists (
    select 1
    from public.crm_lead_tags relation
    join public.crm_external_refs lead_ref on lead_ref.local_id = relation.lead_id
    join public.crm_external_refs tag_ref on tag_ref.local_id = relation.tag_id
    where lead_ref.external_id = 'qa-lead-full'
      and tag_ref.external_id = 'qa-tag-full'
      and relation.archived_at is null
  ) or exists (
    select 1
    from public.crm_external_refs ref
    left join public.crm_categories category
      on ref.local_table = 'crm_categories'
      and category.id = ref.local_id
      and category.organization_id = ref.organization_id
      and category.archived_at is null
    left join public.crm_tags tag
      on ref.local_table = 'crm_tags'
      and tag.id = ref.local_id
      and tag.organization_id = ref.organization_id
      and tag.archived_at is null
    left join public.crm_leads lead
      on ref.local_table = 'crm_leads'
      and lead.id = ref.local_id
      and lead.organization_id = ref.organization_id
      and lead.archived_at is null
    where ref.last_run_id = run_a_id
      and ref.archived_at is null
      and category.id is null
      and tag.id is null
      and lead.id is null
  ) then
    raise exception 'Delta rollback did not preserve run A rows and relation';
  end if;

  result := public.rollback_crm_trello_import(run_a_id);
  if exists (
    select 1 from public.crm_external_refs
    where last_run_id = run_a_id and archived_at is null
  ) then
    raise exception 'Run A rollback left an active reference: %', result;
  end if;
end
$assertions$;

-- Re-stage A identically after its soft rollback. The mappings keep A as
-- first_run_id, move last_run_id to C, and revive the previously archived
-- relationship before C's rollback restores its exact archived timestamp.
with original_run as (
  select run.*
  from public.crm_import_runs run
  where run.source_external_id = 'qa-board-full'
    and run.source_hash = repeat('4', 64)
    and run.status = 'rolled-back'
), requested_rows as (
  select jsonb_agg(
    jsonb_build_object(
      'entity_type', stage.entity_type,
      'external_id', stage.external_id,
      'parent_external_id', stage.parent_external_id,
      'access_scope', stage.access_scope,
      'normalized_payload', stage.normalized_payload,
      'payload_hash', stage.payload_hash,
      'privacy_reasons', stage.privacy_reasons,
      'validation_errors', stage.validation_errors
    ) order by stage.entity_type, stage.external_id
  ) as rows
  from original_run
  join public.crm_import_staging stage
    on stage.run_id = original_run.id
    and stage.organization_id = original_run.organization_id
)
select public.stage_crm_trello_import(
  original_run.organization_id,
  original_run.source_external_id,
  original_run.source_hash,
  original_run.staging_hash,
  original_run.expected_item_count,
  '{"boardName":"Full QA revived"}'::jsonb,
  requested_rows.rows
)
from original_run cross join requested_rows;

do $assertions$
declare
  run_a_id uuid;
  run_c_id uuid;
  mapped_lead_id uuid;
  mapped_tag_id uuid;
  previous_relation_archived_at timestamptz;
  result jsonb;
begin
  select distinct ref.first_run_id into strict run_a_id
  from public.crm_external_refs ref
  where ref.external_type = 'lead'
    and ref.external_id = 'qa-lead-full';
  select run.id into strict run_c_id
  from public.crm_import_runs run
  where run.source_external_id = 'qa-board-full'
    and run.source_hash = repeat('4', 64)
    and run.status = 'staged';

  result := public.apply_crm_trello_import(run_c_id);
  if (result ->> 'revived')::integer <> 3
    or (result ->> 'created')::integer <> 0
    or (result ->> 'conflicts')::integer <> 0 then
    raise exception 'Identical re-apply did not revive all mappings: %', result;
  end if;

  if (
    select count(*)
    from public.crm_import_staging stage
    join public.crm_import_runs run
      on run.id = stage.run_id
      and run.organization_id = stage.organization_id
    join public.crm_external_refs ref
      on ref.organization_id = stage.organization_id
      and ref.provider = run.provider
      and ref.external_type = stage.entity_type
      and ref.external_id = stage.external_id
      and ref.last_run_id = run.id
    where run.id = run_c_id
      and ref.first_run_id = run_a_id
      and ref.archived_at is null
      and ref.source_hash = stage.payload_hash
      and ref.access_scope = stage.access_scope
  ) <> 3 then
    raise exception 'Identical re-apply mappings are not exact/current';
  end if;

  if exists (
    select 1
    from public.crm_external_refs ref
    left join public.crm_categories category
      on ref.local_table = 'crm_categories'
      and category.id = ref.local_id
      and category.organization_id = ref.organization_id
      and category.archived_at is null
    left join public.crm_tags tag
      on ref.local_table = 'crm_tags'
      and tag.id = ref.local_id
      and tag.organization_id = ref.organization_id
      and tag.archived_at is null
    left join public.crm_leads lead
      on ref.local_table = 'crm_leads'
      and lead.id = ref.local_id
      and lead.organization_id = ref.organization_id
      and lead.archived_at is null
    where ref.last_run_id = run_c_id
      and ref.archived_at is null
      and category.id is null
      and tag.id is null
      and lead.id is null
  ) then
    raise exception 'Identical re-apply left an inactive local mapping';
  end if;

  select lead_ref.local_id, tag_ref.local_id
  into strict mapped_lead_id, mapped_tag_id
  from public.crm_external_refs lead_ref
  cross join public.crm_external_refs tag_ref
  where lead_ref.external_type = 'lead'
    and lead_ref.external_id = 'qa-lead-full'
    and lead_ref.last_run_id = run_c_id
    and lead_ref.archived_at is null
    and tag_ref.organization_id = lead_ref.organization_id
    and tag_ref.provider = lead_ref.provider
    and tag_ref.external_type = 'tag'
    and tag_ref.external_id = 'qa-tag-full'
    and tag_ref.last_run_id = run_c_id
    and tag_ref.archived_at is null;

  select (change.before_snapshot ->> 'previousArchivedAt')::timestamptz
  into strict previous_relation_archived_at
  from public.crm_import_changes change
  where change.run_id = run_c_id
    and change.operation = 'linked-relation'
    and coalesce(change.before_snapshot ->> 'wasPresent', 'false')::boolean
    and (change.after_snapshot ->> 'leadId')::uuid = mapped_lead_id
    and (change.after_snapshot ->> 'tagId')::uuid = mapped_tag_id;
  if previous_relation_archived_at is null or not exists (
    select 1 from public.crm_lead_tags relation
    where relation.lead_id = mapped_lead_id
      and relation.tag_id = mapped_tag_id
      and relation.archived_at is null
  ) then
    raise exception 'Identical re-apply did not revive the archived relation';
  end if;

  result := public.rollback_crm_trello_import(run_c_id);
  if exists (
    select 1 from public.crm_external_refs
    where last_run_id = run_c_id and archived_at is null
  ) then
    raise exception 'Revived-run rollback left an active ref: %', result;
  end if;
end
$assertions$;

reset role;

do $assertions$
declare
  run_c_id uuid;
begin
  select ref.last_run_id into strict run_c_id
  from public.crm_external_refs ref
  where ref.external_type = 'lead'
    and ref.external_id = 'qa-lead-full';

  if exists (
    select 1
    from public.crm_import_changes change
    join public.crm_import_runs run
      on run.id = change.run_id
      and run.organization_id = change.organization_id
    left join public.crm_categories category
      on change.local_table = 'crm_categories'
      and category.id = change.local_id
      and category.organization_id = change.organization_id
    left join public.crm_tags tag
      on change.local_table = 'crm_tags'
      and tag.id = change.local_id
      and tag.organization_id = change.organization_id
    left join public.crm_leads lead
      on change.local_table = 'crm_leads'
      and lead.id = change.local_id
      and lead.organization_id = change.organization_id
    where run.source_external_id = 'qa-board-full'
      and run.status = 'rolled-back'
      and change.operation in ('created', 'revived')
      and (
        (change.local_table = 'crm_categories' and category.archived_at is null)
        or (change.local_table = 'crm_tags' and tag.archived_at is null)
        or (change.local_table = 'crm_leads' and lead.archived_at is null)
      )
  ) then
    raise exception 'Revived-run rollback left a local row active';
  end if;

  if exists (
    select 1
    from public.crm_import_changes change
    left join public.crm_lead_tags relation
      on relation.lead_id = (change.after_snapshot ->> 'leadId')::uuid
      and relation.tag_id = (change.after_snapshot ->> 'tagId')::uuid
    where change.run_id = run_c_id
      and change.operation = 'linked-relation'
      and (
        relation.lead_id is null
        or relation.archived_at is distinct from
          (change.before_snapshot ->> 'previousArchivedAt')::timestamptz
      )
  ) then
    raise exception 'Revived-run rollback did not restore relation provenance';
  end if;
end
$assertions$;

-- Category/status and tag confidentiality are durable classifiers, including
-- bidirectional family propagation without recursive trigger failures.
insert into public.crm_categories (
  id, organization_id, name, status_key, color, position, access_scope
) values (
  '70000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'Ordinary later lane', 'later-private', 'gray', 99, 'organization'
);

insert into public.crm_companies (id, organization_id, name, access_scope)
values (
  '30000000-0000-0000-0000-000000000010',
  '10000000-0000-0000-0000-000000000001',
  'Classifier family company', 'organization'
);
insert into public.crm_contacts (
  id, organization_id, company_id, name, access_scope
) values (
  '40000000-0000-0000-0000-000000000010',
  '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000010',
  'Classifier family contact', 'organization'
);
insert into public.crm_leads (
  id, organization_id, company_id, contact_id, topic, status, access_scope
) values (
  '50000000-0000-0000-0000-000000000010',
  '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000010',
  '40000000-0000-0000-0000-000000000010',
  'Classifier family lead', 'later-private', 'organization'
);
insert into public.crm_tasks (
  id, organization_id, lead_id, title, access_scope
) values (
  '60000000-0000-0000-0000-000000000010',
  '10000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000010',
  'Classifier family task', 'organization'
);

do $assertions$
begin
  if exists (
    select 1
    from (
      select access_scope from public.crm_categories
      where id = '70000000-0000-0000-0000-000000000001'
      union all
      select access_scope from public.crm_companies
      where id = '30000000-0000-0000-0000-000000000010'
      union all
      select access_scope from public.crm_contacts
      where id = '40000000-0000-0000-0000-000000000010'
      union all
      select access_scope from public.crm_leads
      where id = '50000000-0000-0000-0000-000000000010'
      union all
      select access_scope from public.crm_tasks
      where id = '60000000-0000-0000-0000-000000000010'
    ) scopes
    where scopes.access_scope <> 'organization'
  ) then
    raise exception 'Classifier propagation fixture was confidential before the rename';
  end if;
end
$assertions$;

update public.crm_categories
set name = 'Candidate private lane'
where id = '70000000-0000-0000-0000-000000000001';

insert into public.crm_tags (
  id, organization_id, name, color, access_scope
) values (
  '80000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'Founder review only', 'rose', 'cofounders'
);
insert into public.crm_tags (
  id, organization_id, name, color, access_scope
) values (
  '80000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001',
  'Ordinary CRM tag', 'teal', 'organization'
);
insert into public.crm_leads (
  id, organization_id, topic, status, access_scope
) values (
  '50000000-0000-0000-0000-000000000011',
  '10000000-0000-0000-0000-000000000001',
  'Tag-classified lead', 'contacted', 'organization'
);
insert into public.crm_lead_tags (lead_id, tag_id)
values (
  '50000000-0000-0000-0000-000000000011',
  '80000000-0000-0000-0000-000000000001'
);

do $assertions$
begin
  if exists (
    select 1
    from (
      select access_scope from public.crm_categories
      where id = '70000000-0000-0000-0000-000000000001'
      union all
      select access_scope from public.crm_companies
      where id = '30000000-0000-0000-0000-000000000010'
      union all
      select access_scope from public.crm_contacts
      where id = '40000000-0000-0000-0000-000000000010'
      union all
      select access_scope from public.crm_leads
      where id = '50000000-0000-0000-0000-000000000010'
      union all
      select access_scope from public.crm_tasks
      where id = '60000000-0000-0000-0000-000000000010'
      union all
      select access_scope from public.crm_leads
      where id = '50000000-0000-0000-0000-000000000011'
    ) scopes
    where scopes.access_scope <> 'cofounders'
  ) then
    raise exception 'Category/tag scope did not propagate to the full lead family';
  end if;

  update public.crm_leads
  set access_scope = 'organization'
  where id = '50000000-0000-0000-0000-000000000011';
  if exists (
    select 1 from public.crm_leads
    where id = '50000000-0000-0000-0000-000000000011'
      and access_scope <> 'cofounders'
  ) then
    raise exception 'Tag-classified lead scope was downgraded';
  end if;
end
$assertions$;

-- Sensitive note and follow-up content classifies the parent lead before the
-- child write commits. A confidential note cannot remain assigned to a
-- non-founder.
insert into public.crm_leads (id, organization_id, topic, status, access_scope)
values
  (
    '50000000-0000-0000-0000-000000000013',
    '10000000-0000-0000-0000-000000000001',
    'Ordinary note-classified lead', 'contacted', 'organization'
  ),
  (
    '50000000-0000-0000-0000-000000000014',
    '10000000-0000-0000-0000-000000000001',
    'Ordinary follow-up-classified lead', 'contacted', 'organization'
  ),
  (
    '50000000-0000-0000-0000-000000000015',
    '10000000-0000-0000-0000-000000000001',
    'Ordinary assigned-note lead', 'contacted', 'organization'
  );

insert into public.crm_lead_notes (
  organization_id, lead_id, content, created_by_profile_id
) values (
  '10000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000013',
  'Candidate interview notes',
  :'founder_id'
);
insert into public.crm_lead_follow_ups (
  organization_id, lead_id, comment, created_by_profile_id
) values (
  '10000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000014',
  'Intern assessment follow-up',
  :'founder_id'
);

do $assertions$
begin
  if exists (
    select 1 from public.crm_leads
    where id in (
      '50000000-0000-0000-0000-000000000013',
      '50000000-0000-0000-0000-000000000014'
    ) and access_scope <> 'cofounders'
  ) then
    raise exception 'Sensitive lead child content did not classify its parent';
  end if;

  begin
    insert into public.crm_lead_notes (
      organization_id, lead_id, content, created_by_profile_id,
      assigned_to_profile_id
    ) values (
      '10000000-0000-0000-0000-000000000001',
      '50000000-0000-0000-0000-000000000015',
      'Candidate interview assigned to a member',
      current_setting('crm.qa_founder_id')::uuid,
      current_setting('crm.qa_member_id')::uuid
    );
    raise exception 'Expected confidential note assignee rejection';
  exception when insufficient_privilege then
    null;
  end;

  if not exists (
    select 1 from public.crm_leads
    where id = '50000000-0000-0000-0000-000000000015'
      and access_scope = 'organization'
  ) or exists (
    select 1 from public.crm_lead_notes
    where lead_id = '50000000-0000-0000-0000-000000000015'
  ) then
    raise exception 'Rejected sensitive note left a partial escalation/write';
  end if;
end
$assertions$;

-- A later confidential classifier cannot leave a non-founder assigned to the
-- newly hidden record. The rejected update preserves the original lead.
insert into public.crm_leads (
  id, organization_id, topic, status, assigned_to_profile_id, access_scope
) values (
  '50000000-0000-0000-0000-000000000012',
  '10000000-0000-0000-0000-000000000001',
  'Assigned ordinary lead',
  'contacted',
  :'member_id',
  'organization'
);

do $assertions$
begin
  begin
    update public.crm_leads
    set status = 'later-private'
    where id = '50000000-0000-0000-0000-000000000012';
    raise exception 'Expected confidential assignee rejection';
  exception when insufficient_privilege then
    null;
  end;

  if not exists (
    select 1 from public.crm_leads
    where id = '50000000-0000-0000-0000-000000000012'
      and status = 'contacted'
      and access_scope = 'organization'
  ) then
    raise exception 'Rejected confidential escalation mutated the assigned lead';
  end if;

  begin
    insert into public.crm_lead_tags (lead_id, tag_id)
    values (
      '50000000-0000-0000-0000-000000000001',
      '80000000-0000-0000-0000-000000000001'
    );
    raise exception 'Expected cross-organization tag relation rejection';
  exception when check_violation then
    null;
  end;
end
$assertions$;

-- A non-founder sensitive atomic creation must fail before any company,
-- contact, lead or tag relation write can become visible.
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  :'member_id',
  true
);

select public.replace_crm_lead_tags_atomic(
  '10000000-0000-0000-0000-000000000001',
  :'member_id',
  '50000000-0000-0000-0000-000000000012',
  array['80000000-0000-0000-0000-000000000002']::uuid[]
);
select public.replace_crm_lead_tags_atomic(
  '10000000-0000-0000-0000-000000000001',
  :'member_id',
  '50000000-0000-0000-0000-000000000012',
  '{}'::uuid[]
);
select public.replace_crm_lead_tags_atomic(
  '10000000-0000-0000-0000-000000000001',
  :'member_id',
  '50000000-0000-0000-0000-000000000012',
  array['80000000-0000-0000-0000-000000000002']::uuid[]
);

do $assertions$
begin
  begin
    perform public.replace_crm_lead_tags_atomic(
      '10000000-0000-0000-0000-000000000001',
      current_setting('crm.qa_member_id')::uuid,
      '50000000-0000-0000-0000-000000000012',
      array['80000000-0000-0000-0000-000000000001']::uuid[]
    );
    raise exception 'Expected confidential tag replacement rejection';
  exception when insufficient_privilege then
    null;
  end;

  if not exists (
    select 1 from public.crm_lead_tags
    where lead_id = '50000000-0000-0000-0000-000000000012'
      and tag_id = '80000000-0000-0000-0000-000000000002'
      and archived_at is null
  ) or exists (
    select 1 from public.crm_lead_tags
    where lead_id = '50000000-0000-0000-0000-000000000012'
      and tag_id = '80000000-0000-0000-0000-000000000001'
      and archived_at is null
  ) then
    raise exception 'Rejected tag replacement changed the active tag set';
  end if;
end
$assertions$;

do $assertions$
begin
  begin
    perform public.create_crm_lead_atomic(
      requested_organization_id => '10000000-0000-0000-0000-000000000001',
      requested_actor_profile_id => current_setting('crm.qa_member_id')::uuid,
      requested_topic => 'Intern candidate assessment',
      requested_company_name => 'Atomic rejected company',
      requested_contact_name => 'Atomic rejected contact',
      requested_status => 'contacted'
    );
    raise exception 'Expected non-founder atomic sensitive creation rejection';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.update_crm_lead_atomic(
      requested_organization_id => '10000000-0000-0000-0000-000000000001',
      requested_actor_profile_id => current_setting('crm.qa_member_id')::uuid,
      requested_lead_id => '50000000-0000-0000-0000-000000000012',
      requested_updates => jsonb_build_object(
        'notes', E'Entreprise: Atomic rejected update company\nContact: Atomic rejected update contact',
        'topic', 'Intern candidate update'
      ),
      requested_auto_company_name => 'Atomic rejected update company',
      requested_auto_contact_name => 'Atomic rejected update contact'
    );
    raise exception 'Expected non-founder atomic sensitive update rejection';
  exception when insufficient_privilege then
    null;
  end;

end
$assertions$;

reset role;
do $assertions$
begin
  if exists (
    select 1 from public.crm_companies
    where name = 'Atomic rejected company'
  ) or exists (
    select 1 from public.crm_contacts
    where name = 'Atomic rejected contact'
  ) or exists (
    select 1 from public.crm_leads
    where topic = 'Intern candidate assessment'
  ) or exists (
    select 1 from public.crm_companies
    where name = 'Atomic rejected update company'
  ) or exists (
    select 1 from public.crm_contacts
    where name = 'Atomic rejected update contact'
  ) or not exists (
    select 1 from public.crm_leads
    where id = '50000000-0000-0000-0000-000000000012'
      and topic = 'Assigned ordinary lead'
      and notes is null
      and access_scope = 'organization'
  ) then
    raise exception 'Rejected atomic create/update left a partial CRM write';
  end if;
end
$assertions$;

insert into public.crm_leads (
  id, organization_id, topic, status, access_scope
) values (
  '50000000-0000-0000-0000-000000000017',
  '10000000-0000-0000-0000-000000000001',
  'Founder atomic update seed',
  'contacted',
  'organization'
);

-- A cofounder can create the same family, and every related row is scoped in
-- the one committed transaction.
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  :'founder_id',
  true
);
select public.create_crm_lead_atomic(
  requested_organization_id => '10000000-0000-0000-0000-000000000001',
  requested_actor_profile_id => :'founder_id',
  requested_topic => 'Intern candidate assessment approved',
  requested_company_name => 'Atomic founder company',
  requested_contact_name => 'Atomic founder contact',
  requested_status => 'contacted'
);

select public.update_crm_lead_atomic(
  requested_organization_id => '10000000-0000-0000-0000-000000000001',
  requested_actor_profile_id => :'founder_id',
  requested_lead_id => '50000000-0000-0000-0000-000000000017',
  requested_updates => jsonb_build_object(
    'assigned_to_profile_id', :'founder_id',
    'notes', E'Entreprise: Atomic founder update company\nContact: Atomic founder update contact',
    'tag_ids', jsonb_build_array('80000000-0000-0000-0000-000000000001'),
    'topic', 'Intern candidate founder update'
  ),
  requested_auto_company_name => 'Atomic founder update company',
  requested_auto_contact_name => 'Atomic founder update contact'
);

do $assertions$
begin
  if exists (
    select 1
    from (
      select access_scope from public.crm_companies
      where name = 'Atomic founder company'
      union all
      select access_scope from public.crm_contacts
      where name = 'Atomic founder contact'
      union all
      select access_scope from public.crm_leads
      where topic = 'Intern candidate assessment approved'
    ) scopes
    where scopes.access_scope <> 'cofounders'
  ) or (
    select count(*) from public.crm_leads
    where topic = 'Intern candidate assessment approved'
  ) <> 1 then
    raise exception 'Founder atomic sensitive creation is incomplete or public';
  end if;
  if exists (
    select 1
    from (
      select access_scope from public.crm_companies
      where name = 'Atomic founder update company'
      union all
      select access_scope from public.crm_contacts
      where name = 'Atomic founder update contact'
      union all
      select access_scope from public.crm_leads
      where id = '50000000-0000-0000-0000-000000000017'
    ) scopes
    where scopes.access_scope <> 'cofounders'
  ) or not exists (
    select 1
    from public.crm_lead_tags
    where lead_id = '50000000-0000-0000-0000-000000000017'
      and tag_id = '80000000-0000-0000-0000-000000000001'
      and archived_at is null
  ) then
    raise exception 'Founder atomic sensitive update is incomplete or public';
  end if;
end
$assertions$;

reset role;

-- Bridge claim revalidates actor identity, organization, active row and scope,
-- then persists the exact actor binding. Cross-user confidential replay fails.
do $assertions$
begin
  begin
    perform * from public.claim_crm_bridge_action(
      repeat('a', 64),
      '10000000-0000-0000-0000-000000000001',
      current_setting('crm.qa_member_id')::uuid,
      'member@qarizmi.com',
      '50000000-0000-0000-0000-000000000011'
    );
    raise exception 'Expected non-founder confidential bridge claim rejection';
  exception when insufficient_privilege then
    null;
  end;

  perform * from public.claim_crm_bridge_action(
    repeat('b', 64),
    '10000000-0000-0000-0000-000000000001',
    current_setting('crm.qa_founder_id')::uuid,
    'ali@qarizmi.com',
    '50000000-0000-0000-0000-000000000011'
  );

  if not exists (
    select 1 from public.naia_consumed_action_tokens
    where token_hash = repeat('b', 64)
      and organization_id = '10000000-0000-0000-0000-000000000001'
      and actor_profile_id = current_setting('crm.qa_founder_id')::uuid
  ) then
    raise exception 'Bridge claim was not bound to the exact actor and organization';
  end if;

  begin
    perform * from public.claim_crm_bridge_action(
      repeat('c', 64),
      '10000000-0000-0000-0000-000000000001',
      current_setting('crm.qa_founder_id')::uuid,
      'member@qarizmi.com',
      null
    );
    raise exception 'Expected bridge actor email mismatch rejection';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.execute_crm_bridge_lead_status_action(
      repeat('d', 64),
      '10000000-0000-0000-0000-000000000001',
      current_setting('crm.qa_member_id')::uuid,
      'member@qarizmi.com',
      '50000000-0000-0000-0000-000000000012',
      'later-private'
    );
    raise exception 'Expected confidential status execution rejection';
  exception when insufficient_privilege then
    null;
  end;

  if exists (
    select 1 from public.naia_consumed_action_tokens
    where token_hash = repeat('d', 64)
  ) or not exists (
    select 1 from public.crm_leads
    where id = '50000000-0000-0000-0000-000000000012'
      and status = 'contacted'
      and access_scope = 'organization'
  ) then
    raise exception 'Rejected status execution consumed its token or mutated the lead';
  end if;

  update public.crm_leads
  set archived_at = now()
  where id = '50000000-0000-0000-0000-000000000012';

  begin
    perform public.execute_crm_bridge_lead_status_action(
      repeat('e', 64),
      '10000000-0000-0000-0000-000000000001',
      current_setting('crm.qa_founder_id')::uuid,
      'ali@qarizmi.com',
      '50000000-0000-0000-0000-000000000012',
      'contacted'
    );
    raise exception 'Expected archived lead execution rejection';
  exception when insufficient_privilege then
    null;
  end;

  if exists (
    select 1 from public.naia_consumed_action_tokens
    where token_hash = repeat('e', 64)
  ) then
    raise exception 'Rejected archived execution consumed its token';
  end if;
end
$assertions$;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'founder_id', true);
select public.claim_naia_web_action(
  repeat('f', 64),
  '10000000-0000-0000-0000-000000000001',
  :'founder_id'
);

do $assertions$
begin
  begin
    perform public.claim_naia_web_action(
      repeat('f', 64),
      '10000000-0000-0000-0000-000000000001',
      current_setting('crm.qa_founder_id')::uuid
    );
    raise exception 'Expected web approval replay rejection';
  exception when unique_violation then
    null;
  end;
end
$assertions$;
reset role;

rollback;
