// Reconcile the four user-provided 2023–2026 payment-history screenshots.
// Full principal + interest is a project cost attributed to Banu by instruction.
import { sbaCostId, SBA_SCHEDULES } from './record-monthly-sba.mjs'

const schedule = SBA_SCHEDULES[1]
// Effective date, processed date, payment, displayed principal, displayed interest.
// null preserves a dash in the screenshot; it is not a missing payment.
const data = [
  ['2023-06-07', '2023-06-08', 250, null, 250],
  ['2023-07-07', '2023-07-10', 250, null, 250],
  ['2023-08-07', '2023-08-08', 250, null, 250],
  ['2023-09-07', '2023-09-08', 250, null, 250],
  ['2023-10-10', '2023-10-11', 250, null, 250],
  ['2023-11-07', '2023-11-08', 250, null, 250],
  ['2023-12-07', '2023-12-08', 250, null, 250],
  ['2024-01-08', '2024-01-09', 250, null, 250],
  ['2024-02-07', '2024-02-08', 250, null, 250],
  ['2024-03-07', '2024-03-08', 250, null, 250],
  ['2024-04-08', '2024-04-09', 250, null, 250],
  ['2024-05-07', '2024-05-08', 250, null, 250],
  ['2024-06-07', '2024-06-10', 250, null, 250],
  ['2024-07-08', '2024-07-09', 250, null, 250],
  ['2024-08-07', '2024-08-08', 250, null, 250],
  ['2024-09-09', '2024-09-10', 250, null, 250],
  ['2024-10-07', '2024-10-08', 250, null, 250],
  ['2024-11-07', '2024-11-08', 250, 97.70, 152.30],
  ['2024-12-09', '2024-12-10', 250, 116.18, 133.82],
  ['2025-01-07', '2025-01-08', 250, 129.08, 120.92],
  ['2025-02-07', '2025-02-10', 250, 121.15, 128.85],
  ['2025-03-07', '2025-03-10', 250, 133.97, 116.03],
  ['2025-04-07', '2025-04-08', 250, 121.96, 128.04],
  ['2025-05-07', '2025-05-08', 250, 126.47, 123.53],
  // The screenshot contains both July 15 rows, with different allocations.
  ['2025-07-15', '2025-07-16', 204, 124.77, 79.23],
  ['2025-07-15', '2025-07-16', 204, null, 204],
  ['2025-08-15', '2025-08-18', 204, 77.15, 126.85],
  ['2025-09-15', '2025-09-16', 204, 77.39, 126.61],
  ['2025-10-15', '2025-10-16', 204, 81.72, 122.28],
  ['2025-11-17', '2025-11-18', 204, 69.77, 134.23],
  ['2025-12-15', '2025-12-16', 204, 90.30, 113.70],
  ['2026-01-15', '2026-01-16', 204, 78.41, 125.59],
  ['2026-02-17', '2026-02-18', 204, 70.57, 133.43],
  ['2026-03-16', '2026-03-17', 204, 95.03, 108.97],
  ['2026-04-15', '2026-04-16', 204, 83.21, 120.79],
  ['2026-05-15', '2026-05-18', 204, 83.47, 120.53],
  ['2026-06-15', '2026-06-16', 204, 79.72, 124.28],
  ['2026-07-15', '2026-07-16', 204, 83.97, 120.03],
  ['2026-08-17', '2026-08-18', 204, 72.26, 131.74],
  ['2026-09-15', '2026-09-16', 204, 88.44, 115.56],
  ['2026-10-15', '2026-10-16', 204, 84.73, 119.27],
]
const cents = (value) => Math.round(Number(value) * 100)
const payments = data.map(([date, processedDate, amount, principal, interest]) => ({
  date, processedDate, amount, principal, interest, bankPaymentConfirmed: true,
  costId: sbaCostId(`mu-sba-history|9930608208|${date}|${processedDate}|${amount}|${principal}|${interest}`),
}))
const paidCents = payments.reduce((sum, payment) => sum + cents(payment.amount), 0)
if (payments.length !== 41 || paidCents !== 946800 || new Set(payments.map((payment) => payment.costId)).size !== 41) throw new Error('Source count, total or identities do not reconcile')
if (payments.some((payment) => payment.principal != null && cents(payment.principal) + cents(payment.interest) !== cents(payment.amount))) throw new Error('Payment split does not reconcile')

const base = process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!base || !key) throw new Error('Supabase URL and service-role key required')
async function request(path, options = {}) {
  const response = await fetch(`${base}/rest/v1/${path}`, { ...options, headers: { apikey: key, Authorization: `Bearer ${key}`, ...options.headers } })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  return response.json()
}
const history = await request(`cost_versions?select=*&project_id=eq.2&order=version.desc`)
const latest = schedule.costIds.map((id) => history.find((row) => row.cost_id === id))
if (latest.some((row) => !row || row.deleted_at)) throw new Error('Missing MU loan or parent')
if (latest[0].attachments.some((item) => item._type === 'banu_financing_phase_policy')) {
  console.log('MU SBA history was reconciled and subsequently split by construction date; use the current phase groups. No changes made.')
  process.exit(0)
}
const marker = latest[0].attachments.find((item) => item._type === 'mu_sba_history_reconciliation')
const activeById = new Map()
history.forEach((row) => { if (!activeById.has(row.cost_id)) activeById.set(row.cost_id, row) })
const childRecords = [...activeById.values()].filter((row) => !row.deleted_at && row.parent_cost_id === schedule.costIds[0])
function strip(row) {
  const { id: _id, created_at: _createdAt, created_by: _createdBy, ...copy } = row
  return copy
}

if (!marker) {
  if (childRecords.length || Number(latest[0].amount) !== 1224) throw new Error('MU history changed; review before reconciling')
  if (latest[0].attachments.filter((item) => item._type === 'sba_monthly_cost' && item.bankPaymentConfirmed).length !== 5) throw new Error('Expected five previously recorded confirmed payments')
  const note = 'Reconciled full user-provided 2023–2026 MU SBA loan 9930608208 screenshots on November 16, 2026. 41 confirmed payments total $9,468: 2023 $1,750; 2024 $3,000; 2025 $2,678; January–October 2026 $2,040. The five June–October 2026 payments already recorded ($1,020) are included once. Two distinct July 15, 2025 rows are retained, one with principal $124.77 / interest $79.23 and one displaying interest $204; no June 2025 payment is shown or inferred. Each payment is a separate breakdown attributed to Banu; full principal plus interest is project cost per user instruction. November 2026 remains a separate $204 recurring cost, bank payment unverified. Parent total $9,672.'
  const novemberDate = '2026-11-15'
  const novemberId = sbaCostId(`sba-recurring|${schedule.costIds[0]}|2026-11`)
  const breakdowns = payments.map((payment) => {
    const detail = `SBA loan 9930608208, MU payments for SBA, paid by Banu. Effective ${payment.date}; processed ${payment.processedDate}. Full payment $${payment.amount.toFixed(2)} counted as project cost. Principal ${payment.principal == null ? 'not displayed (dash)' : `$${payment.principal.toFixed(2)}`}; interest $${payment.interest.toFixed(2)}. Source: user-provided ${payment.date.slice(0, 4)} SBA history screenshot.`
    return { ...strip(latest[0]), cost_id: payment.costId, parent_cost_id: schedule.costIds[0], version: 1,
      name: `MU SBA payment — ${payment.date}${payment.date === '2025-07-15' ? payment.principal == null ? ' — interest-only row' : ' — principal and interest row' : ''}`,
      amount: payment.amount, invoice_amount: payment.amount, cost_date: payment.date, payment_date: payment.date,
      payment_method: null, lot_allocations: [], details: detail,
      attachments: [
        { _type: 'cost_details', details: detail },
        { _type: 'cost_accounting', payerType: 'owner', payerOwnerId: 9, payerName: 'Banu U', vendorName: 'SBA', mainCategory: 'Land Interest & Financing', subcategory: 'Other Financing Costs', loanRelated: true, referenceNumber: '9930608208', paymentStatus: 'paid', paymentDate: payment.date, invoiceAmount: payment.amount, notes: detail },
        { _type: 'sba_payment_evidence', ...payment, loanNumber: '9930608208', source: `User-provided ${payment.date.slice(0, 4)} SBA history screenshot` },
      ],
    }
  })
  const novemberNote = 'November 15, 2026 recurring MU SBA project cost $204 under Banu, including principal and interest by user instruction. Bank payment and allocation are unverified.'
  breakdowns.push({ ...strip(latest[0]), cost_id: novemberId, parent_cost_id: schedule.costIds[0], version: 1,
    name: `MU payments for SBA — ${novemberDate}`, amount: 204, invoice_amount: 204, cost_date: novemberDate, payment_date: null, payment_method: null, lot_allocations: [], details: novemberNote,
    attachments: [{ _type: 'cost_details', details: novemberNote }, { _type: 'cost_accounting', payerType: 'owner', payerOwnerId: 9, payerName: 'Banu U', vendorName: 'SBA', mainCategory: 'Land Interest & Financing', loanRelated: true, referenceNumber: '9930608208', invoiceAmount: 204, notes: novemberNote }, { _type: 'sba_monthly_cost', date: novemberDate, amount: 204, loanCostId: schedule.costIds[0], payerOwnerId: 9, bankPaymentConfirmed: false }],
  })
  const targetCents = paidCents + 20400
  const deltaCents = targetCents - cents(latest[0].amount)
  const versions = latest.map((old, index) => {
    const row = strip(old)
    row.version++
    row.amount = (cents(old.amount) + deltaCents) / 100
    row.details = [old.details, note].filter(Boolean).join('\n\n')
    const accounting = old.attachments.find((item) => item._type === 'cost_accounting') || { _type: 'cost_accounting' }
    row.attachments = old.attachments.filter((item) => !['cost_accounting', 'cost_details'].includes(item._type))
    row.attachments.push({ ...accounting, invoiceAmount: row.amount, notes: [accounting.notes, note].filter(Boolean).join('\n\n') }, { _type: 'cost_details', details: row.details })
    if (index === 0) row.attachments.push({ _type: 'mu_sba_history_reconciliation', loanNumber: '9930608208', confirmedPaymentCount: 41, confirmedPaid: 9468, unverifiedNovemberCost: 204, breakdownCostIds: breakdowns.map((child) => child.cost_id), reconciledDate: '2026-11-16' })
    if (row.lot_allocations.length) {
      const count = row.lot_allocations.length
      row.lot_allocations = row.lot_allocations.map((allocation, n) => ({ ...allocation, amount: (cents(allocation.amount) + Math.floor(deltaCents / count) + (n < deltaCents % count ? 1 : 0)) / 100 }))
      if (row.lot_allocations.reduce((sum, allocation) => sum + cents(allocation.amount), 0) !== cents(row.amount)) throw new Error('Parent allocation mismatch')
    }
    return row
  })
  await request('cost_versions', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify([...versions, ...breakdowns]) })
}

const verified = await request('active_costs?select=*&project_id=eq.2')
const children = verified.filter((row) => row.parent_cost_id === schedule.costIds[0])
const confirmed = children.filter((row) => row.attachments.some((item) => item._type === 'sba_payment_evidence'))
if (confirmed.length !== 41 || confirmed.reduce((sum, row) => sum + cents(row.amount), 0) !== paidCents) throw new Error('Confirmed payments do not reconcile')
if (new Set(confirmed.map((row) => row.cost_id)).size !== 41) throw new Error('Duplicate payment IDs')
for (const payment of payments) {
  const row = confirmed.find((child) => child.cost_id === payment.costId)
  if (!row || cents(row.amount) !== cents(payment.amount) || row.owner_id !== 9) throw new Error('Payment verification failed')
}
const loan = verified.find((row) => row.cost_id === schedule.costIds[0])
if (children.reduce((sum, row) => sum + cents(row.amount), 0) !== cents(loan.amount)) throw new Error('MU parent and breakdown totals differ')
console.log(JSON.stringify({ verified: true, alreadyReconciled: Boolean(marker), loan: '9930608208', confirmedPayments: confirmed.length, confirmedPaid: paidCents / 100, totalWithNovemberCost: loan.amount, yearly: Object.fromEntries(['2023', '2024', '2025', '2026'].map((year) => [year, payments.filter((payment) => payment.date.startsWith(year)).reduce((sum, payment) => sum + cents(payment.amount), 0) / 100])) }))
