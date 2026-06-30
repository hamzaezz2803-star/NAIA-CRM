-- Migration to allow authenticated users to delete their own notifications or organization-wide notifications.
drop policy if exists "members can delete notifications" on public.notifications;

create policy "members can delete notifications"
on public.notifications for delete
using (
  public.is_org_member(organization_id)
  and (profile_id is null or profile_id = auth.uid())
);
