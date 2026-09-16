# Green Fort project-cost accounting architecture

## Accounting rule

Every ledger entry has two independent dimensions:

1. **Expense purpose** — main category and subcategory (for example, Soft / Development Costs → Civil Engineering).
2. **Funding source** — who paid, payment source, reimbursable status, and whether a loan funded the payment.

An owner-paid engineering invoice remains an Engineering project cost and is also included in that owner's contribution report. It is never recategorized as an "Owner contribution" expense.

## Application layers

- `cost_versions` is the immutable, versioned project-cost ledger. The latest non-deleted version is exposed through `active_costs`.
- Categories, subcategories, vendors, funding sources, loans, properties, and owners are normalized configuration records.
- `transaction_allocations` allows one source transaction to be allocated across projects without duplicating the source transaction.
- `documents` stores attachment metadata while file bytes remain in private object storage.
- `ledger_audit_logs` records field-level before/after values in addition to immutable cost versions.
- Reports use top-level costs as accounting totals and leaf breakdowns as supporting detail, preventing double-counting.

## Reporting model

Project cost is grouped by main category, then subcategory, then individual ledger entry. Funding is grouped separately by payer type and owner. A reconciliation compares project-cost totals with recorded funding; it does not create entries automatically.

All monetary database fields use `numeric(14,2)`. Deletes create a new archived version and remain recoverable from audit history.
