import { describe, expect, it } from 'vitest'
import { parseBankRows, parseCsv } from './bankImport'

describe('bank spreadsheet parsing', () => {
  it('preserves an Excel UTC date without shifting it to the previous day', () => {
    const parsed = parseBankRows([
      ['Date', 'Description', 'Amount', 'Category'],
      [new Date('2023-07-17T00:00:00.000Z'), 'Mobile deposit', 10500, 'Project Income'],
    ], { bank: 'boa' })

    expect(parsed[0].date).toBe('2023-07-17')
  })

  it('assigns every Flagstar row to Banu U and combines debit and credit columns', () => {
    const rows = [
      ['Date', 'Description', 'Debit', 'Credit'],
      ['7/10/2026', 'Contractor payment', '125.50', ''],
      ['7/11/2026', 'Deposit', '', '500'],
    ]
    const parsed = parseBankRows(rows, { bank: 'flagstar', defaultOwner: 'Kemal I' })

    expect(parsed.map((row) => row.owner)).toEqual(['Banu U', 'Banu U'])
    expect(parsed.map((row) => row.amount)).toEqual([-125.5, 500])
  })

  it('detects Bank of America owners and parses quoted CSV descriptions', () => {
    const rows = parseCsv('Date,Description,Amount,Account Name\n07/12/2026,"Payment, vendor",-40,Banu U\n07/13/2026,Deposit,100,Kemal I')
    const parsed = parseBankRows(rows, { bank: 'boa', defaultOwner: 'Banu U' })

    expect(parsed[0]).toMatchObject({ owner: 'Banu U', description: 'Payment, vendor', amount: -40 })
    expect(parsed[1]).toMatchObject({ owner: 'Kemal I', amount: 100 })
  })

  it('does not subtract financing payments from an owner contribution', () => {
    const rows = [
      ['Date', 'Type', 'Amount', 'Category', 'Vendor / Payee', 'Memo / Reference'],
      ['07/01/2026', 'Credit', '5000', 'Owner Contribution / Loan Draw (REVIEW)', 'Incoming funds', 'Ilter, Kemal'],
      ['07/02/2026', 'Debit', '-3017', 'Financing', 'Providence Bank / Ilter Kemal', 'Loan payment for Ilter Kemal'],
    ]
    const parsed = parseBankRows(rows, { bank: 'boa' })

    expect(parsed[0]).toMatchObject({ owner: 'Kemal I', isOwnerContribution: true })
    expect(parsed[1]).toMatchObject({
      owner: 'GreenFort',
      description: 'Providence Bank — GreenFort loan payment',
      isOwnerContribution: false,
    })
  })

  it('ignores spreadsheet confidence flags and asks only when classification is ambiguous', () => {
    const rows = [
      ['Date', 'Type', 'Amount', 'Category', 'Vendor / Payee', 'Memo / Reference', 'Confidence'],
      ['07/03/2026', 'Fee', '-25', 'Bank Fees (Overhead)', 'Bank Fee', '', 'Needs review'],
      ['07/04/2026', 'Credit', '25000', 'Owner Contribution / Loan Draw (REVIEW)', 'Incoming funds', '', 'Confirmed'],
      ['07/05/2026', 'Fee', '0', 'Bank Fees (Overhead)', 'Bank Fee', 'Prfd Rwds for Bus-Wire Fee Waiver', 'Confirmed'],
    ]
    const parsed = parseBankRows(rows, { bank: 'boa' })

    expect(parsed[0]).toMatchObject({ classificationStatus: 'auto_classified', reviewReasons: [] })
    expect(parsed[1].classificationStatus).toBe('needs_review')
    expect(parsed[1].reviewReasons[0]).toMatch(/owner contribution, loan draw, transfer, or project income/i)
    expect(parsed[2]).toMatchObject({ category: 'Bank Fee Waiver', classificationStatus: 'auto_classified', reviewReasons: [] })
  })
})
