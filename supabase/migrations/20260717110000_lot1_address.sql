alter table public.project_lot_commitments
  drop constraint if exists project_lot_commitments_lot_check;

alter table public.project_lot_commitments
  add constraint project_lot_commitments_lot_check
  check (lot in ('Lot 1', 'Lot 2', 'Lot 3', 'Lot 4'));
