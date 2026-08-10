\set ON_ERROR_STOP on

-- Run after every migration preceding 20260809221616, and before applying
-- 20260809221616 itself. These rows reproduce the exact classifier ordering
-- gap that used to remain visible until 20260810000025.

insert into public.organizations (id, name, slug)
values (
  '11000000-0000-0000-0000-000000000001',
  'CRM Intermediate QA',
  'crm-intermediate-qa'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '21000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'ali@qarizmi.com', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '21000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'member-intermediate@qarizmi.com', '',
    now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  );

insert into public.profiles (id, email, full_name)
values
  (
    '21000000-0000-0000-0000-000000000001',
    'ali@qarizmi.com',
    'Ali Intermediate QA'
  ),
  (
    '21000000-0000-0000-0000-000000000002',
    'member-intermediate@qarizmi.com',
    'Member Intermediate QA'
  )
on conflict (id) do update
set email = excluded.email,
    full_name = excluded.full_name;

insert into public.organization_memberships (
  organization_id, profile_id, role
)
values
  (
    '11000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000001',
    'owner'
  ),
  (
    '11000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000002',
    'member'
  );

insert into public.crm_categories (
  id, organization_id, name, status_key, color, position
)
values (
  '71000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  'Intern pipeline',
  'intermediate-category',
  'gray',
  0
);

insert into public.crm_tags (id, organization_id, name, color)
values (
  '81000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  'Intern candidates',
  'teal'
);

insert into public.crm_leads (id, organization_id, topic, status)
values
  (
    '51000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000001',
    'Category-derived ordinary text',
    'intermediate-category'
  ),
  (
    '51000000-0000-0000-0000-000000000002',
    '11000000-0000-0000-0000-000000000001',
    'Tag-derived ordinary text',
    'contacted'
  );

insert into public.crm_lead_tags (lead_id, tag_id)
values (
  '51000000-0000-0000-0000-000000000002',
  '81000000-0000-0000-0000-000000000001'
);

insert into public.crm_contacts (id, organization_id, name)
values (
  '41000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  'Tag-derived ordinary contact'
);
insert into public.crm_contact_tags (contact_id, tag_id)
values (
  '41000000-0000-0000-0000-000000000001',
  '81000000-0000-0000-0000-000000000001'
);

insert into public.crm_tasks (id, organization_id, title)
values (
  '61000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  'Tag-derived ordinary task'
);
insert into public.crm_task_tags (task_id, tag_id)
values (
  '61000000-0000-0000-0000-000000000001',
  '81000000-0000-0000-0000-000000000001'
);
