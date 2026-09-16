import { describe, expect, it } from 'vitest'
import { inferCostSubcategory, inferMainCostCategory } from './accountingTaxonomy'

describe('accounting taxonomy', () => {
  it('uses the stated cost purpose before an outsource-loan funding description', () => {
    const cost = {
      name: 'Outsource Loan',
      category: 'Site work',
      phase: 'development',
      details: 'Funds paid to Narron for ground work',
    }

    expect(inferMainCostCategory(cost)).toBe('Soft / Development Costs')
    expect(inferCostSubcategory(cost)).toBe('Clearing / Preliminary Site Work')
  })

  it('classifies construction attorney fees as construction costs', () => {
    const cost = { name: 'Attorney invoice', category: 'Legal / attorney fees', phase: 'construction' }

    expect(inferMainCostCategory(cost)).toBe('Legal & Professional Fees')
    expect(inferCostSubcategory(cost)).toBe('Attorney Fees')
  })
})
