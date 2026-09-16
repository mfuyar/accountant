import { useMemo, useRef, useState } from 'react'
import { summarizeDevelopmentFunding } from './lib/developmentFunding'
import { inferCostSubcategory, inferMainCostCategory, payerLabel } from './lib/accountingTaxonomy'
import { currency } from './lib/currency'

const COST_CATEGORIES = [
  'Land cost', 'Permits & municipal fees', 'Site utilities', 'Site work', 'Foundation',
  'Framing', 'Roofing', 'Mechanical', 'Electrical', 'Plumbing', 'Interior finishes',
  'Professional fees', 'Legal / attorney fees', 'Engineering', 'Soft costs', 'Loan interest', 'Outsource Loan', 'Owner contribution', 'Kemal Equity Interest',
  'Banu Equity Interest', 'Financing costs', 'Other',
]

const phaseLabel = (phase) => ({ development: 'Development', construction: 'Construction', soft_cost: 'Soft Cost', other: 'Other' }[phase] || phase || 'Other')

const escapeCsvValue = (value) => {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))

const groupRows = (costs, keyFor) => Object.values(costs.reduce((groups, cost) => {
  const key = keyFor(cost)
  if (!groups[key]) groups[key] = { name: key, amount: 0, count: 0 }
  groups[key].amount += Number(cost.amount || 0)
  groups[key].count += 1
  return groups
}, {})).sort((a, b) => b.amount - a.amount)

const accountingCategory = (cost) => {
  if (cost.mainCategory) return cost.mainCategory
  const category = String(cost.category || '').trim()
  if (/^land cost$/i.test(category)) return 'Land Acquisition'
  if (/loan interest|financing cost/i.test(category)) return cost.phase === 'construction' ? 'Construction Financing Costs' : 'Land Interest & Financing'
  return inferMainCostCategory(cost)
}

const leafBreakdownsFor = (parentId, byParent, visited = new Set()) => {
  if (visited.has(String(parentId))) return []
  const nextVisited = new Set(visited).add(String(parentId))
  return (byParent.get(String(parentId)) || []).flatMap((item) => {
    const children = byParent.get(String(item.costId ?? item.id)) || []
    return children.length ? leafBreakdownsFor(item.costId ?? item.id, byParent, nextVisited) : [item]
  })
}

const buildDevelopmentLedgerRows = (costs = [], breakdowns = []) => {
  const byParent = new Map()
  breakdowns.forEach((cost) => {
    const key = String(cost.parentCostId ?? '')
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key).push(cost)
  })

  return costs.flatMap((parent) => {
    const leaves = leafBreakdownsFor(parent.costId ?? parent.id, byParent)
    if (!leaves.length) return [{ ...parent, parentName: '', reportCategory: accountingCategory(parent), reportSubcategory: inferCostSubcategory(parent), reportRowType: 'parent' }]

    const parentCents = Math.round(Number(parent.amount || 0) * 100)
    const leafCents = leaves.reduce((sum, item) => sum + Math.round(Number(item.amount || 0) * 100), 0)
    const rows = leaves.map((item) => ({
      ...item,
      parentName: parent.name,
      reportCategory: accountingCategory(item),
      reportSubcategory: inferCostSubcategory(item),
      reportRowType: 'breakdown',
    }))
    if (parentCents > leafCents) rows.push({
      ...parent,
      costId: `unallocated-${parent.costId ?? parent.id}`,
      name: `Unallocated balance — ${parent.name}`,
      amount: (parentCents - leafCents) / 100,
      parentName: parent.name,
      reportCategory: accountingCategory(parent),
      reportSubcategory: inferCostSubcategory(parent),
      reportRowType: 'unallocated',
    })
    if (leafCents > parentCents) rows.push({
      ...parent,
      costId: `reconciliation-${parent.costId ?? parent.id}`,
      name: `Over-allocation adjustment — ${parent.name}`,
      details: `Breakdowns exceed the parent accounting total by ${currency.format((leafCents - parentCents) / 100)}. Correct the parent or its breakdowns.`,
      amount: -(leafCents - parentCents) / 100,
      parentName: parent.name,
      reportCategory: 'Reconciliation adjustments',
      reportSubcategory: 'Reconciliation adjustment',
      reportRowType: 'reconciliation',
    })
    return rows
  })
}

const summarizeDevelopmentCosts = (costs = []) => {
  const total = costs.reduce((sum, cost) => sum + Number(cost.amount || 0), 0)
  const assigned = costs.reduce((sum, cost) => sum + (cost.lotAllocations || []).reduce((allocationSum, entry) => allocationSum + Number(entry.amount || 0), 0), 0)
  const lots = {}
  costs.forEach((cost) => (cost.lotAllocations || []).forEach((entry) => {
    const name = entry.lot || 'Unassigned'
    if (!lots[name]) lots[name] = { name, amount: 0, count: 0 }
    lots[name].amount += Number(entry.amount || 0)
    lots[name].count += 1
  }))
  const unassigned = Math.max(0, total - assigned)
  if (unassigned > 0) lots.Unassigned = {
    name: 'Unassigned', amount: unassigned,
    count: costs.filter((cost) => (cost.lotAllocations || []).reduce((sum, entry) => sum + Number(entry.amount || 0), 0) < Number(cost.amount || 0)).length,
  }
  return {
    total, assigned, unassigned,
    phaseRows: groupRows(costs, (cost) => phaseLabel(cost.phase)),
    categoryRows: groupRows(costs, (cost) => cost.category || 'Uncategorized'),
    lotRows: Object.values(lots).sort((a, b) => b.amount - a.amount),
  }
}

const SummaryTable = ({ title, rows, total }) => <section className="development-report-table-card">
  <h3>{title}</h3>
  <table>
    <thead><tr><th>Group</th><th>Records</th><th>Amount</th><th>% of total</th></tr></thead>
    <tbody>
      {rows.map((row) => <tr key={row.name}><td>{row.name}</td><td>{row.count}</td><td>{currency.format(row.amount)}</td><td>{total ? `${(row.amount / total * 100).toFixed(1)}%` : '0.0%'}</td></tr>)}
      {!rows.length ? <tr><td colSpan="4">No cost data recorded.</td></tr> : null}
    </tbody>
  </table>
</section>

const DEVELOPMENT_LEDGER_SECTION_ORDER = ['Land Cost', 'Soft Costs', 'Ground Work — Narron', 'Land Interest & Financing']

const DevelopmentLedgerSections = ({ costs, breakdowns, onEditCost, onAddBreakdown }) => {
  const childrenByParent = new Map()
  breakdowns.forEach((item) => {
    const key = String(item.parentCostId || '')
    if (!childrenByParent.has(key)) childrenByParent.set(key, [])
    childrenByParent.get(key).push(item)
  })
  const flattenChildren = (parentId, depth = 0, visited = new Set()) => {
    if (visited.has(String(parentId))) return []
    const nextVisited = new Set(visited).add(String(parentId))
    return (childrenByParent.get(String(parentId)) || []).flatMap((item) => [
      { ...item, depth },
      ...flattenChildren(item.costId || item.id, depth + 1, nextVisited),
    ])
  }
  const sections = DEVELOPMENT_LEDGER_SECTION_ORDER
    .map((name) => costs.find((cost) => cost.name === name))
    .filter(Boolean)
  if (!sections.length) return null

  return <section className="development-ledger-sections" aria-labelledby="development-ledger-sections-heading">
    <div className="development-ledger-sections-heading">
      <div><p className="eyebrow">Editable parent sections</p><h3 id="development-ledger-sections-heading">Development Ledger Sections</h3><p>Open a section to review its current items or add another breakdown.</p></div>
      <strong>{currency.format(sections.reduce((sum, section) => sum + Number(section.amount || 0), 0))}</strong>
    </div>
    <div className="development-ledger-section-list">
      {sections.map((section) => {
        const rows = flattenChildren(section.costId || section.id)
        const directChildren = childrenByParent.get(String(section.costId || section.id)) || []
        const allocated = directChildren.reduce((sum, item) => sum + Number(item.amount || 0), 0)
        const remaining = Math.round((Number(section.amount || 0) - allocated) * 100) / 100
        return <details className="development-ledger-section" key={section.costId || section.id}>
          <summary>
            <span><strong>{section.name}</strong><small>{rows.length} detail item{rows.length === 1 ? '' : 's'} · {remaining > 0 ? `${currency.format(remaining)} not yet broken down` : 'Fully broken down'}</small></span>
            <strong>{currency.format(section.amount)}</strong>
          </summary>
          <div className="development-ledger-section-body">
            {rows.length ? <div className="development-ledger-section-items">
              {rows.map((row) => <div key={row.costId || row.id} style={{ '--ledger-depth': row.depth }}>
                <span><strong>{row.name}</strong><small>{row.date || 'No date'} · {row.category || 'Uncategorized'}</small></span>
                <strong>{currency.format(row.amount)}</strong>
              </div>)}
            </div> : <p className="development-ledger-section-empty">No detailed breakdowns yet. The complete parent balance remains recorded.</p>}
            {section.attachments?.length ? <p className="development-ledger-section-documents">{section.attachments.length} supporting document{section.attachments.length === 1 ? '' : 's'} attached: {section.attachments.map((attachment) => attachment.name).join(', ')}</p> : null}
            <div className="button-row">
              {onAddBreakdown ? <button type="button" className="action-button" onClick={() => onAddBreakdown(section.costId)}>Add breakdown</button> : null}
              {onEditCost ? <button type="button" className="secondary-button" onClick={() => onEditCost(section.costId)}>Edit section</button> : null}
            </div>
          </div>
        </details>
      })}
    </div>
  </section>
}

const ReportContent = ({ project, costs, breakdowns, owners, incomes, summary, ledgerRows, generatedAt, categoryDrafts, savingCategoryId, categoryMessage, pendingDeleteId, deletingCostId, onCategoryDraft, onSaveCategory, onEditCost, onAddBreakdown, onRequestDelete, onCancelDelete }) => {
  const rawBudget = project?.totalBudget ?? project?.total_budget
  const budget = Number(rawBudget)
  const hasBudget = rawBudget !== null && rawBudget !== undefined && rawBudget !== '' && Number.isFinite(budget) && budget > 0
  const variance = hasBudget ? budget - summary.total : null
  const funding = summarizeDevelopmentFunding(costs, incomes)
  const ownerNames = new Map(owners.map((owner) => [String(owner.id), owner.name]))
  const fundingRows = groupRows(ledgerRows, (row) => payerLabel(row, owners))
  const fundingTotal = fundingRows.reduce((sum, row) => sum + row.amount, 0)
  const fundingVariance = fundingTotal - summary.total
  const ownerContributionRows = owners.map((owner) => ({
    name: owner.name,
    ownershipPercentage: Number(owner.ownershipPercentage ?? 50),
    amount: ledgerRows.filter((row) => (
      row.payerType === 'owner'
        ? String(row.payerOwnerId || row.ownerId) === String(owner.id)
        : !row.payerType && String(row.ownerId) === String(owner.id)
    )).reduce((sum, row) => sum + Number(row.amount || 0), 0),
  }))
  const totalOwnerContributions = ownerContributionRows.reduce((sum, row) => sum + row.amount, 0)
  return <div className="development-report-document">
    <header className="development-report-title">
      <div><p>Greenfort Accountant</p><h1>Development Cost Summary</h1><h2>{project?.name || 'Project'}</h2></div>
      <div><span>Report date</span><strong>{generatedAt}</strong>{project?.address ? <small>{project.address}</small> : null}</div>
    </header>
    <div className="development-report-kpis">
      <div><span>Project budget</span><strong>{hasBudget ? currency.format(budget) : 'Not set'}</strong></div>
      <div><span>Recorded costs</span><strong>{currency.format(summary.total)}</strong></div>
      <div className={hasBudget && variance < 0 ? 'negative' : ''}><span>Remaining budget</span><strong>{hasBudget ? currency.format(variance) : 'Not available'}</strong></div>
      <div className={summary.unassigned > 0 ? 'warning' : ''}><span>Unassigned to lots</span><strong>{currency.format(summary.unassigned)}</strong></div>
    </div>
    <DevelopmentLedgerSections costs={costs} breakdowns={breakdowns} onEditCost={onEditCost} onAddBreakdown={onAddBreakdown} />
    {funding.preSaleDeposits > 0 ? <section className="development-funding-utilization">
      <div><p className="eyebrow">Development funding</p><h3>Pre-sale deposit utilization</h3><p>The deposit is recorded as funding, and its linked utilization is included once in development costs. Breakdown items can be added later without changing the top-level cost total.</p></div>
      <div className="development-report-kpis">
        <div><span>Pre-sale deposits</span><strong>{currency.format(funding.preSaleDeposits)}</strong></div>
        <div><span>Deposit refunds</span><strong>{currency.format(funding.refunded)}</strong></div>
        <div><span>Development spending</span><strong>{currency.format(funding.developmentSpend)}</strong></div>
        <div><span>Deposit utilized</span><strong>{currency.format(funding.utilized)}</strong></div>
        <div><span>Deposit remaining</span><strong>{currency.format(funding.remaining)}</strong></div>
      </div>
    </section> : null}
    <div className="development-report-summary-tables">
      <SummaryTable title="Cost by phase" rows={summary.phaseRows} total={summary.total} />
      <SummaryTable title="Cost by lot" rows={summary.lotRows} total={summary.total} />
      <SummaryTable title="Cost by main category" rows={groupRows(ledgerRows, (row) => row.reportCategory)} total={summary.total} />
    </div>
    <section className={`development-ledger-reconciliation${Math.abs(fundingVariance) > 0.009 ? ' warning' : ''}`}>
      <div><p className="eyebrow">Separate funding dimension</p><h3>Project cost and funding reconciliation</h3><p>Expense categories describe what was purchased. Funding sources separately show who paid.</p></div>
      <div className="development-report-kpis">
        <div><span>Total project cost</span><strong>{currency.format(summary.total)}</strong></div>
        <div><span>Funding assigned</span><strong>{currency.format(fundingTotal)}</strong></div>
        <div className={Math.abs(fundingVariance) > 0.009 ? 'warning' : ''}><span>Difference</span><strong>{currency.format(fundingVariance)}</strong></div>
      </div>
      <SummaryTable title="Funding sources / owner contributions" rows={fundingRows} total={fundingTotal} />
      {Math.abs(fundingVariance) > 0.009 ? <p className="development-reconciliation-warning">Funding and project costs do not reconcile. Review entries with an unspecified payer; no adjustment entry was created.</p> : null}
    </section>
    {owners.length ? <section className="development-owner-equalization">
      <div><p className="eyebrow">Owner contribution report</p><h3>Owner-paid project costs and equalization</h3><p>These totals use the payer field, not the expense category. Suggested equalization is informational and creates no accounting entry.</p></div>
      <div className="development-owner-equalization-grid">
        {ownerContributionRows.map((row) => {
          const proportionalShare = totalOwnerContributions * row.ownershipPercentage / 100
          const difference = row.amount - proportionalShare
          return <article key={row.name}><span>{row.name} · {row.ownershipPercentage.toFixed(2)}%</span><strong>{currency.format(row.amount)}</strong><small>{difference >= 0 ? `${currency.format(difference)} above` : `${currency.format(Math.abs(difference))} below`} proportional owner-funded share</small></article>
        })}
      </div>
    </section> : null}
    <section className="development-category-ledger">
      <div className="development-category-ledger-heading">
        <div><p className="eyebrow">Accountant-ready detail</p><h3>Ledger by category</h3><p>Breakdowns replace their parent in this detail, so each dollar is reported once. Unallocated parent balances remain visible.</p></div>
        <strong>{currency.format(ledgerRows.reduce((sum, row) => sum + Number(row.amount || 0), 0))}</strong>
      </div>
      {groupRows(ledgerRows, (row) => row.reportCategory).map((group) => {
        const rows = ledgerRows.filter((row) => row.reportCategory === group.name).sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
        const subcategoryRows = groupRows(rows, (row) => row.reportSubcategory || 'Other')
        return <details className="development-category-group" key={group.name}>
          <summary><span><strong>{group.name}</strong><small>{group.count} ledger entr{group.count === 1 ? 'y' : 'ies'}</small></span><strong>{currency.format(group.amount)}</strong></summary>
          <div className="development-subcategory-summary" aria-label={`${group.name} subcategory totals`}>
            {subcategoryRows.map((subcategory) => <div key={subcategory.name}><span>{subcategory.name}</span><strong>{currency.format(subcategory.amount)}</strong><small>{subcategory.count} entr{subcategory.count === 1 ? 'y' : 'ies'}</small></div>)}
          </div>
          <div className="development-category-table"><table>
            <thead><tr><th>Date</th><th>Detail</th><th>Owner / vendor</th><th>Parent cost</th><th>Lot</th><th>Category</th><th>Amount</th><th>Actions</th></tr></thead>
            <tbody>{rows.map((row) => {
              const editable = ['parent', 'breakdown'].includes(row.reportRowType)
              return <tr key={`${row.costId || row.id}-${row.reportRowType}`}>
              <td>{row.date || '—'}</td><td><strong>{row.name}</strong>{row.details ? <small>{row.details}</small> : null}</td><td>{ownerNames.get(String(row.ownerId)) || 'Not assigned'}</td><td>{row.parentName || 'Direct cost'}</td><td>{(row.lotAllocations || []).map((entry) => entry.lot).join(', ') || 'Unassigned'}</td>
              <td>{editable && onSaveCategory ? <div className="development-ledger-category-editor">
                <select aria-label={`Category for ${row.name}`} value={categoryDrafts[row.costId] ?? row.category ?? ''} onChange={(event) => onCategoryDraft(row.costId, event.target.value)}>
                  <option value="">Uncategorized</option>
                  {row.category && !COST_CATEGORIES.includes(row.category) ? <option value={row.category}>{row.category}</option> : null}
                  {COST_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
                <button type="button" className="secondary-button" disabled={savingCategoryId === row.costId || (categoryDrafts[row.costId] ?? row.category ?? '') === (row.category ?? '')} onClick={() => onSaveCategory(row)}>{savingCategoryId === row.costId ? 'Saving…' : 'Save'}</button>
              </div> : <span>{row.reportCategory}</span>}<small>{row.reportSubcategory}</small></td><td>{currency.format(row.amount)}</td>
              <td>{editable ? <div className="development-ledger-row-actions">
                {onEditCost ? <button type="button" className="secondary-button" onClick={() => onEditCost(row.costId)}>Edit all details</button> : null}
                {onRequestDelete ? pendingDeleteId === row.costId ? <>
                  <button type="button" className="danger-button" disabled={deletingCostId === row.costId} onClick={() => onRequestDelete(row)}>{deletingCostId === row.costId ? 'Deleting…' : 'Confirm delete'}</button>
                  <button type="button" className="secondary-button" disabled={deletingCostId === row.costId} onClick={onCancelDelete}>Cancel</button>
                </> : <button type="button" className="danger-button" onClick={() => onRequestDelete(row)}>Delete</button> : null}
              </div> : <small>Calculated row</small>}</td>
            </tr>
            })}</tbody>
          </table></div>
        </details>
      })}
      {categoryMessage ? <p className={`development-ledger-category-message ${categoryMessage.type}`} role={categoryMessage.type === 'error' ? 'alert' : 'status'}>{categoryMessage.text}</p> : null}
    </section>
    <section className="development-report-ledger">
      <h3>Detailed cost ledger</h3>
      <table>
        <thead><tr><th>Date</th><th>Cost</th><th>Owner / vendor</th><th>Phase</th><th>Category</th><th>Lot allocation</th><th>Amount</th></tr></thead>
        <tbody>
          {[...costs].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).map((cost) => <tr key={cost.costId || cost.id}>
            <td>{cost.date || '—'}</td><td>{cost.name}</td><td>{ownerNames.get(String(cost.ownerId)) || 'Not assigned'}</td><td>{phaseLabel(cost.phase)}</td><td>{cost.category || 'Uncategorized'}</td>
            <td>{(cost.lotAllocations || []).map((entry) => `${entry.lot}: ${currency.format(entry.amount)}`).join('; ') || 'Unassigned'}</td><td>{currency.format(cost.amount)}</td>
          </tr>)}
          {!costs.length ? <tr><td colSpan="7">No costs have been recorded for this project.</td></tr> : null}
        </tbody>
        <tfoot><tr><th colSpan="6">Total recorded costs</th><th>{currency.format(summary.total)}</th></tr></tfoot>
      </table>
    </section>
  </div>
}

function DevelopmentCostReport({ project, costs = [], breakdowns = [], owners = [], incomes = [], onUpdateCostCategory = null, onEditCost = null, onAddBreakdown = null, onDeleteCost = null }) {
  const reportRef = useRef(null)
  const [categoryDrafts, setCategoryDrafts] = useState({})
  const [savingCategoryId, setSavingCategoryId] = useState(null)
  const [categoryMessage, setCategoryMessage] = useState(null)
  const [pendingDeleteId, setPendingDeleteId] = useState(null)
  const [deletingCostId, setDeletingCostId] = useState(null)
  const summary = useMemo(() => summarizeDevelopmentCosts(costs), [costs])
  const ledgerRows = useMemo(() => buildDevelopmentLedgerRows(costs, breakdowns), [breakdowns, costs])
  const generatedAt = new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(new Date())

  const saveCategory = async (row) => {
    if (!onUpdateCostCategory) return
    const category = categoryDrafts[row.costId] ?? row.category ?? ''
    setSavingCategoryId(row.costId)
    setCategoryMessage(null)
    try {
      await onUpdateCostCategory(row, category)
      setCategoryDrafts((current) => {
        const next = { ...current }
        delete next[row.costId]
        return next
      })
      setCategoryMessage({ type: 'success', text: `${row.name} saved as ${category || 'Uncategorized'}.` })
    } catch (error) {
      setCategoryMessage({ type: 'error', text: `Category could not be saved: ${error?.message || 'Unknown error'}` })
    } finally {
      setSavingCategoryId(null)
    }
  }

  const requestDelete = async (row) => {
    if (!onDeleteCost) return
    if (pendingDeleteId !== row.costId) {
      setPendingDeleteId(row.costId)
      setCategoryMessage(null)
      return
    }
    setDeletingCostId(row.costId)
    try {
      await onDeleteCost(row.costId)
      setPendingDeleteId(null)
      setCategoryMessage({ type: 'success', text: `${row.name} was deleted. Its previous versions remain in the audit history.` })
    } catch (error) {
      setCategoryMessage({ type: 'error', text: `The cost could not be deleted: ${error?.message || 'Unknown error'}` })
    } finally {
      setDeletingCostId(null)
    }
  }

  const printReport = () => {
    const reportNode = reportRef.current?.querySelector('.development-report-document')
    const printWindow = window.open('', '_blank')
    if (!reportNode || !printWindow) return
    printWindow.opener = null
    printWindow.document.title = `${project?.name || 'Project'} – Development Cost Summary`
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((sheet) => printWindow.document.head.appendChild(sheet.cloneNode(true)))
    const printStyles = printWindow.document.createElement('style')
    printStyles.textContent = `
      @page { size: letter portrait; margin: 0.45in; }
      html, body { width: auto !important; height: auto !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; background: white !important; }
      body > * { display: none !important; }
      body > .print-development-report { display: block !important; width: auto !important; padding: 0 !important; }
      .development-report-document { display: block !important; }
      .development-report-document > * { margin-bottom: 16px; }
      .development-report-title, .development-report-kpis, .development-funding-utilization, .development-report-table-card { break-inside: avoid; page-break-inside: avoid; }
      .development-report-title { color: #0f172a !important; background: white !important; border: 2px solid #0f766e; }
      .development-report-title p, .development-report-title span, .development-report-title small { color: #475569 !important; }
      .development-report-kpis { display: table !important; width: 100%; table-layout: fixed; border-spacing: 8px 0; }
      .development-report-kpis > div { display: table-cell !important; }
      .development-report-summary-tables { display: block !important; }
      .development-report-table-card { margin-bottom: 12px; overflow: visible; }
      .development-report-ledger { overflow: visible; }
      .development-report-document table { font-size: 8pt; }
      .development-report-document tr { break-inside: avoid; page-break-inside: avoid; }
      .development-report-document th, .development-report-document td { padding: 6px; }
    `
    printWindow.document.head.appendChild(printStyles)
    const printRoot = printWindow.document.createElement('div')
    printRoot.className = 'print-development-report'
    printRoot.appendChild(reportNode.cloneNode(true))
    printRoot.querySelectorAll('details').forEach((details) => { details.open = true })
    printWindow.document.body.appendChild(printRoot)
    const printWhenReady = () => printWindow.setTimeout(() => { printWindow.focus(); printWindow.print() }, 100)
    const pendingSheets = [...printWindow.document.querySelectorAll('link[rel="stylesheet"]')]
    if (!pendingSheets.length) printWhenReady()
    else {
      let remaining = pendingSheets.length
      const sheetReady = () => { remaining -= 1; if (remaining === 0) printWhenReady() }
      pendingSheets.forEach((sheet) => { sheet.addEventListener('load', sheetReady, { once: true }); sheet.addEventListener('error', sheetReady, { once: true }) })
      printWindow.setTimeout(() => { if (remaining > 0) { remaining = 0; printWhenReady() } }, 1500)
    }
  }

  const exportCsv = () => {
    const rows = [
      ['Development Cost Summary', project?.name || 'Project'], ['Report date', generatedAt],
      ['Project budget', Number(project?.totalBudget ?? project?.total_budget ?? 0).toFixed(2)], ['Recorded costs', summary.total.toFixed(2)],
      ['Unassigned to lots', summary.unassigned.toFixed(2)],
      ['Pre-sale deposits', summarizeDevelopmentFunding(costs, incomes).preSaleDeposits.toFixed(2)],
      ['Pre-sale deposit refunds', summarizeDevelopmentFunding(costs, incomes).refunded.toFixed(2)],
      ['Pre-sale deposit utilized', summarizeDevelopmentFunding(costs, incomes).utilized.toFixed(2)],
      ['Pre-sale deposit remaining', summarizeDevelopmentFunding(costs, incomes).remaining.toFixed(2)], [],
      ['Date', 'Ledger detail', 'Owner / vendor', 'Phase', 'Main category', 'Subcategory', 'Parent cost', 'Lot allocation', 'Amount'],
      ...ledgerRows.map((cost) => [cost.date || '', cost.name, owners.find((owner) => String(owner.id) === String(cost.ownerId))?.name || '', phaseLabel(cost.phase), cost.reportCategory, cost.reportSubcategory, cost.parentName || '', (cost.lotAllocations || []).map((entry) => `${entry.lot}: ${Number(entry.amount || 0).toFixed(2)}`).join('; '), Number(cost.amount || 0).toFixed(2)]),
    ]
    const blob = new Blob([rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${String(project?.name || 'project').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-development-cost-summary.csv`
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url)
  }

  const exportExcel = () => {
    const ownerName = (cost) => owners.find((owner) => String(owner.id) === String(cost.ownerId))?.name || ''
    const rows = ledgerRows.map((cost) => `<tr><td>${escapeHtml(cost.date || '')}</td><td>${escapeHtml(cost.name)}</td><td>${escapeHtml(cost.vendorName || '')}</td><td>${escapeHtml(cost.reportCategory)}</td><td>${escapeHtml(cost.reportSubcategory)}</td><td>${escapeHtml(ownerName(cost))}</td><td>${escapeHtml(payerLabel(cost, owners))}</td><td>${escapeHtml(cost.paymentSource || cost.paymentMethod || '')}</td><td>${escapeHtml(cost.referenceNumber || '')}</td><td>${cost.reimbursable ? 'Yes' : 'No'}</td><td>${cost.loanRelated ? 'Yes' : 'No'}</td><td>${Number(cost.amount || 0).toFixed(2)}</td></tr>`).join('')
    const workbook = `<html><head><meta charset="utf-8"></head><body><h1>GREEN FORT LLC</h1><h2>${escapeHtml(project?.name || 'Project')} — Development Cost Ledger</h2><p>Report date: ${escapeHtml(generatedAt)}</p><table border="1"><thead><tr><th>Date</th><th>Description</th><th>Vendor / Payee</th><th>Main Category</th><th>Subcategory</th><th>Attribution</th><th>Paid By</th><th>Payment Source</th><th>Reference</th><th>Reimbursable</th><th>Loan Related</th><th>Amount</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th colspan="11">Total project cost</th><th>${summary.total.toFixed(2)}</th></tr></tfoot></table></body></html>`
    const blob = new Blob([workbook], { type: 'application/vnd.ms-excel;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${String(project?.name || 'project').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-development-cost-ledger.xls`
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url)
  }

  return <>
    <section className="panel development-report-panel">
      <div className="panel-header">
        <div><p className="eyebrow">Project reporting</p><h2>Development Cost Summary</h2><p>Budget position and recorded project costs by phase, category, and lot.</p></div>
        <div className="button-row"><button type="button" className="secondary-button" onClick={exportCsv}>Export CSV</button><button type="button" className="secondary-button" onClick={exportExcel}>Export Excel</button><button type="button" className="action-button" onClick={printReport}>Print / Save PDF</button></div>
      </div>
      <div ref={reportRef}><ReportContent project={project} costs={costs} breakdowns={breakdowns} owners={owners} incomes={incomes} summary={summary} ledgerRows={ledgerRows} generatedAt={generatedAt} categoryDrafts={categoryDrafts} savingCategoryId={savingCategoryId} categoryMessage={categoryMessage} pendingDeleteId={pendingDeleteId} deletingCostId={deletingCostId} onCategoryDraft={(costId, category) => setCategoryDrafts((current) => ({ ...current, [costId]: category }))} onSaveCategory={onUpdateCostCategory ? saveCategory : null} onEditCost={onEditCost} onAddBreakdown={onAddBreakdown} onRequestDelete={onDeleteCost ? requestDelete : null} onCancelDelete={() => setPendingDeleteId(null)} /></div>
    </section>
  </>
}

export default DevelopmentCostReport
