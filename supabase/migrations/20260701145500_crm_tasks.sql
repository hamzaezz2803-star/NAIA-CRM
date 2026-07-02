-- Create crm_tasks table
create table if not exists public.crm_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'todo', -- 'todo', 'in-progress', 'done'
  due_date timestamptz,
  lead_id uuid references public.crm_leads (id) on delete cascade,
  assigned_to_profile_id uuid references public.profiles (id) on delete set null,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Junction table for task tags
create table if not exists public.crm_task_tags (
  task_id uuid not null references public.crm_tasks (id) on delete cascade,
  tag_id uuid not null references public.crm_tags (id) on delete cascade,
  primary key (task_id, tag_id)
);

-- Enable RLS
alter table public.crm_tasks enable row level security;
alter table public.crm_task_tags enable row level security;

-- RLS policies
drop policy if exists "members can do all on crm_tasks" on public.crm_tasks;
create policy "members can do all on crm_tasks"
  on public.crm_tasks for all
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists "members can do all on crm_task_tags" on public.crm_task_tags;
create policy "members can do all on crm_task_tags"
  on public.crm_task_tags for all
  using (
    exists (
      select 1 from public.crm_tasks t
      where t.id = task_id and public.is_org_member(t.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.crm_tasks t
      where t.id = task_id and public.is_org_member(t.organization_id)
    )
  );

grant select, insert, update, delete
on public.crm_tasks, public.crm_task_tags
to authenticated;

grant all privileges
on public.crm_tasks, public.crm_task_tags
to service_role;
