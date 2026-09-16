alter table public.project_checks
  add column if not exists check_type text not null default 'payment',
  add column if not exists destination_account text not null default '';

-- Promote records saved through the compatibility marker before these columns
-- existed, then remove only the transfer markers from the visible memo.
update public.project_checks
set
  check_type = 'internal_transfer',
  destination_account = coalesce(replace(
    substring(memo from '\[\[greenfort-transfer-destination:([^]]+)\]\]'),
    '%20',
    ' '
  ), ''),
  invoice_id = null,
  cost_id = null,
  funded_by_income_id = null,
  lot = null,
  memo = trim(regexp_replace(
    regexp_replace(memo, E'\\n?\\[\\[greenfort-check-type:internal_transfer\\]\\]', '', 'g'),
    E'\\n?\\[\\[greenfort-transfer-destination:[^]]+\\]\\]',
    '',
    'g'
  ))
where memo like '%[[greenfort-check-type:internal_transfer]]%';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'project_checks_check_type_check'
  ) then
    alter table public.project_checks
      add constraint project_checks_check_type_check
      check (check_type in ('payment', 'internal_transfer'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'project_checks_internal_transfer_links_check'
  ) then
    alter table public.project_checks
      add constraint project_checks_internal_transfer_links_check
      check (
        check_type <> 'internal_transfer'
        or (
          invoice_id is null
          and cost_id is null
          and funded_by_income_id is null
          and lot is null
        )
      );
  end if;
end $$;

comment on column public.project_checks.check_type is
  'payment is an outside/vendor payment; internal_transfer moves cash between company-owned accounts and is not a cost.';

comment on column public.project_checks.destination_account is
  'Safe display label for the receiving account on an internal transfer; never a routing or full account number.';
