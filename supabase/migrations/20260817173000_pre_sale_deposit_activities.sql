alter table public.incomes
  drop constraint if exists incomes_income_type_check;

alter table public.incomes
  add constraint incomes_income_type_check
  check (income_type in ('project_income', 'refund', 'reimbursement', 'other', 'loan_draw', 'pre_sale_deposit'));

alter table public.incomes
  add column if not exists activity_breakdown jsonb not null default '[]'::jsonb
  check (jsonb_typeof(activity_breakdown) = 'array');

comment on column public.incomes.activity_breakdown is
  'Append-only activity details for funding receipts, including applications, refunds, and balance adjustments.';

-- Promote the legacy funding record and any activity written through the
-- backward-compatible attachment envelope before this migration was applied.
update public.incomes
set income_type = 'pre_sale_deposit'
where income_type = 'project_income'
  and description ~* 'pre[ -]?sale[[:space:]]+deposits?'
  and description ~* 'utilized';

update public.incomes as income
set activity_breakdown = case
      when jsonb_array_length(income.activity_breakdown) = 0 then coalesce((
        select jsonb_agg(item -> 'activity' order by ordinal)
        from jsonb_array_elements(income.attachments) with ordinality as entries(item, ordinal)
        where item ->> '_type' = 'income_activity' and item ? 'activity'
      ), '[]'::jsonb)
      else income.activity_breakdown
    end,
    attachments = coalesce((
      select jsonb_agg(item order by ordinal)
      from jsonb_array_elements(income.attachments) with ordinality as entries(item, ordinal)
      where coalesce(item ->> '_type', '') <> 'income_activity'
    ), '[]'::jsonb)
where exists (
  select 1
  from jsonb_array_elements(income.attachments) as entries(item)
  where item ->> '_type' = 'income_activity'
);
