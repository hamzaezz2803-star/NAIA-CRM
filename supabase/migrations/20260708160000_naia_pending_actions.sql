-- NAIA pending action drafts for conversational bridges (WhatsApp today).
--
-- WhatsApp Cloud API reply-button ids are capped at 256 characters, far too
-- small for a serialized {action, command, approvalToken} draft (the Slack
-- bridge inlines it in 2000-character button values). Drafts are therefore
-- parked in this table and the button id only carries the row uuid. Expired
-- rows are purged on read and every claim is single-use.
--
-- Rows are service-role only on purpose: the webhook has no user session and
-- browser clients must never be able to read or forge pending approvals.

create table if not exists public.naia_pending_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  draft jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists naia_pending_actions_expires_idx
  on public.naia_pending_actions (expires_at);

alter table public.naia_pending_actions enable row level security;

-- No RLS policies on purpose: only the service-role key (which bypasses RLS)
-- may touch pending drafts. Revoke direct grants as defense in depth.
revoke all on table public.naia_pending_actions from public, anon, authenticated;
