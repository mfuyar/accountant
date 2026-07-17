alter table public.project_lot_commitments
  add column if not exists permit_number text;
