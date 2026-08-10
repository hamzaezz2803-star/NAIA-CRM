-- Cover foreign-key lookups used by PostgreSQL while preserving the existing
-- organization-first read indexes for the founder-only Meeting UI.

create index if not exists meeting_external_artifacts_meeting_id_idx
  on public.meeting_external_artifacts (meeting_id)
  where meeting_id is not null;

create index if not exists meeting_external_artifacts_imported_by_profile_id_idx
  on public.meeting_external_artifacts (imported_by_profile_id)
  where imported_by_profile_id is not null;
