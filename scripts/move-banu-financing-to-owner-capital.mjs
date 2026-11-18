// Preview by default; --apply records owner-paid contributions and archives costs.
import { BANU_LOANS, BANU_PERSONAL_ID, LAND_FINANCING_ID, cents, constructionGroupId, equalLotAllocations, versionRow } from './lib/banu-financing-policy.mjs'
import { capitalReference, contributionFromCost } from './lib/owner-capital-policy.mjs'
import { readOwnerCapitalNotes } from '../src/lib/ownerCapital.js'

const base = process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!base || !key) throw new Error('Supabase URL and service-role key required')
async function request(path, options = {}) {
  const response = await fetch(`${base}/rest/v1/${path}`, { ...options, headers: { apikey: key, Authorization: `Bearer ${key}`, ...options.headers } })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  return response.json()
}
async function latestCosts() {
  const result = new Map()
  for (let offset = 0;;offset += 500) {
    const rows = await request(`cost_versions?select=*&project_id=eq.2&order=version.desc,id.desc&limit=500&offset=${offset}`)
    rows.forEach((row) => { if (!result.has(row.cost_id)) result.set(row.cost_id, row) })
    if (rows.length < 500) break
  }
  return [...result.values()]
}
const costs = await latestCosts()
const land = costs.find((row) => row.cost_id === LAND_FINANCING_ID)
const existing = await request('project_financing_transactions?select=*&project_id=eq.2')
const completed = existing.filter((row) => readOwnerCapitalNotes(row.notes).capital?.migration === 'banu-owner-capital-2026-11-18')
const active = costs.filter((row) => !row.deleted_at)
const groupIds = BANU_LOANS.flatMap((loan) => [loan.id, constructionGroupId(loan.id)])
const payments = active.filter((row) => groupIds.includes(row.parent_cost_id))
if (!payments.length && completed.length === 90) {
  if (completed.reduce((sum, row) => sum + cents(row.amount), 0) !== 2955547 || active.some((row) => groupIds.includes(row.cost_id))) throw new Error('Owner capital reconciliation differs')
  console.log(JSON.stringify({ alreadyMigrated: true, contributions: 90, repayable: 29555.47, projectCostsAdded: 0 }))
  process.exit(0)
}
if (payments.length !== 90 || payments.reduce((sum, row) => sum + cents(row.amount), 0) !== 2955547) throw new Error('Owner-paid source payment count or total changed')
const contributions = payments.map((payment) => {
  const loan = BANU_LOANS.find((loan) => [loan.id, constructionGroupId(loan.id)].includes(payment.parent_cost_id))
  const entry = contributionFromCost(payment, loan.id)
  const capital = readOwnerCapitalNotes(entry.notes).capital
  entry.notes = entry.notes.replace(/\[\[greenfort-owner-capital:[^\]]+\]\]/, `[[greenfort-owner-capital:${encodeURIComponent(JSON.stringify({ ...capital, migration: 'banu-owner-capital-2026-11-18' }))}]]`)
  return entry
})
const missing = contributions.filter((entry) => {
  const matches = existing.filter((row) => row.reference === entry.reference)
  if (matches.length > 1 || (matches.length && (cents(matches[0].amount) !== cents(entry.amount) || !readOwnerCapitalNotes(matches[0].notes).capital))) throw new Error('Duplicate or conflicting owner contribution reference')
  return matches.length === 0
})
console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'preview', sourcePayments: payments.length, contributionRowsToCreate: missing.length, repayable: 29555.47, developmentCostsToRemove: 22737.49, constructionCostsToRemove: 6817.98 }))
if (!process.argv.includes('--apply')) process.exit(0)
if (missing.length) await request('project_financing_transactions', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(missing) })
const verifiedEntries = await request('project_financing_transactions?select=*&project_id=eq.2')
for (const payment of payments) {
  const matches = verifiedEntries.filter((entry) => entry.reference === capitalReference(payment.cost_id))
  if (matches.length !== 1 || cents(matches[0].amount) !== cents(payment.amount) || matches[0].owner_id !== 9 || matches[0].entry_status !== 'completed') throw new Error('Contribution verification failed; source costs retained')
}
const archivedAt = new Date().toISOString()
const toArchive = active.filter((row) => groupIds.includes(row.cost_id) || groupIds.includes(row.parent_cost_id) || row.cost_id === BANU_PERSONAL_ID)
if (toArchive.length !== 97 || cents(land.amount) !== 16371871) throw new Error('Source hierarchy changed; contributions saved but source costs need review')
const archives = toArchive.map((old) => {
  const row = versionRow(old, { deleted_at: archivedAt })
  row.details = `${old.details || ''}\n\nReclassified by user on November 18, 2026 to repayable owner contribution by Banugul Barut Uyar. Excluded from construction/development spending. Original loan, payment, allocation and document history retained; repayment is not a second expense or profit payout.`
  row.attachments.push({ _type: 'moved_to_owner_capital', sourceCostId: old.cost_id, ownerId: 9, migration: 'banu-owner-capital-2026-11-18' })
  return row
})
const landVersion = versionRow(land, { amount: (cents(land.amount) - 2273749) / 100 })
landVersion.invoice_amount = landVersion.amount
landVersion.lot_allocations = equalLotAllocations(landVersion.amount)
landVersion.attachments = landVersion.attachments.map((item) => item._type === 'cost_accounting' ? { ...item, invoiceAmount: landVersion.amount, notes: `${item.notes || ''}\n\nBanugul's $22,737.49 owner-paid financing removed from development cost and recorded separately as repayable owner contribution.` } : item)
landVersion.details = `${landVersion.details || ''}\n\nBanugul financing moved to the Owner Contributions ledger, not a project expense.`
await request('cost_versions', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify([...archives, landVersion]) })
const after = (await latestCosts()).filter((row) => !row.deleted_at)
if (after.some((row) => groupIds.includes(row.cost_id) || groupIds.includes(row.parent_cost_id) || row.cost_id === BANU_PERSONAL_ID)) throw new Error('Owner financing still appears as an active cost')
const rootTotal = (rows, phase = null) => rows.filter((row) => !row.parent_cost_id && (!phase || row.phase === phase)).reduce((sum, row) => sum + cents(row.amount), 0)
if (rootTotal(active) - rootTotal(after) !== 2955547 || rootTotal(active, 'construction') - rootTotal(after, 'construction') !== 681798) throw new Error('Spending totals do not reconcile')
console.log(JSON.stringify({ verified: true, contributionPayments: 90, contributedByBanugul: 29555.47, returnedToOwner: 0, repayableBalance: 29555.47, constructionCostsRemoved: 6817.98, developmentCostsRemoved: 22737.49 }))
