-- Qarizmi OS is invite-only. These SECURITY DEFINER helpers are required by
-- authenticated RLS policies or the post-login provisioning flow, but they are
-- not anonymous RPC endpoints.
revoke execute on function public.ensure_membership() from public, anon;
revoke execute on function public.is_org_admin(uuid) from public, anon;
revoke execute on function public.is_org_contributor(uuid) from public, anon;
revoke execute on function public.is_org_member(uuid) from public, anon;

grant execute on function public.ensure_membership() to authenticated, service_role;
grant execute on function public.is_org_admin(uuid) to authenticated, service_role;
grant execute on function public.is_org_contributor(uuid) to authenticated, service_role;
grant execute on function public.is_org_member(uuid) to authenticated, service_role;

-- Trigger functions execute through their owning database triggers. They must
-- not be callable through PostgREST by anonymous or signed-in users.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.sync_meeting_from_crm_lead()
from public, anon, authenticated;

grant execute on function public.handle_new_user() to service_role;
grant execute on function public.sync_meeting_from_crm_lead() to service_role;

-- Projects created with the dashboard's automatic-RLS option can contain this
-- event-trigger helper even though it is not part of the repository migration
-- chain. Harden it when present without breaking clean database rebuilds.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
    execute 'grant execute on function public.rls_auto_enable() to service_role';
  end if;
end
$$;
