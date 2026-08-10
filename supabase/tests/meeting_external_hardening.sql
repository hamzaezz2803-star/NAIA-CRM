\set ON_ERROR_STOP on

begin;
set local statement_timeout = '10s';

select coalesce(
  (select id::text from auth.users where lower(email) = 'ali@qarizmi.com' limit 1),
  '8a000000-0000-4000-8000-000000000001'
) as founder_id
\gset

select coalesce(
  (select id::text from auth.users where lower(email) = 'worker-member@qarizmi.com' limit 1),
  '8a000000-0000-4000-8000-000000000002'
) as member_id
\gset

insert into public.organizations (id, name, slug)
values (
  '8a000000-0000-4000-8000-000000000010',
  'Meeting External QA',
  'meeting-external-qa'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  :'founder_id',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'ali@qarizmi.com', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
)
on conflict (id) do update set email = excluded.email;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  :'member_id',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'worker-member@qarizmi.com', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
)
on conflict (id) do update set email = excluded.email;

insert into public.profiles (id, email, full_name)
values (:'founder_id', 'ali@qarizmi.com', 'Ali Meeting QA')
on conflict (id) do update set email = excluded.email;

insert into public.profiles (id, email, full_name)
values (:'member_id', 'worker-member@qarizmi.com', 'Worker Member QA')
on conflict (id) do update set email = excluded.email;

insert into public.organization_memberships (organization_id, profile_id, role)
values (
  '8a000000-0000-4000-8000-000000000010', :'founder_id', 'owner'
)
on conflict (organization_id, profile_id) do update set role = excluded.role;

insert into public.organization_memberships (organization_id, profile_id, role)
values (
  '8a000000-0000-4000-8000-000000000010', :'member_id', 'member'
)
on conflict (organization_id, profile_id) do update set role = excluded.role;

insert into public.crm_companies (id, organization_id, name, access_scope)
values (
  '8a000000-0000-4000-8000-000000000020',
  '8a000000-0000-4000-8000-000000000010',
  'Atlas',
  'cofounders'
);

insert into public.meetings (
  id, organization_id, company_id, title, starts_at, status, source,
  created_by_profile_id
)
values (
  '8a000000-0000-4000-8000-000000000030',
  '8a000000-0000-4000-8000-000000000010',
  '8a000000-0000-4000-8000-000000000020',
  'Atlas kickoff',
  '2026-08-10T09:30:00Z',
  'review-ready',
  'manual',
  :'founder_id'
);

insert into public.meeting_outputs (
  id, organization_id, meeting_id, job_id, version, notes_markdown,
  transcript_text, transcript_srt, structured_output, review_revision
)
values (
  '8a000000-0000-4000-8000-000000000040',
  '8a000000-0000-4000-8000-000000000010',
  '8a000000-0000-4000-8000-000000000030',
  null,
  2,
  'Meeting notes',
  'Transcript',
  'SRT',
  '{}'::jsonb,
  3
);

insert into public.meeting_assets (
  id, organization_id, meeting_id, kind, provider, display_name,
  storage_path, mime_type, created_by_profile_id
)
values (
  '8a000000-0000-4000-8000-000000000050',
  '8a000000-0000-4000-8000-000000000010',
  '8a000000-0000-4000-8000-000000000030',
  'audio-recording',
  'supabase-storage',
  'recording.webm',
  '8a000000-0000-4000-8000-000000000010/8a000000-0000-4000-8000-000000000030/recording.webm',
  'audio/webm',
  :'founder_id'
);

insert into public.meeting_processing_jobs (
  id, organization_id, meeting_id, audio_asset_id, status, worker_id,
  lease_token, lease_expires_at, created_by_profile_id
)
values (
  '8a000000-0000-4000-8000-000000000060',
  '8a000000-0000-4000-8000-000000000010',
  '8a000000-0000-4000-8000-000000000030',
  '8a000000-0000-4000-8000-000000000050',
  'finalizing',
  'qa-worker',
  '8a000000-0000-4000-8000-000000000070',
  now() + interval '10 minutes',
  :'founder_id'
);

insert into public.meeting_outputs (
  id, organization_id, meeting_id, job_id, version, notes_markdown,
  transcript_text, transcript_srt, structured_output, review_revision
)
values (
  '8a000000-0000-4000-8000-000000000041',
  '8a000000-0000-4000-8000-000000000010',
  '8a000000-0000-4000-8000-000000000030',
  '8a000000-0000-4000-8000-000000000060',
  1,
  'Worker notes',
  'Worker transcript',
  'Worker SRT',
  '{}'::jsonb,
  0
);

do $assertions$
begin
  if has_table_privilege(
    'authenticated', 'public.meeting_gemini_sync_states', 'SELECT'
  ) then
    raise exception 'authenticated can read durable Gemini provider cursors';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.meeting_gemini_sync_states'::regclass) then
    raise exception 'Gemini sync state RLS is disabled';
  end if;
end
$assertions$;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'founder_id', true);

do $assertions$
declare
  authorized boolean;
  finalized boolean;
begin
  authorized := public.authorize_meeting_drive_archive(
    '8a000000-0000-4000-8000-000000000010',
    '8a000000-0000-4000-8000-000000000030',
    '8a000000-0000-4000-8000-000000000020',
    'Atlas',
    '8a000000-0000-4000-8000-000000000040',
    2,
    3
  );
  if authorized is not true then
    raise exception 'live founder archive authorization failed';
  end if;

  finalized := public.finalize_meeting_drive_archive(
    '8a000000-0000-4000-8000-000000000010',
    '8a000000-0000-4000-8000-000000000030',
    '8a000000-0000-4000-8000-000000000020',
    'Atlas',
    '8a000000-0000-4000-8000-000000000040',
    2,
    3,
    'drive-folder',
    'https://drive.google.com/drive/folders/drive-folder',
    jsonb_build_array(
      jsonb_build_object('externalId','drive-notes','kind','meeting-notes','mimeType','text/markdown','name','notes.md','parentFolderId','drive-folder','sha256',repeat('a',64),'sizeBytes',12,'url','https://drive.google.com/file/d/drive-notes/view'),
      jsonb_build_object('externalId','drive-text','kind','transcript-text','mimeType','text/plain','name','transcript.txt','parentFolderId','drive-folder','sha256',repeat('b',64),'sizeBytes',10,'url','https://drive.google.com/file/d/drive-text/view'),
      jsonb_build_object('externalId','drive-srt','kind','transcript-srt','mimeType','application/x-subrip','name','transcript.srt','parentFolderId','drive-folder','sha256',repeat('c',64),'sizeBytes',3,'url','https://drive.google.com/file/d/drive-srt/view'),
      jsonb_build_object('externalId','drive-json','kind','structured-output','mimeType','application/json','name','analysis.json','parentFolderId','drive-folder','sha256',repeat('d',64),'sizeBytes',2,'url','https://drive.google.com/file/d/drive-json/view')
    ),
    '[]'::jsonb,
    '[]'::jsonb
  );
  if finalized is not true then
    raise exception 'atomic Drive archive finalization failed';
  end if;
end
$assertions$;

do $assertions$
begin
  begin
    perform public.finalize_meeting_drive_archive(
      '8a000000-0000-4000-8000-000000000010',
      '8a000000-0000-4000-8000-000000000030',
      '8a000000-0000-4000-8000-000000000020',
      'Atlas',
      '8a000000-0000-4000-8000-000000000040',
      2,
      3,
      'rollback-folder',
      'https://drive.google.com/drive/folders/rollback-folder',
      jsonb_build_array(
        jsonb_build_object('externalId','rollback-first','kind','meeting-notes','mimeType','text/markdown','name','rollback-notes.md','parentFolderId','rollback-folder','sha256',repeat('1',64),'sizeBytes',12),
        jsonb_build_object('externalId','rollback-overflow','kind','transcript-text','mimeType','text/plain','name','rollback-transcript.txt','parentFolderId','rollback-folder','sha256',repeat('2',64),'sizeBytes','999999999999999999999999999999999999'),
        jsonb_build_object('externalId','rollback-srt','kind','transcript-srt','mimeType','application/x-subrip','name','rollback-transcript.srt','parentFolderId','rollback-folder','sha256',repeat('3',64),'sizeBytes',3),
        jsonb_build_object('externalId','rollback-json','kind','structured-output','mimeType','application/json','name','rollback-analysis.json','parentFolderId','rollback-folder','sha256',repeat('4',64),'sizeBytes',2)
      ),
      '[]'::jsonb,
      '[]'::jsonb
    );
    raise exception 'second-asset failure did not abort the archive';
  exception
    when numeric_value_out_of_range then null;
  end;
end
$assertions$;

reset role;
do $assertions$
begin
  if exists (
    select 1 from public.meeting_assets
    where meeting_id = '8a000000-0000-4000-8000-000000000030'
      and external_id like 'rollback-%'
  ) then
    raise exception 'failed archive retained a partial asset manifest';
  end if;
end
$assertions$;

do $assertions$
declare
  mixed_case_manifest jsonb := jsonb_build_array(
    jsonb_build_object('externalId','a_drive','kind','meeting-notes','mimeType','text/markdown','name','notes.md','parentFolderId','meeting-folder','sha256',repeat('a',64),'sizeBytes',42,'url','https://drive.google.com/file/d/a_drive/view'),
    jsonb_build_object('externalId','A-drive','kind','transcript-text','mimeType','text/plain','name','transcript.txt','parentFolderId','meeting-folder','sha256',repeat('b',64),'sizeBytes',42,'url','https://drive.google.com/file/d/A-drive/view'),
    jsonb_build_object('externalId','_drive','kind','transcript-srt','mimeType','application/x-subrip','name','transcript.srt','parentFolderId','meeting-folder','sha256',repeat('c',64),'sizeBytes',42,'url','https://drive.google.com/file/d/_drive/view'),
    jsonb_build_object('externalId','-drive','kind','structured-output','mimeType','application/json','name','analysis.json','parentFolderId','meeting-folder','sha256',repeat('d',64),'sizeBytes',42,'url','https://drive.google.com/file/d/-drive/view')
  );
begin
  if public.calculate_meeting_archive_manifest_sha256(mixed_case_manifest)
    <> 'c869bb59e10ed7aaf66a07104bd9cfb422a4f3c2ef6626801bae670bd5951584'
  then
    raise exception 'SQL archive manifest canonicalization diverges from the worker implementation';
  end if;
end
$assertions$;

select set_config(
  'meeting.qa_archive_manifest',
  jsonb_build_array(
    jsonb_build_object('externalId','drive-notes','kind','meeting-notes','mimeType','text/markdown','name','notes.md','parentFolderId','drive-folder','sha256',repeat('a',64),'sizeBytes',12,'url','https://drive.google.com/file/d/drive-notes/view'),
    jsonb_build_object('externalId','drive-text','kind','transcript-text','mimeType','text/plain','name','transcript.txt','parentFolderId','drive-folder','sha256',repeat('b',64),'sizeBytes',10,'url','https://drive.google.com/file/d/drive-text/view'),
    jsonb_build_object('externalId','drive-srt','kind','transcript-srt','mimeType','application/x-subrip','name','transcript.srt','parentFolderId','drive-folder','sha256',repeat('c',64),'sizeBytes',3,'url','https://drive.google.com/file/d/drive-srt/view'),
    jsonb_build_object('externalId','drive-json','kind','structured-output','mimeType','application/json','name','analysis.json','parentFolderId','drive-folder','sha256',repeat('d',64),'sizeBytes',2,'url','https://drive.google.com/file/d/drive-json/view')
  )::text,
  true
);
select set_config(
  'meeting.qa_archive_manifest_hash',
  public.calculate_meeting_archive_manifest_sha256(
    current_setting('meeting.qa_archive_manifest')::jsonb
  ),
  true
);

set local role service_role;

do $assertions$
declare
  finalized boolean;
begin
  if not public.authorize_worker_meeting_drive_archive(
    '8a000000-0000-4000-8000-000000000060',
    'qa-worker',
    '8a000000-0000-4000-8000-000000000070',
    '8a000000-0000-4000-8000-000000000010',
    '8a000000-0000-4000-8000-000000000030',
    '8a000000-0000-4000-8000-000000000020',
    'Atlas',
    '8a000000-0000-4000-8000-000000000041',
    1,
    0
  ) then
    raise exception 'valid worker archive lease was rejected';
  end if;

  if public.authorize_worker_meeting_drive_archive(
    '8a000000-0000-4000-8000-000000000060',
    'qa-worker',
    '8a000000-0000-4000-8000-000000000070',
    '8a000000-0000-4000-8000-000000000010',
    '8a000000-0000-4000-8000-000000000030',
    '8a000000-0000-4000-8000-000000000020',
    'Atlas',
    '8a000000-0000-4000-8000-000000000040',
    1,
    0
  ) then
    raise exception 'worker authorized an output from another job/version';
  end if;

  finalized := public.finalize_worker_meeting_drive_archive(
    '8a000000-0000-4000-8000-000000000060',
    'qa-worker',
    '8a000000-0000-4000-8000-000000000070',
    '8a000000-0000-4000-8000-000000000010',
    '8a000000-0000-4000-8000-000000000030',
    '8a000000-0000-4000-8000-000000000020',
    'Atlas',
    '8a000000-0000-4000-8000-000000000041',
    1,
    0,
    'drive-folder',
    'https://drive.google.com/drive/folders/drive-folder',
    current_setting('meeting.qa_archive_manifest')::jsonb,
    current_setting('meeting.qa_archive_manifest_hash'),
    '[]'::jsonb,
    '[]'::jsonb
  );
  if finalized is not true then
    raise exception 'worker archive CAS finalization failed';
  end if;

  finalized := public.finalize_worker_meeting_drive_archive(
    '8a000000-0000-4000-8000-000000000060',
    'qa-worker',
    '8a000000-0000-4000-8000-000000000070',
    '8a000000-0000-4000-8000-000000000010',
    '8a000000-0000-4000-8000-000000000030',
    '8a000000-0000-4000-8000-000000000020',
    'Atlas',
    '8a000000-0000-4000-8000-000000000041',
    1,
    0,
    'drive-folder',
    'https://drive.google.com/drive/folders/drive-folder',
    current_setting('meeting.qa_archive_manifest')::jsonb,
    current_setting('meeting.qa_archive_manifest_hash'),
    '[]'::jsonb,
    '[]'::jsonb
  );
  if finalized is not true then
    raise exception 'idempotent worker archive replay failed';
  end if;

  if public.finalize_worker_meeting_drive_archive(
    '8a000000-0000-4000-8000-000000000060',
    'qa-worker',
    '8a000000-0000-4000-8000-000000000070',
    '8a000000-0000-4000-8000-000000000010',
    '8a000000-0000-4000-8000-000000000030',
    '8a000000-0000-4000-8000-000000000020',
    'Atlas',
    '8a000000-0000-4000-8000-000000000041',
    1,
    0,
    'drive-folder',
    'https://drive.google.com/drive/folders/drive-folder',
    current_setting('meeting.qa_archive_manifest')::jsonb,
    repeat('f', 64),
    '[]'::jsonb,
    '[]'::jsonb
  ) then
    raise exception 'worker accepted a mismatched archive manifest hash';
  end if;
end
$assertions$;

reset role;
update public.meeting_processing_jobs
set lease_expires_at = now() - interval '1 second'
where id = '8a000000-0000-4000-8000-000000000060';
set local role service_role;
do $assertions$
begin
  if public.authorize_worker_meeting_drive_archive(
    '8a000000-0000-4000-8000-000000000060','qa-worker',
    '8a000000-0000-4000-8000-000000000070',
    '8a000000-0000-4000-8000-000000000010',
    '8a000000-0000-4000-8000-000000000030',
    '8a000000-0000-4000-8000-000000000020','Atlas',
    '8a000000-0000-4000-8000-000000000041',1,0
  ) then raise exception 'expired worker lease retained Drive authorization'; end if;
end
$assertions$;

reset role;
update public.meeting_processing_jobs
set lease_expires_at = now() + interval '10 minutes',
    created_by_profile_id = :'member_id'
where id = '8a000000-0000-4000-8000-000000000060';
set local role service_role;
do $assertions$
begin
  if public.authorize_worker_meeting_drive_archive(
    '8a000000-0000-4000-8000-000000000060','qa-worker',
    '8a000000-0000-4000-8000-000000000070',
    '8a000000-0000-4000-8000-000000000010',
    '8a000000-0000-4000-8000-000000000030',
    '8a000000-0000-4000-8000-000000000020','Atlas',
    '8a000000-0000-4000-8000-000000000041',1,0
  ) then raise exception 'non-founder job creator retained Drive authorization'; end if;
end
$assertions$;

reset role;
update public.meeting_processing_jobs
set created_by_profile_id = :'founder_id'
where id = '8a000000-0000-4000-8000-000000000060';
update public.organization_memberships
set role = 'member'
where organization_id = '8a000000-0000-4000-8000-000000000010'
  and profile_id = :'founder_id';
set local role service_role;
do $assertions$
begin
  if public.authorize_worker_meeting_drive_archive(
    '8a000000-0000-4000-8000-000000000060','qa-worker',
    '8a000000-0000-4000-8000-000000000070',
    '8a000000-0000-4000-8000-000000000010',
    '8a000000-0000-4000-8000-000000000030',
    '8a000000-0000-4000-8000-000000000020','Atlas',
    '8a000000-0000-4000-8000-000000000041',1,0
  ) then raise exception 'revoked owner retained worker Drive authorization'; end if;
end
$assertions$;

reset role;
update public.organization_memberships
set role = 'owner'
where organization_id = '8a000000-0000-4000-8000-000000000010'
  and profile_id = :'founder_id';
set local role authenticated;
select set_config('request.jwt.claim.sub', :'founder_id', true);

do $assertions$
declare
  claim jsonb;
  second_claim jsonb;
  completed boolean;
begin
  claim := public.claim_meeting_gemini_sync(
    '8a000000-0000-4000-8000-000000000010', 180
  );
  if claim->>'action' <> 'execute'
     or (claim->>'maxResults')::integer <> 25 then
    raise exception 'first Gemini sync claim was not bounded executable';
  end if;
  perform set_config('meeting.qa_sync_lease', claim->>'leaseToken', true);

  second_claim := public.claim_meeting_gemini_sync(
    '8a000000-0000-4000-8000-000000000010', 180
  );
  if second_claim->>'action' <> 'busy' then
    raise exception 'concurrent Gemini sync was not rejected';
  end if;

  completed := public.complete_meeting_gemini_sync(
    '8a000000-0000-4000-8000-000000000010',
    (claim->>'leaseToken')::uuid,
    'cursor-page-2',
    25,
    5,
    1048576
  );
  if completed is not true then
    raise exception 'Gemini cursor page did not finalize';
  end if;

  second_claim := public.claim_meeting_gemini_sync(
    '8a000000-0000-4000-8000-000000000010', 180
  );
  if second_claim->>'action' <> 'cooldown' then
    raise exception 'Gemini cooldown was not enforced';
  end if;
end
$assertions$;

reset role;

update public.meeting_gemini_sync_states
set next_allowed_at = now() - interval '1 second'
where organization_id = '8a000000-0000-4000-8000-000000000010'
  and profile_id = :'founder_id';

set local role authenticated;
select set_config('request.jwt.claim.sub', :'founder_id', true);

do $assertions$
declare
  resumed jsonb;
begin
  resumed := public.claim_meeting_gemini_sync(
    '8a000000-0000-4000-8000-000000000010', 180
  );
  if resumed->>'action' <> 'execute'
     or resumed->>'pageToken' <> 'cursor-page-2' then
    raise exception 'Gemini durable cursor did not resume';
  end if;
  if not public.release_meeting_gemini_sync_claim(
    '8a000000-0000-4000-8000-000000000010',
    (resumed->>'leaseToken')::uuid,
    'synthetic release'
  ) then
    raise exception 'Gemini lease release failed';
  end if;
end
$assertions$;

reset role;

update public.meeting_outputs
set review_revision = 4
where id = '8a000000-0000-4000-8000-000000000040';

set local role authenticated;
select set_config('request.jwt.claim.sub', :'founder_id', true);

do $assertions$
begin
  if public.authorize_meeting_drive_archive(
    '8a000000-0000-4000-8000-000000000010',
    '8a000000-0000-4000-8000-000000000030',
    '8a000000-0000-4000-8000-000000000020',
    'Atlas',
    '8a000000-0000-4000-8000-000000000040',
    2,
    3
  ) then
    raise exception 'stale output revision retained Drive authorization';
  end if;
end
$assertions$;

reset role;
update public.organization_memberships
set role = 'member'
where organization_id = '8a000000-0000-4000-8000-000000000010'
  and profile_id = :'founder_id';

set local role authenticated;
select set_config('request.jwt.claim.sub', :'founder_id', true);

do $assertions$
begin
  if public.authorize_meeting_drive_archive(
    '8a000000-0000-4000-8000-000000000010',
    '8a000000-0000-4000-8000-000000000030',
    '8a000000-0000-4000-8000-000000000020',
    'Atlas',
    '8a000000-0000-4000-8000-000000000040',
    2,
    4
  ) then
    raise exception 'downgraded founder retained Drive authorization';
  end if;
end
$assertions$;

rollback;
