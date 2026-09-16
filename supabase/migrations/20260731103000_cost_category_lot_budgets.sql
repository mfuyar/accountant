alter table public.cost_categories
  add column if not exists lot_budgets jsonb not null default '{}'::jsonb;

alter table public.cost_categories
  drop constraint if exists cost_categories_lot_budgets_object;
alter table public.cost_categories
  add constraint cost_categories_lot_budgets_object
  check (jsonb_typeof(lot_budgets) = 'object');

-- Construction has four independently budgeted lots. Keep the phase total in
-- budgeted_amount so existing portfolio totals continue to work.
update public.cost_categories
set lot_budgets = jsonb_build_object(
      'Lot 1', coalesce((lot_budgets ->> 'Lot 1')::numeric, 0),
      'Lot 2', coalesce((lot_budgets ->> 'Lot 2')::numeric, 0),
      'Lot 3', coalesce((lot_budgets ->> 'Lot 3')::numeric, 0),
      'Lot 4', coalesce((lot_budgets ->> 'Lot 4')::numeric, 0)
    )
where phase = 'construction';
