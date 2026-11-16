-- Run once in this project's Supabase SQL Editor as the database owner.
-- Enables loan receivables and records the authorized, not-yet-issued loan.
begin;

alter table public.project_financing_transactions
  drop constraint if exists project_financing_transactions_entry_type_check;
alter table public.project_financing_transactions
  add constraint project_financing_transactions_entry_type_check
  check (entry_type in (
    'loan_received', 'principal_repayment', 'interest_payment', 'owner_distribution',
    'loan_given', 'loan_principal_received', 'loan_interest_received'
  ));

insert into public.project_financing_transactions (
  project_id, entry_type, entry_status, counterparty, amount,
  entry_date, payment_method, reference, notes
)
select
  2, 'loan_given', 'planned', 'Sercan Kaan Yildirim', 10000.00,
  date '2026-11-06', 'check', '',
  'Planned loan receivable from Green Fort. User will write a check. No payment issued or confirmed. Exclude from construction costs, lot allocations and partner distributions. Record principal repayments separately from interest. Repayment due date and interest terms have not been provided.'
where exists (select 1 from public.projects where id = 2 and name = 'Tryon Rd')
  and not exists (
    select 1 from public.project_financing_transactions
    where project_id = 2 and entry_type = 'loan_given'
      and lower(trim(counterparty)) = 'sercan kaan yildirim'
      and amount = 10000.00
  );

commit;

select id, counterparty, entry_type, entry_status, amount, entry_date
from public.project_financing_transactions
where project_id = 2 and entry_type = 'loan_given'
  and lower(trim(counterparty)) = 'sercan kaan yildirim';
