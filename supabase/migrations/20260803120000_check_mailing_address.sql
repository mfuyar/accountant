alter table public.project_checks
  add column if not exists mailing_address text not null default '';

