import { describe, expect, it } from 'vitest'
import { buildLegacyIncomeAttachments, buildProjectCostTotals, buildProjectWorkspace } from './supabase'

describe('legacy income persistence', () => {
  it('keeps every partial refund when activity_breakdown is unavailable', () => {
    const attachments = buildLegacyIncomeAttachments({
      attachments: [{ id: 'agreement', name: 'agreement.pdf' }],
      activities: [
        { id: 'receipt', type: 'receipt', amount: 10000 },
        { id: 'refund-1', type: 'refund', amount: 5000, relatedActivityId: 'receipt' },
        { id: 'refund-2', type: 'refund', amount: 5000, relatedActivityId: 'receipt' },
      ],
    })

    expect(attachments.filter((item) => item._type === 'income_activity').map((item) => item.activity.id))
      .toEqual(['receipt', 'refund-1', 'refund-2'])
    expect(attachments[0]).toEqual({ id: 'agreement', name: 'agreement.pdf' })
  })
})

describe('buildProjectCostTotals', () => {
  it('counts top-level costs without adding their breakdowns or grouped items again', () => {
    const totals = buildProjectCostTotals([
      { project_id: 2, parent_cost_id: null, amount: 372854 },
      { project_id: 2, parent_cost_id: null, amount: 110392 },
      { project_id: 2, parent_cost_id: 'parent-a', amount: 377914.79 },
      { project_id: 2, parent_cost_id: 'merged-group', amount: 64024.42 },
      { project_id: 3, parent_cost_id: null, amount: 50000 },
    ])

    expect(totals).toEqual({ 2: 483246, 3: 50000 })
  })

  it('counts utilized pre-sale funding once as a top-level development cost', () => {
    expect(buildProjectCostTotals([
      { project_id: 2, parent_cost_id: null, name: 'Land Interest', phase: 'development', amount: 100000 },
      { project_id: 2, parent_cost_id: null, name: 'Pre sale Deposits (Utilized)', phase: 'development', amount: 300000 },
    ])).toEqual({ 2: 400000 })
  })
})

describe('buildProjectWorkspace', () => {
  it('loads pre-sale activity from the backward-compatible income envelope', () => {
    const ok = { data: [], error: null }
    const workspace = buildProjectWorkspace({
      categoriesResult: ok, invoicesResult: ok, transactionsResult: ok, costsResult: ok,
      incomesResult: { data: [{
        id: 91, project_id: 7, description: 'Pre-sale Deposits (Utilized)', source: 'Buyer', amount: 300000,
        income_date: '2026-07-14', income_type: 'project_income', lot_breakdown: [],
        attachments: [
          { _type: 'income_activity', activity: { id: 'refund-1', type: 'refund', amount: 25000, date: '2026-08-17', description: 'Buyer refund' } },
          { id: 'doc-1', name: 'deposit-agreement.pdf' },
        ],
      }], error: null },
      reviewResult: ok, draftsResult: ok, checksResult: ok, lotCommitmentsResult: ok, financingResult: ok,
    })

    expect(workspace.incomes[0]).toMatchObject({
      type: 'pre_sale_deposit',
      activities: [{ id: 'refund-1', type: 'refund', amount: 25000 }],
      attachments: [{ id: 'doc-1', name: 'deposit-agreement.pdf' }],
    })
  })

  it('includes stored invoice documents so the check page can preview them', () => {
    const ok = { data: [], error: null }
    const workspace = buildProjectWorkspace({
      categoriesResult: ok,
      invoicesResult: { data: [{
        id: 50, project_id: 7, invoice_number: '106170', amount: 5880, status: 'pending',
        documents: [{ id: 91, storage_bucket: 'accounting-documents', storage_path: '7/invoice-106170.pdf', original_name: 'Invoice 106170.pdf', mime_type: 'application/pdf', size_bytes: 12345 }],
      }], error: null },
      transactionsResult: ok,
      costsResult: ok,
      incomesResult: ok,
      reviewResult: ok,
      draftsResult: ok,
      checksResult: ok,
      lotCommitmentsResult: ok,
    })

    expect(workspace.invoices[0].attachments).toEqual([{
      documentId: 91,
      id: 91,
      storageBucket: 'accounting-documents',
      storagePath: '7/invoice-106170.pdf',
      name: 'Invoice 106170.pdf',
      originalName: 'Invoice 106170.pdf',
      documentDate: '',
      description: '',
      mimeType: 'application/pdf',
      size: 12345,
    }])
  })

  it('merges documents linked by cost_id into every loaded cost version', () => {
    const ok = { data: [], error: null }
    const workspace = buildProjectWorkspace({
      categoriesResult: ok,
      invoicesResult: ok,
      transactionsResult: ok,
      costsResult: { data: [{
        id: 1, cost_id: 'plumbing-lot-4', project_id: 7, version: 1, name: 'Under-slab plumbing',
        amount: 5880, phase: 'construction', cost_date: '2026-07-31', attachments: [],
      }], error: null },
      costDocumentsResult: { data: [{
        id: 'doc-106170', project_id: 7, cost_id: 'plumbing-lot-4', storage_bucket: 'accounting-documents',
        storage_path: '7/Invoice-106170.pdf', original_name: 'Invoice 106170.pdf', mime_type: 'application/pdf', size_bytes: 76720,
      }], error: null },
      incomesResult: ok,
      reviewResult: ok,
      draftsResult: ok,
      checksResult: ok,
      lotCommitmentsResult: ok,
      financingResult: ok,
    })

    expect(workspace.costVersions[0].attachments).toEqual([
      expect.objectContaining({ documentId: 'doc-106170', name: 'Invoice 106170.pdf', storagePath: '7/Invoice-106170.pdf' }),
    ])
  })

  it('keeps loaded costs visible when an auxiliary section fails', () => {
    const ok = { data: [], error: null }
    const workspace = buildProjectWorkspace({
      categoriesResult: { data: [{ id: 9, project_id: 7, phase: 'construction', name: 'Construction', budgeted_amount: 800000, lot_budgets: { 'Lot 1': 175000, 'Lot 2': 200000, 'Lot 3': 210000, 'Lot 4': 215000 } }], error: null },
      invoicesResult: ok,
      transactionsResult: ok,
      costsResult: { data: [{
        id: 1, cost_id: 'cost-1', project_id: 7, version: 1, name: 'Foundation',
        amount: 25000, phase: 'construction', cost_date: '2026-07-16', attachments: [],
      }], error: null },
      incomesResult: ok,
      reviewResult: ok,
      draftsResult: ok,
      checksResult: { data: null, error: new Error('Check register temporarily unavailable') },
    })

    expect(workspace.costVersions).toHaveLength(1)
    expect(workspace.categories[0]).toMatchObject({ budgetedAmount: 800000, lotBudgets: { 'Lot 1': 175000, 'Lot 2': 200000, 'Lot 3': 210000, 'Lot 4': 215000 } })
    expect(workspace.costVersions[0].name).toBe('Foundation')
    expect(workspace.projectChecks).toEqual([])
    expect(workspace.warnings).toEqual(['Check register temporarily unavailable'])
  })

  it('carries the invoice/cost attachment and lot fields through from saved check rows', () => {
    const ok = { data: [], error: null }
    const workspace = buildProjectWorkspace({
      categoriesResult: ok,
      invoicesResult: ok,
      transactionsResult: ok,
      costsResult: { data: [], error: null },
      incomesResult: ok,
      reviewResult: ok,
      draftsResult: ok,
      checksResult: { data: [{
        id: 1, project_id: 7, check_number: '1042', payee: 'Triangle Concrete', amount: 5000,
        check_date: '2026-07-16', status: 'printed', invoice_id: null, cost_id: 'cost-1',
        funded_by_income_id: 900, lot: 'Lot 2',
        memo: 'Inv 106167 · Under-slab plumbing\n[[greenfort-mailing-address:123%20Plumber%20Rd%0ARaleigh%2C%20NC%2027601]]',
      }], error: null },
    })

    expect(workspace.projectChecks[0]).toMatchObject({
      costId: 'cost-1',
      invoiceId: null,
      fundedByIncomeId: 900,
      lot: 'Lot 2',
      memo: 'Inv 106167 · Under-slab plumbing',
      mailingAddress: '123 Plumber Rd\nRaleigh, NC 27601',
    })
  })
})
