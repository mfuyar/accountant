import { pathToFileURL } from 'node:url'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { monthlyContribution } from './lib/owner-capital-policy.mjs'
import { readOwnerCapitalNotes } from '../src/lib/ownerCapital.js'
export { sbaCostId } from './lib/banu-financing-policy.mjs'

// Retained for the historical screenshot import scripts and their source IDs.
export const SBA_COST_IDS = ['cb20d628-a292-401f-8cce-4419fdcadabc', '3a78c72b-9cd0-41d3-bebe-50e0b688fcd8', '2292c1ae-7a10-4a85-a0c7-b7b3d70d3ce8']
export const SBA_START_MONTH = '2026-12'
export const SBA_SCHEDULES = [
  { name: 'Banu SBA payment', amount: 150, costIds: SBA_COST_IDS },
  { name: 'MU payments for SBA', amount: 204, costIds: ['99306082-0800-4000-a000-000000000002', ...SBA_COST_IDS.slice(1)] },
]
export const SBA_OWNER_SCHEDULES = SBA_SCHEDULES.map((schedule) => ({ ...schedule, loanCostId: schedule.costIds[0] }))
export const buildSbaContribution = monthlyContribution

export function dueSbaDates(today) {
  const dates = []
  for (let month = SBA_START_MONTH; `${month}-15` <= today;) {
    dates.push(`${month}-15`)
    const [year, number] = month.split('-').map(Number)
    month = number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, '0')}`
  }
  return dates
}

async function run() {
  const base = process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) throw new Error('Supabase URL and service-role key are required')
  const logDir = path.join(os.homedir(), 'Library/Logs/GreenfortAccountant')
  await fs.mkdir(logDir, { recursive: true, mode: 0o700 })
  const lockPath = path.join(logDir, 'monthly-sba.lock')
  let lock
  try { lock = await fs.open(lockPath, 'wx', 0o600) }
  catch (error) {
    if (error.code !== 'EEXIST') throw error
    const ownerPid = Number(await fs.readFile(lockPath, 'utf8'))
    let running = false
    if (Number.isInteger(ownerPid) && ownerPid > 0) {
      try { process.kill(ownerPid, 0); running = true }
      catch (checkError) { if (checkError.code !== 'ESRCH') throw checkError }
    }
    if (running) throw new Error('Another monthly SBA recorder is running')
    await fs.unlink(lockPath)
    lock = await fs.open(lockPath, 'wx', 0o600)
  }
  await lock.writeFile(String(process.pid))
  try {
    async function request(endpoint, options = {}) {
      const response = await fetch(`${base}/rest/v1/${endpoint}`, { ...options, headers: { apikey: key, Authorization: `Bearer ${key}`, ...options.headers }, signal: AbortSignal.timeout(60000) })
      if (!response.ok) throw new Error(`SBA owner contribution request failed: HTTP ${response.status}`)
      return response.json()
    }
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    for (const schedule of SBA_OWNER_SCHEDULES) {
      let recorded = 0
      for (const date of dueSbaDates(today)) {
        const row = buildSbaContribution(date, schedule)
        const existing = await request(`project_financing_transactions?select=*&project_id=eq.2&reference=eq.${encodeURIComponent(row.reference)}`)
        if (existing.length) {
          if (existing.length !== 1 || Number(existing[0].amount) !== schedule.amount || !readOwnerCapitalNotes(existing[0].notes).capital) throw new Error('Conflicting owner contribution record')
          continue
        }
        await request('project_financing_transactions', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(row) })
        recorded++
      }
      console.log(JSON.stringify({ schedule: schedule.name, today, recordedMonths: recorded, amountPerMonth: schedule.amount, ledger: 'Owner Contributions', status: 'pending confirmation', costsCreated: 0 }))
    }
  } finally { await lock.close(); await fs.unlink(lockPath) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run().catch((error) => { console.error(error.message); process.exitCode = 1 })
