// Preview by default. --apply adds unpaid costs and documents; never writes checks.
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { sbaCostId as stableId } from './lib/banu-financing-policy.mjs'
import { paymentBalance } from '../src/lib/paymentBalance.js'

const base = process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!base || !key) throw new Error('Supabase URL and service-role key required')
const projectId = 2
const companyId = 'bc1f27bd-aab4-4766-9997-ba57f90d232c'
const directory = '/tmp/greenfort-tryon-nov-bills'
const sourceName = 'TryonNov.Bills.pdf'
const source = await fs.readFile(`/Users/muhemmet/Downloads/${sourceName}`)
const sourceHash = createHash('sha256').update(source).digest('hex')
const importKey = `tryon-nov-bills|${sourceHash}`
const id = (identity) => stableId(`${importKey}|${identity}`)
const cents = (amount) => Math.round(Number(amount || 0) * 100)
const payees = {
  sbs: { name: 'SBS Service Building Supply', address: 'P.O. Box 896730\nCharlotte, NC 28289-6730', phone: '919-776-1500', trade: 'Construction materials', groupId: '95757279-ec92-4449-a791-a83de2a7e0b1' },
  concrete: { name: 'S.A. Brothers Concrete, LLC', address: '1140 Benson Road, Ste 222\nGarner, NC 27529', phone: '919-615-2333', email: 'contact@sabrothersconcrete.com', trade: 'Concrete', draftId: '644cb608-2a1e-4f45-a8d7-0d3f9fc87a4a', groupId: id('payee|sa-brothers') },
  hvac: { name: 'Maynor Service Company', address: '1000 Goodworth Drive\nApex, NC 27539', phone: '919-361-0993', email: 'info@maynorservices.com', trade: 'HVAC', draftId: 'b4915272-317c-4ddc-9641-407f3562193f', groupId: id('payee|maynor') },
}
const invoices = [
  { payee: 'concrete', reference: '2656', date: '2026-11-16', due: '2026-11-16', amount: 28844, lot: 'Lot 2', file: 'SA-Brothers-2656.pdf', page: 2, description: 'Mono slab / slab turnkey, Lot 2 Units A and B, 4700 Tryon Road. Billed to TA Habitech Builders.' },
  { payee: 'concrete', reference: '2657', date: '2026-11-16', due: '2026-11-16', amount: 28844, lot: 'Lot 3', file: 'SA-Brothers-2657.pdf', page: 3, description: 'Mono slab / slab turnkey, Lot 3 Units A and B, 4700 Tryon Road. Billed to TA Habitech Builders.' },
  { payee: 'hvac', reference: '435113428', date: '2026-10-26', due: '2026-11-25', amount: 15750, lot: 'Lot 4', file: 'Maynor-435113428.pdf', page: 4, description: 'Rough-in HVAC, 4A Avent Ferry Towns, 5552 Avent Ferry Road. Billed to A & M Venture, Inc.' },
  { payee: 'hvac', reference: '488893448', date: '2026-10-29', due: '2026-11-28', amount: 15750, lot: 'Lot 3', file: 'Maynor-488893448.pdf', page: 5, description: 'Rough-in HVAC, 3B Avent Ferry Towns, 5556 Avent Ferry Road. Billed to A & M Venture, Inc.' },
  { payee: 'hvac', reference: '488861304', date: '2026-10-28', due: '2026-11-27', amount: 15750, lot: 'Lot 3', file: 'Maynor-488861304.pdf', page: 6, description: 'Rough-in HVAC, 3A Avent Ferry Towns, 5558 Avent Ferry Road. Billed to A & M Venture, Inc.' },
  { payee: 'hvac', reference: '488049961', date: '2026-10-27', due: '2026-11-26', amount: 15750, lot: 'Lot 4', file: 'Maynor-488049961.pdf', page: 7, description: 'Rough-in HVAC, 4B Avent Ferry Towns, 5560 Avent Ferry Road. User explicitly confirmed Lot 4 on November 18, 2026 despite address differing from saved lot addresses. Original invoice address preserved. Billed to A & M Venture, Inc.' },
]
const subaccounts = [
  { reference: '1-1', lot: 'Lot 4', amount: 21985.49 },
  { reference: '3-1', lot: 'Lot 3', amount: 21126.25 },
  { reference: '3-2', lot: 'Lot 3', amount: 1055 },
  { reference: '5-1', lot: 'Lot 2', amount: 17819.60 },
  { reference: '7-1', lot: 'Lot 1', amount: 10309.25 },
]
if (subaccounts.reduce((sum, item) => sum + cents(item.amount), 0) !== 7229559 || invoices.reduce((sum, item) => sum + cents(item.amount), 0) !== 12068800) throw new Error('Transcribed bills do not reconcile')

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, { ...options, headers: { apikey: key, Authorization: `Bearer ${key}`, ...options.headers } })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  const text = await response.text()
  return text ? JSON.parse(text) : null
}
const [costs, checks, documents, vendors] = await Promise.all([
  request('/rest/v1/active_costs?select=*&project_id=eq.2'), request('/rest/v1/project_checks?select=*&project_id=eq.2'),
  request('/rest/v1/documents?select=*&project_id=eq.2'), request('/rest/v1/vendors?select=*'),
])
const alreadyImported = costs.some((cost) => cost.attachments.some((item) => item._type === 'november_bill_import' && item.sourceHash === sourceHash))
if (alreadyImported) {
  for (const invoice of invoices) {
    const matches = costs.filter((cost) => cost.cost_id === id(`invoice|${invoice.payee}|${invoice.reference}`))
    if (matches.length !== 1 || cents(matches[0].amount) !== cents(invoice.amount)) throw new Error('Partial import needs review')
  }
  console.log(JSON.stringify({ alreadyImported: true, additionalCost: 0, checksCreated: 0 }))
  process.exit(0)
}
for (const invoice of invoices) {
  if (costs.some((cost) => [cost.name, ...cost.attachments.filter((item) => item._type === 'cost_accounting').map((item) => item.referenceNumber)].some((value) => String(value || '').includes(invoice.reference)))) throw new Error(`Possible duplicate invoice ${invoice.reference}`)
}
const normalize = (row) => {
  const accounting = row.attachments.find((item) => item._type === 'cost_accounting') || {}
  return { ...row, costId: row.cost_id, parentCostId: row.parent_cost_id, paymentDate: row.payment_date || accounting.paymentDate || '', paymentStatus: accounting.paymentStatus || '', paymentMethod: row.payment_method || accounting.paymentMethod || '' }
}
const sbs = costs.find((cost) => cost.cost_id === payees.sbs.groupId)
const oldSbsBalance = paymentBalance(normalize(sbs), costs.map(normalize), checks.map((check) => ({ ...check, costId: check.cost_id, invoiceId: check.invoice_id })))
if (cents(sbs.amount) !== 30129551 || oldSbsBalance.remaining !== 0 || oldSbsBalance.overpaid !== 0) throw new Error('Prior SBS costs/payment balance changed; reconcile before adding statement')
if (!process.argv.includes('--apply')) {
  console.log(JSON.stringify({ mode: 'preview', newCost: 192983.59, payees: [{ name: payees.sbs.name, amount: 72295.59 }, { name: payees.concrete.name, amount: 57688 }, { name: payees.hvac.name, amount: 63000 }], sourcePages: 7, checksToCreate: 0 }))
  process.exit(0)
}

const attachments = new Map()
async function storeDocument(name, bytes, date = null) {
  const hash = createHash('sha256').update(bytes).digest('hex')
  const documentId = id(`document|${name}|${hash}`)
  let document = documents.find((item) => item.id === documentId)
  if (!document) {
    const storagePath = `${projectId}/${documentId}-${name.replace(/[^a-zA-Z0-9._-]+/g, '-')}`
    await request(`/storage/v1/object/accounting-documents/${storagePath}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'x-upsert': 'false' }, body: bytes })
    try {
      const saved = await request('/rest/v1/documents', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ id: documentId, project_id: projectId, storage_bucket: 'accounting-documents', storage_path: storagePath, original_name: name, mime_type: 'application/pdf', size_bytes: bytes.length, document_date: date, description: `Source ${sourceName}; imported as unpaid costs November 18, 2026. SHA256 ${hash}` }) })
      document = saved[0]
    } catch (error) {
      await request('/storage/v1/object/accounting-documents', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [storagePath] }) })
      throw error
    }
    documents.push(document)
  }
  const response = await fetch(`${base}/storage/v1/object/authenticated/${document.storage_bucket}/${document.storage_path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  if (!response.ok || !Buffer.from(await response.arrayBuffer()).equals(bytes)) throw new Error('Stored PDF differs from source')
  const attachment = { documentId: document.id, name: document.original_name, mimeType: 'application/pdf', size: document.size_bytes, storageBucket: document.storage_bucket, storagePath: document.storage_path }
  attachments.set(name, attachment)
  return attachment
}
await storeDocument(sourceName, source)
await storeDocument('SBS-statement-2026-10-31.pdf', await fs.readFile(`${directory}/SBS-statement-2026-10-31.pdf`), '2026-10-31')
for (const invoice of invoices) await storeDocument(invoice.file, await fs.readFile(`${directory}/${invoice.file}`), invoice.date)

for (const payee of Object.values(payees)) {
  const existing = vendors.find((vendor) => vendor.name.trim().toLowerCase() === payee.name.toLowerCase())
  if (!existing) await request('/rest/v1/vendors', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ company_id: companyId, name: payee.name, trade: payee.trade, mailing_address: payee.address, contact_phone: payee.phone, contact_email: payee.email || null }) })
}
const history = await request(`/rest/v1/cost_versions?select=*&project_id=eq.2&cost_id=eq.${sbs.cost_id}&order=version.desc&limit=1`)
const original = history[0]
if (original.version !== sbs.version || cents(original.amount) !== cents(sbs.amount)) throw new Error('SBS cost changed while documents uploaded')
const { id: _id, created_at: _createdAt, created_by: _createdBy, ...template } = original
const rows = []
const marker = { _type: 'november_bill_import', sourceHash, sourceName, sourceDocumentId: attachments.get(sourceName).documentId, importDate: '2026-11-18', checksAuthorized: false }
const lotTotals = (items) => ['Lot 1', 'Lot 2', 'Lot 3', 'Lot 4'].map((lot) => ({ lot, amount: items.filter((item) => item.lot === lot).reduce((sum, item) => sum + cents(item.amount), 0) / 100 })).filter((entry) => entry.amount > 0)
function cost({ costId, name, payee, amount, date, reference, due, description, files, allocations, parent = null, page = null }) {
  const vendor = payees[payee]
  const note = `${description} ${due ? `Due ${due}.` : ''} Unpaid; no payment or check has been created. Source: ${sourceName}${page ? ` page ${page}` : ''}.`
  return { ...template, cost_id: costId, parent_cost_id: parent, version: 1, owner_id: 12, name, amount, phase: 'construction', cost_date: date, details: note,
    category: vendor.name, construction_draft_id: vendor.draftId || null, invoice_amount: amount, payment_date: null, payment_method: null, payment_fee_amount: null, payment_fee_percentage: null,
    lot_allocations: allocations, deleted_at: null,
    attachments: [...files.map((file) => {
      const invoice = invoices.find((item) => item.file === file)
      return { ...attachments.get(file), vendor: vendor.name, vendorMailingAddress: vendor.address,
        reference: invoice?.reference || reference, amount: invoice?.amount || amount, date: invoice?.date || date, sourcePage: invoice?.page || page }
    }),
      { _type: 'cost_details', details: note },
      { _type: 'cost_accounting', vendorName: vendor.name, mainCategory: 'Construction Costs', subcategory: payee === 'sbs' ? 'Other Construction Costs' : vendor.trade,
        constructionDraftId: vendor.draftId || null, payerType: 'company', payerName: 'Green Fort LLC', invoiceAmount: amount, paymentStatus: 'unpaid', paymentDate: null, paymentMethod: '', referenceNumber: reference, reimbursable: false, loanRelated: false, notes: note }, marker],
  }
}
for (const group of ['concrete', 'hvac']) {
  const items = invoices.filter((invoice) => invoice.payee === group)
  rows.push(cost({ costId: payees[group].groupId, name: payees[group].name, payee: group, amount: items.reduce((sum, item) => sum + cents(item.amount), 0) / 100,
    date: items.map((item) => item.date).sort().at(-1), reference: items.map((item) => item.reference).join(', '), due: items.map((item) => item.due).sort()[0],
    description: `Payee group for ${items.length} invoices; full invoice amounts are supporting breakdowns and must not be counted again.`, files: items.map((item) => item.file), allocations: lotTotals(items) }))
  for (const invoice of items) rows.push(cost({ costId: id(`invoice|${invoice.payee}|${invoice.reference}`), name: `${payees[group].name} — invoice ${invoice.reference}`, payee: group,
    amount: invoice.amount, date: invoice.date, reference: invoice.reference, due: invoice.due, description: invoice.description, files: [invoice.file], allocations: [{ lot: invoice.lot, amount: invoice.amount }], parent: payees[group].groupId, page: invoice.page }))
}
const statementId = id('sbs|statement|2026-10-31|5100223')
const sbsNote = 'October 31, 2026 statement, customer 5100223. Five uncrossed Tryon subaccounts total $72,295.59, matching the handwritten correction. Excludes crossed-out non-Tryon amounts $1,794.65, $130.77 and $425.93 ($2,351.35); printed statement total $74,646.94 is not used. Previous SBS ledger costs $301,295.51 are already paid by linked checks; this is the new outstanding statement balance. No invoice-level detail supplied for these five subaccount balances.'
rows.push(cost({ costId: statementId, name: 'SBS Service Building Supply — October 31 statement', payee: 'sbs', amount: 72295.59, date: '2026-10-31', reference: '5100223 / 2026-10-31', due: '2026-11-20', description: sbsNote, files: ['SBS-statement-2026-10-31.pdf'], allocations: lotTotals(subaccounts), parent: payees.sbs.groupId, page: 1 }))
for (const subaccount of subaccounts) rows.push(cost({ costId: id(`sbs|2026-10-31|${subaccount.reference}`), name: `SBS — subaccount ${subaccount.reference} — ${subaccount.lot}`, payee: 'sbs', amount: subaccount.amount, date: '2026-10-31', reference: `5100223 / ${subaccount.reference} / 2026-10-31`, due: '2026-11-20', description: `Statement subaccount balance, allocated to ${subaccount.lot} using the handwritten lot identification. Not a separate invoice. ${sbsNote}`, files: ['SBS-statement-2026-10-31.pdf'], allocations: [{ lot: subaccount.lot, amount: subaccount.amount }], parent: statementId, page: 1 }))
const sbsVersion = { ...template, version: original.version + 1, name: payees.sbs.name, amount: 373591.10, invoice_amount: 373591.10, cost_date: '2026-10-31', category: payees.sbs.name,
  lot_allocations: original.lot_allocations.map((allocation) => ({ ...allocation, amount: (cents(allocation.amount) + subaccounts.filter((item) => item.lot === allocation.lot).reduce((sum, item) => sum + cents(item.amount), 0)) / 100 })),
  attachments: [...original.attachments.filter((item) => !['cost_accounting', 'cost_details'].includes(item._type)), attachments.get('SBS-statement-2026-10-31.pdf'),
    { ...original.attachments.find((item) => item._type === 'cost_accounting'), invoiceAmount: 373591.10, vendorName: payees.sbs.name, notes: `${original.attachments.find((item) => item._type === 'cost_accounting')?.notes || ''}\n\n${sbsNote}` }, marker],
  details: [original.details, sbsNote].filter(Boolean).join('\n\n'),
}
sbsVersion.attachments.push({ _type: 'cost_details', details: sbsVersion.details })
rows.push(sbsVersion)
for (const row of rows) if (row.lot_allocations.reduce((sum, allocation) => sum + cents(allocation.amount), 0) !== cents(row.amount)) throw new Error('Cost allocations do not reconcile')
if (new Set(rows.map((row) => row.cost_id)).size !== rows.length) throw new Error('Duplicate cost IDs')
await request('/rest/v1/cost_versions', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(rows) })
const [verified, checksAfter] = await Promise.all([request('/rest/v1/active_costs?select=*&project_id=eq.2'), request('/rest/v1/project_checks?select=*&project_id=eq.2')])
for (const row of rows) {
  const actual = verified.find((item) => item.cost_id === row.cost_id)
  if (!actual || cents(actual.amount) !== cents(row.amount) || actual.version !== row.version) throw new Error('Saved cost verification failed')
}
const rootTotal = (items) => items.filter((item) => !item.parent_cost_id).reduce((sum, item) => sum + cents(item.amount), 0)
if (rootTotal(verified) - rootTotal(costs) !== 19298359) throw new Error('Project totals double-count or omit bills')
if (JSON.stringify(checks.map((check) => check.id).sort()) !== JSON.stringify(checksAfter.map((check) => check.id).sort())) throw new Error('Check register changed during import')
const normalized = verified.map(normalize)
const normalizedChecks = checksAfter.map((check) => ({ ...check, costId: check.cost_id, invoiceId: check.invoice_id }))
const balances = Object.values(payees).map((payee) => ({ payee: payee.name, balance: paymentBalance(normalized.find((item) => item.costId === payee.groupId), normalized, normalizedChecks) }))
if (balances.reduce((sum, item) => sum + cents(item.balance.remaining), 0) !== 19298359) throw new Error('Unpaid balances differ from imported bills')
console.log(JSON.stringify({ verified: true, newCosts: 192983.59, checksCreated: 0, documentsRetained: 8, payees: balances.map((item) => ({ payee: item.payee, unpaid: item.balance.remaining })) }))
