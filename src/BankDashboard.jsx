import { useMemo, useState } from 'react'
import readXlsxFile from 'read-excel-file/browser'
import { parseBankRows, parseCsv } from './lib/bankImport'

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const bankNames = { boa: 'Bank of America', flagstar: 'Flagstar' }

const transactionTypeFor = (item) => {
  const value = String(item.transactionType || '').toLowerCase()
  const activityText = [item.category, item.vendor, item.description, item.memo]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  const feeText = [item.category, item.vendor, item.description]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (activityText.includes('providence bank')) return 'loan'
  if (value.includes('check')) return 'check'
  if (value.includes('fee')
    || feeText.includes('bank fees')
    || feeText.includes('software & technology')
    || feeText.includes('(software)')
    || /\b(lovable|netlify|dropbox|taxact|1099 online)\b/.test(feeText)) return 'fee'
  if (value.includes('credit') || value.includes('deposit')) return 'credit'
  if (value.includes('debit') || value.includes('withdrawal')) return 'debit'
  return item.amount >= 0 ? 'credit' : 'debit'
}

const typeNames = { credit: 'Credit', debit: 'Debit', check: 'Check', fee: 'Fee', loan: 'Loan payment' }
const approvalCategories = [
  'Owner Contribution',
  'Loan Draw',
  'Bank Transfer',
  'Project Income',
  'Financing / Loan Payment',
  'Bank Fees',
  'Software & Technology',
  'Permits & Fees',
  'Legal & Professional',
  'General Contractor',
  'Site Work',
  'Surveying',
  'Utilities',
  'Insurance',
  'Taxes',
  'Personal / Non-Project',
  'Other Project Cost',
]

function BankDashboard({ transactions, onImport, onChangeOwner, onApproveCategory }) {
  const [bank, setBank] = useState('boa')
  const [defaultOwner, setDefaultOwner] = useState('Project / Unassigned')
  const [ownerFilter, setOwnerFilter] = useState('all')
  const [bankFilter, setBankFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [phaseFilter, setPhaseFilter] = useState('all')
  const [reviewFilter, setReviewFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [categorySelections, setCategorySelections] = useState({})
  const [pendingVisibleCount, setPendingVisibleCount] = useState(40)
  const [classifiedVisibleCount, setClassifiedVisibleCount] = useState(40)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const categories = useMemo(() => [...new Set(transactions.map((item) => item.category).filter(Boolean))].sort(), [transactions])
  const phases = useMemo(() => [...new Set(transactions.map((item) => item.phase).filter(Boolean))].sort(), [transactions])

  const filtered = useMemo(() => transactions.filter((item) => {
    const searchableText = [item.description, item.vendor, item.memo, item.rawDescription, item.category, item.sourceName]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return (ownerFilter === 'all' || item.owner === ownerFilter)
      && (bankFilter === 'all' || item.bank === bankFilter)
      && (typeFilter === 'all' || transactionTypeFor(item) === typeFilter)
      && (categoryFilter === 'all' || item.category === categoryFilter)
      && (phaseFilter === 'all' || item.phase === phaseFilter)
      && (reviewFilter === 'all' || (reviewFilter === 'review' ? item.reviewReasons.length > 0 : item.reviewReasons.length === 0))
      && (!search.trim() || searchableText.includes(search.trim().toLowerCase()))
      && (!dateFrom || item.date >= dateFrom)
      && (!dateTo || item.date <= dateTo)
  }), [bankFilter, categoryFilter, dateFrom, dateTo, ownerFilter, phaseFilter, reviewFilter, search, transactions, typeFilter])

  const summary = useMemo(() => {
    const rowsOfType = (type) => filtered.filter((item) => transactionTypeFor(item) === type)
    const absoluteTotal = (rows) => rows.reduce((sum, item) => sum + Math.abs(item.amount), 0)
    const creditRows = rowsOfType('credit')
    const debitRows = rowsOfType('debit')
    const checkRows = rowsOfType('check')
    const feeRows = rowsOfType('fee')
    const loanRows = rowsOfType('loan')
    return {
      credits: absoluteTotal(creditRows),
      creditCount: creditRows.length,
      debits: absoluteTotal(debitRows),
      debitCount: debitRows.length,
      checks: absoluteTotal(checkRows),
      checkCount: checkRows.length,
      fees: absoluteTotal(feeRows),
      feeCount: feeRows.length,
      loans: absoluteTotal(loanRows),
      loanCount: loanRows.length,
      net: filtered.reduce((sum, item) => sum + item.amount, 0),
      banuContribution: filtered.filter((item) => item.owner === 'Banu U' && item.isOwnerContribution).reduce((sum, item) => sum + item.amount, 0),
      kemalContribution: filtered.filter((item) => item.owner === 'Kemal I' && item.isOwnerContribution).reduce((sum, item) => sum + item.amount, 0),
      review: filtered.filter((item) => item.reviewReasons.length).length,
    }
  }, [filtered])

  const pendingTransactions = filtered.filter((item) => item.reviewReasons.length)
  const classifiedTransactions = filtered.filter((item) => !item.reviewReasons.length)

  const clearFilters = () => {
    setOwnerFilter('all')
    setBankFilter('all')
    setTypeFilter('all')
    setCategoryFilter('all')
    setPhaseFilter('all')
    setReviewFilter('all')
    setSearch('')
    setDateFrom('')
    setDateTo('')
  }

  const approveCategory = (item) => {
    const category = categorySelections[item.id]
    if (!category) return
    onApproveCategory(item.id, category)
    setCategorySelections((current) => {
      const next = { ...current }
      delete next[item.id]
      return next
    })
  }

  const handleUpload = async (event) => {
    const [file] = Array.from(event.target.files || [])
    if (!file) return
    setError('')
    setMessage('')
    if (file.size > 10 * 1024 * 1024) {
      setError('The bank file is too large. Choose an Excel or CSV file smaller than 10 MB.')
      event.target.value = ''
      return
    }

    try {
      const extension = file.name.toLowerCase().split('.').pop()
      let rows
      if (extension === 'xlsx') {
        const workbook = await readXlsxFile(file)
        const transactionSheet = Array.isArray(workbook) && workbook[0]?.data
          ? workbook.find((sheet) => sheet.sheet.toLowerCase() === 'transactions') || workbook[0]
          : null
        rows = transactionSheet ? transactionSheet.data : workbook
      }
      else if (extension === 'csv') rows = parseCsv(await file.text())
      else throw new Error('Use an .xlsx or .csv bank export.')

      const parsed = parseBankRows(rows, { bank, defaultOwner: bank === 'flagstar' ? 'Banu U' : defaultOwner, sourceName: file.name })
      if (!parsed.length) throw new Error('No transaction rows were found. Check that the first populated row contains column headings.')
      await onImport(parsed)
      setMessage(`Imported ${parsed.length} ${bankNames[bank]} transaction${parsed.length === 1 ? '' : 's'} from ${file.name}.`)
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'The bank file could not be read.')
    }
    event.target.value = ''
  }

  const renderTransactionRow = (item) => (
    <div key={item.id} className="table-row">
      <div>
        <strong>{item.description}</strong>
        <p>{item.date || 'Date missing'} • {bankNames[item.bank]} • {typeNames[transactionTypeFor(item)]} • {item.sourceName}</p>
        {item.category || item.phase ? <small>{item.category || 'Uncategorized'}{item.phase ? ` • ${item.phase}` : ''}</small> : null}
        {item.classificationStatus === 'user_approved' ? (
          <small className="classification-approved">Approved • {item.owner} • {item.category}</small>
        ) : null}
        {item.classificationStatus === 'auto_classified' ? <small>Auto-classified from transaction details</small> : null}
        {item.reviewReasons.length ? <small className="warning">Review: {item.reviewReasons.join(', ')}</small> : null}
        {item.reviewReasons.length ? (
          <div className="transaction-review-actions">
            <select
              aria-label={`Category for ${item.description}`}
              value={categorySelections[item.id] || ''}
              onChange={(event) => setCategorySelections((current) => ({ ...current, [item.id]: event.target.value }))}
            >
              <option value="">Choose category…</option>
              {approvalCategories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
            <button
              type="button"
              className="action-button"
              disabled={!categorySelections[item.id]}
              onClick={() => approveCategory(item)}
            >
              Approve category
            </button>
          </div>
        ) : null}
      </div>
      <select aria-label={`Owner for ${item.description}`} value={item.owner} onChange={(event) => onChangeOwner(item.id, event.target.value)}>
        <option value="Banu U">Banu U</option>
        <option value="Kemal I">Kemal I</option>
        <option value="GreenFort">GreenFort</option>
        <option value="Project / Unassigned">Project / Unassigned</option>
      </select>
      <strong className={item.amount < 0 ? 'warning' : ''}>{currency.format(item.amount)}</strong>
    </div>
  )

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Owner bank activity</p>
          <h2>Bank dashboard</h2>
          <p>Flagstar imports are assigned to Banu U. Bank of America imports can be split between Banu U and Kemal I.</p>
        </div>
      </div>

      <div className="section-grid">
        <div className="owner-form">
          <label>
            Bank
            <select aria-label="Import bank" value={bank} onChange={(event) => setBank(event.target.value)}>
              <option value="boa">Bank of America</option>
              <option value="flagstar">Flagstar — Banu U</option>
            </select>
          </label>
          {bank === 'boa' ? (
            <label>
              Unrecognized owner contributions
              <select aria-label="Default bank owner" value={defaultOwner} onChange={(event) => setDefaultOwner(event.target.value)}>
                <option value="Project / Unassigned">Leave unassigned</option>
                <option value="Banu U">Banu U</option>
                <option value="Kemal I">Kemal I</option>
              </select>
            </label>
          ) : null}
          <label>
            Upload Excel or CSV bank export
            <input aria-label="Bank spreadsheet" type="file" accept=".xlsx,.csv" onChange={handleUpload} />
          </label>
          {error ? <p className="validation-error" role="alert">{error}</p> : null}
          {message ? <p role="status">{message}</p> : null}
        </div>

        <div className="owner-form">
          <label>
            Filter owner
            <select aria-label="Filter bank owner" value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}>
              <option value="all">All owners</option>
              <option value="Banu U">Banu U</option>
              <option value="Kemal I">Kemal I</option>
              <option value="GreenFort">GreenFort</option>
              <option value="Project / Unassigned">Project / Unassigned</option>
            </select>
          </label>
          <label>
            Filter bank
            <select aria-label="Filter bank" value={bankFilter} onChange={(event) => setBankFilter(event.target.value)}>
              <option value="all">All banks</option>
              <option value="boa">Bank of America</option>
              <option value="flagstar">Flagstar</option>
            </select>
          </label>
          <label>
            Transaction type
            <select aria-label="Filter transaction type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              <option value="all">All transaction types</option>
              <option value="debit">Debits</option>
              <option value="credit">Credits</option>
              <option value="check">Checks</option>
              <option value="fee">Fees</option>
              <option value="loan">Loan payments</option>
            </select>
          </label>
          <label>
            Review status
            <select aria-label="Filter review status" value={reviewFilter} onChange={(event) => setReviewFilter(event.target.value)}>
              <option value="all">All review statuses</option>
              <option value="review">Needs review</option>
              <option value="clear">Reviewed / clear</option>
            </select>
          </label>
        </div>
      </div>

      <div className="bank-filter-grid">
        <label>
          Search transactions
          <input aria-label="Search bank transactions" type="search" placeholder="Vendor, memo, category…" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <label>
          Category
          <select aria-label="Filter category" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
            <option value="all">All categories</option>
            {categories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
        </label>
        <label>
          Phase
          <select aria-label="Filter phase" value={phaseFilter} onChange={(event) => setPhaseFilter(event.target.value)}>
            <option value="all">All phases</option>
            {phases.map((phase) => <option key={phase} value={phase}>{phase}</option>)}
          </select>
        </label>
        <label>
          From date
          <input aria-label="Filter from date" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </label>
        <label>
          To date
          <input aria-label="Filter to date" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </label>
        <button type="button" className="secondary-button" onClick={clearFilters}>Clear filters</button>
      </div>

      <div className="summary-grid">
        <div className="summary-card"><span>Credits ({summary.creditCount})</span><strong>{currency.format(summary.credits)}</strong></div>
        <div className="summary-card"><span>Debits ({summary.debitCount})</span><strong>{currency.format(summary.debits)}</strong></div>
        <div className="summary-card"><span>Checks ({summary.checkCount})</span><strong>{currency.format(summary.checks)}</strong></div>
        <div className="summary-card"><span>Fees ({summary.feeCount})</span><strong>{currency.format(summary.fees)}</strong></div>
        <div className="summary-card"><span>Loan payments ({summary.loanCount})</span><strong>{currency.format(summary.loans)}</strong></div>
        <div className="summary-card"><span>Net activity</span><strong>{currency.format(summary.net)}</strong></div>
        <div className="summary-card"><span>Banu U contributions</span><strong>{currency.format(summary.banuContribution)}</strong></div>
        <div className="summary-card"><span>Kemal I contributions</span><strong>{currency.format(summary.kemalContribution)}</strong></div>
        <div className="summary-card"><span>Needs review</span><strong>{summary.review}</strong></div>
        <div className="summary-card"><span>Transactions shown</span><strong>{filtered.length}</strong></div>
      </div>

      {filtered.length === 0 ? (
        <div className="table-card"><div className="table-row"><div><strong>{transactions.length ? 'No matching transactions' : 'No bank transactions'}</strong><p>{transactions.length ? 'Change or clear the filters to see more transactions.' : 'Upload a Bank of America or Flagstar spreadsheet to begin.'}</p></div></div></div>
      ) : (
        <div className="transaction-groups">
          <details className="transaction-group" open>
            <summary><strong>Needs approval</strong><span>{pendingTransactions.length}</span></summary>
            <div className="table-card">
              {pendingTransactions.length === 0 ? <div className="table-row"><strong>No transactions need approval.</strong></div> : null}
              {pendingTransactions.slice(0, pendingVisibleCount).map(renderTransactionRow)}
              {pendingVisibleCount < pendingTransactions.length ? (
                <button type="button" className="secondary-button" onClick={() => setPendingVisibleCount((current) => current + 40)}>
                  Show more needs approval ({pendingTransactions.length - pendingVisibleCount} remaining)
                </button>
              ) : null}
            </div>
          </details>

          <details className="transaction-group">
            <summary><strong>Approved / classified</strong><span>{classifiedTransactions.length}</span></summary>
            <div className="table-card">
              {classifiedTransactions.length === 0 ? <div className="table-row"><strong>No approved transactions match the filters.</strong></div> : null}
              {classifiedTransactions.slice(0, classifiedVisibleCount).map(renderTransactionRow)}
              {classifiedVisibleCount < classifiedTransactions.length ? (
                <button type="button" className="secondary-button" onClick={() => setClassifiedVisibleCount((current) => current + 40)}>
                  Show more approved ({classifiedTransactions.length - classifiedVisibleCount} remaining)
                </button>
              ) : null}
            </div>
          </details>
        </div>
      )}
    </section>
  )
}

export default BankDashboard
