import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import FinancingLedger from './FinancingLedger'

const project = { id: 7, name: 'Tryon Rd' }

const renderLedger = (overrides = {}) => {
  const props = {
    project,
    owners: [{ id: 3, name: 'Kemal', contributionAmount: 100000 }],
    entries: [],
    onSave: vi.fn(async (entry) => ({ id: 99, ...entry })),
    onDelete: vi.fn(async () => {}),
    onStatusChange: vi.fn(async () => {}),
    onUpdate: vi.fn(async () => {}),
    onTreatmentChange: vi.fn(async () => {}),
    onPrepareCheck: vi.fn(),
    ...overrides,
  }
  render(<FinancingLedger {...props} />)
  return props
}

describe('FinancingLedger', () => {
  it('saves a builder payout without assigning it to an unrelated owner', async () => {
    const props = renderLedger()
    fireEvent.change(screen.getByLabelText('Financing entry type'), { target: { value: 'owner_distribution' } })
    fireEvent.change(screen.getByLabelText('Payout owner'), { target: { value: 'habitech_builder' } })
    fireEvent.change(screen.getByLabelText('Financing amount'), { target: { value: '4000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save entry' }))
    await waitFor(() => expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({
      type: 'owner_distribution', counterparty: 'Habitech Builders', ownerId: null, amount: 4000,
    })))
  })

  it('keeps principal, interest, owner payouts and planned payments visibly separate', () => {
    renderLedger({
      entries: [
        { id: 1, type: 'loan_received', status: 'completed', counterparty: 'Private Lender', amount: 100000, date: '2026-01-01', reference: '', paymentMethod: '' },
        { id: 2, type: 'principal_repayment', status: 'completed', counterparty: 'Private Lender', amount: 25000, date: '2026-02-01', reference: '', paymentMethod: 'check' },
        { id: 3, type: 'interest_payment', status: 'completed', counterparty: 'Private Lender', amount: 5000, date: '2026-02-01', reference: '', paymentMethod: 'check' },
        { id: 4, type: 'owner_distribution', status: 'completed', counterparty: 'Kemal', amount: 10000, date: '2026-03-01', reference: '', paymentMethod: 'check' },
        { id: 5, type: 'principal_repayment', status: 'planned', counterparty: 'Private Lender', amount: 20000, date: '2026-04-01', reference: '', paymentMethod: 'check' },
      ],
    })

    expect(screen.getAllByText('$75,000.00')).toHaveLength(2)
    expect(screen.getByText('$20,000.00')).toBeInTheDocument()
    expect(screen.getByText('$5,000.00')).toBeInTheDocument()
    expect(screen.getByText('$10,000.00')).toBeInTheDocument()
    expect(screen.getByText('$60,000.00')).toBeInTheDocument()
    expect(screen.getByText(/On every item, explicitly choose whether it counts as a project cost or reduces a selected partner’s profit/)).toBeInTheDocument()
  })

  it('saves a check payment as planned and prepares a meaningful check', async () => {
    const props = renderLedger()
    fireEvent.change(screen.getByLabelText('Financing entry type'), { target: { value: 'owner_distribution' } })
    fireEvent.change(screen.getByLabelText('Payout owner'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Financing amount'), { target: { value: '12500' } })
    fireEvent.change(screen.getByLabelText('Financing reference'), { target: { value: 'Owner payout Q3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save planned & prepare check' }))

    await waitFor(() => expect(props.onSave).toHaveBeenCalled())
    expect(props.onSave.mock.calls[0][0]).toMatchObject({
      projectId: 7,
      type: 'owner_distribution',
      status: 'planned',
      counterparty: 'Kemal',
      ownerId: 3,
      amount: 12500,
      paymentMethod: 'check',
    })
    expect(props.onPrepareCheck).toHaveBeenCalledWith(expect.objectContaining({
      payee: 'Kemal',
      amount: 12500,
      memo: 'Partner profit payout · Owner payout Q3',
    }))
  })

  it('allows an owner payout to be recorded as Amex Business usage', async () => {
    const props = renderLedger()
    fireEvent.change(screen.getByLabelText('Financing entry type'), { target: { value: 'owner_distribution' } })
    fireEvent.change(screen.getByLabelText('Payout owner'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Financing amount'), { target: { value: '600' } })
    fireEvent.change(screen.getByLabelText('Financing payment method'), { target: { value: 'amex_business' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save entry' }))

    await waitFor(() => expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({
      type: 'owner_distribution',
      ownerId: 3,
      amount: 600,
      paymentMethod: 'amex_business',
    })))
  })

  it('requires explicit confirmation before saving an exact duplicate', async () => {
    const entry = { id: 1, type: 'loan_received', status: 'completed', counterparty: 'John Smith', amount: 10000, date: '2026-08-14', reference: 'Note 1', paymentMethod: '', notes: '' }
    const props = renderLedger({ entries: [entry] })
    fireEvent.change(screen.getByLabelText('Financing counterparty'), { target: { value: 'John Smith' } })
    fireEvent.change(screen.getByLabelText('Financing amount'), { target: { value: '10000' } })
    fireEvent.change(screen.getByLabelText('Financing date'), { target: { value: '2026-08-14' } })
    fireEvent.change(screen.getByLabelText('Financing reference'), { target: { value: 'Note 1' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save entry' }))
    expect(props.onSave).not.toHaveBeenCalled()
    expect(screen.getByText('Possible duplicate entry')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Save another entry anyway' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save entry' }))
    await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1))
  })

  it('lets a planned payment be marked completed', async () => {
    const props = renderLedger({ entries: [{ id: 8, type: 'principal_repayment', status: 'planned', counterparty: 'John Smith', amount: 5000, date: '2026-08-20', reference: '', paymentMethod: 'check', notes: '' }] })
    fireEvent.click(screen.getByRole('button', { name: 'Mark completed' }))
    await waitFor(() => expect(props.onStatusChange).toHaveBeenCalledWith(8, 'completed'))
  })

  it('lets a principal repayment be classified as a project cost or partner-profit deduction', async () => {
    const entry = { id: 12, type: 'principal_repayment', status: 'completed', counterparty: 'Banugul Barut Uyar', amount: 7000, date: '2026-08-14', reference: '148', paymentMethod: 'check', notes: 'Kagan Ilter Loan repayment', accountingTreatment: '' }
    const props = renderLedger({ owners: [{ id: 9, name: 'Banu U' }], entries: [entry] })

    fireEvent.click(screen.getByRole('checkbox', { name: 'Project cost' }))
    await waitFor(() => expect(props.onTreatmentChange).toHaveBeenCalledWith(12, 'project_cost', null, 'Kagan Ilter Loan repayment'))

    props.onTreatmentChange.mockClear()
    renderLedger({ owners: [{ id: 9, name: 'Banu U' }], entries: [{ ...entry, accountingTreatment: 'partner_profit', profitOwnerId: 9 }] })
    expect(screen.getAllByRole('checkbox', { name: 'Deduct from partner profit' })[1]).toBeChecked()
    expect(screen.getByLabelText('Profit partner for Banugul Barut Uyar')).toHaveValue('9')
  })

  it('shows accounting-treatment choices on every financing item type', () => {
    renderLedger({ entries: [
      { id: 21, type: 'loan_received', status: 'completed', counterparty: 'Lender', amount: 1000, date: '2026-08-01', reference: '', paymentMethod: 'bank_transfer', notes: '' },
      { id: 22, type: 'interest_payment', status: 'completed', counterparty: 'Lender', amount: 50, date: '2026-08-02', reference: '', paymentMethod: 'check', notes: '' },
      { id: 23, type: 'owner_distribution', status: 'completed', counterparty: 'Kemal', amount: 100, date: '2026-08-03', reference: '', paymentMethod: 'check', notes: '' },
    ] })

    expect(screen.getAllByRole('checkbox', { name: 'Project cost' })).toHaveLength(3)
    expect(screen.getAllByRole('checkbox', { name: 'Deduct from partner profit' })).toHaveLength(3)
  })

  it('edits every field on an existing financing record inline', async () => {
    const entry = { id: 12, type: 'principal_repayment', status: 'completed', counterparty: 'Banugul Barut Uyar', ownerId: null, amount: 7000, date: '2026-08-14', reference: '148', paymentMethod: 'check', notes: 'Kagan Ilter Loan repayment', accountingTreatment: '', profitOwnerId: null }
    const props = renderLedger({ entries: [entry] })

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Edit counterparty for 12'), { target: { value: 'Updated Payee' } })
    fireEvent.change(screen.getByLabelText('Edit amount for 12'), { target: { value: '7250.50' } })
    fireEvent.change(screen.getByLabelText('Edit reference for 12'), { target: { value: '148-A' } })
    fireEvent.change(screen.getByLabelText('Edit notes for 12'), { target: { value: 'Updated repayment details' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(props.onUpdate).toHaveBeenCalledWith(12, expect.objectContaining({
      type: 'principal_repayment',
      status: 'completed',
      counterparty: 'Updated Payee',
      amount: 7250.5,
      date: '2026-08-14',
      paymentMethod: 'check',
      reference: '148-A',
      notes: 'Updated repayment details',
    })))
  })

  it('opens a standalone check without creating a financing ledger entry', () => {
    const props = renderLedger()
    fireEvent.change(screen.getByLabelText('Free check payee'), { target: { value: 'ABC Services' } })
    fireEvent.change(screen.getByLabelText('Free check amount'), { target: { value: '725.50' } })
    fireEvent.change(screen.getByLabelText('Free check date'), { target: { value: '2026-08-19' } })
    fireEvent.change(screen.getByLabelText('Free check memo'), { target: { value: 'Equipment reimbursement' } })
    fireEvent.change(screen.getByLabelText('Free check mailing address'), { target: { value: '123 Main St\nRaleigh, NC 27601' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open check writer' }))

    expect(props.onSave).not.toHaveBeenCalled()
    expect(props.onPrepareCheck).toHaveBeenCalledWith({
      payee: 'ABC Services',
      amount: 725.5,
      date: '2026-08-19',
      memo: 'Equipment reimbursement',
      mailingAddress: '123 Main St\nRaleigh, NC 27601',
    })
  })
})
