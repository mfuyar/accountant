import { describe, expect, it } from 'vitest'
import { isOwnerCapitalEntry, ownerCapitalStorage, readOwnerCapitalNotes, summarizeOwnerCapital } from './ownerCapital'

describe('repayable owner contributions', () => {
  it('stores contribution/return identities without treating them as costs or profit payouts', () => {
    for (const type of ['owner_contribution', 'owner_contribution_return']) {
      const stored = ownerCapitalStorage({ type, ownerId: 9, notes: 'Owner paid SBA directly.', capital: { loanNumber: '3600818310', sourceCostId: 'payment-id' } })
      expect(stored.type).toBe(type === 'owner_contribution' ? 'loan_received' : 'principal_repayment')
      const parsed = readOwnerCapitalNotes(stored.notes)
      expect(parsed.notes).toBe('Owner paid SBA directly.')
      expect(parsed.capital).toMatchObject({ loanNumber: '3600818310', sourceCostId: 'payment-id', ownerId: 9, excludedFromProjectCosts: true, reimbursable: true })
      expect(isOwnerCapitalEntry({ notes: stored.notes })).toBe(true)
    }
    expect(readOwnerCapitalNotes('[[greenfort-owner-capital:bad-json]]').capital).toBeNull()
  })

  it('counts paid contributions once, subtracts returns, and excludes forecasts and profit payouts', () => {
    const entry = { ownerId: 9, counterparty: 'Banugul', type: 'owner_contribution', status: 'completed', amount: 1000 }
    expect(summarizeOwnerCapital([entry,
      { ...entry, type: 'owner_contribution_return', amount: 250 },
      { ...entry, type: 'owner_contribution_return', status: 'planned', amount: 50 },
      { ...entry, status: 'planned', amount: 150 },
      { ...entry, type: 'owner_distribution', amount: 5000 },
    ])).toEqual([{ ownerId: 9, name: 'Banugul', contributed: 1000, returned: 250, pending: 150, pendingReturn: 50, balance: 750, available: 700 }])
  })
})
