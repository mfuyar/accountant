// Run with: node --env-file=.env scripts/record-providence-construction-interest.mjs
// Copies the user's confirmed bank interest payments into the construction ledger.
// Financing records remain payment history; only cost_versions feeds cost totals.
import { createHash } from 'node:crypto'

const base = process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!base || !key) throw new Error('Supabase URL and service-role key are required')

async function request(path, options = {}) {
  const response = await fetch(`${base}/rest/v1/${path}`, {
    ...options,
    headers: { apikey: key, Authorization: `Bearer ${key}`, ...options.headers },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  const text = await response.text()
  return text ? JSON.parse(text) : null
}

const [financing, costs, documents] = await Promise.all([
  request('project_financing_transactions?select=*&project_id=eq.2&entry_type=eq.interest_payment&entry_status=eq.completed'),
  request('active_costs?select=*&project_id=eq.2'),
  request('documents?select=*&project_id=eq.2'),
])
const sourceNames = ['Export-16112026.pdf', 'Export-16112026 (1).pdf']
const payments = financing.filter((entry) => /^Providence Bank — Building [234] — loan (0784|0786|0792)$/.test(entry.counterparty)
  && sourceNames.some((name) => entry.notes.includes(`Source: ${name};`)))
const totalCents = payments.reduce((sum, entry) => sum + Math.round(Number(entry.amount) * 100), 0)
if (payments.length !== 18 || totalCents !== 2312656) throw new Error('Expected 18 confirmed interest payments totaling $23,126.56')

const rows = payments.map((entry) => {
  const building = entry.counterparty.match(/Building ([234])/)[1]
  const suffix = entry.counterparty.match(/loan (\d+)$/)[1]
  const sourceName = sourceNames.find((name) => entry.notes.includes(`Source: ${name};`))
  const documentId = entry.notes.match(/document ID ([0-9a-f-]{36})/)?.[1]
  const document = documents.find((item) => item.id === documentId && item.original_name === sourceName)
  if (!document) throw new Error(`Missing bank statement for interest payment ${entry.id}`)
  const hash = createHash('sha256').update(`providence-construction-interest|2|${entry.reference}`).digest('hex')
  const costId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
  const notes = `Construction loan interest, Building ${building} / Lot ${building}, Providence note 10050${suffix}. Paid from Providence checking ending 1564 on ${entry.entry_date}; bank reference ${entry.reference}. Outgoing internal transfer classified entirely as interest per user instruction. Financing payment record ${entry.id} is the same payment, not an additional expense.`
  return {
    cost_id: costId, project_id: 2, owner_id: 12, version: 1,
    name: `Providence construction loan interest — Building ${building} — ${entry.entry_date}`,
    amount: Number(entry.amount), invoice_amount: Number(entry.amount), phase: 'construction',
    category: 'Loan interest', cost_date: entry.entry_date, parent_cost_id: null,
    details: notes, payment_method: 'providence_ach', payment_date: entry.entry_date,
    payment_fee_percentage: null, payment_fee_amount: 0,
    lot_allocations: [{ lot: `Lot ${building}`, amount: Number(entry.amount) }],
    attachments: [
      { documentId: document.id, name: document.original_name, mimeType: document.mime_type, size: document.size_bytes, storageBucket: document.storage_bucket, storagePath: document.storage_path },
      { _type: 'construction_interest_source', financingTransactionId: entry.id, bankReference: entry.reference },
      { _type: 'cost_details', details: notes },
      { _type: 'cost_accounting', vendorName: 'Providence Bank', mainCategory: 'Construction Financing Costs', subcategory: 'Construction Loan Interest', payerType: 'company', payerName: 'Green Fort LLC', paymentSource: 'Providence checking ending 1564', paymentMethod: 'providence_ach', paymentStatus: 'paid', paymentDate: entry.entry_date, invoiceAmount: Number(entry.amount), referenceNumber: entry.reference, reimbursable: false, loanRelated: true, notes },
    ],
  }
})
const missing = rows.filter((row) => {
  const matches = costs.filter((cost) => cost.cost_id === row.cost_id
    || cost.attachments?.some((attachment) => attachment._type === 'construction_interest_source'
      && attachment.financingTransactionId === row.attachments[1].financingTransactionId)
    || (cost.category === 'Loan interest' && cost.attachments?.some((attachment) => attachment.referenceNumber === row.attachments[1].bankReference)))
  if (matches.length > 1 || (matches.length && (Number(matches[0].amount) !== row.amount || matches[0].phase !== 'construction'))) throw new Error('Existing interest cost needs review')
  return matches.length === 0
})
if (missing.length) await request('cost_versions', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(missing),
})
const verified = await request('active_costs?select=*&project_id=eq.2')
for (const row of rows) {
  const matches = verified.filter((cost) => cost.attachments?.some((attachment) => attachment._type === 'construction_interest_source'
    && attachment.financingTransactionId === row.attachments[1].financingTransactionId))
  const paymentDate = matches[0]?.payment_date || matches[0]?.attachments?.find((attachment) => attachment._type === 'cost_accounting')?.paymentDate
  if (matches.length !== 1 || Number(matches[0].amount) !== row.amount || paymentDate !== row.payment_date) throw new Error('Interest cost verification failed')
}
console.log(JSON.stringify({ added: missing.length, verifiedPayments: rows.length, interestPaid: totalCents / 100 }))
