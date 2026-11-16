import { describe, expect, it } from 'vitest'
import { BANU_LOANS, BANU_PERSONAL_ID, LAND_FINANCING_ID, buildBanuPhaseMigration, cents, constructionGroupId, equalLotAllocations, phaseForDate } from './banu-financing-policy.mjs'

function fixtures() {
  const row = (id, amount, parent = null, extra = {}) => ({ cost_id: id, amount, parent_cost_id: parent, project_id: 2, owner_id: 9, phase: 'development', version: 1, cost_date: '2026-07-14', deleted_at: null, attachments: [], lot_allocations: [], ...extra })
  const [sba, mu, flagstar] = BANU_LOANS
  return [row(LAND_FINANCING_ID, 171646.67), row(BANU_PERSONAL_ID, 30665.45, LAND_FINANCING_ID),
    row(sba.id, 7543.98, BANU_PERSONAL_ID), row(mu.id, 9672, BANU_PERSONAL_ID),
    row(flagstar.id, 13449.47, BANU_PERSONAL_ID, { attachments: [{ _type: 'flagstar_interest_update', previousHelocTotal: 8047.49, payments: [{ date: '2026-08-01', amount: 1375.65 }, { date: '2026-09-01', amount: 1347.24 }, { date: '2026-10-01', amount: 1216.86 }, { date: '2026-11-01', amount: 1462.23 }] }] }),
    row('sba-dev', 5834, sba.id, { cost_date: '2026-07-15' }), row('sba-construction', 600, sba.id, { cost_date: '2026-08-17' }),
    row('unsupported', 1109.98, sba.id, { attachments: [{ _type: 'sba_unreconciled_balance' }] }),
    row('mu-dev', 8856, mu.id, { cost_date: '2026-07-15' }), row('mu-construction', 816, mu.id, { cost_date: '2026-08-17' }),
  ]
}

describe('Banu financing phase allocation', () => {
  it('uses the bank-funded draw date and preserves every cent in a four-lot split', () => {
    expect(phaseForDate('2026-07-15')).toBe('development')
    expect(phaseForDate('2026-07-16')).toBe('construction')
    expect(equalLotAllocations(1462.23)).toEqual([{ lot: 'Lot 1', amount: 365.56 }, { lot: 'Lot 2', amount: 365.56 }, { lot: 'Lot 3', amount: 365.56 }, { lot: 'Lot 4', amount: 365.55 }])
  })

  it('moves costs once, preserves payment identities, archives only the unsupported balance and reconciles parents', () => {
    const old = fixtures()
    const updates = buildBanuPhaseMigration(old, '2026-11-16T12:00:00Z')
    const byId = new Map([...old, ...updates].map((row) => [row.cost_id, row]))
    expect(byId.get('unsupported').deleted_at).toBe('2026-11-16T12:00:00Z')
    expect(byId.get('sba-dev').cost_id).toBe('sba-dev')
    expect(byId.get('sba-construction').parent_cost_id).toBe(constructionGroupId(BANU_LOANS[0].id))
    expect(byId.get(BANU_PERSONAL_ID).amount).toBe(22737.49)
    expect(byId.get(LAND_FINANCING_ID).amount).toBe(163718.71)
    const groups = BANU_LOANS.map((loan) => byId.get(constructionGroupId(loan.id)))
    expect(groups.map((row) => row.amount)).toEqual([600, 816, 5401.98])
    for (const row of updates.filter((row) => row.cost_id !== LAND_FINANCING_ID && !row.deleted_at)) {
      expect(row.owner_id).toBe(9)
      expect(row.lot_allocations.map((item) => item.lot)).toEqual(['Lot 1', 'Lot 2', 'Lot 3', 'Lot 4'])
      expect(row.lot_allocations.reduce((sum, item) => sum + cents(item.amount), 0)).toBe(cents(row.amount))
    }
    expect(cents(byId.get(LAND_FINANCING_ID).amount) + groups.reduce((sum, group) => sum + cents(group.amount), 0)).toBe(cents(171646.67) - cents(1109.98))
    expect(buildBanuPhaseMigration([...byId.values()])).toEqual([])
    expect(old.find((row) => row.cost_id === BANU_PERSONAL_ID).amount).toBe(30665.45)
  })
})
