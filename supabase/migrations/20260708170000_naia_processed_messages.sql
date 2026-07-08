-- Deduplication of inbound WhatsApp webhook messages. Meta delivers webhooks
-- at least once: a slow ack or a transient error triggers a redelivery of the
-- same message (same wamid). The first processing claims the wamid on the
-- primary key here; a redelivery fails the insert and is ignored, so a
-- command is never planned twice and buttons are never sent twice. Rows are
-- purged opportunistically after 7 days.

create table if not exists public.naia_processed_messages (
  wamid text primary key,
  processed_at timestamptz not null default now()
);

alter table public.naia_processed_messages enable row level security;

-- Service-role only: RLS is enabled with no policy on purpose, and the API
-- roles are revoked. Only the server-side webhook may read or write this.
revoke all on table public.naia_processed_messages from public, anon, authenticated;
