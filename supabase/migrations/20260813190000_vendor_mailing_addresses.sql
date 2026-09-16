alter table public.vendors
  add column if not exists mailing_address text;

alter table public.vendors
  add column if not exists updated_at timestamptz not null default now();

create index if not exists vendors_company_name_lookup_idx
  on public.vendors (company_id, lower(name));
