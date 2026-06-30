-- Notifications table
-- Stores persistent notifications and alerts.
-- Note: CRM reminders are generated dynamically, not stored here.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete cascade, -- if null, it's an org-wide notification
  title text not null,
  description text,
  type text not null default 'system' check (type in ('system', 'mention', 'alert', 'success')),
  link_url text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_org_profile_idx
  on public.notifications (organization_id, profile_id);

create index if not exists notifications_unread_idx
  on public.notifications (organization_id, profile_id, is_read)
  where is_read = false;

-- Enable RLS
alter table public.notifications enable row level security;

-- Policies
create policy "members can read notifications"
on public.notifications for select
using (
  public.is_org_member(organization_id)
  and (profile_id is null or profile_id = auth.uid())
);

create policy "members can mark notifications as read"
on public.notifications for update
using (
  public.is_org_member(organization_id)
  and (profile_id is null or profile_id = auth.uid())
)
with check (
  public.is_org_member(organization_id)
  and (profile_id is null or profile_id = auth.uid())
);

create policy "system can insert notifications"
on public.notifications for insert
with check (public.is_org_member(organization_id));
