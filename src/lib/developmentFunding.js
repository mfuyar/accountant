const normalizedName = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()

export const isPreSaleDepositCost = (cost) => {
  const name = normalizedName(cost?.name)
  return cost?.phase === 'development' && name.includes('pre sale deposit') && name.includes('utilized')
}

export const isPreSaleDepositIncome = (income) => income?.type === 'pre_sale_deposit'
  || (normalizedName(income?.description).includes('pre sale deposit') && normalizedName(income?.description).includes('utilized'))

export const summarizePreSaleDepositActivities = (income) => {
  const summary = { received: 0, applied: 0, refunded: 0, pendingRefund: 0, adjustment: 0 }
  ;(income?.activities || []).forEach((activity) => {
    const amount = Number(activity.amount || 0)
    if (activity.type === 'receipt') summary.received += amount
    else if (activity.type === 'application') summary.applied += amount
    else if (activity.type === 'refund') {
      if (activity.status === 'pending') summary.pendingRefund += amount
      else summary.refunded += amount
    }
    else if (activity.type === 'adjustment_increase') summary.adjustment += amount
    else if (activity.type === 'adjustment_decrease') summary.adjustment -= amount
  })
  return {
    ...summary,
    unreconciled: Math.max(0, Number(income?.amount || 0) - summary.received),
    remaining: Number(income?.amount || 0) + summary.adjustment - summary.applied - summary.refunded - summary.pendingRefund,
  }
}

const sameFundingEntry = (income, cost) => (
  String(income.sourceCostId || '') === String(cost.costId || cost.id)
  || (
    normalizedName(income.description) === normalizedName(cost.name)
    && Number(income.amount || 0) === Number(cost.amount || 0)
    && String(income.date || '') === String(cost.date || '')
  )
)

export const deriveDevelopmentFundingIncomes = (fundingCosts = [], persistedIncomes = [], owners = []) => {
  const ownerNames = new Map(owners.map((owner) => [String(owner.id), owner.name]))
  const derived = fundingCosts
    .filter((cost) => !persistedIncomes.some((income) => sameFundingEntry(income, cost)))
    .map((cost) => ({
      id: `development-funding-${cost.costId || cost.id}`,
      projectId: cost.projectId,
      description: cost.name,
      source: ownerNames.get(String(cost.ownerId)) || 'Green Fort',
      amount: Number(cost.amount || 0),
      date: cost.date,
      type: 'pre_sale_deposit',
      lotBreakdown: cost.lotAllocations || [],
      activities: [],
      attachments: cost.attachments || [],
      sourceCostId: cost.costId || cost.id,
      derivedFromCost: true,
    }))
  return [...persistedIncomes, ...derived]
}

export const summarizeDevelopmentFunding = (costs = [], incomes = []) => {
  const developmentSpend = costs
    .filter((cost) => cost.phase === 'development')
    .reduce((sum, cost) => sum + Number(cost.amount || 0), 0)
  const deposits = incomes.filter(isPreSaleDepositIncome)
  const masterDeposits = deposits.filter((income) => income.derivedFromCost
    || normalizedName(income.description).includes('utilized')
    || (income.activities || []).length > 0)
  const detailDeposits = deposits.filter((income) => !masterDeposits.includes(income))
  const masterTotal = masterDeposits.reduce((sum, income) => sum + Number(income.amount || 0), 0)
  const detailTotal = detailDeposits.reduce((sum, income) => sum + Number(income.amount || 0), 0)
  // A utilized pre-sale cost is the master funding amount. Older buyer/installment
  // entries are its supporting detail and must not be added to that master again.
  // If entered deposits exceed the master, retain the excess as additional funding
  // so genuinely new deposits are not hidden.
  const preSaleDeposits = masterTotal > 0
    ? masterTotal + Math.max(0, detailTotal - masterTotal)
    : detailTotal
  let refunded = 0
  let pendingRefund = 0
  let adjustment = 0
  let recordedApplications = 0
  let hasRecordedApplications = false
  deposits.forEach((income) => {
    const activitySummary = summarizePreSaleDepositActivities(income)
    refunded += activitySummary.refunded
    pendingRefund += activitySummary.pendingRefund
    adjustment += activitySummary.adjustment
    recordedApplications += activitySummary.applied
    if ((income.activities || []).some((activity) => activity.type === 'application')) hasRecordedApplications = true
  })
  const available = Math.max(0, preSaleDeposits + adjustment - refunded - pendingRefund)
  const utilized = Math.min(available, hasRecordedApplications ? recordedApplications : developmentSpend)
  return {
    developmentSpend,
    preSaleDeposits,
    refunded,
    pendingRefund,
    adjustment,
    utilized,
    remaining: Math.max(0, available - utilized),
  }
}
