import { useMemo, useRef, useState } from 'react'
import { currency } from './lib/currency'

const today = () => new Date().toLocaleDateString('en-CA')

const typeLabels = {
  loan_received: 'Private loan received',
  principal_repayment: 'Loan principal repayment',
  interest_payment: 'Loan interest payment',
  owner_distribution: 'Partner profit payout',
}

const paymentMethodLabel = (method) => ({
  check: 'Check',
  bank_transfer: 'ACH / bank transfer',
  bofa_zelle: 'Zelle from BOFA',
  amex_business: 'Amex Business',
  other_credit_card: 'Other credit card',
  cash: 'Cash',
  other: 'Other',
}[method] || 'Not specified')

const cashDirection = (type) => type === 'loan_received' ? 1 : -1
const isPayment = (type) => type !== 'loan_received'

function FinancingLedger({ project, owners = [], entries = [], onSave, onDelete, onStatusChange, onUpdate, onTreatmentChange, onPrepareCheck }) {
  const [type, setType] = useState('loan_received')
  const [status, setStatus] = useState('completed')
  const [counterparty, setCounterparty] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today)
  const [paymentMethod, setPaymentMethod] = useState('')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [allowDuplicate, setAllowDuplicate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const [pendingDeleteId, setPendingDeleteId] = useState(null)
  const [treatmentSavingId, setTreatmentSavingId] = useState(null)
  const [editingEntryId, setEditingEntryId] = useState(null)
  const [editDraft, setEditDraft] = useState(null)
  const [editSaving, setEditSaving] = useState(false)
  const [freePayee, setFreePayee] = useState('')
  const [freeAmount, setFreeAmount] = useState('')
  const [freeDate, setFreeDate] = useState(today)
  const [freeMemo, setFreeMemo] = useState('')
  const [freeAddress, setFreeAddress] = useState('')
  const [freeCheckError, setFreeCheckError] = useState('')
  const formRef = useRef(null)

  const completed = entries.filter((entry) => entry.status === 'completed')
  const planned = entries.filter((entry) => entry.status === 'planned')
  const summary = useMemo(() => {
    const loanReceived = completed.filter((entry) => entry.type === 'loan_received').reduce((sum, entry) => sum + entry.amount, 0)
    const principalRepaid = completed.filter((entry) => entry.type === 'principal_repayment').reduce((sum, entry) => sum + entry.amount, 0)
    const interestPaid = completed.filter((entry) => entry.type === 'interest_payment').reduce((sum, entry) => sum + entry.amount, 0)
    const ownerDistributionCash = completed.filter((entry) => entry.type === 'owner_distribution').reduce((sum, entry) => sum + entry.amount, 0)
    const ownerDistributions = completed.filter((entry) => entry.accountingTreatment === 'partner_profit' || (entry.type === 'owner_distribution' && entry.accountingTreatment !== 'project_cost')).reduce((sum, entry) => sum + entry.amount, 0)
    const projectRepaymentCosts = completed.filter((entry) => entry.accountingTreatment === 'project_cost').reduce((sum, entry) => sum + entry.amount, 0)
    const plannedOutgoing = planned.filter((entry) => isPayment(entry.type)).reduce((sum, entry) => sum + entry.amount, 0)
    return {
      loanReceived,
      principalRepaid,
      outstanding: loanReceived - principalRepaid,
      interestPaid,
      ownerDistributions,
      projectRepaymentCosts,
      plannedOutgoing,
      netFinancingCash: loanReceived - principalRepaid - interestPaid - ownerDistributionCash,
    }
  }, [completed, planned])

  const lenderBalances = useMemo(() => {
    const lenders = new Map()
    completed.filter((entry) => entry.type === 'loan_received' || entry.type === 'principal_repayment').forEach((entry) => {
      const key = entry.counterparty.trim().toLowerCase()
      const current = lenders.get(key) || { name: entry.counterparty, received: 0, repaid: 0 }
      if (entry.type === 'loan_received') current.received += entry.amount
      else current.repaid += entry.amount
      lenders.set(key, current)
    })
    return [...lenders.values()].map((lender) => ({ ...lender, balance: lender.received - lender.repaid })).sort((a, b) => b.balance - a.balance)
  }, [completed])

  const normalizedCounterparty = type === 'owner_distribution'
    ? ownerId === 'habitech_builder' ? 'Habitech Builders' : owners.find((owner) => String(owner.id) === String(ownerId))?.name || counterparty.trim()
    : counterparty.trim()
  const duplicate = entries.find((entry) => (
    entry.type === type
    && entry.status === status
    && entry.counterparty.trim().toLowerCase() === normalizedCounterparty.toLowerCase()
    && Number(entry.amount) === Number(amount)
    && entry.date === date
    && String(entry.reference || '').trim().toLowerCase() === reference.trim().toLowerCase()
  ))

  const reset = () => {
    setAmount('')
    setReference('')
    setNotes('')
    setPaymentMethod('')
    setAllowDuplicate(false)
  }

  const submit = async (event) => {
    event.preventDefault()
    const shouldPrepareCheck = event.nativeEvent?.submitter?.value === 'save_and_check'
    const numericAmount = Number(amount)
    setMessage(null)
    if (!normalizedCounterparty) return setMessage({ type: 'error', text: type === 'owner_distribution' ? 'Select the owner receiving this payout.' : 'Enter the private lender or recipient name.' })
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return setMessage({ type: 'error', text: 'Enter an amount greater than $0.00.' })
    if (!date) return setMessage({ type: 'error', text: 'Select the planned or completed date.' })
    if (duplicate && !allowDuplicate) return setMessage({ type: 'error', text: 'A matching financing entry already exists. Review it below or explicitly allow the duplicate.' })
    setSaving(true)
    try {
      const entryStatus = shouldPrepareCheck ? 'planned' : status
      const saved = await onSave({
        projectId: project.id,
        type,
        status: entryStatus,
        counterparty: normalizedCounterparty,
        ownerId: type === 'owner_distribution' && ownerId && ownerId !== 'habitech_builder' ? Number(ownerId) : null,
        amount: numericAmount,
        date,
        paymentMethod: shouldPrepareCheck ? 'check' : paymentMethod,
        reference: reference.trim(),
        notes: notes.trim(),
      })
      setMessage({ type: 'success', text: shouldPrepareCheck ? 'Payment saved as planned and the check is ready to review.' : `${typeLabels[type]} saved as ${status}.` })
      if (shouldPrepareCheck && onPrepareCheck) {
        onPrepareCheck({
          payee: normalizedCounterparty,
          amount: numericAmount,
          memo: `${typeLabels[type]}${reference.trim() ? ` · ${reference.trim()}` : ''}`,
          mailingAddress: '',
        })
      }
      if (saved) reset()
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'The financing entry could not be saved.' })
    } finally {
      setSaving(false)
    }
  }

  const startPayment = (nextType, name, nextOwnerId = '') => {
    setType(nextType)
    setStatus('completed')
    setCounterparty(name)
    setOwnerId(nextOwnerId ? String(nextOwnerId) : '')
    setAmount('')
    setDate(today())
    setMessage(null)
    formRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  }

  const deleteEntry = async (entry) => {
    try {
      await onDelete(entry.id)
      setPendingDeleteId(null)
      setMessage({ type: 'success', text: 'Financing entry removed.' })
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'The entry could not be removed.' })
    }
  }


  const changeStatus = async (entry, nextStatus) => {
    try {
      await onStatusChange(entry.id, nextStatus)
      setMessage({ type: 'success', text: nextStatus === 'completed' ? 'Payment marked completed.' : 'Entry moved back to planned.' })
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'The entry status could not be updated.' })
    }
  }

  const changeTreatment = async (entry, treatment, profitOwnerId = null) => {
    if (!onTreatmentChange) return
    setTreatmentSavingId(entry.id)
    try {
      await onTreatmentChange(entry.id, treatment, profitOwnerId, entry.notes)
      const label = treatment === 'project_cost' ? 'counted as a project cost' : treatment === 'partner_profit' ? 'set to deduct from partner profit' : 'left unclassified'
      setMessage({ type: 'success', text: `${entry.counterparty} financing item is ${label}.` })
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'The accounting treatment could not be updated.' })
    } finally {
      setTreatmentSavingId(null)
    }
  }

  const suggestedProfitOwnerId = (entry) => entry.profitOwnerId || entry.ownerId || owners.find((owner) => {
    const ownerToken = String(owner.name || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 4)
    const counterparty = String(entry.counterparty || '').toLowerCase().replace(/[^a-z]/g, '')
    return ownerToken.length >= 3 && counterparty.includes(ownerToken)
  })?.id || null

  const startEdit = (entry) => {
    setEditingEntryId(entry.id)
    setEditDraft({ ...entry, amount: String(entry.amount), ownerId: entry.ownerId ? String(entry.ownerId) : entry.counterparty === 'Habitech Builders' ? 'habitech_builder' : '' })
    setMessage(null)
  }

  const saveEdit = async (entry) => {
    const numericAmount = Number(editDraft.amount)
    if (!editDraft.counterparty.trim()) return setMessage({ type: 'error', text: 'Enter the payee or counterparty.' })
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return setMessage({ type: 'error', text: 'Enter an amount greater than $0.00.' })
    if (!editDraft.date) return setMessage({ type: 'error', text: 'Select the transaction date.' })
    setEditSaving(true)
    try {
      await onUpdate(entry.id, {
        ...editDraft,
        amount: numericAmount,
        ownerId: editDraft.type === 'owner_distribution' && editDraft.ownerId && editDraft.ownerId !== 'habitech_builder' ? Number(editDraft.ownerId) : null,
      })
      setEditingEntryId(null)
      setEditDraft(null)
      setMessage({ type: 'success', text: 'Financing record updated.' })
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'The financing record could not be updated.' })
    } finally {
      setEditSaving(false)
    }
  }

  const prepareFreeCheck = (event) => {
    event.preventDefault()
    const numericAmount = Number(freeAmount)
    setFreeCheckError('')
    if (!freePayee.trim()) return setFreeCheckError('Enter who the check is payable to.')
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return setFreeCheckError('Enter a check amount greater than $0.00.')
    if (!freeDate) return setFreeCheckError('Select the check date.')
    onPrepareCheck({
      payee: freePayee.trim(),
      amount: numericAmount,
      date: freeDate,
      memo: freeMemo.trim(),
      mailingAddress: freeAddress.trim(),
    })
  }

  return <section className="financing-ledger">
    <div className="panel financing-summary-panel">
      <div className="panel-header"><div><p className="eyebrow">Accounting & budgeting</p><h2>Private loans and owner payouts</h2><p>Keep financing and equity activity separate from project income and deductible costs.</p></div></div>
      <div className="financing-summary-grid">
        <div><span>Private-loan balance</span><strong>{currency.format(summary.outstanding)}</strong><small>Received minus principal repaid</small></div>
        <div><span>Planned payouts</span><strong>{currency.format(summary.plannedOutgoing)}</strong><small>Upcoming repayments, interest and distributions</small></div>
        <div><span>Interest paid</span><strong>{currency.format(summary.interestPaid)}</strong><small>Separate accountant-review amount</small></div>
        <div><span>Partner profit paid</span><strong>{currency.format(summary.ownerDistributions)}</strong><small>Deduct from each party’s profit payable</small></div>
        <div><span>Financing items treated as cost</span><strong>{currency.format(summary.projectRepaymentCosts)}</strong><small>Completed items explicitly classified as project cost</small></div>
        <div><span>Net financing cash</span><strong>{currency.format(summary.netFinancingCash)}</strong><small>Completed financing cash in minus cash out</small></div>
      </div>
      <div className="accounting-treatment-note">
        <strong>Repayment treatment</strong>
        <span>Financing items stay separate by default. On every item, explicitly choose whether it counts as a project cost or reduces a selected partner’s profit. The two treatments are mutually exclusive.</span>
      </div>
    </div>

    <div className="section-grid financing-workspace">
      <div className="panel" ref={formRef}>
        <div className="panel-header"><div><p className="eyebrow">Add or plan</p><h2>Financing entry</h2></div></div>
        <form className="owner-form financing-entry-form" onSubmit={submit} noValidate>
          <label>Entry type<select aria-label="Financing entry type" value={type} onChange={(event) => { setType(event.target.value); setAllowDuplicate(false) }}>
            {Object.entries(typeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select></label>
          <label>Status<select aria-label="Financing entry status" value={status} onChange={(event) => { setStatus(event.target.value); setAllowDuplicate(false) }}><option value="planned">Planned / budgeted</option><option value="completed">Completed</option></select></label>
          {type === 'owner_distribution' ? <label>Owner<select aria-label="Payout owner" value={ownerId} onChange={(event) => setOwnerId(event.target.value)}><option value="">Select owner</option><option value="habitech_builder">Builder — Habitech Builders</option>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></label>
            : <label>{type === 'loan_received' ? 'Private lender' : 'Pay to lender'}<input aria-label="Financing counterparty" value={counterparty} onChange={(event) => setCounterparty(event.target.value)} placeholder="Person or company name" /></label>}
          <label>Amount<span className="currency-input"><span aria-hidden="true">$</span><input aria-label="Financing amount" type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></span></label>
          <label>{status === 'planned' ? 'Planned date' : 'Completed date'}<input aria-label="Financing date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label>Payment method<select aria-label="Financing payment method" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="">Not specified</option><option value="check">Check</option><option value="bank_transfer">ACH / bank transfer</option><option value="bofa_zelle">Zelle from BOFA</option><option value="amex_business">Amex Business usage</option><option value="other_credit_card">Other credit card usage</option><option value="cash">Cash</option><option value="other">Other</option></select></label>
          <label>Reference / check number<input aria-label="Financing reference" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Optional" /></label>
          <label className="wide-field">Accounting notes<textarea aria-label="Financing notes" rows="3" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Agreement terms, principal vs. interest explanation, or owner authorization" /></label>
          {duplicate ? <div className="duplicate-financing-warning wide-field" role="alert"><strong>Possible duplicate entry</strong><span>{typeLabels[duplicate.type]} for {duplicate.counterparty}, {currency.format(duplicate.amount)} on {duplicate.date} already exists.</span><label><input type="checkbox" checked={allowDuplicate} onChange={(event) => setAllowDuplicate(event.target.checked)} /> Save another entry anyway</label></div> : null}
          {message ? <p className={message.type === 'error' ? 'validation-error wide-field' : 'wide-field'} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</p> : null}
          <div className="button-row wide-field"><button type="submit" className="action-button" disabled={saving}>{saving ? 'Saving…' : 'Save entry'}</button>{isPayment(type) && onPrepareCheck ? <button type="submit" name="financing-action" value="save_and_check" className="secondary-button" disabled={saving}>Save planned &amp; prepare check</button> : null}</div>
        </form>
      </div>

      <div className="panel">
        <div className="panel-header"><div><p className="eyebrow">Outstanding balances</p><h2>Private lenders</h2></div><strong>{lenderBalances.length}</strong></div>
        <div className="table-card financing-lender-list">
          {lenderBalances.map((lender) => <div className="table-row" key={lender.name.toLowerCase()}><div><strong>{lender.name}</strong><p>Received {currency.format(lender.received)} · Principal repaid {currency.format(lender.repaid)}</p></div><div className="metric-stack"><strong className={lender.balance < 0 ? 'warning' : ''}>{currency.format(lender.balance)}</strong>{lender.balance > 0 ? <button type="button" className="secondary-button" onClick={() => startPayment('principal_repayment', lender.name)}>Repay</button> : null}</div></div>)}
          {!lenderBalances.length ? <div className="cost-empty-state"><strong>No private loans recorded.</strong><p>Add a completed loan received entry to establish a lender balance.</p></div> : null}
        </div>
        {owners.length ? <div className="owner-payout-shortcuts"><strong>Owner payout shortcuts</strong><div className="button-row">{owners.map((owner) => <button type="button" className="secondary-button" key={owner.id} onClick={() => startPayment('owner_distribution', owner.name, owner.id)}>Pay {owner.name}</button>)}</div></div> : null}
      </div>
    </div>

    {onPrepareCheck ? <div className="panel free-check-panel">
      <div className="panel-header"><div><p className="eyebrow">Not tied to a bill</p><h2>Write any check</h2><p>Start a standalone check for a person, company, reimbursement, or other payment.</p></div></div>
      <form className="owner-form free-check-form" onSubmit={prepareFreeCheck} noValidate>
        <label>Pay to the order of<input aria-label="Free check payee" value={freePayee} onChange={(event) => setFreePayee(event.target.value)} placeholder="Person or company" /></label>
        <label>Amount<span className="currency-input"><span aria-hidden="true">$</span><input aria-label="Free check amount" type="number" min="0.01" step="0.01" value={freeAmount} onChange={(event) => setFreeAmount(event.target.value)} /></span></label>
        <label>Check date<input aria-label="Free check date" type="date" value={freeDate} onChange={(event) => setFreeDate(event.target.value)} /></label>
        <label>Memo<input aria-label="Free check memo" value={freeMemo} onChange={(event) => setFreeMemo(event.target.value)} placeholder="Reason for payment" /></label>
        <label className="wide-field">Envelope address <span className="optional-label">Optional</span><textarea aria-label="Free check mailing address" rows="3" value={freeAddress} onChange={(event) => setFreeAddress(event.target.value)} placeholder={'Street address\nCity, State ZIP'} /></label>
        <div className="free-check-accounting-note wide-field"><strong>Accounting reminder</strong><span>A standalone check does not automatically become a project cost, loan repayment, or owner distribution. Link or record its accounting purpose so reports remain accurate.</span></div>
        {freeCheckError ? <p className="validation-error wide-field" role="alert">{freeCheckError}</p> : null}
        <div className="button-row wide-field"><button type="submit" className="action-button">Open check writer</button></div>
      </form>
    </div> : null}

    <div className="panel">
      <div className="panel-header"><div><p className="eyebrow">Audit ledger</p><h2>Financing history</h2></div><strong>{entries.length}</strong></div>
      <div className="financing-history">
        {[...entries].sort((a, b) => String(b.date).localeCompare(String(a.date)) || Number(b.id) - Number(a.id)).map((entry) => {
          const profitOwnerId = suggestedProfitOwnerId(entry)
          return <article className="financing-history-row" key={entry.id}>
            <div className="financing-payment-details"><strong>{typeLabels[entry.type]}</strong><p>{entry.counterparty} · {entry.date}{entry.reference ? ` · Ref ${entry.reference}` : ''} · {paymentMethodLabel(entry.paymentMethod)}</p>{entry.notes ? <small>{entry.notes}</small> : null}
              {onTreatmentChange ? <div className="financing-treatment-controls">
                <label><input type="checkbox" checked={entry.accountingTreatment === 'project_cost'} disabled={treatmentSavingId === entry.id} onChange={(event) => changeTreatment(entry, event.target.checked ? 'project_cost' : '')} /> Project cost</label>
                <label><input type="checkbox" checked={entry.accountingTreatment === 'partner_profit'} disabled={treatmentSavingId === entry.id} onChange={(event) => changeTreatment(entry, event.target.checked ? 'partner_profit' : '', event.target.checked ? profitOwnerId : null)} /> Deduct from partner profit</label>
                {entry.accountingTreatment === 'partner_profit' ? <label>Partner<select aria-label={`Profit partner for ${entry.counterparty}`} value={entry.profitOwnerId || profitOwnerId || ''} disabled={treatmentSavingId === entry.id} onChange={(event) => changeTreatment(entry, 'partner_profit', event.target.value ? Number(event.target.value) : null)}><option value="">Use payee: {entry.counterparty}</option>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></label> : null}
                {!entry.accountingTreatment ? <small>Choose treatment</small> : null}
              </div> : null}
            </div>
            <span className={`financing-entry-status ${entry.status}`}>{entry.status}</span>
            <strong className={cashDirection(entry.type) > 0 ? 'cash-in' : 'cash-out'}>{cashDirection(entry.type) > 0 ? '+' : '−'}{currency.format(entry.amount)}</strong>
            <div className="button-row">{onUpdate ? <button type="button" className="secondary-button" onClick={() => startEdit(entry)}>Edit</button> : null}{onStatusChange ? <button type="button" className="secondary-button" onClick={() => changeStatus(entry, entry.status === 'planned' ? 'completed' : 'planned')}>{entry.status === 'planned' ? 'Mark completed' : 'Move to planned'}</button> : null}{pendingDeleteId === entry.id ? <><button type="button" className="danger-button" onClick={() => deleteEntry(entry)}>Confirm remove</button><button type="button" className="secondary-button" onClick={() => setPendingDeleteId(null)}>Cancel</button></> : <button type="button" className="secondary-button" onClick={() => setPendingDeleteId(entry.id)}>Remove</button>}</div>
            {editingEntryId === entry.id && editDraft ? <div className="financing-inline-edit" aria-label={`Edit financing entry ${entry.id}`}>
              <label>Type<select aria-label={`Edit type for ${entry.id}`} value={editDraft.type} onChange={(event) => setEditDraft((current) => ({ ...current, type: event.target.value }))}>{Object.entries(typeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <label>Status<select aria-label={`Edit status for ${entry.id}`} value={editDraft.status} onChange={(event) => setEditDraft((current) => ({ ...current, status: event.target.value }))}><option value="planned">Planned</option><option value="completed">Completed</option></select></label>
              <label>Payee / counterparty<input aria-label={`Edit counterparty for ${entry.id}`} value={editDraft.counterparty} onChange={(event) => setEditDraft((current) => ({ ...current, counterparty: event.target.value }))} /></label>
              {editDraft.type === 'owner_distribution' ? <label>Owner<select aria-label={`Edit owner for ${entry.id}`} value={editDraft.ownerId} onChange={(event) => { const owner = owners.find((item) => String(item.id) === event.target.value); setEditDraft((current) => ({ ...current, ownerId: event.target.value, counterparty: event.target.value === 'habitech_builder' ? 'Habitech Builders' : owner?.name || current.counterparty })) }}><option value="">Select owner</option><option value="habitech_builder">Builder — Habitech Builders</option>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></label> : null}
              <label>Amount<input aria-label={`Edit amount for ${entry.id}`} type="number" min="0.01" step="0.01" value={editDraft.amount} onChange={(event) => setEditDraft((current) => ({ ...current, amount: event.target.value }))} /></label>
              <label>Date<input aria-label={`Edit date for ${entry.id}`} type="date" value={editDraft.date} onChange={(event) => setEditDraft((current) => ({ ...current, date: event.target.value }))} /></label>
              <label>Payment method<select aria-label={`Edit payment method for ${entry.id}`} value={editDraft.paymentMethod} onChange={(event) => setEditDraft((current) => ({ ...current, paymentMethod: event.target.value }))}><option value="">Not specified</option><option value="check">Check</option><option value="bank_transfer">ACH / bank transfer</option><option value="bofa_zelle">Zelle from BOFA</option><option value="amex_business">Amex Business usage</option><option value="other_credit_card">Other credit card usage</option><option value="cash">Cash</option><option value="other">Other</option></select></label>
              <label>Reference<input aria-label={`Edit reference for ${entry.id}`} value={editDraft.reference} onChange={(event) => setEditDraft((current) => ({ ...current, reference: event.target.value }))} /></label>
              <label className="wide-field">Notes<textarea aria-label={`Edit notes for ${entry.id}`} rows="3" value={editDraft.notes} onChange={(event) => setEditDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
              <div className="button-row wide-field"><button type="button" className="action-button" disabled={editSaving} onClick={() => saveEdit(entry)}>{editSaving ? 'Saving…' : 'Save changes'}</button><button type="button" className="secondary-button" disabled={editSaving} onClick={() => { setEditingEntryId(null); setEditDraft(null) }}>Cancel editing</button></div>
            </div> : null}
          </article>
        })}
        {!entries.length ? <div className="cost-empty-state"><strong>No financing activity yet.</strong><p>Private loans and owner payouts will appear here without inflating income or project costs.</p></div> : null}
      </div>
    </div>
  </section>
}

export default FinancingLedger
