alter table public.cost_versions
  drop constraint if exists cost_versions_phase_check;

alter table public.cost_versions
  add constraint cost_versions_phase_check
  check (phase in ('development', 'construction', 'soft_cost', 'other'));

alter table public.cost_categories
  drop constraint if exists cost_categories_phase_check;

alter table public.cost_categories
  add constraint cost_categories_phase_check
  check (phase in ('development', 'construction', 'soft_cost', 'other'));

create or replace function private.seed_project_categories()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.cost_categories (project_id, phase, name, budgeted_amount)
  values
    (new.id, 'development', 'Development', 0),
    (new.id, 'construction', 'Construction', 0),
    (new.id, 'soft_cost', 'Soft Cost', 0),
    (new.id, 'other', 'Other', 0);
  return new;
end;
$$;

insert into public.cost_categories (project_id, phase, name, budgeted_amount)
select p.id, defaults.phase, defaults.name, 0
from public.projects p
cross join (values ('soft_cost', 'Soft Cost'), ('other', 'Other')) defaults(phase, name)
where not exists (
  select 1 from public.cost_categories c
  where c.project_id = p.id and c.phase = defaults.phase and lower(c.name) = lower(defaults.name)
);
