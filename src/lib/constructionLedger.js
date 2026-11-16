import { paymentBalance } from './paymentBalance'
import { payerLabel } from './accountingTaxonomy'
import { safeCsvText } from './csvSecurity'

const cents = (value) => Math.round(Number(value || 0) * 100)
const csvCell = (value) => `"${safeCsvText(value).replace(/"/g, '""')}"`

export function buildConstructionLedger(costs = [], checks = [], invoices = []) {
  return costs.filter((cost) => cost.phase === 'construction' && !cost.parentCostId).map((cost) => {
    const balance = paymentBalance(cost, costs, checks, invoices)
    const allocated = (cost.lotAllocations || []).reduce((sum, entry) => sum + cents(entry.amount), 0)
    return {
      ...cost,
      balance,
      unassigned: Math.max(0, cents(cost.amount) - allocated) / 100,
      status: balance.overpaid > 0 ? 'Overpaid' : balance.remaining === 0 ? 'Paid' : balance.paid > 0 ? 'Partially paid' : 'Unpaid',
    }
  }).sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.costId).localeCompare(String(b.costId)))
}

export function constructionLedgerCsv(rows, owners = []) {
  const headings = ['Date', 'Cost', 'Category', 'Vendor', 'Paid by', 'Reference', 'Lots', 'Status', 'Cost amount', 'Paid', 'Outstanding', 'Overpaid', 'Running cost total']
  let running = 0
  return [headings, ...rows.map((row) => {
    running += cents(row.amount)
    return [row.date, row.name, row.category || row.subcategory, row.vendorName, payerLabel(row, owners), row.referenceNumber,
      [...(row.lotAllocations || []).map((entry) => `${entry.lot}: ${Number(entry.amount).toFixed(2)}`), ...(row.unassigned ? [`Unassigned: ${row.unassigned.toFixed(2)}`] : [])].join('; '),
      row.status, Number(row.amount || 0).toFixed(2), row.balance.paid.toFixed(2), row.balance.remaining.toFixed(2), row.balance.overpaid.toFixed(2), (running / 100).toFixed(2)]
  })].map((row) => row.map(csvCell).join(',')).join('\r\n')
}
