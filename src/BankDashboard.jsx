import { useEffect, useMemo, useRef, useState } from 'react'
import readXlsxFile from 'read-excel-file/browser'
import { parseBankRows, parseCsv, taxTreatmentFor } from './lib/bankImport'
import { extractPdfStatementRows } from './lib/bankStatementPdf'
import { currency } from './lib/currency'
import { safeCsvText } from './lib/csvSecurity'

const bankNames = {
  boa: 'Bank of America',
  providence: 'Providence Bank',
  amex: 'American Express',
  flagstar: 'Flagstar',
}

const csvCell = (value) => `"${safeCsvText(value).replaceAll('"', '""')}"`

const downloadCsv = (filename, rows) => {
  const blob = new Blob([rows.map((row) => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

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
  if (item.category === 'Bank Transfer') return 'transfer'
  if (activityText.includes('providence bank') || activityText.includes('private lender loan')) return 'loan'
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

const typeNames = { credit: 'Credit', debit: 'Debit', check: 'Check', fee: 'Fee', loan: 'Loan payment', transfer: 'Account transfer' }
const identifyingDetailFor = (item) => {
  const details = [item.memo, item.rawDescription, item.vendor]
    .map((value) => String(value || '').trim())
    .filter((value) => value && value.toLowerCase() !== String(item.description || '').trim().toLowerCase())
  return [...new Set(details.map((value) => value.toLowerCase()))]
    .map((normalized) => details.find((value) => value.toLowerCase() === normalized))
    .join(' · ')
}
const approvalCategories = [
  'Owner Contribution',
  'Loan Draw',
  'Private Lender Loan Proceeds',
  'Private Lender Loan Principal',
  'Private Lender Loan Interest',
  'Bank Cash Back',
  'Bank Transfer',
  'Business Income',
  'Interest Income',
  'Refund / Reimbursement',
  'Project Income',
  'Financing / Loan Payment',
  'Bank Fees',
  'Advertising & Marketing',
  'Software & Technology',
  'Office Supplies',
  'Materials & Supplies',
  'Contract Labor',
  'Repairs & Maintenance',
  'Rent or Lease',
  'Vehicle Expense',
  'Meals',
  'Travel',
  'Permits & Fees',
  'Legal & Professional',
  'General Contractor',
  'Site Work',
  'Surveying',
  'Utilities',
  'Insurance',
  'Taxes & Licenses',
  'Personal / Non-Project',
  'Other Project Cost',
]

const debitLedgerChoices = [
  { value: 'soft_cost', label: 'Soft Cost' },
  { value: 'land_cost', label: 'Land Cost' },
  { value: 'ground_work', label: 'Ground Work' },
  { value: 'land_financing', label: 'Land Financing' },
  { value: 'construction_cost', label: 'Construction Cost' },
  { value: 'other_cost', label: 'Other Project Cost' },
  { value: 'internal_transfer', label: 'Internal Transfer / Not a Cost', exclude: true },
  { value: 'personal_exclude', label: 'Personal / Exclude', exclude: true },
]

const suggestedDebitChoice = (item) => {
  const text = [item.description, item.vendor, item.memo, item.rawDescription, item.category].filter(Boolean).join(' ').toLowerCase()
  if (item.category === 'Bank Transfer' || /green fort llc.*(flagstar|bofa|bank of america)|account transfer/.test(text)) return 'internal_transfer'
  if (/narr[ao]n|po\s*#?\s*2502/.test(text)) return 'ground_work'
  if (/land purchase|closing|title|recording|acquisition/.test(text)) return 'land_cost'
  if (/interest|heloc|mortgage|loan payment|providence bank|origination|financing/.test(text)) return 'land_financing'
  if (/permit|survey|engineer|architect|legal|city fee|county fee|zoning|inspection|utility|software|bank fee/.test(text)) return 'soft_cost'
  if (/contractor|material|lumber|plumb|electric|hvac|roof|fram|concrete|foundation|grading|site work/.test(text)) return 'construction_cost'
  return 'other_cost'
}

const debitIsProcessed = (item, ledgerCosts) => item.classificationStatus === 'ledger_posted'
  || item.classificationStatus === 'ledger_excluded'
  || ledgerCosts.some((cost) => cost.referenceNumber === `BOFA-TXN-${item.id}`)

const possibleLedgerDuplicate = (item, ledgerCosts) => {
  const bankText = [item.description, item.vendor].filter(Boolean).join(' ').toLowerCase()
  return ledgerCosts.find((cost) => {
    if (cost.referenceNumber === `BOFA-TXN-${item.id}`) return true
    if (String(cost.date || '') !== String(item.date || '')) return false
    if (Math.abs(Number(cost.amount || 0) - Math.abs(Number(item.amount || 0))) > 0.009) return false
    const costText = [cost.name, cost.vendorName].filter(Boolean).join(' ').toLowerCase()
    return !bankText || !costText || bankText.includes(costText) || costText.includes(bankText)
  })
}

function BankDashboard({
  transactions,
  statements = [],
  onImport,
  onStoreStatement,
  onOpenStatement,
  onDownloadStatement,
  onChangeOwner,
  onApproveCategory,
  ledgerCosts = [],
  onPostDebitCosts,
  canConnect = false,
  projectId = null,
  onFetchConnections,
  onCreateLinkToken,
  onExchangePublicToken,
  onLoadPlaidLink,
  onSyncConnection,
  onDisconnectConnection,
}) {
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
  const [connections, setConnections] = useState([])
  const [connectionConfigured, setConnectionConfigured] = useState(false)
  const [connectionBusy, setConnectionBusy] = useState('')
  const [connectionMessage, setConnectionMessage] = useState(null)
  const [debitSelections, setDebitSelections] = useState(() => new Set())
  const [debitClassifications, setDebitClassifications] = useState({})
  const [debitReviewStatus, setDebitReviewStatus] = useState('pending')
  const [debitReviewSearch, setDebitReviewSearch] = useState('')
  const [debitVisibleCount, setDebitVisibleCount] = useState(50)
  const [postingDebits, setPostingDebits] = useState(false)
  const [debitPostMessage, setDebitPostMessage] = useState(null)
  const oauthResumeStarted = useRef(false)

  const refreshConnections = async () => {
    if (!canConnect || !onFetchConnections) return
    try {
      const result = await onFetchConnections()
      setConnections(result.connections || [])
      setConnectionConfigured(Boolean(result.configured))
    } catch (connectionError) {
      setConnectionMessage({ type: 'error', text: connectionError instanceof Error ? connectionError.message : 'Bank connection status could not be loaded.' })
    }
  }

  useEffect(() => {
    refreshConnections()
  }, [canConnect, projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  const clearOauthResume = () => {
    sessionStorage.removeItem('greenfort-plaid-link-token')
    const url = new URL(window.location.href)
    if (url.searchParams.has('oauth_state_id')) {
      url.searchParams.delete('oauth_state_id')
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
    }
  }

  const launchPlaid = async (linkToken, receivedRedirectUri = undefined) => {
    setConnectionBusy('connect')
    setConnectionMessage(null)
    try {
      const Plaid = await onLoadPlaidLink()
      await new Promise((resolve, reject) => {
        let handler
        handler = Plaid.create({
          token: linkToken,
          ...(receivedRedirectUri ? { receivedRedirectUri } : {}),
          onSuccess: async (publicToken, metadata) => {
            try {
              const result = await onExchangePublicToken(publicToken, metadata?.institution?.name)
              const connection = result.connection
              if (connection?.id && onSyncConnection) await onSyncConnection(connection.id)
              await refreshConnections()
              setConnectionMessage({ type: 'success', text: `${connection?.institutionName || 'Bank of America'} connected. Transactions are ready for review.` })
              clearOauthResume()
              resolve()
            } catch (exchangeError) {
              reject(exchangeError)
            } finally {
              handler?.destroy?.()
            }
          },
          onExit: (linkError) => {
            handler?.destroy?.()
            if (linkError) reject(new Error(linkError.display_message || linkError.error_message || 'Bank connection was not completed.'))
            else resolve()
          },
        })
        handler.open()
      })
    } catch (connectionError) {
      setConnectionMessage({ type: 'error', text: connectionError instanceof Error ? connectionError.message : 'Bank of America could not be connected.' })
    } finally {
      setConnectionBusy('')
    }
  }

  useEffect(() => {
    const oauthState = new URLSearchParams(window.location.search).get('oauth_state_id')
    const savedToken = sessionStorage.getItem('greenfort-plaid-link-token')
    if (!oauthState || !savedToken || oauthResumeStarted.current || !onLoadPlaidLink) return
    oauthResumeStarted.current = true
    launchPlaid(savedToken, window.location.href)
  }, [onLoadPlaidLink]) // eslint-disable-line react-hooks/exhaustive-deps

  const connectBank = async () => {
    setConnectionBusy('connect')
    setConnectionMessage(null)
    try {
      const result = await onCreateLinkToken()
      sessionStorage.setItem('greenfort-plaid-link-token', result.linkToken)
      await launchPlaid(result.linkToken)
    } catch (connectionError) {
      setConnectionMessage({ type: 'error', text: connectionError instanceof Error ? connectionError.message : 'Bank connection could not be started.' })
      setConnectionBusy('')
    }
  }

  const syncConnection = async (connection) => {
    setConnectionBusy(connection.id)
    setConnectionMessage(null)
    try {
      const result = await onSyncConnection(connection.id)
      await refreshConnections()
      setConnectionMessage({ type: 'success', text: `Sync complete: ${result.added || 0} new, ${result.modified || 0} updated, and ${result.removed || 0} removed.` })
    } catch (connectionError) {
      setConnectionMessage({ type: 'error', text: connectionError instanceof Error ? connectionError.message : 'Transactions could not be synced.' })
    } finally {
      setConnectionBusy('')
    }
  }

  const disconnectConnection = async (connection) => {
    if (!window.confirm(`Disconnect ${connection.institutionName}? Previously imported transactions will remain in the app.`)) return
    setConnectionBusy(connection.id)
    setConnectionMessage(null)
    try {
      await onDisconnectConnection(connection.id)
      await refreshConnections()
      setConnectionMessage({ type: 'success', text: `${connection.institutionName} disconnected. Previously imported transactions were kept.` })
    } catch (connectionError) {
      setConnectionMessage({ type: 'error', text: connectionError instanceof Error ? connectionError.message : 'The bank could not be disconnected.' })
    } finally {
      setConnectionBusy('')
    }
  }

  const categories = useMemo(() => [...new Set(transactions.map((item) => item.category).filter(Boolean))].sort(), [transactions])
  const phases = useMemo(() => [...new Set(transactions.map((item) => item.phase).filter(Boolean))].sort(), [transactions])
  const bankForStatement = (statement) => statement.bank || transactions.find((item) => item.sourceName === (statement.originalName || statement.name))?.bank || ''
  const statementForTransaction = (item) => statements.find((statement) => (
    (statement.originalName || statement.name) === item.sourceName
      && bankForStatement(statement) === item.bank
  ))
  const statementGroups = Object.entries(bankNames).map(([bankId, name]) => ({
    bankId,
    name,
    statements: statements.filter((statement) => bankForStatement(statement) === bankId),
  }))

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
    const transferRows = rowsOfType('transfer')
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
      transfers: absoluteTotal(transferRows),
      transferCount: transferRows.length,
      net: filtered.reduce((sum, item) => sum + item.amount, 0),
      banuContribution: filtered.filter((item) => item.owner === 'Banu U' && item.isOwnerContribution).reduce((sum, item) => sum + item.amount, 0),
      kemalContribution: filtered.filter((item) => item.owner === 'Kemal I' && item.isOwnerContribution).reduce((sum, item) => sum + item.amount, 0),
      review: filtered.filter((item) => item.reviewReasons.length).length,
    }
  }, [filtered])

  const pendingTransactions = filtered.filter((item) => item.reviewReasons.length)
  const classifiedTransactions = filtered.filter((item) => !item.reviewReasons.length)
  const taxSummary = useMemo(() => {
    const totals = new Map()
    filtered.forEach((item) => {
      const treatment = taxTreatmentFor(item)
      if (treatment !== 'Business income' && treatment !== 'Business expense') return
      const key = `${treatment}|${item.category}`
      totals.set(key, (totals.get(key) || 0) + Math.abs(item.amount))
    })
    return [...totals.entries()].map(([key, total]) => {
      const [treatment, category] = key.split('|')
      return { treatment, category, total }
    }).sort((a, b) => a.treatment.localeCompare(b.treatment) || a.category.localeCompare(b.category))
  }, [filtered])

  const taxTotals = useMemo(() => ({
    income: filtered.filter((item) => taxTreatmentFor(item) === 'Business income').reduce((sum, item) => sum + Math.abs(item.amount), 0),
    expenses: filtered.filter((item) => taxTreatmentFor(item) === 'Business expense').reduce((sum, item) => sum + Math.abs(item.amount), 0),
    nonTax: filtered.filter((item) => taxTreatmentFor(item) === 'Non-tax cash movement').reduce((sum, item) => sum + Math.abs(item.amount), 0),
    review: filtered.filter((item) => taxTreatmentFor(item) === 'Needs review').length,
  }), [filtered])

  const bofaDebits = useMemo(() => transactions
    .filter((item) => item.bank === 'boa' && Number(item.amount) < 0)
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.id).localeCompare(String(b.id))), [transactions])
  const visibleBofaDebits = useMemo(() => bofaDebits.filter((item) => {
    const processed = debitIsProcessed(item, ledgerCosts)
    const text = [item.description, item.vendor, item.memo, item.rawDescription, item.sourceName].filter(Boolean).join(' ').toLowerCase()
    return (debitReviewStatus === 'all' || (debitReviewStatus === 'posted' ? processed : !processed))
      && (!debitReviewSearch.trim() || text.includes(debitReviewSearch.trim().toLowerCase()))
  }), [bofaDebits, debitReviewSearch, debitReviewStatus, ledgerCosts])
  const debitCoverage = useMemo(() => ({
    first: bofaDebits[0]?.date || '', last: bofaDebits.at(-1)?.date || '',
    total: bofaDebits.reduce((sum, item) => sum + Math.abs(Number(item.amount || 0)), 0),
    processed: bofaDebits.filter((item) => debitIsProcessed(item, ledgerCosts)).length,
  }), [bofaDebits, ledgerCosts])

  const chooseDebitClassification = (item, classification) => {
    setDebitClassifications((current) => ({ ...current, [item.id]: classification }))
    setDebitSelections((current) => new Set(current).add(item.id))
  }

  const toggleDebitSelection = (item, checked) => {
    setDebitSelections((current) => {
      const next = new Set(current)
      if (checked) next.add(item.id)
      else next.delete(item.id)
      return next
    })
    if (checked && !debitClassifications[item.id]) {
      setDebitClassifications((current) => ({ ...current, [item.id]: suggestedDebitChoice(item) }))
    }
  }

  const selectVisibleDebits = () => {
    const selectable = visibleBofaDebits.slice(0, debitVisibleCount).filter((item) => !debitIsProcessed(item, ledgerCosts))
    setDebitSelections(new Set(selectable.map((item) => item.id)))
    setDebitClassifications((current) => Object.fromEntries(selectable.map((item) => [item.id, current[item.id] || suggestedDebitChoice(item)])))
  }

  const postSelectedDebits = async () => {
    if (!onPostDebitCosts) return
    const selected = bofaDebits
      .filter((item) => debitSelections.has(item.id) && !debitIsProcessed(item, ledgerCosts))
      .map((item) => ({ transaction: item, classification: debitClassifications[item.id] || suggestedDebitChoice(item) }))
    if (!selected.length) return
    setPostingDebits(true)
    setDebitPostMessage(null)
    try {
      const result = await onPostDebitCosts(selected)
      setDebitSelections(new Set())
      setDebitClassifications({})
      setDebitPostMessage({ type: 'success', text: `${result?.posted || 0} debit${result?.posted === 1 ? '' : 's'} added to the real cost ledger; ${result?.excluded || 0} non-cost item${result?.excluded === 1 ? '' : 's'} classified without creating expenses.${result?.existing ? ` ${result.existing} existing ledger link${result.existing === 1 ? '' : 's'} kept.` : ''}` })
    } catch (postError) {
      setDebitPostMessage({ type: 'error', text: postError instanceof Error ? postError.message : 'The selected debits could not be posted.' })
    } finally {
      setPostingDebits(false)
    }
  }

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
      setError('The statement is too large. Choose a PDF, Excel, or CSV file smaller than 10 MB.')
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
      else if (extension === 'pdf') rows = await extractPdfStatementRows(file, { bank })
      else throw new Error('Use a .pdf statement or an .xlsx/.csv transaction export.')

      const parsed = parseBankRows(rows, { bank, defaultOwner: bank === 'flagstar' ? 'Banu U' : defaultOwner, sourceName: file.name })
      if (!parsed.length) throw new Error(extension === 'pdf'
        ? 'No transactions could be read from this PDF. Download a CSV from the account website, or use a text-based (not scanned) PDF.'
        : 'No transaction rows were found. Check that the first populated row contains column headings.')
      const savedStatement = onStoreStatement ? await onStoreStatement(file, bank) : null
      const saved = await onImport(parsed)
      const addedCount = Array.isArray(saved) ? saved.length : parsed.length
      const duplicateCount = parsed.length - addedCount
      setMessage(`Added ${addedCount} ${bankNames[bank]} transaction${addedCount === 1 ? '' : 's'} from ${file.name}.${savedStatement ? ' The original file was stored.' : ''}${duplicateCount ? ` Skipped ${duplicateCount} duplicate${duplicateCount === 1 ? '' : 's'}.` : ''}`)
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'The bank file could not be read.')
    }
    event.target.value = ''
  }

  const renderTransactionRow = (item) => (
    <div key={item.id} className="table-row">
      <div>
        <strong>{item.description}</strong>
        <div className="transaction-source-line">
          <p>{item.date || 'Date missing'} • {bankNames[item.bank]} • {typeNames[transactionTypeFor(item)]} • {item.sourceName}</p>
          {onOpenStatement && statementForTransaction(item) ? (
            <button
              type="button"
              className="transaction-statement-preview"
              onClick={() => onOpenStatement(statementForTransaction(item))}
            >
              Preview statement
            </button>
          ) : null}
        </div>
        {identifyingDetailFor(item) ? <small className="transaction-bank-detail"><strong>Bank detail:</strong> {identifyingDetailFor(item)}</small> : null}
        {item.account ? <small><strong>Account:</strong> {item.account}</small> : null}
        {item.category || item.phase ? <small>{item.category || 'Uncategorized'}{item.phase ? ` • ${item.phase}` : ''}</small> : null}
        {item.classificationStatus === 'user_approved' ? (
          <small className="classification-approved">Approved • {item.owner} • {item.category}</small>
        ) : null}
        {item.classificationStatus === 'auto_classified' ? <small>Auto-classified from transaction details</small> : null}
        <small>Tax treatment: {taxTreatmentFor(item)}</small>
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
          <p className="eyebrow">Bookkeeping and tax records</p>
          <h2>Bank &amp; credit card transactions</h2>
          <p>Upload statements, review categories, avoid duplicate imports, and export accountant-ready records.</p>
        </div>
      </div>

      <div className="bank-connection-panel">
        <div>
          <p className="eyebrow">Read-only live banking</p>
          <h3>Bank of America connection</h3>
          <p>Securely import balances and transactions through Bank of America’s Plaid authorization flow. This connection cannot send ACH payments or move money.</p>
        </div>
        {!canConnect ? <p className="validation-error">Sign in as a project administrator to connect a bank.</p> : null}
        {canConnect && !connectionConfigured ? <p className="connection-setup-note">Live banking is ready in the app but still needs Plaid server credentials.</p> : null}
        {connections.map((connection) => (
          <div className="bank-connection-card" key={connection.id}>
            <div>
              <strong>{connection.institutionName}</strong>
              <p>{connection.accounts.length} connected account{connection.accounts.length === 1 ? '' : 's'} · {connection.lastSyncedAt ? `Last synced ${new Date(connection.lastSyncedAt).toLocaleString()}` : 'Not synced yet'}</p>
              <div className="bank-connected-accounts">
                {connection.accounts.map((account) => (
                  <span key={account.id}>{account.name}{account.mask ? ` ••${account.mask}` : ''} · {account.currentBalance == null ? 'Balance unavailable' : currency.format(account.currentBalance)}</span>
                ))}
              </div>
            </div>
            <div className="bank-connection-actions">
              <button type="button" className="action-button" disabled={Boolean(connectionBusy)} onClick={() => syncConnection(connection)}>{connectionBusy === connection.id ? 'Syncing…' : 'Sync transactions'}</button>
              <button type="button" className="secondary-button" disabled={Boolean(connectionBusy)} onClick={() => disconnectConnection(connection)}>Disconnect</button>
            </div>
          </div>
        ))}
        {canConnect && connectionConfigured ? <button type="button" className="action-button" disabled={Boolean(connectionBusy)} onClick={connectBank}>{connectionBusy === 'connect' ? 'Opening secure connection…' : connections.length ? 'Connect another account' : 'Connect Bank of America'}</button> : null}
        {connectionMessage ? <p className={connectionMessage.type === 'error' ? 'validation-error' : 'connection-success'} role={connectionMessage.type === 'error' ? 'alert' : 'status'}>{connectionMessage.text}</p> : null}
      </div>

      <div className="section-grid">
        <div className="owner-form">
          <label>
            Bank
            <select aria-label="Import bank" value={bank} onChange={(event) => setBank(event.target.value)}>
              <option value="boa">Bank of America</option>
              <option value="providence">Providence Bank — GreenFort</option>
              <option value="amex">American Express — GreenFort</option>
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
            Upload statement or transaction export
            <input aria-label="Bank statement" type="file" accept=".pdf,.xlsx,.csv" onChange={handleUpload} />
            <small>PDF, CSV, or Excel · up to 10 MB. CSV gives the most reliable transaction results. The original uploaded file is stored with this project.</small>
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
              <option value="providence">Providence Bank</option>
              <option value="amex">American Express</option>
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
              <option value="transfer">Account transfers</option>
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

      <details className="bank-statements-panel">
        <summary className="bank-statements-summary">
          <div>
            <p className="eyebrow">Source records</p>
            <h3>Original bank statements</h3>
          </div>
          <span>{statements.length} file{statements.length === 1 ? '' : 's'}</span>
        </summary>
        <div className="bank-statements-content">
          <p>Open the complete original PDF to review statement pages and check images.</p>
          {!statements.length ? <div className="cost-empty-state"><strong>No original statements stored yet</strong><p>Import a statement above and the original file will appear here.</p></div> : null}
          <div className="bank-statement-groups">{statementGroups.map((group) => (
            <section className="bank-statement-group" key={group.bankId}>
              <div className="bank-statement-group-heading">
                <strong>{group.name}</strong>
                <span>{group.statements.length} statement{group.statements.length === 1 ? '' : 's'}</span>
              </div>
              {!group.statements.length ? <p className="bank-statement-empty">No stored {group.name} statements yet.</p> : null}
              {group.statements.length ? <div className="bank-statement-list">{group.statements.map((statement) => (
                <div className="bank-statement-card" key={statement.documentId || statement.id || statement.storagePath}>
                  <div>
                    <strong>{statement.name}</strong>
                    <p>{statement.createdAt ? `Stored ${new Date(statement.createdAt).toLocaleDateString()}` : 'Stored with this project'}{statement.size ? ` · ${(statement.size / 1024).toFixed(0)} KB` : ''}</p>
                  </div>
                  <div className="button-row">
                    {onOpenStatement ? <button type="button" className="action-button" onClick={() => onOpenStatement(statement)}>Preview</button> : null}
                    {onDownloadStatement ? <button type="button" className="secondary-button" onClick={() => onDownloadStatement(statement)}>Download</button> : null}
                  </div>
                </div>
              ))}</div> : null}
            </section>
          ))}</div>
        </div>
      </details>

      {onPostDebitCosts ? <section className="bank-debit-ledger-review" aria-labelledby="bank-debit-ledger-heading">
        <div className="bank-debit-ledger-heading">
          <div>
            <p className="eyebrow">BOFA cost reconstruction</p>
            <h3 id="bank-debit-ledger-heading">Review every Bank of America debit</h3>
            <p>Checks, wires, ACH, card payments, and fees from {debitCoverage.first || 'the first imported statement'} through {debitCoverage.last || 'the latest imported statement'}. Select rows, confirm a cost type, then post them once to the real ledger.</p>
          </div>
          <strong>{currency.format(debitCoverage.total)}</strong>
        </div>
        <div className="bank-debit-ledger-summary">
          <span><strong>{bofaDebits.length}</strong> total debits</span>
          <span><strong>{debitCoverage.processed}</strong> processed</span>
          <span><strong>{bofaDebits.length - debitCoverage.processed}</strong> pending</span>
          <span><strong>{debitSelections.size}</strong> selected</span>
        </div>
        <div className="bank-debit-ledger-toolbar">
          <label>Search debits<input aria-label="Search BOFA debit review" type="search" value={debitReviewSearch} onChange={(event) => setDebitReviewSearch(event.target.value)} placeholder="Vendor, check, wire, memo…" /></label>
          <label>Status<select aria-label="Filter BOFA debit review status" value={debitReviewStatus} onChange={(event) => setDebitReviewStatus(event.target.value)}><option value="pending">Pending ledger review</option><option value="posted">Posted / excluded</option><option value="all">All BOFA debits</option></select></label>
          <button type="button" className="secondary-button" disabled={!visibleBofaDebits.length} onClick={selectVisibleDebits}>Select visible with suggestions</button>
          <button type="button" className="action-button" disabled={!debitSelections.size || postingDebits || !onPostDebitCosts} onClick={postSelectedDebits}>{postingDebits ? 'Posting…' : `Post selected to ledger (${debitSelections.size})`}</button>
        </div>
        {debitPostMessage ? <p className={debitPostMessage.type === 'error' ? 'validation-error' : 'connection-success'} role={debitPostMessage.type === 'error' ? 'alert' : 'status'}>{debitPostMessage.text}</p> : null}
        <div className="bank-debit-review-list">
          {visibleBofaDebits.slice(0, debitVisibleCount).map((item) => {
            const processed = debitIsProcessed(item, ledgerCosts)
            const duplicate = possibleLedgerDuplicate(item, ledgerCosts)
            const selectedChoice = debitClassifications[item.id] || ''
            return <article className={`bank-debit-review-row${processed ? ' is-processed' : ''}`} key={item.id}>
              <label className="bank-debit-select"><input type="checkbox" aria-label={`Select debit ${item.description}`} checked={debitSelections.has(item.id)} disabled={processed} onChange={(event) => toggleDebitSelection(item, event.target.checked)} /></label>
              <div className="bank-debit-review-detail">
                <div><strong>{item.vendor || item.description}</strong><strong className="warning">{currency.format(Math.abs(item.amount))}</strong></div>
                <p>{item.date || 'No date'} · {typeNames[transactionTypeFor(item)]} · {item.sourceName}</p>
                {identifyingDetailFor(item) ? <small><strong>Bank detail:</strong> {identifyingDetailFor(item)}</small> : null}
                <small>Current bank category: {item.category || 'Uncategorized'} · Owner: {item.owner || 'Unassigned'}</small>
                {duplicate && !processed ? <small className="warning">Possible existing ledger match: {duplicate.name} · {currency.format(duplicate.amount)}. Review before posting; it will not be deleted automatically.</small> : null}
                {processed ? <small className="classification-approved">{item.classificationStatus === 'ledger_excluded' ? 'Reviewed — not a project cost' : 'Posted to cost ledger'} · {item.category}</small> : null}
                {onOpenStatement && statementForTransaction(item) ? <button type="button" className="transaction-statement-preview" onClick={() => onOpenStatement(statementForTransaction(item))}>Preview statement / check</button> : null}
              </div>
              <fieldset className="bank-debit-cost-choices" disabled={processed}>
                <legend>Cost classification</legend>
                {debitLedgerChoices.map((choice) => <label key={choice.value} className={choice.exclude ? 'is-exclusion' : ''}>
                  <input type="checkbox" aria-label={`${choice.label} for ${item.description}`} checked={selectedChoice === choice.value} onChange={() => chooseDebitClassification(item, choice.value)} />
                  <span>{choice.label}</span>
                </label>)}
              </fieldset>
            </article>
          })}
          {!visibleBofaDebits.length ? <div className="cost-empty-state"><strong>No BOFA debits match this review filter.</strong></div> : null}
          {debitVisibleCount < visibleBofaDebits.length ? <button type="button" className="secondary-button" onClick={() => setDebitVisibleCount((current) => current + 50)}>Show 50 more ({visibleBofaDebits.length - debitVisibleCount} remaining)</button> : null}
        </div>
      </section> : null}

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
        <div className="summary-card"><span>Account transfers ({summary.transferCount})</span><strong>{currency.format(summary.transfers)}</strong></div>
        <div className="summary-card"><span>Net activity</span><strong>{currency.format(summary.net)}</strong></div>
        <div className="summary-card"><span>Banu U contributions</span><strong>{currency.format(summary.banuContribution)}</strong></div>
        <div className="summary-card"><span>Kemal I contributions</span><strong>{currency.format(summary.kemalContribution)}</strong></div>
        <div className="summary-card"><span>Needs review</span><strong>{summary.review}</strong></div>
        <div className="summary-card"><span>Transactions shown</span><strong>{filtered.length}</strong></div>
      </div>

      <div className="summary-grid tax-summary-grid">
        <div className="summary-card"><span>Business income</span><strong>{currency.format(taxTotals.income)}</strong></div>
        <div className="summary-card"><span>Categorized business expenses</span><strong>{currency.format(taxTotals.expenses)}</strong></div>
        <div className="summary-card"><span>Non-tax cash movements</span><strong>{currency.format(taxTotals.nonTax)}</strong></div>
        <div className="summary-card"><span>Excluded pending review</span><strong>{taxTotals.review}</strong></div>
      </div>

      <div className="accounting-export-bar">
        <div>
          <strong>Accountant exports</strong>
          <p>Exports use the filters above, so you can select a tax year, account, or category first.</p>
        </div>
        <button type="button" className="secondary-button" disabled={!filtered.length} onClick={() => downloadCsv('greenfort-transactions.csv', [
          ['Date', 'Financial account', 'Description', 'Category', 'Owner', 'Debit', 'Credit', 'Tax treatment', 'Source statement'],
          ...filtered.map((item) => [item.date, bankNames[item.bank] || item.bank, item.description, item.category, item.owner, item.amount < 0 ? Math.abs(item.amount).toFixed(2) : '', item.amount > 0 ? item.amount.toFixed(2) : '', taxTreatmentFor(item), item.sourceName]),
        ])}>Export transactions CSV</button>
        <button type="button" className="secondary-button" disabled={!taxSummary.length} onClick={() => downloadCsv('greenfort-tax-category-summary.csv', [
          ['Tax treatment', 'Tax / bookkeeping category', 'Total'],
          ...taxSummary.map((item) => [item.treatment, item.category, item.total.toFixed(2)]),
        ])}>Export tax summary CSV</button>
      </div>

      {filtered.length === 0 ? (
        <div className="table-card"><div className="table-row"><div><strong>{transactions.length ? 'No matching transactions' : 'No transactions yet'}</strong><p>{transactions.length ? 'Change or clear the filters to see more transactions.' : 'Upload a Bank of America, Providence Bank, or American Express statement to begin.'}</p></div></div></div>
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
