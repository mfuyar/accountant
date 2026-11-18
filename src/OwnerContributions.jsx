import { useState } from 'react'
import { currency } from './lib/currency'
import { isOwnerCapitalEntry, summarizeOwnerCapital } from './lib/ownerCapital'

export default function OwnerContributions({ project, owners = [], entries = [], onSave, onStatusChange, onOpenDocument }) {
  const capitalEntries = entries.filter((entry) => isOwnerCapitalEntry(entry) && String(entry.projectId) === String(project?.id))
  const balances = summarizeOwnerCapital(capitalEntries, owners)
  const [ownerId, setOwnerId] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }))
  const [reference, setReference] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const total = (key) => balances.reduce((sum, row) => sum + Math.round(row[key] * 100), 0) / 100
  const repay = async (event) => {
    event.preventDefault()
    const balance = balances.find((row) => String(row.ownerId) === ownerId)
    const value = Number(amount)
    if (!balance || !Number.isFinite(value) || value <= 0 || Math.round(value * 100) > Math.round(balance.available * 100)) return setMessage('Choose an owner and enter a return amount within their repayable balance.')
    if (!date) return setMessage('Enter the date the owner was repaid.')
    setSaving(true)
    try {
      await onSave({ projectId: project.id, type: 'owner_contribution_return', status: 'completed', ownerId: balance.ownerId, counterparty: balance.name, amount: value, date, paymentMethod, reference: reference.trim(), notes: notes.trim(), capital: { ownerName: balance.name } })
      setAmount(''); setReference(''); setNotes(''); setMessage('Owner contribution return recorded. It reduces the amount owed without adding a project expense or profit payout.')
    } catch (error) { setMessage(error.message || 'Could not record the contribution return.') }
    finally { setSaving(false) }
  }
  const confirm = async (entry) => {
    setSaving(true)
    try { await onStatusChange(entry.id, 'completed'); setMessage('Owner-paid contribution confirmed.') }
    catch (error) { setMessage(error.message || 'Could not confirm contribution.') }
    finally { setSaving(false) }
  }
  return <section className="panel" aria-labelledby="owner-capital-heading">
    <div className="panel-header"><div><p className="eyebrow">Owner funding</p><h2 id="owner-capital-heading">Owner Contributions &amp; Repayments</h2><p>Owner-paid SBA and Flagstar financing is recorded here as repayable owner contribution, outside construction and development spending. Returning it reduces the owner balance; it is separate from profit payouts.</p></div></div>
    <div className="draw-plan-metrics">
      {[['Owner contributions paid', total('contributed')], ['Returned to owners', total('returned')], ['Due back to owners', total('balance')], ['Pending confirmation', total('pending')]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{currency.format(value)}</strong></div>)}
    </div>
    <div className="table-card">{balances.map((row) => <div className="table-row" key={row.ownerId}>
      <div><strong>{row.name}</strong><p>Contributed {currency.format(row.contributed)} · Returned {currency.format(row.returned)} · Pending {currency.format(row.pending)}</p></div>
      <div className="metric-stack"><span>Contribution to repay</span><strong>{currency.format(row.balance)}</strong></div>
    </div>)}</div>
    {onSave ? <details><summary>Record a return of owner contribution</summary>
      <p>Use this after paying the owner back. Recording a return does not send a payment.</p>
      <form className="owner-form" onSubmit={repay}>
        <label>Owner<select aria-label="Contribution return owner" value={ownerId} onChange={(event) => setOwnerId(event.target.value)}><option value="">Select owner</option>{balances.map((row) => <option key={row.ownerId} value={row.ownerId}>{row.name}</option>)}</select></label>
        <label>Amount<input aria-label="Contribution return amount" type="number" step="0.01" min="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <label>Paid date<input aria-label="Contribution return date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label>Payment method<select aria-label="Contribution return payment method" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="bank_transfer">Bank transfer</option><option value="check">Check</option><option value="other">Other</option></select></label>
        <label>Check / transfer reference<input aria-label="Contribution return reference" value={reference} onChange={(event) => setReference(event.target.value)} /></label>
        <label>Notes<textarea aria-label="Contribution return notes" value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        <button type="submit" className="action-button" disabled={saving}>Record contribution returned</button>
      </form>
    </details> : null}
    {message ? <p role="status">{message}</p> : null}
    <details><summary>View contribution and repayment history ({capitalEntries.length})</summary>
      <div className="draw-plan-table-wrap"><table className="draw-plan-table" aria-label="Owner contribution history">
        <thead><tr><th>Date</th><th>Owner / loan</th><th>Entry</th><th>Amount</th><th>Status</th></tr></thead>
        <tbody>{[...capitalEntries].sort((a, b) => String(b.date).localeCompare(String(a.date))).map((entry) => <tr key={entry.id}>
          <td>{entry.date}</td><td>{entry.counterparty}<span>{entry.capital?.loanLabel || ''}{entry.capital?.loanNumber ? ` · ${entry.capital.loanNumber}` : ''}</span><span>{entry.notes}</span>{onOpenDocument ? (entry.capital?.documents || []).map((document) => <button key={document.documentId} type="button" className="secondary-button" onClick={() => onOpenDocument(document)}>View {document.name}</button>) : null}</td>
          <td>{entry.type === 'owner_contribution_return' ? 'Return of contribution' : 'Owner-paid contribution'}</td><td>{currency.format(entry.amount)}</td>
          <td>{entry.status === 'completed' ? 'Recorded paid' : 'Awaiting confirmation'}{entry.status === 'planned' && entry.type === 'owner_contribution' && onStatusChange ? <button type="button" disabled={saving} onClick={() => confirm(entry)}>Confirm owner paid</button> : null}</td>
        </tr>)}</tbody>
      </table></div>
    </details>
  </section>
}
