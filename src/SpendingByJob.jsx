import { useMemo } from 'react'
import { currency } from './lib/currency'

const allLots = ['Lot 1', 'Lot 2', 'Lot 3', 'Lot 4']
const lotKeysBySourceKey = { lot_1: 'Lot 1', lot_2: 'Lot 2', lot_3: 'Lot 3', lot_4: 'Lot 4' }

// "Lot Cost" is a real job row (not job-specific work like framing or plumbing) meant to capture
// project-wide development cost — it has no per-check spending of its own to match, so instead of
// showing $0, it's driven directly by the project's total development cost split evenly per lot.
const SHARED_DEVELOPMENT_COST_JOB_NAME = 'Lot Cost'

const jobKey = (value) => String(value || '').toLowerCase().replace(/\s+job$/, '').trim()

const costMatchesDraft = (cost, draft) => {
  if (String(cost.constructionDraftId || '') === String(draft.id)) return true
  if (cost.phase !== 'construction') return false
  const draftKey = jobKey(draft.name)
  return draftKey.length > 2 && [cost.category, cost.name].some((value) => jobKey(value) === draftKey)
}

const emptyDrafts = []
const emptyChecks = []
const emptyCosts = []

function SpendingByJob({ constructionDrafts = emptyDrafts, checks = emptyChecks, activeCosts = emptyCosts, sharedDevelopmentCostTotal = 0 }) {
  const manualCosts = useMemo(() => {
    const draftCostIds = new Set(constructionDrafts.map((draft) => draft.convertedCostId).filter(Boolean))
    const draftNames = new Set(constructionDrafts.filter((draft) => draft.name !== SHARED_DEVELOPMENT_COST_JOB_NAME).map((draft) => draft.name))
    return activeCosts.filter((cost) => (
      !cost.parentCostId
      && cost.phase === 'construction'
      && !cost.constructionDraftId
      && !draftCostIds.has(cost.costId)
      && !draftNames.has(cost.name)
      && !constructionDrafts.some((draft) => draft.name !== SHARED_DEVELOPMENT_COST_JOB_NAME && costMatchesDraft(cost, draft))
    ))
  }, [activeCosts, constructionDrafts])

  const hasAllocatedManualCosts = manualCosts.some((cost) => (cost.lotAllocations || []).length || cost.category)

  const manualCategoryRows = useMemo(() => {
    const categories = new Map()
    manualCosts.forEach((cost) => {
      const category = cost.category || 'Uncategorized'
      if (!categories.has(category)) {
        categories.set(category, { name: category, costs: [], byLot: Object.fromEntries(allLots.map((lot) => [lot, 0])), total: 0, unassigned: 0 })
      }
      const row = categories.get(category)
      const allocations = cost.lotAllocations || []
      const allocated = allocations.reduce((sum, entry) => {
        const amount = Number(entry.amount || 0)
        if (allLots.includes(entry.lot)) row.byLot[entry.lot] += amount
        return sum + amount
      }, 0)
      row.total += Number(cost.amount || 0)
      row.unassigned += Math.max(0, Number(cost.amount || 0) - allocated)
      row.costs.push(cost)
    })
    return [...categories.values()].sort((a, b) => b.total - a.total)
  }, [manualCosts])

  const rows = useMemo(() => {
    const sharedLotCost = sharedDevelopmentCostTotal / allLots.length

    return constructionDrafts.map((draft) => {
      if (draft.name === SHARED_DEVELOPMENT_COST_JOB_NAME) {
        if (hasAllocatedManualCosts) {
          const byLot = Object.fromEntries(allLots.map((lot) => [lot, manualCategoryRows.reduce((sum, row) => sum + row.byLot[lot], 0)]))
          const total = manualCategoryRows.reduce((sum, row) => sum + row.total, 0)
          const unassigned = manualCategoryRows.reduce((sum, row) => sum + row.unassigned, 0)
          return {
            id: draft.id,
            name: draft.name,
            estimatedByLot: byLot,
            estimatedTotal: total,
            spentByLot: byLot,
            spentTotal: total,
            unassignedSpent: unassigned,
          }
        }
        const byLot = {}
        allLots.forEach((lot) => { byLot[lot] = sharedLotCost })
        return {
          id: draft.id,
          name: draft.name,
          estimatedByLot: byLot,
          estimatedTotal: sharedDevelopmentCostTotal,
          spentByLot: byLot,
          spentTotal: sharedDevelopmentCostTotal,
          unassignedSpent: 0,
        }
      }

      const estimatedByLot = {}
      allLots.forEach((lot) => { estimatedByLot[lot] = 0 })
      Object.entries(draft.sourceEstimates || {}).forEach(([key, value]) => {
        const lot = lotKeysBySourceKey[key]
        if (lot) estimatedByLot[lot] = Number(value) || 0
      })
      const estimatedTotal = allLots.reduce((sum, lot) => sum + estimatedByLot[lot], 0)

      const matchingCostIds = new Set(
        activeCosts
          .filter((cost) => cost.costId === draft.convertedCostId || costMatchesDraft(cost, draft))
          .map((cost) => cost.costId),
      )
      const mappedCosts = activeCosts.filter((cost) => costMatchesDraft(cost, draft) && cost.costId !== draft.convertedCostId)
      const mappedCostIds = new Set(mappedCosts.map((cost) => cost.costId))
      const mappedSpendCosts = mappedCosts.filter((cost) => !mappedCosts.some((child) => child.parentCostId === cost.costId))
      const representedByCost = new Set(mappedSpendCosts.map((cost) => cost.costId))
      const relevantChecks = checks.filter((check) => (
        check.status !== 'voided'
        && check.checkType !== 'internal_transfer'
        && check.costId
        && matchingCostIds.has(check.costId)
        && !representedByCost.has(check.costId)
      ))

      const spentByLot = {}
      allLots.forEach((lot) => { spentByLot[lot] = 0 })
      let unassignedSpent = 0
      mappedSpendCosts.forEach((cost) => {
        const allocations = cost.lotAllocations || []
        const allocated = allocations.reduce((sum, entry) => {
          const amount = Number(entry.amount) || 0
          if (allLots.includes(entry.lot)) spentByLot[entry.lot] += amount
          return sum + amount
        }, 0)
        unassignedSpent += Math.max(0, Number(cost.amount || 0) - allocated)
      })
      relevantChecks.forEach((check) => {
        if (allLots.includes(check.lot)) spentByLot[check.lot] += Number(check.amount) || 0
        else unassignedSpent += Number(check.amount) || 0
      })
      const spentTotal = allLots.reduce((sum, lot) => sum + spentByLot[lot], 0) + unassignedSpent

      return {
        id: draft.id,
        name: draft.name,
        estimatedByLot,
        estimatedTotal,
        spentByLot,
        spentTotal,
        unassignedSpent,
        mappedCostCount: mappedCostIds.size,
      }
    })
  }, [constructionDrafts, checks, activeCosts, sharedDevelopmentCostTotal, hasAllocatedManualCosts, manualCategoryRows])

  const grandEstimatedByLot = useMemo(() => {
    const totals = {}
    allLots.forEach((lot) => { totals[lot] = rows.reduce((sum, row) => sum + row.estimatedByLot[lot], 0) })
    return totals
  }, [rows])

  const grandSpentByLot = useMemo(() => {
    const totals = {}
    allLots.forEach((lot) => { totals[lot] = rows.reduce((sum, row) => sum + row.spentByLot[lot], 0) })
    return totals
  }, [rows])

  const grandEstimated = allLots.reduce((sum, lot) => sum + grandEstimatedByLot[lot], 0)
  const grandSpent = rows.reduce((sum, row) => sum + row.spentTotal, 0)
  const hasLotCostRow = rows.some((row) => row.name === SHARED_DEVELOPMENT_COST_JOB_NAME)
  const manualSpent = manualCategoryRows.reduce((sum, row) => sum + row.total, 0)
  const displayedGrandSpent = grandSpent + (hasLotCostRow ? 0 : manualSpent)

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Construction</p>
          <h2>Spending by Job</h2>
        </div>
        <div className="metric-stack">
          <span>Total spent of estimated</span>
          <strong>{currency.format(displayedGrandSpent)} of {currency.format(grandEstimated)}</strong>
        </div>
      </div>
      <p className="hero-copy">Draft jobs use attached checks. Manually entered construction costs use their saved category and lot allocations. Breakdown records are not counted again. Costs without a complete lot allocation appear as unassigned.</p>

      <div className="spending-by-job-scroll">
        <table className="spending-by-job-table">
          <thead>
            <tr>
              <th>Job</th>
              {allLots.map((lot) => <th key={lot}>{lot}</th>)}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={allLots.length + 2}>No construction draft jobs recorded yet.</td></tr>
            ) : rows.map((row) => (
              <tr key={row.id} className={row.name === SHARED_DEVELOPMENT_COST_JOB_NAME ? 'spending-by-job-shared-row' : ''}>
                <td>{row.name}</td>
                {allLots.map((lot) => (
                  <td key={lot}>
                    <div>{currency.format(row.spentByLot[lot])}</div>
                    <small>of {currency.format(row.estimatedByLot[lot])}</small>
                  </td>
                ))}
                <td>
                  <strong>{currency.format(row.spentTotal)}</strong>
                  <small> of {currency.format(row.estimatedTotal)}</small>
                  {row.unassignedSpent > 0 ? <small className="spending-by-job-unassigned"> (+{currency.format(row.unassignedSpent)} unassigned lot)</small> : null}
                </td>
              </tr>
            ))}
          </tbody>
          {rows.length ? <tfoot>
            <tr>
              <td>All jobs</td>
              {allLots.map((lot) => (
                <td key={lot}>
                  <strong>{currency.format(grandSpentByLot[lot])}</strong>
                  <small> of {currency.format(grandEstimatedByLot[lot])}</small>
                </td>
              ))}
              <td><strong>{currency.format(grandSpent)}</strong><small> of {currency.format(grandEstimated)}</small></td>
            </tr>
          </tfoot> : null}
        </table>
      </div>

      <div className="overview-section-heading spending-manual-heading">
        <div>
          <p className="eyebrow">Manual ledger</p>
          <h3>Manual costs by category and lot</h3>
        </div>
        <strong>{currency.format(manualSpent)}</strong>
      </div>
      <div className="spending-by-job-scroll">
        <table className="spending-by-job-table spending-manual-table">
          <thead><tr><th>Category</th>{allLots.map((lot) => <th key={lot}>{lot}</th>)}<th>Total</th></tr></thead>
          <tbody>
            {manualCategoryRows.length === 0 ? <tr><td colSpan={allLots.length + 2}>No unmatched manual construction costs.</td></tr> : manualCategoryRows.map((row) => <tr key={row.name}>
              <td><strong>{row.name}</strong><small>{row.costs.length} cost{row.costs.length === 1 ? '' : 's'}</small></td>
              {allLots.map((lot) => <td key={lot}>{currency.format(row.byLot[lot])}</td>)}
              <td><strong>{currency.format(row.total)}</strong>{row.unassigned > 0 ? <small className="spending-by-job-unassigned">{currency.format(row.unassigned)} unassigned</small> : null}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
      {manualCategoryRows.map((row) => <section className="spending-manual-category" key={`detail-${row.name}`}>
        <h3>{row.name}</h3>
        {row.costs.map((cost) => <div className="table-row" key={cost.costId}>
          <div><strong>{cost.name}</strong><small>{cost.date} • {cost.phase}</small></div>
          <div className="spending-manual-lots">
            {(cost.lotAllocations || []).map((entry) => <span key={`${cost.costId}-${entry.lot}`}>{entry.lot}: {currency.format(entry.amount)}</span>)}
            {!(cost.lotAllocations || []).length ? <span className="unassigned">Unassigned lot</span> : null}
          </div>
          <strong>{currency.format(cost.amount)}</strong>
        </div>)}
      </section>)}
    </section>
  )
}

export default SpendingByJob
