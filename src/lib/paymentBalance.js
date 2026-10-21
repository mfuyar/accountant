const cents = (amount) => Math.round(Number(amount || 0) * 100)
const sameId = (a, b) => a != null && b != null && String(a) === String(b)

// Check amounts stay separate from invoice amounts. Only printed checks settle a balance.
export function paymentBalance(record, costs = [], checks = [], invoices = [], excludedCheckId = null) {
  const eligible = checks.filter((check) => !sameId(check.id, excludedCheckId) && check.checkType !== 'internal_transfer')
  const visit = (current, isInvoice, visited) => {
    const id = isInvoice ? current.id : current.costId
    const token = `${isInvoice ? 'invoice' : 'cost'}:${id}`
    if (visited.has(token)) return { paid: 0, checks: [] }
    const next = new Set(visited).add(token)
    const relatedInvoices = isInvoice ? [current] : invoices.filter((invoice) => sameId(invoice.costId, id))
    const matchesRecord = (check) => isInvoice
      ? sameId(check.invoiceId, id)
      : sameId(check.costId, id) || relatedInvoices.some((invoice) => sameId(check.invoiceId, invoice.id))
    const linked = eligible.filter(matchesRecord)
    const allLinked = checks.filter((check) => check.checkType !== 'internal_transfer' && matchesRecord(check))
    const printed = linked.filter((check) => check.status === 'printed')
    const direct = printed.reduce((sum, check) => sum + cents(check.amount), 0)
    const recordedPaid = isInvoice ? current.status === 'paid' && allLinked.length === 0
      : (current.paymentStatus === 'paid' && allLinked.length === 0)
        || (Boolean(current.paymentDate) && (!/check/.test(current.paymentMethod || '') || allLinked.length === 0))
    const children = isInvoice ? [] : costs.filter((cost) => sameId(cost.parentCostId, id))
    const childBalances = children.map((child) => visit(child, false, next))
    const childrenPaid = childBalances.reduce((sum, balance) => sum + balance.paid, 0)
    return {
      paid: Math.max(direct + childrenPaid, recordedPaid ? cents(current.amount) : 0),
      checks: [...linked, ...childBalances.flatMap((balance) => balance.checks)],
    }
  }
  const result = record ? visit(record, record.costId == null, new Set()) : { paid: 0, checks: [] }
  const total = cents(record?.amount)
  const difference = total - result.paid
  return {
    total: total / 100,
    paid: result.paid / 100,
    remaining: Math.max(0, difference) / 100,
    overpaid: Math.max(0, -difference) / 100,
    checks: [...new Set(result.checks)],
  }
}
