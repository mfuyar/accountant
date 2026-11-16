export const isLoanReceivable = (type) => ['loan_given', 'loan_principal_received', 'loan_interest_received'].includes(type)
export const financingCashDirection = (type) => ['loan_received', 'loan_principal_received', 'loan_interest_received'].includes(type) ? 1 : -1

export function summarizeLoanReceivables(entries = []) {
  const borrowers = new Map()
  for (const entry of entries.filter((item) => isLoanReceivable(item.type))) {
    const key = entry.counterparty.trim().toLowerCase()
    const row = borrowers.get(key) || { name: entry.counterparty, advanced: 0, repaid: 0, interest: 0, planned: 0 }
    const amount = Math.round(Number(entry.amount) * 100)
    if (entry.status === 'planned' && entry.type === 'loan_given') row.planned += amount
    if (entry.status === 'completed') {
      if (entry.type === 'loan_given') row.advanced += amount
      if (entry.type === 'loan_principal_received') row.repaid += amount
      if (entry.type === 'loan_interest_received') row.interest += amount
    }
    borrowers.set(key, row)
  }
  return [...borrowers.values()].map((row) => ({ ...row, advanced: row.advanced / 100, repaid: row.repaid / 100, interest: row.interest / 100, planned: row.planned / 100, balance: (row.advanced - row.repaid) / 100 }))
}
