import { describe, expect, it } from 'vitest'
import { parseStatementText } from './bankStatementPdf'

describe('PDF bank statement text parsing', () => {
  it('parses Amex purchases and payments using the source amount convention', () => {
    const rows = parseStatementText(`Statement Date 07/31/2026
Purchases
07/03 OFFICE DEPOT 42.18
Payments Received
07/10 PAYMENT THANK YOU 500.00`, { bank: 'amex' })

    expect(rows).toEqual([
      ['Date', 'Description', 'Amount'],
      ['2026-07-03', 'OFFICE DEPOT', 42.18],
      ['2026-07-10', 'PAYMENT THANK YOU', -500],
    ])
  })

  it('uses bank statement section headings to sign deposits and withdrawals', () => {
    const rows = parseStatementText(`Closing Date 07/31/2026
Deposits and credits
07/02 CUSTOMER DEPOSIT 1,200.00
Withdrawals and debits
07/06 OFFICE RENT 800.00`, { bank: 'providence' })

    expect(rows.slice(1)).toEqual([
      ['2026-07-02', 'CUSTOMER DEPOSIT', 1200],
      ['2026-07-06', 'OFFICE RENT', -800],
    ])
  })
})
