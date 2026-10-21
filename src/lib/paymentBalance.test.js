import { describe, expect, it } from 'vitest'
import { paymentBalance } from './paymentBalance'

describe('paymentBalance', () => {
  it('subtracts the paid SBS breakdown once when preparing a combined check', () => {
    const parent = { costId: 'sbs', amount: 301295.51 }
    const child = { costId: 'paid', parentCostId: 'sbs', amount: 18102.96, paymentDate: '2026-09-15', paymentMethod: 'bofa_check' }
    const check = { id: 152, checkNumber: '152', costId: 'paid', amount: 18102.96, status: 'printed' }
    expect(paymentBalance(parent, [parent, child], [check])).toMatchObject({ paid: 18102.96, remaining: 283192.55, overpaid: 0 })
  })

  it('tracks partial payments, later parent payments, voids, and overpayments in cents', () => {
    const parent = { costId: 'parent', amount: 100 }
    const child = { costId: 'child', parentCostId: 'parent', amount: 100 }
    const checks = [
      { id: 1, costId: 'child', amount: 30.01, status: 'printed' },
      { id: 2, costId: 'parent', amount: 50, status: 'printed' },
      { id: 3, costId: 'parent', amount: 500, status: 'voided' },
      { id: 4, costId: 'parent', amount: 600, status: 'draft' },
    ]
    expect(paymentBalance(parent, [parent, child], checks)).toMatchObject({ paid: 80.01, remaining: 19.99 })
    expect(paymentBalance(parent, [parent, child], checks, [], 2)).toMatchObject({ paid: 30.01, remaining: 69.99 })
    expect(paymentBalance(parent, [parent, child], [...checks, { id: 5, costId: 'parent', amount: 25, status: 'printed' }])).toMatchObject({ paid: 105.01, remaining: 0, overpaid: 5.01 })
  })

  it('does not double count paid metadata and a check linked through an invoice', () => {
    const cost = { costId: 'cost', amount: 90, paymentStatus: 'paid' }
    const invoice = { id: 2, costId: 'cost', amount: 90 }
    expect(paymentBalance(cost, [cost], [{ id: 1, invoiceId: 2, costId: 'cost', amount: 90, status: 'printed' }], [invoice])).toMatchObject({ paid: 90, remaining: 0 })
  })
})
