import { describe, expect, it } from 'vitest'
import { parseBankRows, parseCsv, taxTreatmentFor } from './bankImport'

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

  it('classifies Green Fort checks and explicit BOFA-Flagstar movements as internal transfers', () => {
    const boaRows = [
      ['Date', 'Type', 'Amount', 'Category', 'Vendor / Payee', 'Memo / Reference', 'Raw bank description'],
      ['04/29/2025', 'Credit', '10000', 'Owner Contribution / Loan Draw (REVIEW)', 'Incoming funds', 'FLAGBK CK WEBXFR DES:TRANSFER GREEN FORT LLC', 'Flagstar transfer'],
      ['05/01/2025', 'Check', '-7500', 'General Contractor', 'Green Fort LLC', 'Move funds to Flagstar', 'Check #1044'],
      ['05/02/2025', 'Debit', '-467', 'Permits & Fees', 'City of Raleigh', 'INDN:Green Fort LLC', 'City permit payment'],
    ]
    const [explicitTransfer, selfPayeeCheck, vendorPayment] = parseBankRows(boaRows, { bank: 'boa' })
    const [flagstarDeposit] = parseBankRows([
      ['Date', 'Type', 'Credit', 'Category', 'Vendor / Payee'],
      ['05/03/2025', 'Check deposit', '7500', 'Business Income', 'Green Fort LLC'],
    ], { bank: 'flagstar' })

    expect(explicitTransfer).toMatchObject({ category: 'Bank Transfer', classificationStatus: 'auto_classified', reviewReasons: [] })
    expect(selfPayeeCheck).toMatchObject({ category: 'Bank Transfer', classificationStatus: 'auto_classified', reviewReasons: [] })
    expect(flagstarDeposit).toMatchObject({ category: 'Bank Transfer', owner: 'Banu U', classificationStatus: 'auto_classified' })
    expect(vendorPayment).toMatchObject({ category: 'Permits & Fees' })
    expect(taxTreatmentFor(selfPayeeCheck)).toBe('Non-tax cash movement')
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

  it('normalizes Amex charges and payments and auto-categorizes common expenses', () => {
    const rows = [
      ['Date', 'Description', 'Amount'],
      ['07/03/2026', 'ADOBE SOFTWARE', '29.99'],
      ['07/04/2026', 'ONLINE PAYMENT - THANK YOU', '-500.00'],
    ]
    const parsed = parseBankRows(rows, { bank: 'amex' })

    expect(parsed[0]).toMatchObject({ amount: -29.99, category: 'Software & Technology', owner: 'GreenFort' })
    expect(parsed[1]).toMatchObject({ amount: 500, category: 'Credit Card Payment', owner: 'GreenFort' })
  })

  it('creates stable source row IDs so importing the same statement can be deduplicated', () => {
    const rows = [
      ['Date', 'Description', 'Amount'],
      ['07/03/2026', 'Office Depot', '-42.00'],
    ]
    const first = parseBankRows(rows, { bank: 'boa', sourceName: 'july.csv' })
    const second = parseBankRows(rows, { bank: 'boa', sourceName: 'renamed-july.csv' })

    expect(first[0].sourceRowId).toBe(second[0].sourceRowId)
  })

  it('treats private lender proceeds as a liability and asks to split repayments', () => {
    const rows = [
      ['Date', 'Description', 'Amount'],
      ['07/05/2026', 'Loan from private lender Ahmet', '25000.00'],
      ['07/20/2026', 'Private loan payment Ahmet', '-1200.00'],
    ]
    const parsed = parseBankRows(rows, { bank: 'boa' })

    expect(parsed[0]).toMatchObject({
      category: 'Private Lender Loan Proceeds',
      classificationStatus: 'auto_classified',
    })
    expect(parsed[1]).toMatchObject({
      category: 'Private Lender Loan Payment',
      classificationStatus: 'needs_review',
    })
    expect(parsed[1].reviewReasons[0]).toMatch(/principal, interest, or a combination/i)
  })

  it('separates business income, expenses, transfers, and uncertain tax items', () => {
    expect(taxTreatmentFor({ amount: 500, category: 'Business Income', reviewReasons: [] })).toBe('Business income')
    expect(taxTreatmentFor({ amount: -50, category: 'Office Supplies', reviewReasons: [] })).toBe('Business expense')
    expect(taxTreatmentFor({ amount: -500, category: 'Credit Card Payment', reviewReasons: [] })).toBe('Non-tax cash movement')
    expect(taxTreatmentFor({ amount: 20, category: 'Refund / Reimbursement', reviewReasons: ['Confirm treatment'] })).toBe('Needs review')
  })

  it('recognizes bank cash back as a non-tax rebate category', () => {
    const [cashBack] = parseBankRows([
      ['Date', 'Description', 'Amount'],
      ['07/31/2026', 'Business card cash back rewards credit', '42.15'],
    ], { bank: 'boa' })

    expect(cashBack).toMatchObject({ category: 'Bank Cash Back', classificationStatus: 'auto_classified' })
    expect(taxTreatmentFor(cashBack)).toBe('Non-tax cash movement')
  })
})
