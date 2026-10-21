-- Repair backend grants on existing installations. Creation migrations also carry
-- these grants so fresh databases do not depend on historical default privileges.
-- Keep authenticated permissions and RLS policies unchanged. In particular,
-- bank_connections remains backend-only and cost_versions remains append-only.
grant select, insert, update, delete on
  public.admin_allowlist,
  public.bank_connections,
  public.bank_transactions,
  public.companies,
  public.construction_cost_drafts,
  public.cost_categories,
  public.cost_subcategories,
  public.cost_versions,
  public.documents,
  public.funding_sources,
  public.incomes,
  public.invoices,
  public.ledger_audit_logs,
  public.loans,
  public.owners,
  public.payments,
  public.profiles,
  public.project_checks,
  public.project_financing_transactions,
  public.project_invitations,
  public.project_lot_commitments,
  public.project_members,
  public.projects,
  public.properties,
  public.review_items,
  public.transaction_allocations,
  public.transactions,
  public.vendors
to service_role;

grant usage, select on sequence
  public.bank_transactions_id_seq,
  public.cost_categories_id_seq,
  public.cost_subcategories_id_seq,
  public.cost_versions_id_seq,
  public.funding_sources_id_seq,
  public.incomes_id_seq,
  public.invoices_id_seq,
  public.ledger_audit_logs_id_seq,
  public.loans_id_seq,
  public.owners_id_seq,
  public.payments_id_seq,
  public.project_checks_id_seq,
  public.project_financing_transactions_id_seq,
  public.project_invitations_id_seq,
  public.project_lot_commitments_id_seq,
  public.projects_id_seq,
  public.properties_id_seq,
  public.review_items_id_seq,
  public.transaction_allocations_id_seq,
  public.transactions_id_seq,
  public.vendors_id_seq
to service_role;

grant select on public.active_costs to service_role;
