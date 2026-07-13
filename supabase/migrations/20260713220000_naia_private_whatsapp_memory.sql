-- Bounded private WhatsApp conversation history for NAIA.
--
-- User commands are stored only after the Cloud API webhook has authenticated the
-- request, matched the configured NAIA phone-number id, and resolved the
-- sender through the private founder allowlist. Phone numbers are deliberately
-- not persisted: the profile and organization are the durable identity. NAIA
-- responses are deliberately excluded because they may contain Gmail,
-- Calendar, CRM, or private founder knowledge.

create table if not exists public.naia_private_whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role = 'user'),
  content text not null check (char_length(content) between 1 and 4096),
  created_at timestamptz not null default now()
);

create index if not exists naia_private_whatsapp_messages_profile_created_at_idx
  on public.naia_private_whatsapp_messages (organization_id, profile_id, created_at desc);

alter table public.naia_private_whatsapp_messages enable row level security;

-- The unauthenticated Meta webhook uses the service-role client after it has
-- verified the request. Browser and API roles must never read private history.
revoke all on table public.naia_private_whatsapp_messages from public, anon, authenticated;
