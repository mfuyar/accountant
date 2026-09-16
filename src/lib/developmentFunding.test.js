import { describe, expect, it } from 'vitest'
import { deriveDevelopmentFundingIncomes, isPreSaleDepositCost, summarizeDevelopmentFunding } from './developmentFunding'

describe('development funding', () => {
  const fundingCost = { costId: 'fund-1', projectId: 2, ownerId: 12, name: 'Pre sale Deposits (Utilized)', amount: 300000, date: '2026-07-14', phase: 'development', lotAllocations: [] }

  it('recognizes the utilized pre-sale deposit as funding instead of a cost', () => {
    expect(isPreSaleDepositCost(fundingCost)).toBe(true)
    expect(isPreSaleDepositCost({ ...fundingCost, name: 'Land Interest' })).toBe(false)
  })

  it('derives one income entry and does not duplicate an existing matching income', () => {
    const derived = deriveDevelopmentFundingIncomes([fundingCost], [], [{ id: 12, name: 'Green Fort' }])
    expect(derived).toEqual([expect.objectContaining({ type: 'pre_sale_deposit', source: 'Green Fort', amount: 300000, derivedFromCost: true })])
    expect(deriveDevelopmentFundingIncomes([fundingCost], [{ id: 4, description: fundingCost.name, amount: 300000, date: fundingCost.date, type: 'project_income' }])).toHaveLength(1)
  })

  it('applies pre-sale deposits to development spending without inflating costs', () => {
    expect(summarizeDevelopmentFunding(
      [{ phase: 'development', amount: 500000 }, { phase: 'construction', amount: 100000 }],
      [{ type: 'pre_sale_deposit', amount: 300000 }],
    )).toEqual({ developmentSpend: 500000, preSaleDeposits: 300000, refunded: 0, adjustment: 0, utilized: 300000, remaining: 0 })
  })

  it('does not add buyer installment detail to the derived master deposit', () => {
    expect(summarizeDevelopmentFunding(
      [{ phase: 'development', amount: 500000 }],
      [
        { type: 'pre_sale_deposit', amount: 300000, derivedFromCost: true },
        { type: 'pre_sale_deposit', amount: 100000, description: 'Buyer 1 installment' },
        { type: 'pre_sale_deposit', amount: 50000, description: 'Buyer 2 installment' },
        { type: 'pre_sale_deposit', amount: 50000, description: 'Buyer 3 installment' },
        { type: 'pre_sale_deposit', amount: 50000, description: 'Buyer 4 installment' },
        { type: 'pre_sale_deposit', amount: 40000, description: 'Buyer 5 installment' },
      ],
    ).preSaleDeposits).toBe(300000)
  })

  it('does not add buyer installment detail to a saved utilized master deposit', () => {
    expect(summarizeDevelopmentFunding([], [
      { type: 'pre_sale_deposit', amount: 300000, description: 'Pre-sale Deposits (Utilized)' },
      { type: 'pre_sale_deposit', amount: 100000, description: 'Buyer 1' },
      { type: 'pre_sale_deposit', amount: 50000, description: 'Buyer 2' },
      { type: 'pre_sale_deposit', amount: 50000, description: 'Buyer 3' },
      { type: 'pre_sale_deposit', amount: 50000, description: 'Buyer 4' },
      { type: 'pre_sale_deposit', amount: 40000, description: 'Buyer 5' },
    ]).preSaleDeposits).toBe(300000)
  })

  it('uses explicit applications and refunds to calculate the remaining deposit balance', () => {
    expect(summarizeDevelopmentFunding(
      [{ phase: 'development', amount: 500000 }],
      [{ type: 'pre_sale_deposit', amount: 300000, activities: [
        { type: 'application', amount: 80000 },
        { type: 'refund', amount: 25000 },
        { type: 'adjustment_increase', amount: 5000 },
        { type: 'cancellation', amount: 0 },
      ] }],
    )).toEqual({ developmentSpend: 500000, preSaleDeposits: 300000, refunded: 25000, adjustment: 5000, utilized: 80000, remaining: 200000 })
  })
})
