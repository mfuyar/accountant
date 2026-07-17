alter table public.incomes
  add column if not exists lot_breakdown jsonb not null default '[]'::jsonb
  check (jsonb_typeof(lot_breakdown) = 'array');

alter table public.incomes
  add column if not exists attachments jsonb not null default '[]'::jsonb
  check (jsonb_typeof(attachments) = 'array');
