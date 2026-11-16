import { describe, expect, it } from 'vitest'
import { summarizeConstructionInterest } from './constructionInterest'

const interest = {
  costId: 'interest', projectId: 2, name: 'Providence interest', phase: 'construction',
  mainCategory: 'Construction Financing Costs', subcategory: 'Construction Loan Interest',
  amount: 100, paymentDate: '2026-11-16', lotAllocations: [{ lot: 'Lot 2', amount: 100 }],
}

describe('construction interest', () => {
  it('keeps full SBA principal-and-interest costs out of the interest-only total', () => {
    const result = summarizeConstructionInterest([
      { ...interest, costId: 'sba', name: 'Banu SBA — Construction', category: 'Financing costs', subcategory: 'Other Financing Costs', amount: 600 },
      { ...interest, costId: 'flagstar', name: 'Flagstar HELOC interest — Construction', amount: 5401.98, lotAllocations: [] },
    ])
    expect(result.paid).toBe(5401.98)
    expect(result.payments.map((payment) => payment.costId)).toEqual(['flagstar'])
  })

  it('counts paid interest once while excluding breakdowns, unpaid interest, land interest and fees', () => {
    const result = summarizeConstructionInterest([
      interest,
      { ...interest, costId: 'detail', parentCostId: 'interest' },
      { ...interest, costId: 'unpaid', paymentDate: '' },
      { ...interest, costId: 'land', phase: 'development' },
      { ...interest, costId: 'fee', name: 'Draw inspection fee', subcategory: 'Inspection / Draw Fees' },
      { ...interest, costId: 'archived', deletedAt: '2026-11-16' },
    ])
    expect(result.paid).toBe(100)
    expect(result.byLot).toEqual({ 'Lot 2': 100 })
    expect(result.payments).toHaveLength(1)
  })

  it('uses confirmed payments and excludes voided checks', () => {
    const result = summarizeConstructionInterest([{ ...interest, paymentDate: '', lotAllocations: [{ lot: 'Lot 2', amount: 60 }, { lot: 'Lot 3', amount: 40 }] }], [
      { id: 1, costId: 'interest', status: 'printed', amount: 50 },
      { id: 2, costId: 'interest', status: 'voided', amount: 100 },
    ])
    expect(result.paid).toBe(50)
    expect(result.byLot).toEqual({ 'Lot 2': 30, 'Lot 3': 20 })
    expect(result.unassigned).toBe(0)
  })
})
