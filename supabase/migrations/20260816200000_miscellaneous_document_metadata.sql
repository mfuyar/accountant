alter table public.documents
  add column if not exists display_name text,
  add column if not exists description text;
