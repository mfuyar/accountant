alter table public.project_checks
  add column if not exists funded_by_income_id bigint references public.incomes(id) on delete set null;

create index if not exists project_checks_funded_by_income_idx
  on public.project_checks (funded_by_income_id) where funded_by_income_id is not null;
