create table if not exists public.bank_connections (
  id uuid primary key default gen_random_uuid(),
  project_id bigint not null references public.projects(id) on delete cascade,
  provider text not null default 'plaid' check (provider in ('plaid')),
  institution_id text,
  institution_name text not null default 'Bank of America',
  item_id text not null unique,
  access_token_ciphertext text not null,
  sync_cursor text,
  accounts jsonb not null default '[]'::jsonb check (jsonb_typeof(accounts) = 'array'),
  status text not null default 'connected' check (status in ('connected', 'error', 'disconnected')),
  last_error text,
  last_synced_at timestamptz,
  connected_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bank_connections_project_id_idx
  on public.bank_connections(project_id, created_at desc);

alter table public.bank_connections enable row level security;

-- Plaid access tokens are intentionally unavailable through the browser-facing API.
-- The plaid-bank Edge Function is the only application path that uses this table.
revoke all on public.bank_connections from anon, authenticated;

