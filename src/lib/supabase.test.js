import { describe, expect, it } from 'vitest'
import { buildProjectCostTotals, buildProjectWorkspace } from './supabase'

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
})

describe('buildProjectWorkspace', () => {
  it('keeps loaded costs visible when an auxiliary section fails', () => {
    const ok = { data: [], error: null }
    const workspace = buildProjectWorkspace({
      categoriesResult: ok,
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
      }], error: null },
    })

    expect(workspace.projectChecks[0]).toMatchObject({
      costId: 'cost-1',
      invoiceId: null,
      fundedByIncomeId: 900,
      lot: 'Lot 2',
    })
  })
})
