import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import InvoicePaymentWarning, { unpaidInvoiceAge } from './InvoicePaymentWarning'

describe('invoice payment warnings', () => {
  it('starts on day ten using the original invoice date', () => {
    expect(unpaidInvoiceAge('2026-08-31', false, new Date(2026, 8, 9))).toBeNull()
    expect(unpaidInvoiceAge('2026-08-31', false, new Date(2026, 8, 10))).toBe(10)
    expect(unpaidInvoiceAge('2026-08-31', false, new Date(2026, 8, 16))).toBe(16)
  })
  it('excludes paid, future, missing, and invalid invoice dates', () => {
    const now = new Date(2026, 8, 16)
    for (const date of ['', undefined, '2026-02-31', '2026-09-30']) expect(unpaidInvoiceAge(date, false, now)).toBeNull()
    expect(unpaidInvoiceAge('2026-08-31', true, now)).toBeNull()
  })
  it('counts calendar days across daylight-saving changes', () => {
    expect(unpaidInvoiceAge('2026-03-01', false, new Date(2026, 2, 11))).toBe(10)
  })
  it('removes the visible warning when the invoice becomes paid', () => {
    const { rerender } = render(<InvoicePaymentWarning invoiceDate="2020-01-01" paid={false} />)
    expect(screen.getByRole('status')).toHaveTextContent('Payment warning: unpaid')
    rerender(<InvoicePaymentWarning invoiceDate="2020-01-01" paid />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
