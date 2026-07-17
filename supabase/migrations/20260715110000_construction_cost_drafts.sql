create table if not exists public.construction_cost_drafts (
  id uuid primary key default gen_random_uuid(),
  project_id bigint not null references public.projects(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  details text not null default '',
  planned_amount numeric(12,2) check (planned_amount is null or planned_amount >= 0),
  planned_date date,
  status text not null default 'draft' check (status in ('draft', 'converted')),
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  source_label text,
  sort_order integer not null default 0,
  converted_cost_id uuid,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists construction_cost_drafts_project_name_key
  on public.construction_cost_drafts (project_id, lower(name));
create index if not exists construction_cost_drafts_project_status_idx
  on public.construction_cost_drafts (project_id, status, sort_order);

alter table public.construction_cost_drafts enable row level security;

drop policy if exists construction_cost_drafts_project_admin_access on public.construction_cost_drafts;
create policy construction_cost_drafts_project_admin_access on public.construction_cost_drafts
  for all to authenticated
  using (private.can_manage_project(project_id))
  with check (private.can_manage_project(project_id));

grant select, insert, update, delete on public.construction_cost_drafts to authenticated;
revoke all on public.construction_cost_drafts from anon;
