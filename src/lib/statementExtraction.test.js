import { describe, expect, it } from 'vitest'
import { extractStatementFromText } from './statementExtraction'

const rows = '08/21/26 100001I 09/20/26 100.50 PO# STUDS 100001I 100.50 08/28/26 100002I 09/20/26 200.25 PO# SHAFTWALL 100002I 200.25'
const statement = `BALANCE 300.75 ALL ACCOUNTS ARE DUE 09/20/26 CUSTOMER 1234567 08/31/26 1234567 08/31/26 STATEMENT INVOICE NO. ${rows}`

describe('statement text extraction', () => {
  it('extracts the statement date, total, and invoice details without treating the stub as new charges', () => {
    expect(extractStatementFromText(statement)).toMatchObject({ amount: 300.75, date: '2026-08-31', reference: '100001I, 100002I', vendor: '', paymentMethod: '' })
    expect(extractStatementFromText(statement).details).toContain('Due 2026-09-20')
    expect(extractStatementFromText(`${statement} ${rows}`).amount).toBe(300.75)
  })
  it('declines incomplete statements whose invoice sum does not match the balance', () => {
    expect(extractStatementFromText(statement.replace('BALANCE 300.75', 'BALANCE 400.75'))).toBeNull()
    expect(extractStatementFromText('INVOICE Total 300.75')).toBeNull()
  })
  it('declines conflicting copies and invalid dates', () => {
    expect(extractStatementFromText(`${statement} 08/21/26 100001I 09/20/26 101.50 PO# STUDS 100001I 101.50`)).toBeNull()
    expect(extractStatementFromText(statement.replace('08/21/26', '02/31/26'))).toBeNull()
  })
})
