// User screenshots plus explicit authorization to fill every month of 2024/2025.
import { sbaCostId, SBA_COST_IDS } from './record-monthly-sba.mjs'

const loanNumber = '3600818310'
// Effective date, processed date, full payment, displayed principal, interest.
const data = [
  ['2023-06-07', '2023-06-08', 150, null, 150],
  ['2023-07-07', '2023-07-10', 150, null, 150],
  ['2023-08-07', '2023-08-08', 150, null, 150],
  ['2023-09-07', '2023-09-08', 150, null, 150],
  ['2023-10-10', '2023-10-11', 150, null, 150],
  ['2023-11-07', '2023-11-08', 150, null, 150],
  ['2023-12-07', '2023-12-08', 150, null, 150],
  ['2024-03-07', '2024-03-08', 150, null, 150],
  ['2024-04-08', '2024-04-09', 150, null, 150],
  ['2024-05-07', '2024-05-08', 150, null, 150],
  ['2024-06-07', '2024-06-10', 150, null, 150],
  ['2024-07-08', '2024-07-09', 150, null, 150],
  ['2024-08-07', '2024-08-08', 150, null, 150],
  ['2024-09-09', '2024-09-10', 150, null, 150],
  ['2024-10-07', '2024-10-08', 150, null, 150],
  ['2024-11-07', '2024-11-08', 150, null, 150],
  ['2024-12-09', '2024-12-10', 150, null, 150],
  ['2025-03-07', '2025-03-10', 150, 75.54, 74.46],
  ['2025-04-07', '2025-04-08', 150, 67.80, 82.20],
  ['2025-05-07', '2025-05-08', 150, 70.66, 79.34],
  ['2025-07-15', '2025-07-16', 134, 102.03, 31.97],
  ['2025-07-15', '2025-07-16', 150, null, 150],
  ['2025-08-15', '2025-08-18', 150, 68.57, 81.43],
  ['2025-09-15', '2025-09-16', 150, 68.79, 81.21],
  ['2025-10-15', '2025-10-16', 150, 71.62, 78.38],
  ['2025-11-17', '2025-11-18', 150, 64.02, 85.98],
  ['2025-12-15', '2025-12-16', 150, 77.23, 72.77],
  ['2026-01-15', '2026-01-16', 150, 69.68, 80.32],
  ['2026-02-17', '2026-02-18', 150, 64.74, 85.26],
  ['2026-03-16', '2026-03-17', 150, 80.42, 69.58],
  ['2026-04-15', '2026-04-16', 150, 72.94, 77.06],
  ['2026-05-15', '2026-05-18', 150, 73.16, 76.84],
  ['2026-06-15', '2026-06-16', 150, 70.83, 79.17],
  ['2026-07-15', '2026-07-16', 150, 73.61, 76.39],
  ['2026-08-17', '2026-08-18', 150, 66.22, 83.78],
  ['2026-09-15', '2026-09-16', 150, 76.57, 73.43],
  ['2026-10-15', '2026-10-16', 150, 74.27, 75.73],
]
const cents = (value) => Math.round(Number(value) * 100)
const confirmed = data.map(([date, processedDate, amount, principal, interest]) => ({ date, processedDate, amount, principal, interest, bankPaymentConfirmed: true,
  costId: sbaCostId(`banu-sba-history|${loanNumber}|${date}|${processedDate}|${amount}|${principal}|${interest}`) }))
if (confirmed.length !== 37 || confirmed.reduce((sum, item) => sum + cents(item.amount), 0) !== 553400) throw new Error('Screenshot payment count/total mismatch')
if (confirmed.some((item) => item.principal != null && cents(item.principal) + cents(item.interest) !== cents(item.amount))) throw new Error('Payment split mismatch')
const inferred = []
for (const year of [2024, 2025]) for (let month = 1; month <= 12; month++) {
  const period = `${year}-${String(month).padStart(2, '0')}`
  if (!confirmed.some((payment) => payment.date.startsWith(period))) inferred.push({ date: `${period}-15`, amount: 150, bankPaymentConfirmed: false,
    costId: sbaCostId(`sba-recurring|${SBA_COST_IDS[0]}|${period}`) })
}
if (inferred.length !== 5) throw new Error('Unexpected missing months')

const base = process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!base || !key) throw new Error('Supabase URL and service-role key required')
async function request(path, options = {}) {
  const response = await fetch(`${base}/rest/v1/${path}`, { ...options, headers: { apikey: key, Authorization: `Bearer ${key}`, ...options.headers } })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  return response.json()
}
const history = await request(`cost_versions?select=*&project_id=eq.2&order=version.desc`)
const prior = history.find((row) => row.cost_id === SBA_COST_IDS[0])
if (!prior || prior.owner_id !== 9 || prior.deleted_at) throw new Error('Missing Banu SBA cost')
const existing = new Map()
history.forEach((row) => { if (!existing.has(row.cost_id)) existing.set(row.cost_id, row) })
const children = [...existing.values()].filter((row) => !row.deleted_at && row.parent_cost_id === prior.cost_id)
const reconciled = prior.attachments.some((item) => item._type === 'banu_sba_history_reconciliation')
function strip(old) { const { id: _id, created_at: _createdAt, created_by: _createdBy, ...row } = old; return row }

if (!reconciled) {
  if (children.length || cents(prior.amount) !== 754398) throw new Error('Existing SBA history changed; review before reconciling')
  const makeChild = (payment, kind, note) => ({ ...strip(prior), cost_id: payment.costId, parent_cost_id: prior.cost_id, version: 1,
    name: `Banu SBA payment — ${payment.date}${payment.amount === 134 ? ' — additional $134 row' : ''}${payment.bankPaymentConfirmed ? '' : ' — estimated cost'}`,
    amount: payment.amount, invoice_amount: payment.amount, cost_date: payment.date, payment_date: payment.bankPaymentConfirmed ? payment.date : null,
    payment_method: null, lot_allocations: [], details: note,
    attachments: [{ _type: 'cost_details', details: note },
      { _type: 'cost_accounting', payerType: 'owner', payerOwnerId: 9, payerName: 'Banu U', vendorName: 'SBA', mainCategory: 'Land Interest & Financing', subcategory: 'Other Financing Costs', loanRelated: true, referenceNumber: loanNumber, invoiceAmount: payment.amount, paymentStatus: payment.bankPaymentConfirmed ? 'paid' : '', paymentDate: payment.bankPaymentConfirmed ? payment.date : null, notes: note },
      { _type: kind, ...payment, loanNumber, loanCostId: prior.cost_id, payerOwnerId: 9 }],
  })
  const breakdowns = confirmed.map((payment) => makeChild(payment, 'sba_payment_evidence', `Banu SBA loan ${loanNumber}. Screenshot-confirmed full payment $${payment.amount.toFixed(2)}, effective ${payment.date}, processed ${payment.processedDate}. Principal ${payment.principal == null ? 'not displayed (dash)' : `$${payment.principal.toFixed(2)}`}; interest $${payment.interest.toFixed(2)}. Full principal plus interest is a project cost per user instruction. Source: user-provided ${payment.date.slice(0, 4)} SBA screenshot.`))
  for (const payment of inferred) breakdowns.push(makeChild(payment, 'sba_monthly_cost', `User instructed full-year 2024 and 2025 costs, including missing monthly $150 installments. Period ${payment.date.slice(0, 7)}, recorded on the 15th as an estimated monthly cost. Bank payment, actual effective date, principal and interest split are unverified. Banu SBA loan ${loanNumber}; no extra charge beyond the existing aggregate.`))
  const november = { date: '2026-11-15', amount: 150, bankPaymentConfirmed: false, costId: sbaCostId(`sba-recurring|${prior.cost_id}|2026-11`) }
  breakdowns.push(makeChild(november, 'sba_monthly_cost', `Banu SBA loan ${loanNumber}, November 2026 recurring cost $150 per user instruction. Bank payment and split unverified.`))
  const explainedCents = breakdowns.reduce((sum, row) => sum + cents(row.amount), 0)
  const residualCents = cents(prior.amount) - explainedCents
  if (residualCents !== 110998) throw new Error('Unexpected unexplained original balance')
  const residual = { date: '2026-07-14', amount: residualCents / 100, bankPaymentConfirmed: false, costId: sbaCostId(`banu-sba-unreconciled-opening|${loanNumber}`) }
  const residualNote = `Unreconciled remainder of Banu's previously recorded SBA total after assigning the provided payments and user-authorized full-year estimates. $${residual.amount.toFixed(2)} is retained from the old aggregate, not newly added and not represented as confirmed paid. No source currently identifies its payment dates or principal/interest components.`
  const residualRow = makeChild(residual, 'sba_unreconciled_balance', residualNote)
  residualRow.name = 'Banu SBA — prior balance awaiting reconciliation'
  breakdowns.push(residualRow)
  const note = `SBA loan ${loanNumber} reconciliation November 16, 2026: 37 screenshot-confirmed payments total $5,534. User authorized full-year 2024 and 2025; five absent months recorded as $150 estimated costs ($750): January/February 2024 and January/February/June 2025. Both July 15, 2025 rows ($134 and $150) retained. Full-year costs: 2024 $1,800; 2025 $1,934 including extra $134. November 2026 cost $150 remains bank-unverified. Original aggregate $7,543.98 unchanged; remaining $1,109.98 of old balance is isolated as unreconciled, not confirmed payment. All principal and interest counted as Banu project costs by instruction; each payment or estimate has a separate breakdown. Monthly $150 automation continues December 15.`
  const parent = strip(prior)
  parent.version++
  parent.name = 'SBA1 — Banu payments — 3600818310'
  parent.details = [prior.details, note].filter(Boolean).join('\n\n')
  const accounting = prior.attachments.find((item) => item._type === 'cost_accounting') || { _type: 'cost_accounting' }
  parent.attachments = prior.attachments.filter((item) => !['cost_accounting', 'cost_details', 'sba_overlap_review'].includes(item._type))
  parent.attachments.push({ ...accounting, referenceNumber: loanNumber, invoiceAmount: Number(parent.amount), notes: [accounting.notes, note].filter(Boolean).join('\n\n') }, { _type: 'cost_details', details: parent.details },
    { _type: 'sba_loan', loanNumber, payerOwnerId: 9 },
    { _type: 'banu_sba_history_reconciliation', loanNumber, confirmedPaymentCount: 37, confirmedPaid: 5534, inferredMonths: inferred.map((item) => item.date.slice(0, 7)), estimatedFullYearCosts: 750, novemberUnverifiedCost: 150, unreconciledPriorBalance: 1109.98, reconciledDate: '2026-11-16', breakdownCostIds: breakdowns.map((row) => row.cost_id) })
  if (breakdowns.reduce((sum, row) => sum + cents(row.amount), 0) !== cents(parent.amount)) throw new Error('Breakdowns exceed prior total')
  await request('cost_versions', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify([parent, ...breakdowns]) })
}

const verified = await request('active_costs?select=*&project_id=eq.2')
const saved = verified.filter((row) => row.parent_cost_id === prior.cost_id)
const parent = verified.find((row) => row.cost_id === prior.cost_id)
if (saved.length !== 44 || saved.reduce((sum, row) => sum + cents(row.amount), 0) !== cents(parent.amount) || cents(parent.amount) !== 754398) throw new Error('Saved breakdown totals differ')
for (const payment of [...confirmed, ...inferred]) {
  const matches = saved.filter((row) => row.cost_id === payment.costId)
  if (matches.length !== 1 || cents(matches[0].amount) !== cents(payment.amount) || matches[0].owner_id !== 9) throw new Error('Payment identity verification failed')
}
const yearly = Object.fromEntries([2024, 2025].map((year) => [year, [...confirmed, ...inferred].filter((payment) => payment.date.startsWith(String(year))).reduce((sum, payment) => sum + cents(payment.amount), 0) / 100]))
console.log(JSON.stringify({ verified: true, alreadyReconciled: reconciled, loanNumber, confirmedPayments: 37, confirmedPaid: 5534, missingMonthCosts: 750, yearly, novemberUnverifiedCost: 150, unreconciledPriorBalance: 1109.98, totalUnchanged: parent.amount }))
