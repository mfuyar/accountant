import { useMemo, useState } from 'react'
import { currency } from './lib/currency'

const today = () => new Date().toLocaleDateString('en-CA')
const isBuilderName = (value) => /habitech|builder|general contractor|\bgc\b/i.test(value || '')
const isBuilder = (owner) => isBuilderName(owner.name)
const isGreenFort = (owner) => /green\s*fort/i.test(owner.name || '')
const paymentMethodLabel = (method) => ({
  bank_transfer: 'ACH / bank transfer',
  bofa_zelle: 'Zelle from BOFA',
  check: 'Check',
  amex_business: 'Amex Business',
  other_credit_card: 'Other credit card',
  cash: 'Cash',
  other: 'Other',
}[method] || 'Not specified')

const parsePayoutDetails = (notes = '') => {
  const lines = String(notes).split('\n')
  const headerIndex = lines.findIndex((line) => line.trim().toLowerCase() === 'payout details:')
  if (headerIndex < 0) return { summary: notes, items: [] }
  const items = lines.slice(headerIndex + 1).map((line) => {
    const [date = '', description = '', amount = ''] = line.split('|').map((part) => part.trim())
    const numericAmount = Number(amount.replace(/[$,]/g, ''))
    return date && description && Number.isFinite(numericAmount) ? { date, description, amount: numericAmount } : null
  }).filter(Boolean)
  return { summary: lines.slice(0, headerIndex).join('\n').trim(), items }
}

function ProfitPayoutList({ entries }) {
  if (!entries.length) return null
  return <div className="party-profit-payout-list">
    {entries.map((entry) => {
      const payout = parsePayoutDetails(entry.notes)
      return <article key={entry.id} className="party-profit-payout">
        <div><span>{entry.date} · {paymentMethodLabel(entry.paymentMethod)}{entry.reference ? ` · Ref ${entry.reference}` : ''}</span><strong>{currency.format(entry.amount)}</strong></div>
        {payout.summary ? <small>{payout.summary}</small> : null}
        {payout.items.length ? <div className="party-profit-payout-items" aria-label={`${entry.counterparty} payout details`}>
          {payout.items.map((item, index) => <div className="partner-payout-detail-row" key={`${item.date}-${item.description}-${index}`}><span>{item.date}</span><strong>{item.description}</strong><span>{currency.format(item.amount)}</span></div>)}
        </div> : null}
      </article>
    })}
  </div>
}

function PartnersSection({ project, owners = [], entries = [], onSave, onDelete }) {
  const builderOwner = owners.find(isBuilder)
  const greenFortOwner = owners.find(isGreenFort)
  const childOwners = owners.filter((owner) => !isBuilder(owner) && !isGreenFort(owner))
  const builderLedgerEntry = entries.find((entry) => entry.type === 'owner_distribution' && isBuilderName(`${entry.counterparty || ''} ${entry.notes || ''}`))
  const builderName = builderOwner?.name || builderLedgerEntry?.counterparty || 'Builder'
  const [recipient, setRecipient] = useState('builder')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today)
  const [status, setStatus] = useState('completed')
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('Advance profit payout. Deduct from this party’s remaining project profit payable.')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const [pendingDeleteId, setPendingDeleteId] = useState(null)

  const withdrawals = useMemo(() => entries.filter((entry) => entry.accountingTreatment === 'partner_profit' || (entry.type === 'owner_distribution' && entry.accountingTreatment !== 'project_cost')), [entries])
  const recipientDetails = (value) => {
    if (value === 'builder') return { name: builderName, ownerId: builderOwner?.id || null }
    if (value === 'greenfort') return { name: greenFortOwner?.name || 'Green Fort', ownerId: greenFortOwner?.id || null }
    const ownerId = value.replace('owner:', '')
    const owner = childOwners.find((item) => String(item.id) === ownerId)
    return { name: owner?.name || 'Green Fort owner', ownerId: owner?.id || null }
  }
  const withdrawalsFor = (value, entryStatus = 'completed') => {
    const details = recipientDetails(value)
    return withdrawals.filter((entry) => entry.status === entryStatus && (
      details.ownerId != null
        ? String(entry.profitOwnerId || entry.ownerId) === String(details.ownerId)
        : String(entry.counterparty || '').trim().toLowerCase() === details.name.toLowerCase()
    ))
  }
  const totalFor = (value, entryStatus = 'completed') => withdrawalsFor(value, entryStatus).reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
  const childValues = childOwners.map((owner) => `owner:${owner.id}`)
  const builderCompleted = totalFor('builder')
  const builderPlanned = totalFor('builder', 'planned')
  const greenFortDirectCompleted = totalFor('greenfort')
  const greenFortDirectPlanned = totalFor('greenfort', 'planned')
  const childCompleted = childValues.reduce((sum, value) => sum + totalFor(value), 0)
  const childPlanned = childValues.reduce((sum, value) => sum + totalFor(value, 'planned'), 0)
  const totalCompleted = builderCompleted + greenFortDirectCompleted + childCompleted
  const totalPlanned = builderPlanned + greenFortDirectPlanned + childPlanned

  const submit = async (event) => {
    event.preventDefault()
    const numericAmount = Number(amount)
    setMessage(null)
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return setMessage({ type: 'error', text: 'Enter a withdrawal amount greater than $0.00.' })
    if (!date) return setMessage({ type: 'error', text: 'Select the withdrawal date.' })
    const details = recipientDetails(recipient)
    setSaving(true)
    try {
      await onSave({
        projectId: project.id,
        type: 'owner_distribution',
        status,
        counterparty: details.name,
        ownerId: details.ownerId,
        amount: numericAmount,
        date,
        paymentMethod,
        reference: reference.trim(),
        notes: notes.trim(),
      })
      setAmount('')
      setReference('')
      setMessage({ type: 'success', text: `${details.name} profit payout saved and deducted from that party’s remaining profit payable.` })
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'The withdrawal could not be saved.' })
    } finally {
      setSaving(false)
    }
  }

  const remove = async (entry) => {
    try {
      await onDelete(entry.id)
      setPendingDeleteId(null)
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'The withdrawal could not be removed.' })
    }
  }

  return <section className="partners-section">
    <div className="panel partners-summary-panel">
      <div className="panel-header"><div><p className="eyebrow">Project profit</p><h2>Partner profit payouts and deductions</h2><p>Each completed payout is profit already paid to that party. It immediately reduces their remaining profit payable without becoming a project cost.</p></div></div>
      <div className="partners-total-grid">
        <div><span>Profit paid to date</span><strong>{currency.format(totalCompleted)}</strong><small>Already deducted from party profit balances</small></div>
        <div><span>Planned profit payouts</span><strong>{currency.format(totalPlanned)}</strong><small>Not deducted until paid</small></div>
      </div>
      <div className="partner-hierarchy" aria-label="Partner hierarchy">
        <article className="partner-card">
          <div><span className="partner-type">Builder / GC partner</span><h3>{builderName}</h3></div>
          <div className="partner-withdrawal-totals"><span>Profit paid <strong>{currency.format(builderCompleted)}</strong></span><span>Planned <strong>{currency.format(builderPlanned)}</strong></span><small>Profit share − {currency.format(builderCompleted)} already paid = remaining Builder profit payable.</small></div>
          <ProfitPayoutList entries={withdrawalsFor('builder')} />
        </article>
        <article className="partner-card greenfort-partner-card">
          <div><span className="partner-type">Project partner</span><h3>{greenFortOwner?.name || 'Green Fort'}</h3></div>
          <div className="partner-withdrawal-totals"><span>Group profit paid <strong>{currency.format(greenFortDirectCompleted + childCompleted)}</strong></span><span>Group planned <strong>{currency.format(greenFortDirectPlanned + childPlanned)}</strong></span><small>Already paid amounts reduce Green Fort and each individual owner’s profit payable.</small></div>
          <div className="partner-child-list">
            {greenFortOwner ? <div className="partner-child-owner"><span>{greenFortOwner.name} direct</span><strong>{currency.format(greenFortDirectCompleted)}</strong><small>profit already paid</small><ProfitPayoutList entries={withdrawalsFor('greenfort')} /></div> : null}
            {childOwners.map((owner) => {
              const value = `owner:${owner.id}`
              return <div className="partner-child-owner" key={owner.id}><span>{owner.name}</span><strong>{currency.format(totalFor(value))}</strong><small>{Number(owner.ownershipPercentage ?? 0).toFixed(2)}% recorded ownership · profit already paid</small><ProfitPayoutList entries={withdrawalsFor(value)} /></div>
            })}
            {!childOwners.length ? <p>Add the two individual owners in Owners &amp; Costs; they will appear beneath Green Fort here.</p> : null}
          </div>
        </article>
      </div>
      <div className="partner-settlement-note"><strong>Profit payment formula</strong><span>Party’s approved project profit share − completed payouts already paid = remaining profit payable to that party.</span></div>
    </div>

    <div className="panel">
      <div className="panel-header"><div><p className="eyebrow">Advance profit</p><h2>Record a partner profit payout</h2></div></div>
      <form className="owner-form partner-withdrawal-form" onSubmit={submit} noValidate>
        <label>Recipient<select aria-label="Withdrawal recipient" value={recipient} onChange={(event) => setRecipient(event.target.value)}><option value="builder">{builderName}</option><option value="greenfort">{greenFortOwner?.name || 'Green Fort'}</option>{childOwners.map((owner) => <option key={owner.id} value={`owner:${owner.id}`}>{owner.name} — Green Fort owner</option>)}</select></label>
        <label>Status<select aria-label="Withdrawal status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="completed">Completed</option><option value="planned">Planned</option></select></label>
        <label>Amount<span className="currency-input"><span aria-hidden="true">$</span><input aria-label="Withdrawal amount" type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></span></label>
        <label>Date<input aria-label="Withdrawal date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label>Payment method<select aria-label="Withdrawal payment method" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="bank_transfer">ACH / bank transfer</option><option value="check">Check</option><option value="amex_business">Amex Business usage</option><option value="other_credit_card">Other credit card usage</option><option value="cash">Cash</option><option value="other">Other</option></select></label>
        <label>Reference<input aria-label="Withdrawal reference" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Check or transfer reference" /></label>
        <label className="wide-field">Notes<textarea aria-label="Withdrawal notes" rows="3" value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        {message ? <p className={message.type === 'error' ? 'validation-error wide-field' : 'partner-withdrawal-message wide-field'} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</p> : null}
        <div className="button-row wide-field"><button className="action-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save profit payout'}</button></div>
      </form>
    </div>

    <div className="panel">
      <div className="panel-header"><div><p className="eyebrow">Audit trail</p><h2>Partner profit payout history</h2></div><strong>{withdrawals.length}</strong></div>
      <div className="partner-withdrawal-history">
        {[...withdrawals].sort((a, b) => String(b.date).localeCompare(String(a.date))).map((entry) => {
          const payout = parsePayoutDetails(entry.notes)
          return <article key={entry.id}>
            <div><strong>{entry.counterparty}</strong><span>{entry.date} · {paymentMethodLabel(entry.paymentMethod)}{entry.reference ? ` · Ref ${entry.reference}` : ''}</span>{payout.summary ? <small>{payout.summary}</small> : null}</div>
            <span className={`financing-entry-status ${entry.status}`}>{entry.status}</span>
            <strong>{currency.format(entry.amount)}</strong>
            <div>{pendingDeleteId === entry.id ? <div className="button-row"><button type="button" className="danger-button" onClick={() => remove(entry)}>Confirm remove</button><button type="button" className="secondary-button" onClick={() => setPendingDeleteId(null)}>Cancel</button></div> : <button type="button" className="secondary-button" onClick={() => setPendingDeleteId(entry.id)}>Remove</button>}</div>
            {payout.items.length ? <div className="partner-payout-details"><strong>Payout details ({payout.items.length})</strong><div>{payout.items.map((item, index) => <div className="partner-payout-detail-row" key={`${item.date}-${item.description}-${index}`}><span>{item.date}</span><strong>{item.description}</strong><span>{currency.format(item.amount)}</span></div>)}</div></div> : null}
          </article>
        })}
        {!withdrawals.length ? <div className="cost-empty-state"><strong>No partner profit payouts recorded.</strong><p>Record each payment here so it reduces that party’s remaining profit payable.</p></div> : null}
      </div>
    </div>
  </section>
}

export default PartnersSection
