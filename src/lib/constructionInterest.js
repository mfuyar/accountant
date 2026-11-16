import { inferMainCostCategory } from './accountingTaxonomy'
import { paymentBalance } from './paymentBalance'

const cents = (amount) => Math.round(Number(amount || 0) * 100)

export function summarizeConstructionInterest(costs = [], checks = [], invoices = []) {
  const byLot = {}
  let paid = 0
  let unassigned = 0
  const payments = []
  costs.filter((cost) => !cost.parentCostId && !cost.deletedAt && cost.phase === 'construction'
    && inferMainCostCategory(cost) === 'Construction Financing Costs'
    && /interest/i.test(`${cost.subcategory || ''} ${cost.category || ''} ${cost.name || ''}`))
    .forEach((cost) => {
      const balance = paymentBalance(cost, costs, checks, invoices)
      const paidCents = cents(balance.paid)
      if (!paidCents) return
      paid += paidCents
      let allocated = 0
      ;(cost.lotAllocations || []).forEach((allocation) => {
        // Allocate partial payments in the same proportions as the cost.
        const share = Math.min(paidCents - allocated, Math.round(paidCents * cents(allocation.amount) / cents(cost.amount)))
        if (share <= 0) return
        byLot[allocation.lot] = (byLot[allocation.lot] || 0) + share
        allocated += share
      })
      unassigned += paidCents - allocated
      payments.push({ ...cost, paid: paidCents / 100 })
    })
  return {
    paid: paid / 100,
    byLot: Object.fromEntries(Object.entries(byLot).map(([lot, amount]) => [lot, amount / 100])),
    unassigned: unassigned / 100,
    payments: payments.sort((a, b) => String(b.paymentDate || b.date || '').localeCompare(String(a.paymentDate || a.date || ''))),
  }
}
