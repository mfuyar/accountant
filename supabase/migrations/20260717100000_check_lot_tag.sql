alter table public.project_checks
  add column if not exists lot text check (lot in ('Lot 1', 'Lot 2', 'Lot 3', 'Lot 4'));

create index if not exists project_checks_lot_idx
  on public.project_checks (project_id, lot) where lot is not null;
