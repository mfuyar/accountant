import { createHash } from 'node:crypto'

export const CONSTRUCTION_START = '2026-07-16'
export const BANU_LOTS = ['Lot 1', 'Lot 2', 'Lot 3', 'Lot 4']
export const BANU_PERSONAL_ID = '3a78c72b-9cd0-41d3-bebe-50e0b688fcd8'
export const LAND_FINANCING_ID = '2292c1ae-7a10-4a85-a0c7-b7b3d70d3ce8'
export const BANU_LOANS = [
  { id: 'cb20d628-a292-401f-8cce-4419fdcadabc', label: 'Banu SBA', number: '3600818310', kind: 'sba' },
  { id: '99306082-0800-4000-a000-000000000002', label: 'MU payments for SBA', number: '9930608208', kind: 'sba' },
  { id: 'f22fd7bb-ae08-4246-828f-59b1227b360a', label: 'Flagstar HELOC interest', number: '0747511418', kind: 'flagstar' },
]
export const cents = (amount) => Math.round(Number(amount || 0) * 100)
export function sbaCostId(identity) {
  const hash = createHash('sha256').update(identity).digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}
export const constructionGroupId = (loanId) => sbaCostId(`banu-financing-phase|${loanId}|construction`)
export const phaseForDate = (date) => date < CONSTRUCTION_START ? 'development' : 'construction'
export function equalLotAllocations(amount) {
  const total = cents(amount)
  return BANU_LOTS.map((lot, index) => ({ lot, amount: (Math.floor(total / 4) + (index < total % 4 ? 1 : 0)) / 100 }))
}
export function sumLotAllocations(rows) {
  return BANU_LOTS.map((lot) => ({ lot, amount: rows.reduce((sum, row) => sum + (row.lot_allocations || []).filter((allocation) => allocation.lot === lot).reduce((subtotal, allocation) => subtotal + cents(allocation.amount), 0), 0) / 100 }))
}
export function versionRow(old, changes = {}) {
  const { id: _id, created_at: _createdAt, created_by: _createdBy, ...row } = structuredClone(old)
  return { ...row, version: old.version + 1, ...changes }
}
export const policyMarker = (loanId) => ({ _type: 'banu_financing_phase_policy', version: 1, constructionStart: CONSTRUCTION_START, sourceLoanCostId: loanId, payerOwnerId: 9, lotPercentages: Object.fromEntries(BANU_LOTS.map((lot) => [lot, 25])) })

function classify(row, loan, note, { aggregate = false } = {}) {
  row.owner_id = 9
  row.category = loan.kind === 'flagstar' ? 'Loan interest' : 'Financing costs'
  if (!aggregate) row.lot_allocations = equalLotAllocations(row.amount)
  row.invoice_amount = Number(row.amount)
  const accounting = row.attachments.find((item) => item._type === 'cost_accounting') || { _type: 'cost_accounting' }
  row.details = [row.details, note].filter(Boolean).join('\n\n')
  row.attachments = row.attachments.filter((item) => !['cost_accounting', 'cost_details', 'banu_financing_phase_policy'].includes(item._type))
  row.attachments.push({ ...accounting, payerType: 'owner', payerOwnerId: 9, payerName: 'Banu U', vendorName: loan.kind === 'sba' ? 'SBA' : 'Flagstar Bank', referenceNumber: loan.number,
    mainCategory: row.phase === 'construction' ? 'Construction Financing Costs' : 'Land Interest & Financing',
    subcategory: loan.kind === 'flagstar' ? row.phase === 'construction' ? 'Construction Loan Interest' : 'HELOC Interest' : 'Other Financing Costs',
    invoiceAmount: Number(row.amount), notes: [accounting.notes, note].filter(Boolean).join('\n\n'),
    ...(aggregate ? { paymentDate: null, paymentStatus: '', recurringFrequency: row.phase === 'construction' && loan.kind === 'sba' ? 'monthly' : '' } : {}),
  }, { _type: 'cost_details', details: row.details }, policyMarker(loan.id))
  if (aggregate) { row.payment_date = null; row.payment_method = null }
  return row
}

export function buildBanuPhaseMigration(activeRows, archivedAt = new Date().toISOString()) {
  const active = activeRows.filter((row) => !row.deleted_at)
  const byId = new Map(active.map((row) => [row.cost_id, row]))
  const personal = byId.get(BANU_PERSONAL_ID)
  const land = byId.get(LAND_FINANCING_ID)
  if (!personal || !land) throw new Error('Missing financing hierarchy')
  if (personal.attachments.some((item) => item._type === 'banu_financing_phase_policy')) return []
  const updates = []
  const devGroups = []
  const constructionGroups = []
  let excludedCents = 0
  for (const loan of BANU_LOANS) {
    const original = byId.get(loan.id)
    if (!original || original.owner_id !== 9 || original.parent_cost_id !== personal.cost_id || byId.has(constructionGroupId(loan.id))) throw new Error('Loan identity or hierarchy changed')
    const note = `User-authorized allocation: Banu remains payer; each payment is shared 25% across Lots 1–4. Before ${CONSTRUCTION_START} is development; on/after that first bank-funded draw date is construction. Principal plus interest counts for SBA; Flagstar records interest. Original payment identities and confirmation status are preserved.`
    let payments = active.filter((row) => row.parent_cost_id === loan.id)
    if (loan.kind === 'flagstar') {
      if (payments.length) throw new Error('Flagstar already has breakdowns; review before migrating')
      const evidence = original.attachments.find((item) => item._type === 'flagstar_interest_update')
      if (!evidence || cents(evidence.previousHelocTotal) !== 804749 || cents(original.amount) !== 1344947) throw new Error('Flagstar source totals changed')
      const opening = versionRow(original, { cost_id: sbaCostId(`flagstar-development-baseline|${loan.id}`), version: 0, name: 'Flagstar HELOC — prior recorded interest through July 2026', amount: 8047.49, cost_date: '2026-07-14', payment_date: null,
        attachments: [{ _type: 'cost_accounting', invoiceAmount: 8047.49 }, ...original.attachments.filter((item) => item.documentId), { _type: 'flagstar_opening_balance', amount: 8047.49, source: 'Prior recorded cost and attached statements through July 7, 2026', bankPaymentConfirmed: false }],
      })
      opening.details = 'Prior recorded Flagstar interest $8,047.49, retained as an aggregate because historical payment-level reconciliation is not available. Source statements predate construction.'
      payments = [opening, ...evidence.payments.map((payment) => versionRow(original, { cost_id: sbaCostId(`flagstar-interest-payment|${loan.id}|${payment.date}`), version: 0, name: `Flagstar HELOC interest — ${payment.date}`, amount: payment.amount, cost_date: payment.date, payment_date: payment.date, details: `Screenshot-confirmed Flagstar interest paid ${payment.date}: $${payment.amount.toFixed(2)}. No principal component.`,
        attachments: [{ _type: 'cost_accounting', paymentStatus: 'paid', paymentDate: payment.date, invoiceAmount: payment.amount }, { _type: 'flagstar_payment_evidence', ...payment, bankPaymentConfirmed: true, source: 'User-provided Flagstar payment-history screenshot' }],
      }))]
    }
    if (!payments.length) throw new Error('Missing source payment breakdowns')
    const devPayments = []
    const constructionPayments = []
    for (const payment of payments) {
      if (payment.attachments.some((item) => item._type === 'sba_unreconciled_balance')) {
        excludedCents += cents(payment.amount)
        const archived = versionRow(payment, { deleted_at: archivedAt })
        archived.details = `${payment.details || ''}\n\nExcluded from active costs by user instruction: the supplied SBA payment history is the full source; this $1,109.98 old balance has no supporting payment. History preserved.`
        archived.attachments.push({ _type: 'excluded_unexplained_sba_balance', amount: Number(payment.amount), authorizedDate: '2026-11-16' })
        updates.push(archived)
        continue
      }
      const phase = phaseForDate(payment.cost_date)
      const updated = classify(versionRow(payment, { phase, parent_cost_id: phase === 'construction' ? constructionGroupId(loan.id) : loan.id }), loan, note)
      updates.push(updated)
      ;(phase === 'development' ? devPayments : constructionPayments).push(updated)
    }
    for (const [phase, source] of [['development', devPayments], ['construction', constructionPayments]]) {
      const total = source.reduce((sum, payment) => sum + cents(payment.amount), 0) / 100
      const group = versionRow(original, { cost_id: phase === 'development' ? original.cost_id : constructionGroupId(loan.id), version: phase === 'development' ? original.version + 1 : 1,
        name: `${loan.label} — ${phase === 'development' ? 'Development' : 'Construction'} — ${loan.number}`, amount: total, phase,
        parent_cost_id: phase === 'development' ? personal.cost_id : null,
        cost_date: phase === 'development' ? source.map((row) => row.cost_date).sort().at(-1) : source.map((row) => row.cost_date).sort()[0],
        lot_allocations: sumLotAllocations(source),
      })
      if (!group.cost_date) throw new Error('Empty loan phase group')
      if (phase === 'development') group.attachments = group.attachments.filter((item) => item._type !== 'sba_recurring_payment')
      classify(group, loan, note, { aggregate: true })
      updates.push(group)
      ;(phase === 'development' ? devGroups : constructionGroups).push(group)
    }
  }
  const devCents = devGroups.reduce((sum, row) => sum + cents(row.amount), 0)
  const constructionCents = constructionGroups.reduce((sum, row) => sum + cents(row.amount), 0)
  if (devCents !== 2273749 || constructionCents !== 681798 || excludedCents !== 110998) throw new Error('Proposed split differs from the user-reviewed plan')
  if (cents(personal.amount) !== devCents + constructionCents + excludedCents) throw new Error('Existing Banu total does not reconcile')
  const note = `User-authorized phase split at first bank-funded draw ${CONSTRUCTION_START}. Development financing retained here; construction costs moved to three separate construction loan groups. Unsupported SBA balance $1,109.98 archived. No payment duplicated. Banu development $22,737.49; Banu construction $6,817.98.`
  const personalVersion = versionRow(personal, { name: 'Banu development financing', amount: devCents / 100, lot_allocations: sumLotAllocations(devGroups) })
  const landVersion = versionRow(land, { amount: (cents(land.amount) - constructionCents - excludedCents) / 100 })
  landVersion.lot_allocations = equalLotAllocations(landVersion.amount)
  for (const row of [personalVersion, landVersion]) {
    row.details = [row.details, note].filter(Boolean).join('\n\n')
    row.attachments = row.attachments.filter((item) => item._type !== 'cost_details').map((item) => item._type === 'cost_accounting' ? { ...item, invoiceAmount: row.amount, notes: [item.notes, note].filter(Boolean).join('\n\n') } : item)
    row.attachments.push({ _type: 'cost_details', details: row.details }, policyMarker('banu-financing'))
    row.invoice_amount = row.amount
  }
  personalVersion.owner_id = 9
  personalVersion.attachments = personalVersion.attachments.map((item) => item._type === 'cost_accounting' ? { ...item, payerType: 'owner', payerOwnerId: 9, payerName: 'Banu U' } : item)
  updates.push(personalVersion, landVersion)
  if (new Set(updates.map((row) => row.cost_id)).size !== updates.length) throw new Error('Duplicate cost updates')
  return updates
}
