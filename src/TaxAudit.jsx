import { useMemo } from 'react'

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
})

const allLots = ['Lot 1', 'Lot 2', 'Lot 3', 'Lot 4']
const IRS_1099_NEC_THRESHOLD = 600

const emptyChecks = []
const emptyIncomes = []
const emptyCosts = []
const emptyLotCommitments = []

const escapeCsvValue = (value) => {
  const stringValue = String(value ?? '')
  return /[",\n]/.test(stringValue) ? `"${stringValue.replace(/"/g, '""')}"` : stringValue
}

const downloadCsv = (filename, rows) => {
  const csv = rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

const todayStamp = () => new Date().toISOString().slice(0, 10)
const filenameSafe = (name) => String(name || 'project').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'project'

function TaxAudit({ checks = emptyChecks, incomes = emptyIncomes, activeCosts = emptyCosts, lotCommitments = emptyLotCommitments, projectName = 'project' }) {
  const activeChecks = useMemo(() => checks.filter((check) => check.status !== 'voided'), [checks])

  // Matches the "Dev cost (shared)" / "Lot Cost" methodology already used on the Lots and
  // Spending by Job pages: total recorded development cost, split evenly across all 4 lots.
  const developmentCostTotal = useMemo(
    () => activeCosts.reduce((sum, cost) => sum + Number(cost.amount || 0), 0),
    [activeCosts],
  )
  const sharedLotShare = developmentCostTotal / allLots.length

  const lotTaggedSpend = useMemo(() => {
    const totals = {}
    allLots.forEach((lot) => { totals[lot] = 0 })
    activeChecks.forEach((check) => {
      if (allLots.includes(check.lot)) totals[check.lot] += Number(check.amount) || 0
    })
    return totals
  }, [activeChecks])

  const costBasisRows = useMemo(() => allLots.map((lot) => {
    const commitment = lotCommitments.find((entry) => entry.lot === lot)
    const spent = lotTaggedSpend[lot] || 0
    return {
      lot,
      address: commitment?.address || '',
      spent,
      sharedShare: sharedLotShare,
      totalBasis: spent + sharedLotShare,
    }
  }), [lotCommitments, lotTaggedSpend, sharedLotShare])

  const grandBasis = costBasisRows.reduce((sum, row) => sum + row.totalBasis, 0)

  const vendorSummary = useMemo(() => {
    const byVendorYear = {}
    activeChecks.forEach((check) => {
      const year = check.date ? check.date.slice(0, 4) : 'Unknown'
      const key = `${check.payee}::${year}`
      if (!byVendorYear[key]) byVendorYear[key] = { payee: check.payee, year, total: 0, count: 0 }
      byVendorYear[key].total += Number(check.amount) || 0
      byVendorYear[key].count += 1
    })
    return Object.values(byVendorYear).sort((a, b) => b.total - a.total)
  }, [activeChecks])

  const exportLedgerCsv = () => {
    const dataRows = []
    activeChecks.forEach((check) => {
      dataRows.push([check.date, 'Check', check.payee, check.memo, check.lot || '', (-(Number(check.amount) || 0)).toFixed(2)])
    })
    incomes.forEach((income) => {
      dataRows.push([income.date, 'Income', income.source, income.description, '', (Number(income.amount) || 0).toFixed(2)])
    })
    dataRows.sort((a, b) => (a[0] || '').localeCompare(b[0] || ''))
    const rows = [['Date', 'Type', 'Payee / Source', 'Description / Memo', 'Lot', 'Amount'], ...dataRows]
    downloadCsv(`${filenameSafe(projectName)}-ledger-${todayStamp()}.csv`, rows)
  }

  const exportCostBasisCsv = () => {
    const rows = [
      ['Lot', 'Address', 'Checks tagged to lot', 'Shared development cost (1/4)', 'Total cost basis'],
      ...costBasisRows.map((row) => [row.lot, row.address, row.spent.toFixed(2), row.sharedShare.toFixed(2), row.totalBasis.toFixed(2)]),
      ['Total', '', Object.values(lotTaggedSpend).reduce((sum, value) => sum + value, 0).toFixed(2), developmentCostTotal.toFixed(2), grandBasis.toFixed(2)],
    ]
    downloadCsv(`${filenameSafe(projectName)}-cost-basis-by-lot-${todayStamp()}.csv`, rows)
  }

  const exportVendorSummaryCsv = () => {
    const rows = [
      ['Payee', 'Year', 'Total paid', 'Payment count', 'Likely needs 1099-NEC'],
      ...vendorSummary.map((entry) => [entry.payee, entry.year, entry.total.toFixed(2), entry.count, entry.total >= IRS_1099_NEC_THRESHOLD ? 'Yes' : 'No']),
    ]
    downloadCsv(`${filenameSafe(projectName)}-vendor-payments-${todayStamp()}.csv`, rows)
  }

  return (
    <section className="section-grid">
      <div className="panel wide-field">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Records</p>
            <h2>Tax &amp; Audit</h2>
          </div>
        </div>
        <p className="hero-copy">Everything here is generated directly from your recorded checks, income, and development costs — nothing is estimated or fabricated. Treat this as a starting point for your CPA, not a substitute for professional tax advice.</p>
      </div>

      <div className="panel wide-field">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Cost basis</p>
            <h2>Capitalized cost by lot</h2>
          </div>
          <div className="metric-stack">
            <span>Total across all lots</span>
            <strong>{currency.format(grandBasis)}</strong>
          </div>
        </div>
        <p className="hero-copy">Land/construction cost basis for each lot — the number you'll need to compute gain or loss when a lot sells. Combines checks tagged to that lot with an equal 1/4 share of project-wide development cost.</p>
        <div className="spending-by-job-scroll">
          <table className="spending-by-job-table">
            <thead>
              <tr>
                <th>Lot</th>
                <th>Address</th>
                <th>Checks tagged to lot</th>
                <th>Shared development cost</th>
                <th>Total cost basis</th>
              </tr>
            </thead>
            <tbody>
              {costBasisRows.map((row) => (
                <tr key={row.lot}>
                  <td>{row.lot}</td>
                  <td>{row.address || '—'}</td>
                  <td>{currency.format(row.spent)}</td>
                  <td>{currency.format(row.sharedShare)}</td>
                  <td><strong>{currency.format(row.totalBasis)}</strong></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>All lots</td>
                <td />
                <td>{currency.format(Object.values(lotTaggedSpend).reduce((sum, value) => sum + value, 0))}</td>
                <td>{currency.format(developmentCostTotal)}</td>
                <td><strong>{currency.format(grandBasis)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="button-row">
          <button type="button" className="secondary-button" onClick={exportCostBasisCsv}>Export cost basis (CSV)</button>
        </div>
      </div>

      <div className="panel wide-field">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Ledger</p>
            <h2>Full transaction export</h2>
          </div>
        </div>
        <p className="hero-copy">Every non-voided check and income entry for this project, chronological, ready to hand to an accountant or auditor.</p>
        <div className="button-row">
          <button type="button" className="action-button" onClick={exportLedgerCsv}>Export full ledger (CSV)</button>
        </div>
      </div>

      <div className="panel wide-field">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Contractors</p>
            <h2>Vendor payment summary</h2>
          </div>
        </div>
        <p className="hero-copy">Checks grouped by payee and calendar year. Vendors paid {currency.format(IRS_1099_NEC_THRESHOLD)} or more in a year are flagged as likely needing a 1099-NEC — confirm with your accountant, since this doesn't account for entity type (corporations are typically exempt).</p>
        <div className="spending-by-job-scroll">
          <table className="spending-by-job-table">
            <thead>
              <tr>
                <th>Payee</th>
                <th>Year</th>
                <th>Total paid</th>
                <th>Payments</th>
                <th>1099-NEC?</th>
              </tr>
            </thead>
            <tbody>
              {vendorSummary.length === 0 ? (
                <tr><td colSpan={5}>No checks recorded yet.</td></tr>
              ) : vendorSummary.map((entry) => (
                <tr key={`${entry.payee}-${entry.year}`}>
                  <td>{entry.payee}</td>
                  <td>{entry.year}</td>
                  <td>{currency.format(entry.total)}</td>
                  <td>{entry.count}</td>
                  <td>{entry.total >= IRS_1099_NEC_THRESHOLD ? <span className="spending-by-job-unassigned">Yes</span> : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="button-row">
          <button type="button" className="secondary-button" onClick={exportVendorSummaryCsv}>Export vendor summary (CSV)</button>
        </div>
      </div>
    </section>
  )
}

export default TaxAudit
