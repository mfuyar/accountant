import { describe, expect, it } from 'vitest'
import { buildSbaVersions, dueSbaDates, SBA_COST_IDS, SBA_SCHEDULES } from './record-monthly-sba.mjs'

describe('monthly Banu SBA costs', () => {
  it('starts December 15 and catches up only months already due', () => {
    expect(dueSbaDates('2026-11-16')).toEqual([])
    expect(dueSbaDates('2026-12-14')).toEqual([])
    expect(dueSbaDates('2027-02-14')).toEqual(['2026-12-15', '2027-01-15'])
    expect(dueSbaDates('2027-02-15')).toEqual(['2026-12-15', '2027-01-15', '2027-02-15'])
  })

  it('increments all hierarchy totals once while preserving allocations and history', () => {
    const latest = SBA_COST_IDS.map((id) => ({ cost_id: id, project_id: 2, amount: 1000, version: 3, owner_id: 9, attachments: [{ _type: 'sba_recurring_payment', startMonth: '2026-12', amount: 150, day: 15 }], lot_allocations: [{ lot: 'Lot 1', amount: 500 }, { lot: 'Lot 2', amount: 500 }] }))
    const versions = buildSbaVersions(latest, '2026-12-15')
    expect(versions.map((row) => row.amount)).toEqual([1150, 1150, 1150, 150])
    expect(versions[2].lot_allocations).toEqual([{ lot: 'Lot 1', amount: 575 }, { lot: 'Lot 2', amount: 575 }])
    expect(latest[0].amount).toBe(1000)
    expect(versions[0].attachments.find((item) => item._type === 'sba_monthly_cost').bankPaymentConfirmed).toBe(false)
    expect(buildSbaVersions(versions.slice(0, 3), '2026-12-15')).toEqual([])
  })

  it('keeps the $204 MU loan separate while adding both loans to their shared parents', () => {
    const [original, mu] = SBA_SCHEDULES
    const first = original.costIds.map((id) => ({ cost_id: id, project_id: 2, amount: 1000, version: 1, attachments: [{ _type: 'sba_recurring_payment', startMonth: '2026-12', amount: 150, day: 15 }] }))
    const firstVersions = buildSbaVersions(first, '2026-12-15', original)
    const muLeaf = { cost_id: mu.costIds[0], project_id: 2, amount: 1224, version: 1, attachments: [{ _type: 'sba_recurring_payment', startMonth: '2026-12', amount: 204, day: 15 }] }
    const muVersions = buildSbaVersions([muLeaf, ...firstVersions.slice(1, 3)], '2026-12-15', mu)
    expect(firstVersions[0].amount).toBe(1150)
    expect(muVersions.map((row) => row.amount)).toEqual([1428, 1354, 1354, 204])
    expect(muVersions[3].parent_cost_id).toBe(mu.costIds[0])
    expect(muVersions[3].attachments.some((item) => item._type === 'sba_recurring_payment')).toBe(false)
    expect(muVersions[0].attachments.find((item) => item._type === 'sba_monthly_cost').amount).toBe(204)
    expect(buildSbaVersions(muVersions.slice(0, 3), '2026-12-15', mu)).toEqual([])
    expect(() => buildSbaVersions(first, '2026-12-15', mu)).toThrow()
  })
})
