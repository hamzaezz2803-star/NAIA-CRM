create or replace function public.is_maya_pitch_cofounder(target_organization_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    join auth.users user_record on user_record.id = membership.profile_id
    where membership.organization_id = target_organization_id
      and membership.profile_id = auth.uid()
      and lower(user_record.email) in ('ali@qarizmi.com', 'nabil@qarizmi.com')
  );
$$;

revoke execute on function public.is_maya_pitch_cofounder(uuid) from public, anon;
grant execute on function public.is_maya_pitch_cofounder(uuid) to authenticated, service_role;

create table if not exists public.maya_pitch_library_decks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  drive_file_id text,
  file_name text not null,
  file_version text,
  kind text not null check (kind in ('generic', 'example', 'maya_draft', 'nabil_final')),
  client_name text,
  client_type text check (client_type in ('single-company', 'group', 'holding', 'portfolio')),
  industry_tags text[] not null default '{}',
  source_hash text,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  indexed_at timestamptz
);

create unique index if not exists maya_pitch_library_decks_drive_file_idx
  on public.maya_pitch_library_decks (organization_id, drive_file_id)
  where drive_file_id is not null;

create index if not exists maya_pitch_library_decks_kind_created_idx
  on public.maya_pitch_library_decks (organization_id, kind, created_at desc);

create table if not exists public.maya_pitch_library_slides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  deck_id uuid not null references public.maya_pitch_library_decks (id) on delete cascade,
  slide_number integer not null check (slide_number > 0),
  section text not null default 'unknown' check (section in ('presentation', 'offre', 'credentials', 'diagnostic', 'appendix', 'closing', 'unknown')),
  title text,
  extracted_text text not null default '',
  tags text[] not null default '{}',
  source_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, deck_id, slide_number)
);

create index if not exists maya_pitch_library_slides_deck_slide_idx
  on public.maya_pitch_library_slides (organization_id, deck_id, slide_number);

create table if not exists public.maya_pitch_briefs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  lead_id uuid references public.crm_leads (id) on delete cascade,
  client_name text not null,
  website_url text,
  contact_name text,
  contact_role text,
  client_type text not null default 'single-company' check (client_type in ('single-company', 'group', 'holding', 'portfolio')),
  industry text,
  crm_context jsonb not null default '{}'::jsonb,
  meeting_objective text,
  missing_questions jsonb not null default '[]'::jsonb,
  status text not null default 'needs-context' check (status in ('needs-context', 'ready', 'generating', 'draft-ready', 'final-uploaded', 'learned')),
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists maya_pitch_briefs_lead_idx
  on public.maya_pitch_briefs (organization_id, lead_id, updated_at desc);

create table if not exists public.maya_pitch_generation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  lead_id uuid references public.crm_leads (id) on delete set null,
  brief_id uuid references public.maya_pitch_briefs (id) on delete set null,
  generic_deck_id uuid references public.maya_pitch_library_decks (id) on delete set null,
  draft_drive_file_id text,
  draft_file_name text,
  draft_file_url text,
  final_drive_file_id text,
  final_file_name text,
  final_file_url text,
  status text not null default 'queued' check (status in ('queued', 'generating', 'draft-ready', 'failed', 'final-uploaded', 'learned')),
  model_used text,
  generation_notes jsonb not null default '{}'::jsonb,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists maya_pitch_generation_runs_lead_idx
  on public.maya_pitch_generation_runs (organization_id, lead_id, created_at desc);

create table if not exists public.maya_pitch_learning_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  run_id uuid not null references public.maya_pitch_generation_runs (id) on delete cascade,
  event_type text not null check (event_type in ('slide_removed', 'slide_added', 'slide_reordered', 'copy_changed', 'use_case_changed', 'credential_selection_changed')),
  summary text not null,
  before_excerpt text,
  after_excerpt text,
  weight numeric not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists maya_pitch_learning_events_type_idx
  on public.maya_pitch_learning_events (organization_id, event_type, created_at desc);

alter table public.maya_pitch_library_decks enable row level security;
alter table public.maya_pitch_library_slides enable row level security;
alter table public.maya_pitch_briefs enable row level security;
alter table public.maya_pitch_generation_runs enable row level security;
alter table public.maya_pitch_learning_events enable row level security;

create policy "cofounders can read maya pitch decks"
on public.maya_pitch_library_decks for select
to authenticated
using (public.is_maya_pitch_cofounder(organization_id));

create policy "cofounders can manage maya pitch decks"
on public.maya_pitch_library_decks for all
to authenticated
using (public.is_maya_pitch_cofounder(organization_id))
with check (public.is_maya_pitch_cofounder(organization_id));

create policy "cofounders can read maya pitch slides"
on public.maya_pitch_library_slides for select
to authenticated
using (public.is_maya_pitch_cofounder(organization_id));

create policy "cofounders can manage maya pitch slides"
on public.maya_pitch_library_slides for all
to authenticated
using (public.is_maya_pitch_cofounder(organization_id))
with check (public.is_maya_pitch_cofounder(organization_id));

create policy "cofounders can read maya pitch briefs"
on public.maya_pitch_briefs for select
to authenticated
using (public.is_maya_pitch_cofounder(organization_id));

create policy "cofounders can manage maya pitch briefs"
on public.maya_pitch_briefs for all
to authenticated
using (public.is_maya_pitch_cofounder(organization_id))
with check (public.is_maya_pitch_cofounder(organization_id));

create policy "cofounders can read maya pitch runs"
on public.maya_pitch_generation_runs for select
to authenticated
using (public.is_maya_pitch_cofounder(organization_id));

create policy "cofounders can manage maya pitch runs"
on public.maya_pitch_generation_runs for all
to authenticated
using (public.is_maya_pitch_cofounder(organization_id))
with check (public.is_maya_pitch_cofounder(organization_id));

create policy "cofounders can read maya pitch learning events"
on public.maya_pitch_learning_events for select
to authenticated
using (public.is_maya_pitch_cofounder(organization_id));

create policy "cofounders can manage maya pitch learning events"
on public.maya_pitch_learning_events for all
to authenticated
using (public.is_maya_pitch_cofounder(organization_id))
with check (public.is_maya_pitch_cofounder(organization_id));
