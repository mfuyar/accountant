const marker = /\n?\[\[greenfort-owner-capital:([^\]]+)\]\]/g
export const isOwnerCapitalType = (type) => ['owner_contribution', 'owner_contribution_return'].includes(type)

export function readOwnerCapitalNotes(notes = '') {
  let capital = null
  const visibleNotes = String(notes).replace(marker, (match, encoded) => {
    try {
      const value = JSON.parse(decodeURIComponent(encoded))
      if (['contribution', 'return'].includes(value.kind)) { capital = value; return '' }
    } catch { /* Invalid metadata remains visible and cannot change accounting type. */ }
    return match
  }).trim()
  return { capital, notes: visibleNotes }
}
export const isOwnerCapitalEntry = (entry) => isOwnerCapitalType(entry.type) || ['contribution', 'return'].includes(entry.capital?.kind) || Boolean(readOwnerCapitalNotes(entry.notes).capital)

export function ownerCapitalStorage(entry) {
  if (!isOwnerCapitalType(entry.type)) return { type: entry.type, notes: entry.notes || '' }
  const capital = { ...entry.capital, kind: entry.type === 'owner_contribution' ? 'contribution' : 'return', ownerId: entry.ownerId, reimbursable: true, excludedFromProjectCosts: true }
  const notes = readOwnerCapitalNotes(entry.notes).notes
  return { type: capital.kind === 'contribution' ? 'loan_received' : 'principal_repayment', notes: [notes, `[[greenfort-owner-capital:${encodeURIComponent(JSON.stringify(capital))}]]`].filter(Boolean).join('\n') }
}

export function summarizeOwnerCapital(entries = [], owners = []) {
  const rows = new Map()
  for (const entry of entries.filter(isOwnerCapitalEntry)) {
    const capital = entry.capital || readOwnerCapitalNotes(entry.notes).capital
    const ownerId = entry.ownerId ?? entry.owner_id ?? capital?.ownerId
    const owner = owners.find((item) => String(item.id) === String(ownerId))
    const row = rows.get(String(ownerId)) || { ownerId, name: capital?.ownerName || owner?.name || entry.counterparty, contributed: 0, returned: 0, pending: 0, pendingReturn: 0 }
    const kind = entry.type === 'owner_contribution_return' || capital?.kind === 'return' ? 'return' : 'contribution'
    const amount = Math.round(Number(entry.amount || 0) * 100)
    const completed = (entry.status || entry.entry_status) === 'completed'
    if (kind === 'contribution') row[completed ? 'contributed' : 'pending'] += amount
    else row[completed ? 'returned' : 'pendingReturn'] += amount
    rows.set(String(ownerId), row)
  }
  return [...rows.values()].map((row) => ({ ...row, contributed: row.contributed / 100, returned: row.returned / 100, pending: row.pending / 100, pendingReturn: row.pendingReturn / 100,
    balance: (row.contributed - row.returned) / 100, available: Math.max(0, row.contributed - row.returned - row.pendingReturn) / 100 }))
}
