import { describe, expect, it } from 'vitest'
import { financingCashDirection, summarizeLoanReceivables } from './loanReceivables'

describe('loan receivables', () => {
  it('separates planned funding, principal outstanding, and interest from loans received', () => {
    const entry = { counterparty: 'Sercan Kaan Yildirim', amount: 10000, status: 'completed', type: 'loan_given' }
    expect(summarizeLoanReceivables([
      entry,
      { ...entry, amount: 2000, type: 'loan_principal_received' },
      { ...entry, amount: 125.25, type: 'loan_interest_received' },
      { ...entry, amount: 3000, status: 'planned' },
      { ...entry, amount: 90000, type: 'loan_received' },
      { ...entry, amount: 500, status: 'planned', type: 'loan_principal_received' },
    ])).toEqual([{ name: entry.counterparty, advanced: 10000, repaid: 2000, interest: 125.25, planned: 3000, balance: 8000 }])
    expect(financingCashDirection('loan_given')).toBe(-1)
    expect(financingCashDirection('loan_principal_received')).toBe(1)
    expect(financingCashDirection('loan_interest_received')).toBe(1)
  })
})
