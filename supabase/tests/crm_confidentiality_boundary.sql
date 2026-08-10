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
  ) then
    raise exception 'Rejected atomic creation left a partial CRM write';
  end if;
end
$assertions$;

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
