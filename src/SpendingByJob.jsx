import { useMemo } from 'react'

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const allLots = ['Lot 1', 'Lot 2', 'Lot 3', 'Lot 4']
const lotKeysBySourceKey = { lot_1: 'Lot 1', lot_2: 'Lot 2', lot_3: 'Lot 3', lot_4: 'Lot 4' }

const emptyDrafts = []
const emptyChecks = []
const emptyCosts = []

function SpendingByJob({ constructionDrafts = emptyDrafts, checks = emptyChecks, activeCosts = emptyCosts }) {
  const rows = useMemo(() => {
    return constructionDrafts.map((draft) => {
      const estimatedByLot = {}
      allLots.forEach((lot) => { estimatedByLot[lot] = 0 })
      Object.entries(draft.sourceEstimates || {}).forEach(([key, value]) => {
        const lot = lotKeysBySourceKey[key]
        if (lot) estimatedByLot[lot] = Number(value) || 0
      })
      const estimatedTotal = allLots.reduce((sum, lot) => sum + estimatedByLot[lot], 0)

      const matchingCostIds = new Set(
        activeCosts
          .filter((cost) => cost.name === draft.name || cost.costId === draft.convertedCostId)
          .map((cost) => cost.costId),
      )
      const relevantChecks = checks.filter((check) => check.status !== 'voided' && check.costId && matchingCostIds.has(check.costId))

      const spentByLot = {}
      allLots.forEach((lot) => { spentByLot[lot] = 0 })
      let unassignedSpent = 0
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
      }
    })
  }, [constructionDrafts, checks, activeCosts])

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

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Construction</p>
          <h2>Spending by Job</h2>
        </div>
        <div className="metric-stack">
          <span>Total spent of estimated</span>
          <strong>{currency.format(grandSpent)} of {currency.format(grandEstimated)}</strong>
        </div>
      </div>
      <p className="hero-copy">Spending is matched to a job by the cost each check is attached to (Check Printing → "Attach this check to"), split by whichever lot the check is tagged with. Checks attached to a job's cost but not tagged with a lot show up as "unassigned."</p>

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
              <tr key={row.id}>
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
    </section>
  )
}

export default SpendingByJob
