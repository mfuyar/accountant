alter table public.project_lot_commitments
  drop constraint project_lot_commitments_lot_check;

alter table public.project_lot_commitments
  add constraint project_lot_commitments_lot_check
  check (lot = any (array['Subdivision', 'Lot 1', 'Lot 2', 'Lot 3', 'Lot 4']));
