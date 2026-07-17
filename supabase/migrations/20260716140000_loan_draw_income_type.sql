alter table public.incomes
  drop constraint if exists incomes_income_type_check;

alter table public.incomes
  add constraint incomes_income_type_check
  check (income_type in ('project_income', 'refund', 'reimbursement', 'other', 'loan_draw'));
