import { pathToFileURL } from 'node:url'
import { constructionGroupId, equalLotAllocations, policyMarker } from './lib/banu-financing-policy.mjs'
import { sbaCostId } from './lib/banu-financing-policy.mjs'
export { sbaCostId } from './lib/banu-financing-policy.mjs'

export const SBA_COST_IDS = [
  'cb20d628-a292-401f-8cce-4419fdcadabc',
  '3a78c72b-9cd0-41d3-bebe-50e0b688fcd8',
  '2292c1ae-7a10-4a85-a0c7-b7b3d70d3ce8',
]
export const SBA_START_MONTH = '2026-12'
export const SBA_SCHEDULES = [
  { name: 'Banu SBA payment', amount: 150, individualPayments: true, costIds: SBA_COST_IDS },
  { name: 'MU payments for SBA', amount: 204, individualPayments: true, costIds: ['99306082-0800-4000-a000-000000000002', ...SBA_COST_IDS.slice(1)] },
]
export const SBA_CONSTRUCTION_SCHEDULES = SBA_SCHEDULES.map((schedule) => ({
  ...schedule, loanCostId: schedule.costIds[0], costIds: [constructionGroupId(schedule.costIds[0])], phase: 'construction',
}))

export function dueSbaDates(today) {
  const dates = []
  for (let month = SBA_START_MONTH; `${month}-15` <= today;) {
    dates.push(`${month}-15`)
    const [year, number] = month.split('-').map(Number)
    month = number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, '0')}`
  }
  return dates
}

export function buildSbaVersions(latest, date, schedule = SBA_CONSTRUCTION_SCHEDULES[0]) {
  if (!latest[0]?.attachments?.some((item) => item._type === 'sba_recurring_payment'
    && item.startMonth === SBA_START_MONTH && item.amount === schedule.amount && item.day === 15)) {
    throw new Error('Authorized monthly SBA schedule is missing')
  }
  if (latest[0].attachments.some((item) => item._type === 'sba_monthly_cost' && item.date.slice(0, 7) === date.slice(0, 7))) return []
  if (latest.some((row, index) => row.cost_id !== schedule.costIds[index] || row.project_id !== 2 || row.deleted_at)) throw new Error('SBA cost hierarchy needs review')
  if (schedule.phase !== 'construction' || latest.length !== 1 || latest[0].phase !== 'construction'
    || !latest[0].attachments.some((item) => item._type === 'banu_financing_phase_policy')) throw new Error('Construction allocation policy must be applied before recurring costs')
  const loanId = schedule.loanCostId
  const amountCents = Math.round(schedule.amount * 100)
  const note = `Recurring ${schedule.name} cost for Banu, ${date}: $${schedule.amount} including principal and interest, per user instruction. Bank payment confirmation and principal/interest split have not been provided.`
  const versions = latest.map((old, index) => {
    const { id: _id, created_at: _createdAt, created_by: _createdBy, ...row } = old
    row.version = old.version + 1
    row.amount = (Math.round(Number(old.amount) * 100) + amountCents) / 100
    row.phase = 'construction'
    row.owner_id = 9
    row.category = 'Financing costs'
    row.details = [old.details, note].filter(Boolean).join('\n\n')
    row.attachments = old.attachments.filter((item) => !['cost_accounting', 'cost_details'].includes(item._type))
    const prior = old.attachments.find((item) => item._type === 'cost_accounting') || { _type: 'cost_accounting' }
    row.attachments.push({ ...prior, invoiceAmount: row.amount, notes: [prior.notes, note].filter(Boolean).join('\n\n'), ...(index === 0 ? {
      payerType: 'owner', payerOwnerId: 9, payerName: 'Banu U', loanRelated: true,
      recurringFrequency: 'monthly', mainCategory: 'Construction Financing Costs', subcategory: 'Other Financing Costs',
    } : {}) }, { _type: 'cost_details', details: row.details }, { _type: 'sba_monthly_cost', date, amount: schedule.amount, payerOwnerId: 9, loanCostId: loanId, bankPaymentConfirmed: false })
    if (index === 0) row.cost_date = date
    row.lot_allocations = equalLotAllocations(row.amount)
    return row
  })
  if (schedule.individualPayments) {
    const child = { ...versions[0], cost_id: sbaCostId(`sba-recurring|${loanId}|${date.slice(0, 7)}`), parent_cost_id: schedule.costIds[0], version: 1,
      name: `${schedule.name} — ${date}`, amount: schedule.amount, invoice_amount: schedule.amount,
      payment_date: null, payment_method: null, lot_allocations: equalLotAllocations(schedule.amount), details: note,
      attachments: [
        { _type: 'cost_details', details: note },
        { _type: 'cost_accounting', invoiceAmount: schedule.amount, payerType: 'owner', payerOwnerId: 9, payerName: 'Banu U', mainCategory: 'Construction Financing Costs', subcategory: 'Other Financing Costs', referenceNumber: versions[0].attachments.find((item) => item._type === 'cost_accounting')?.referenceNumber, loanRelated: true, notes: note },
        { _type: 'sba_monthly_cost', date, amount: schedule.amount, payerOwnerId: 9, loanCostId: loanId, bankPaymentConfirmed: false },
        policyMarker(loanId),
      ],
    }
    versions.push(child)
  }
  return versions
}

async function run() {
  const base = process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) throw new Error('Supabase URL and service-role key are required')
  async function request(path, options = {}) {
    const response = await fetch(`${base}/rest/v1/${path}`, {
      ...options, headers: { apikey: key, Authorization: `Bearer ${key}`, ...options.headers },
      signal: AbortSignal.timeout(60000),
    })
    if (!response.ok) throw new Error(`SBA record request failed: HTTP ${response.status}`)
    return response.json()
  }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  for (const schedule of SBA_CONSTRUCTION_SCHEDULES) {
    let recorded = 0
    for (const date of dueSbaDates(today)) {
      const history = await request(`cost_versions?select=*&project_id=eq.2&cost_id=in.(${schedule.costIds.join(',')})&order=version.desc`)
      const latest = schedule.costIds.map((id) => history.find((row) => row.cost_id === id))
      const versions = buildSbaVersions(latest, date, schedule)
      if (!versions.length) continue
      // One atomic insert advances all three totals. Unique version keys also
      // prevent concurrent runs from recording the same month twice.
      await request('cost_versions', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(versions) })
      recorded++
    }
    console.log(JSON.stringify({ schedule: schedule.name, today, recordedMonths: recorded, amountPerMonth: schedule.amount }))
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => { console.error(error.message); process.exitCode = 1 })
}
