import { ownerCapitalStorage, readOwnerCapitalNotes } from '../../src/lib/ownerCapital.js'
import { BANU_LOANS, sbaCostId } from './banu-financing-policy.mjs'

export const OWNER_NAME = 'Banugul Barut Uyar'
export const OWNER_ID = 9
export const capitalReference = (sourceCostId) => `OWNER-PAID:${sourceCostId}`

export function capitalRow({ amount, date, loanId, sourceCostId, status = 'planned', notes = '', extra = {} }) {
  const loan = BANU_LOANS.find((item) => item.id === loanId)
  if (!loan) throw new Error('Unknown owner-financing loan')
  const entry = { type: 'owner_contribution', ownerId: OWNER_ID, notes,
    capital: { ownerName: OWNER_NAME, loanLabel: loan.label, loanNumber: loan.number, sourceLoanCostId: loan.id, sourceCostId, ...extra },
  }
  const storage = ownerCapitalStorage(entry)
  return { project_id: 2, entry_type: storage.type, entry_status: status, counterparty: OWNER_NAME, owner_id: OWNER_ID,
    amount, entry_date: date, payment_method: '', reference: capitalReference(sourceCostId), notes: storage.notes }
}

export function contributionFromCost(cost, loanId) {
  const evidence = cost.attachments.find((item) => ['sba_payment_evidence', 'flagstar_payment_evidence', 'sba_monthly_cost', 'flagstar_opening_balance'].includes(item._type))
  return capitalRow({ amount: Number(cost.amount), date: cost.cost_date, loanId, sourceCostId: cost.cost_id, status: 'completed',
    notes: `${cost.name}. Owner-paid financing contribution, repayable to ${OWNER_NAME}. User confirmed these payments were made personally by Banugul on November 18, 2026. Excluded from project costs and partner profit. ${cost.details || ''}`,
    extra: { confirmationBasis: 'User confirmation November 18, 2026', originalPhase: cost.phase, originalPaymentEvidence: evidence || null, lotAllocations: cost.lot_allocations,
      documents: cost.attachments.filter((item) => item.documentId) },
  })
}

export function monthlyContribution(date, schedule) {
  const sourceCostId = sbaCostId(`sba-recurring|${schedule.loanCostId}|${date.slice(0, 7)}`)
  return capitalRow({ amount: schedule.amount, date, loanId: schedule.loanCostId, sourceCostId,
    notes: `Expected monthly ${schedule.name} payment by ${OWNER_NAME}, $${schedule.amount} including principal and interest. Pending confirmation that the owner paid. This is a planned owner contribution, not a project expense or payment instruction.`,
    extra: { recurring: true, confirmationBasis: 'Pending owner payment confirmation', month: date.slice(0, 7) },
  })
}

export function isCapitalForLoan(row, loanId) {
  return readOwnerCapitalNotes(row.notes).capital?.sourceLoanCostId === loanId
}
