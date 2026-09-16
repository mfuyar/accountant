import { useEffect, useState } from 'react'

export function unpaidInvoiceAge(invoiceDate, paid, now = new Date()) {
  if (paid || !/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate || '')) return null
  const invoice = new Date(`${invoiceDate}T00:00:00Z`)
  if (!Number.isFinite(invoice.getTime()) || invoice.toISOString().slice(0, 10) !== invoiceDate) return null
  // Compare calendar dates, avoiding daylight-saving-time rounding errors.
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.floor((today - invoice.getTime()) / 86400000)
  return days >= 10 ? days : null
}

export default function InvoicePaymentWarning({ invoiceDate, paid }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])
  const age = unpaidInvoiceAge(invoiceDate, paid, now)
  if (age == null) return null
  return <span className="invoice-payment-warning" role="status">Payment warning: unpaid {age} days after invoice date.</span>
}
