// Recognizes statements with dated invoice rows and a detachable payment stub.
// Does not infer a supplier from the customer name or treat an amount due as paid.
export function extractStatementFromText(text) {
  if (!/\bSTATEMENT\b/i.test(text) || !/INVOICE\s+NO\./i.test(text)) return null
  const datePattern = '(\\d{2}/\\d{2}/\\d{2,4})'
  const pattern = new RegExp(`${datePattern}\\s+([A-Z0-9-]+)\\s+${datePattern}\\s+([\\d,]+\\.\\d{2})\\s+PO#\\s+(.+?)\\s+\\2\\s+\\4`, 'gi')
  const isoDate = (value) => {
    const [month, day, year] = value.split('/')
    const result = `${year.length === 2 ? '20' : ''}${year}-${month}-${day}`
    const parsed = new Date(`${result}T00:00:00Z`)
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(result) ? result : ''
  }
  const rows = new Map()
  for (const match of text.matchAll(pattern)) {
    const row = { date: isoDate(match[1]), reference: match[2], due: isoDate(match[3]), amount: Number(match[4].replaceAll(',', '')), description: match[5].trim() }
    if (!row.date || !row.due || !Number.isFinite(row.amount)) return null
    if (rows.has(row.reference) && JSON.stringify(rows.get(row.reference)) !== JSON.stringify(row)) return null
    rows.set(row.reference, row)
  }
  if (!rows.size) return null
  const invoices = [...rows.values()]
  const amount = invoices.reduce((sum, row) => sum + Math.round(row.amount * 100), 0) / 100
  // Require the sum to also occur in the statement's balance summary.
  const summary = text.split(/ALL ACCOUNTS ARE DUE/i)[0]
  const balances = [...summary.matchAll(/\b[\d,]+\.\d{2}\b/g)].map(([value]) => Number(value.replaceAll(',', '')))
  if (!balances.includes(amount)) return null
  const statementDate = text.match(new RegExp(`\\b\\d{5,}\\s+${datePattern}\\s+\\d{5,}\\s+\\1`))
  const date = statementDate ? isoDate(statementDate[1]) : ''
  const description = `Materials statement — ${invoices.length} invoice${invoices.length === 1 ? '' : 's'}`
  return {
    amount, date, costName: description, description, entryType: 'invoice',
    vendor: '', paymentMethod: '', paymentDate: '',
    reference: invoices.map(row => row.reference).join(', '),
    details: invoices.map(row => `${row.reference} | ${row.date} | ${row.description} | $${row.amount.toFixed(2)} | Due ${row.due}`).join('\n'),
    notes: 'Read from PDF text. This is a statement covering the listed invoices; check for duplicates before saving. Vendor and payment status require review.',
    lotAllocations: [],
  }
}
