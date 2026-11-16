-- Outgoing loans are assets. Preserve the existing financing table, RLS and grants.
begin;
alter table public.project_financing_transactions
  drop constraint if exists project_financing_transactions_entry_type_check;
alter table public.project_financing_transactions
  add constraint project_financing_transactions_entry_type_check
  check (entry_type in (
    'loan_received', 'principal_repayment', 'interest_payment', 'owner_distribution',
    'loan_given', 'loan_principal_received', 'loan_interest_received'
  ));
commit;
