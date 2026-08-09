\set ON_ERROR_STOP on

begin;

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
    '20000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'ali@qarizmi.com', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'member@qarizmi.com', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );

insert into public.profiles (id, email, full_name)
values
  ('20000000-0000-0000-0000-000000000001', 'ali@qarizmi.com', 'Ali QA'),
  ('20000000-0000-0000-0000-000000000002', 'member@qarizmi.com', 'Member QA')
on conflict (id) do update set email = excluded.email;

insert into public.organization_memberships (
  organization_id, profile_id, role
)
values
  (
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'owner'
  ),
  (
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000002',
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
  '20000000-0000-0000-0000-000000000002',
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
  '20000000-0000-0000-0000-000000000001',
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
  '20000000-0000-0000-0000-000000000001',
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
  '20000000-0000-0000-0000-000000000001',
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
  select id into target_run_id
  from public.crm_import_runs
  where source_external_id = 'qa-board-full';

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

  result := public.rollback_crm_trello_import(target_run_id);
  if (result ->> 'softArchivedOnRollback')::integer < 3 then
    raise exception 'Rollback did not soft-archive created entities: %', result;
  end if;
  if exists (
    select 1 from public.crm_external_refs
    where last_run_id = target_run_id and archived_at is null
  ) then
    raise exception 'Rollback left an active external reference';
  end if;
end
$assertions$;

reset role;
rollback;
