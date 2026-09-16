import { describe, expect, it } from 'vitest'
import { identifyProvidenceLoan } from './providenceLoanAccounts'

describe('identifyProvidenceLoan', () => {
  it.each([
    ['CLxxxxx0784', 'Lot 2'],
    ['Note ID: 100500786', 'Lot 3'],
    ['Loan Account: 053112657 -*0792 - CLxxxxx0792', 'Lot 4'],
  ])('maps %s to %s', (text, lot) => {
    expect(identifyProvidenceLoan(text)).toMatchObject({ lot })
  })

  it('uses the uniquely lower balance for Lot 4 but does not guess between equal Lot 2 and Lot 3 balances', () => {
    expect(identifyProvidenceLoan('Original Balance $754,126.00')).toMatchObject({ lot: 'Lot 4' })
    expect(identifyProvidenceLoan('Original Balance $784,126.00')).toBeNull()
  })
})
