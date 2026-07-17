alter table public.project_checks
  add column if not exists invoice_id bigint references public.invoices(id) on delete set null,
  add column if not exists cost_id uuid;

create index if not exists project_checks_invoice_idx
  on public.project_checks (project_id, invoice_id) where invoice_id is not null;
create index if not exists project_checks_cost_idx
  on public.project_checks (project_id, cost_id) where cost_id is not null;

alter table public.project_checks
  drop constraint if exists project_checks_single_accounting_link;
alter table public.project_checks
  add constraint project_checks_single_accounting_link
  check (invoice_id is null or cost_id is null);
