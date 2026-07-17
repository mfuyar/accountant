alter table public.project_checks
  add column if not exists template_key text not null default 'bofa'
  check (template_key in ('bofa', 'providence'));
