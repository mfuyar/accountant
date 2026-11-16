import { describe, expect, it } from 'vitest'
import { buildSbaVersions, dueSbaDates, SBA_CONSTRUCTION_SCHEDULES, sbaCostId } from './record-monthly-sba.mjs'
import { equalLotAllocations, policyMarker } from './lib/banu-financing-policy.mjs'

const group = (schedule) => ({ cost_id: schedule.costIds[0], project_id: 2, amount: 1000, phase: 'construction', owner_id: 9, version: 3, parent_cost_id: null,
  lot_allocations: equalLotAllocations(1000), attachments: [policyMarker(schedule.loanCostId), { _type: 'sba_recurring_payment', startMonth: '2026-12', amount: schedule.amount, day: 15 }] })

describe('monthly Banu SBA construction costs', () => {
  it('starts December 15 and catches up only months already due', () => {
    expect(dueSbaDates('2026-11-16')).toEqual([])
    expect(dueSbaDates('2026-12-14')).toEqual([])
    expect(dueSbaDates('2027-02-15')).toEqual(['2026-12-15', '2027-01-15', '2027-02-15'])
  })

  it.each(SBA_CONSTRUCTION_SCHEDULES)('allocates $amount to all four lots once without increasing development parents', (schedule) => {
    const original = group(schedule)
    const rows = buildSbaVersions([original], '2026-12-15', schedule)
    expect(rows).toHaveLength(2)
    expect(rows[0].amount).toBe(1000 + schedule.amount)
    expect(rows[0].parent_cost_id).toBeNull()
    expect(rows[1].parent_cost_id).toBe(schedule.costIds[0])
    expect(rows[1].cost_id).toBe(sbaCostId(`sba-recurring|${schedule.loanCostId}|2026-12`))
    for (const row of rows) {
      expect(row.phase).toBe('construction')
      expect(row.owner_id).toBe(9)
      expect(row.lot_allocations).toEqual(equalLotAllocations(row.amount))
      expect(row.attachments.find((item) => item._type === 'cost_accounting')).toMatchObject({ mainCategory: 'Construction Financing Costs', payerType: 'owner', payerOwnerId: 9 })
    }
    expect(rows[1].attachments.find((item) => item._type === 'sba_monthly_cost').bankPaymentConfirmed).toBe(false)
    expect(buildSbaVersions([rows[0]], '2026-12-15', schedule)).toEqual([])
    expect(original.amount).toBe(1000)
  })

  it('rejects an unmigrated development group or wrong loan', () => {
    const [first, mu] = SBA_CONSTRUCTION_SCHEDULES
    expect(() => buildSbaVersions([{ ...group(first), phase: 'development' }], '2026-12-15', first)).toThrow()
    expect(() => buildSbaVersions([group(first)], '2026-12-15', mu)).toThrow()
  })
})
