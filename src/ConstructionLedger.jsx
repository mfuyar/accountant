import { useMemo, useState } from 'react'
import { currency } from './lib/currency'
import { payerLabel } from './lib/accountingTaxonomy'
import { buildConstructionLedger, constructionLedgerCsv } from './lib/constructionLedger'

const cents = (value) => Math.round(Number(value || 0) * 100)

export default function ConstructionLedger({ project, costs = [], checks = [], invoices = [], owners = [], onEditCost, onAddBreakdown, onManageCosts }) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [lot, setLot] = useState('all')
  const [status, setStatus] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const rows = useMemo(() => buildConstructionLedger(costs, checks, invoices), [costs, checks, invoices])
  const categories = [...new Set(rows.map((row) => row.category || row.subcategory || 'Uncategorized'))].sort()
  const lots = [...new Set(rows.flatMap((row) => (row.lotAllocations || []).map((entry) => entry.lot)))].sort()
  const filtered = rows.filter((row) => {
    const text = [row.name, row.details, row.category, row.subcategory, row.vendorName, row.referenceNumber, payerLabel(row, owners)].join(' ').toLowerCase()
    return text.includes(search.trim().toLowerCase())
      && (category === 'all' || (row.category || row.subcategory || 'Uncategorized') === category)
      && (lot === 'all' || (lot === 'unassigned' ? row.unassigned > 0 : (row.lotAllocations || []).some((entry) => entry.lot === lot && cents(entry.amount) !== 0)))
      && (status === 'all' || row.status === status)
      && (!from || (row.date && row.date >= from)) && (!to || (row.date && row.date <= to))
  })
  const total = (key) => filtered.reduce((sum, row) => sum + cents(key === 'amount' ? row.amount : row.balance[key]), 0) / 100
  let running = 0
  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob(['\uFEFF', constructionLedgerCsv(filtered, owners)], { type: 'text/csv;charset=utf-8;' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `construction-ledger-${String(project?.name || 'project').replace(/[^a-z0-9_-]/gi, '-')}.csv`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <section className="panel construction-ledger">
    <div className="panel-header">
      <div><p className="eyebrow">{project?.name || 'Current project'}</p><h2>Construction Ledger</h2></div>
      <div className="construction-ledger-actions">
        {onManageCosts ? <button type="button" className="action-button" onClick={onManageCosts}>Manage costs</button> : null}
        <button type="button" className="secondary-button" disabled={!filtered.length} onClick={exportCsv}>Export ledger CSV</button>
      </div>
    </div>
    <p className="hero-copy">All recorded construction costs for this project, ordered by date. Breakdowns support each cost and are excluded from totals. Only printed checks or confirmed payments settle balances; estimates are excluded.</p>
    <div className="construction-ledger-summary">
      {[['Recorded costs', total('amount')], ['Paid', total('paid')], ['Outstanding', total('remaining')], ['Overpaid', total('overpaid')]].map(([label, amount]) => <div key={label}><span>{label}</span><strong>{currency.format(amount)}</strong></div>)}
    </div>
    <div className="construction-ledger-filters">
      <label>Search construction<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cost, vendor, payer, reference" /></label>
      <label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{categories.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Lot<select value={lot} onChange={(event) => setLot(event.target.value)}><option value="all">All lots</option>{lots.map((value) => <option key={value}>{value}</option>)}<option value="unassigned">Unassigned</option></select></label>
      <label>Payment status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option>{['Unpaid', 'Partially paid', 'Paid', 'Overpaid'].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>From date<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>To date<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <button type="button" className="secondary-button" onClick={() => { setSearch(''); setCategory('all'); setLot('all'); setStatus('all'); setFrom(''); setTo('') }}>Clear filters</button>
    </div>
    <p className="hero-copy">Showing {filtered.length} of {rows.length} costs. Totals and running cost total reflect the filtered rows. Lot filters show each matching cost in full; allocations are listed separately.</p>
    {from && to && from > to ? <p role="alert">From date must be on or before To date.</p> : null}
    <div className="spending-by-job-scroll">
      <table className="spending-by-job-table construction-ledger-table">
        <colgroup>
          <col style={{ width: 110 }} /><col style={{ width: 300 }} /><col style={{ width: 180 }} />
          <col style={{ width: 160 }} /><col style={{ width: 130 }} /><col style={{ width: 130 }} />
          <col style={{ width: 125 }} /><col style={{ width: 125 }} /><col style={{ width: 125 }} />
          <col style={{ width: 140 }} /><col style={{ width: 150 }} />
        </colgroup>
        <thead><tr>{['Date', 'Cost / category', 'Vendor / paid by', 'Lots', 'Reference', 'Status', 'Cost', 'Paid', 'Outstanding', 'Running cost total', 'Actions'].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{filtered.map((row) => {
          running += cents(row.amount)
          return <tr key={row.costId}>
            <td>{row.date || 'No date'}</td>
            <td><strong>{row.name}</strong><small>{row.category || row.subcategory || 'Uncategorized'}</small>{row.details ? <details className="construction-ledger-description"><summary>View description</summary><p>{row.details}</p></details> : null}</td>
            <td>{row.vendorName || 'No vendor'}<small>{payerLabel(row, owners)}</small></td>
            <td>{(row.lotAllocations || []).map((entry, index) => <small key={`${entry.lot}-${index}`}>{entry.lot}: {currency.format(entry.amount)}</small>)}{row.unassigned > 0 ? <small>Unassigned: {currency.format(row.unassigned)}</small> : null}</td>
            <td>{row.referenceNumber || '—'}</td><td>{row.status}{row.balance.overpaid > 0 ? <small>Overpaid: {currency.format(row.balance.overpaid)}</small> : null}</td>
            <td>{currency.format(row.amount)}</td><td>{currency.format(row.balance.paid)}</td><td>{currency.format(row.balance.remaining)}</td><td>{currency.format(running / 100)}</td>
            <td><div className="construction-ledger-row-actions">{onEditCost ? <button type="button" className="secondary-button" onClick={() => onEditCost(row.costId)} aria-label={`Edit ${row.name}`}>Edit</button> : null}{onAddBreakdown ? <button type="button" className="secondary-button" onClick={() => onAddBreakdown(row.costId)} aria-label={`Breakdown for ${row.name}`}>Breakdown</button> : null}</div></td>
          </tr>
        })}{!filtered.length ? <tr><td colSpan="11">{rows.length ? 'No construction costs match these filters.' : 'No construction costs recorded yet. Use Manage costs to record a construction expense.'}</td></tr> : null}</tbody>
        <tfoot><tr><th scope="row" colSpan="6">Filtered totals</th><td>{currency.format(total('amount'))}</td><td>{currency.format(total('paid'))}</td><td>{currency.format(total('remaining'))}</td><td colSpan="2" /></tr></tfoot>
      </table>
    </div>
  </section>
}
