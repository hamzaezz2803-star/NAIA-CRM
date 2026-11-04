-- Meeting Intelligence and Docs Generator (Maya) were restricted to the two
-- hard-coded cofounder emails with the owner role. Open both modules to every
-- member of the organization (owner, admin, member, viewer). Organization
-- scoping is unchanged: every check still requires a membership in the row's
-- organization for the authenticated user.

create or replace function public.is_meeting_notes_cofounder(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.profile_id = auth.uid()
  );
$$;

create or replace function public.is_maya_pitch_cofounder(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.profile_id = auth.uid()
  );
$$;

create or replace function public.is_maya_pitch_owner(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.profile_id = auth.uid()
  );
$$;

-- The meeting Drive archive RPCs inline the same founder join. Rewrite the
-- deployed definitions in place, dropping only the owner-role and founder-email
-- predicates, and fail the migration if the result is not exactly that.
do $rewrite$
declare
  target regprocedure;
  original_definition text;
  rewritten_definition text;
  rewritten_count integer := 0;
begin
  for target in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'finalize_meeting_drive_archive',
        'authorize_worker_meeting_drive_archive',
        'finalize_worker_meeting_drive_archive'
      )
  loop
    original_definition := pg_get_functiondef(target);
    rewritten_definition := regexp_replace(
      original_definition,
      '\s+and membership\.role = ''owner''',
      '',
      'g'
    );
    rewritten_definition := regexp_replace(
      rewritten_definition,
      '\s+and lower\(user_record\.email\) in \(''ali@qarizmi\.com'', ''nabil@qarizmi\.com''\)',
      '',
      'g'
    );

    if rewritten_definition = original_definition
       or rewritten_definition ilike '%qarizmi.com%'
       or rewritten_definition ilike '%membership.role%' then
      raise exception 'Unexpected definition for %, refusing to rewrite', target;
    end if;

    execute rewritten_definition;
    rewritten_count := rewritten_count + 1;
  end loop;

  if rewritten_count <> 3 then
    raise exception 'Expected 3 meeting archive functions, rewrote %', rewritten_count;
  end if;
end;
$rewrite$;
