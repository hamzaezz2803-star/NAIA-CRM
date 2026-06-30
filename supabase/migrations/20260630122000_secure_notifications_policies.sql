-- Migration to secure notifications RLS policies:
-- Only allow users to insert, update, or delete their own notifications (profile_id = auth.uid()).
-- Drop old policies first:
drop policy if exists "system can insert notifications" on public.notifications;
drop policy if exists "members can insert their own notifications" on public.notifications;
drop policy if exists "members can mark notifications as read" on public.notifications;
drop policy if exists "members can delete notifications" on public.notifications;

-- Create secure insert policy:
create policy "members can insert their own notifications"
on public.notifications for insert
with check (
  public.is_org_member(organization_id)
  and profile_id = auth.uid()
);

-- Create secure update policy:
create policy "members can mark notifications as read"
on public.notifications for update
using (
  public.is_org_member(organization_id)
  and profile_id = auth.uid()
)
with check (
  public.is_org_member(organization_id)
  and profile_id = auth.uid()
);

-- Create secure delete policy:
create policy "members can delete notifications"
on public.notifications for delete
using (
  public.is_org_member(organization_id)
  and profile_id = auth.uid()
);
