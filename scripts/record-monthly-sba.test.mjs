import { describe, expect, it } from 'vitest'
import { buildSbaContribution, dueSbaDates, SBA_OWNER_SCHEDULES, sbaCostId } from './record-monthly-sba.mjs'
import { readOwnerCapitalNotes } from '../src/lib/ownerCapital.js'

describe('monthly Banu SBA owner contributions', () => {
  it('starts December 15 and catches up only months already due', () => {
    expect(dueSbaDates('2026-11-18')).toEqual([])
    expect(dueSbaDates('2026-12-14')).toEqual([])
    expect(dueSbaDates('2027-02-15')).toEqual(['2026-12-15', '2027-01-15', '2027-02-15'])
  })
  it.each(SBA_OWNER_SCHEDULES)('records $amount as pending owner contribution, without creating construction cost', (schedule) => {
    const row = buildSbaContribution('2026-12-15', schedule)
    expect(row.amount).toBe(schedule.amount)
    expect(row.owner_id).toBe(9)
    expect(row.entry_status).toBe('planned')
    expect(row.reference).toBe(`OWNER-PAID:${sbaCostId(`sba-recurring|${schedule.loanCostId}|2026-12`)}`)
    expect(row).not.toHaveProperty('cost_id')
    expect(row).not.toHaveProperty('phase')
    const capital = readOwnerCapitalNotes(row.notes).capital
    expect(capital).toMatchObject({ kind: 'contribution', ownerId: 9, reimbursable: true, excludedFromProjectCosts: true, recurring: true, sourceLoanCostId: schedule.loanCostId })
    expect(buildSbaContribution('2026-12-15', schedule).reference).toBe(row.reference)
  })
})
