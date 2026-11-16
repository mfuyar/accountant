// Preview by default. Pass --apply to write one atomic immutable-version batch.
import { BANU_LOANS, BANU_PERSONAL_ID, LAND_FINANCING_ID, buildBanuPhaseMigration, cents, constructionGroupId, phaseForDate } from './lib/banu-financing-policy.mjs'

const base = process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!base || !key) throw new Error('Supabase URL and service-role key required')
async function request(path, options = {}) {
  const response = await fetch(`${base}/rest/v1/${path}`, { ...options, headers: { apikey: key, Authorization: `Bearer ${key}`, ...options.headers } })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  return response.json()
}
async function latestCosts() {
  const history = []
  for (let offset = 0;;offset += 500) {
    const page = await request(`cost_versions?select=*&project_id=eq.2&order=version.desc,id.desc&limit=500&offset=${offset}`)
    history.push(...page)
    if (page.length < 500) break
  }
  const latest = new Map()
  history.forEach((row) => { if (!latest.has(row.cost_id)) latest.set(row.cost_id, row) })
  return [...latest.values()]
}
const before = await latestCosts()
const updates = buildBanuPhaseMigration(before)
const preview = new Map([...before, ...updates].map((row) => [row.cost_id, row]))
const totals = BANU_LOANS.map((loan) => ({ loan: loan.number, development: preview.get(loan.id).amount, construction: preview.get(constructionGroupId(loan.id)).amount }))
console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'preview', versionsToWrite: updates.length, totals, excluded: 1109.98 }))
if (!process.argv.includes('--apply')) process.exit(0)
if (updates.length) await request('cost_versions', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(updates) })
const saved = await latestCosts()
const active = saved.filter((row) => !row.deleted_at)
for (const loan of BANU_LOANS) {
  for (const [phase, groupId] of [['development', loan.id], ['construction', constructionGroupId(loan.id)]]) {
    const group = active.find((row) => row.cost_id === groupId)
    const children = active.filter((row) => row.parent_cost_id === groupId)
    if (!group || group.phase !== phase || children.reduce((sum, row) => sum + cents(row.amount), 0) !== cents(group.amount)) throw new Error('Loan phase total verification failed')
    for (const row of [group, ...children]) {
      const accounting = row.attachments.find((item) => item._type === 'cost_accounting')
      if (row.owner_id !== 9 || accounting?.payerOwnerId !== 9 || accounting.payerType !== 'owner' || row.lot_allocations.length !== 4 || row.lot_allocations.reduce((sum, allocation) => sum + cents(allocation.amount), 0) !== cents(row.amount)) throw new Error('Payer or lot allocation verification failed')
      if (row !== group && phaseForDate(row.cost_date) !== phase) throw new Error('Payment cutoff verification failed')
    }
  }
}
if (active.some((row) => row.attachments.some((item) => item._type === 'sba_unreconciled_balance'))) throw new Error('Unsupported SBA balance still active')
const rootTotal = (rows) => rows.filter((row) => !row.deleted_at && !row.parent_cost_id).reduce((sum, row) => sum + cents(row.amount), 0)
if (updates.length && rootTotal(before) - rootTotal(saved) !== 110998) throw new Error('Project total changed by more than the excluded amount')
if (cents(active.find((row) => row.cost_id === BANU_PERSONAL_ID).amount) !== 2273749 || cents(active.find((row) => row.cost_id === LAND_FINANCING_ID).amount) !== 16371871) throw new Error('Development parent totals differ')
console.log(JSON.stringify({ verified: true, idempotent: !updates.length, banuDevelopment: 22737.49, banuConstruction: 6817.98, retainedTotal: 29555.47, excluded: 1109.98 }))
