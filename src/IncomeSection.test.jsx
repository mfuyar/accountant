import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import IncomeSection from './IncomeSection'
import { extractLoanDrawFromDocument, extractTransactionFromImage } from './lib/gemini'

vi.mock('./lib/gemini', () => ({
  extractLoanDrawFromDocument: vi.fn().mockResolvedValue({ lots: [] }),
  extractTransactionFromImage: vi.fn().mockResolvedValue({}),
}))

describe('IncomeSection', () => {
  it('shows linked pre-sale funding once as income and does not offer duplicate edit actions', () => {
    render(<IncomeSection
      incomes={[{
        id: 'development-funding-1', projectId: 7, description: 'Pre sale Deposits (Utilized)', source: 'Green Fort', amount: 300000,
        date: '2026-07-14', type: 'pre_sale_deposit', derivedFromCost: true,
      }]}
      projects={[{ id: 7, name: 'Tryon Rd' }]}
      onAddIncome={() => {}}
      onEditIncome={() => {}}
      onDeleteIncome={() => {}}
    />)

    expect(screen.getByText('Total income').parentElement).toHaveTextContent('$300,000.00')
    expect(screen.getByText('Pre sale Deposits (Utilized)')).toBeInTheDocument()
    expect(screen.getByText(/pre-sale deposit · applied to development/i)).toBeInTheDocument()
    expect(screen.getByText(/utilization included once in development costs/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit income' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add deposit activity' })).toBeInTheDocument()
  })

  it('shows the ledger controls for a persisted pre-sale deposit', () => {
    render(<IncomeSection
      incomes={[{
        id: 4, projectId: 7, description: 'Pre-sale Deposits (Utilized)', source: 'Buyer agreements', amount: 300000,
        date: '2026-07-14', type: 'pre_sale_deposit', activities: [], attachments: [],
      }]}
      projects={[{ id: 7, name: 'Tryon Rd' }]}
      onAddIncome={vi.fn()}
      onEditIncome={vi.fn()}
      onDeleteIncome={vi.fn()}
    />)

    expect(screen.getByRole('button', { name: 'View deposit ledger' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add deposit activity' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit income' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete income' })).not.toBeInTheDocument()
  })

  it('materializes a linked pre-sale deposit when its first refund activity is saved', async () => {
    const onAddIncome = vi.fn().mockResolvedValue({ id: 91 })
    render(<IncomeSection
      incomes={[{
        id: 'development-funding-1', projectId: 7, description: 'Pre sale Deposits (Utilized)', source: 'Green Fort', amount: 300000,
        date: '2026-07-14', type: 'pre_sale_deposit', derivedFromCost: true, activities: [], lotBreakdown: [], attachments: [],
      }]}
      projects={[{ id: 7, name: 'Tryon Rd' }]}
      onAddIncome={onAddIncome}
      onEditIncome={() => {}}
      onDeleteIncome={() => {}}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Add deposit activity' }))
    fireEvent.change(screen.getByLabelText('Deposit activity type'), { target: { value: 'refund' } })
    fireEvent.change(screen.getByLabelText('Deposit activity amount'), { target: { value: '25000' } })
    fireEvent.change(screen.getByLabelText('Deposit activity date'), { target: { value: '2026-08-17' } })
    fireEvent.change(screen.getByLabelText('Deposit activity lot'), { target: { value: 'Lot 2' } })
    fireEvent.change(screen.getByLabelText('Deposit activity details'), { target: { value: 'Buyer cancellation refund, check 1104' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save deposit activity' }))

    await waitFor(() => expect(onAddIncome).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 7,
      amount: 300000,
      type: 'pre_sale_deposit',
      activities: [expect.objectContaining({
        type: 'refund', amount: 25000, date: '2026-08-17', lot: 'Lot 2',
        description: 'Buyer cancellation refund, check 1104',
      })],
    })))
  })

  it('shows deposit activity totals without changing the original income amount', () => {
    render(<IncomeSection
      incomes={[{
        id: 91, projectId: 7, description: 'Pre-sale deposit', source: 'Buyer', amount: 300000,
        date: '2026-07-14', type: 'pre_sale_deposit', activities: [
          { id: 'receipt-a', type: 'receipt', amount: 100000, date: '2026-07-14', description: 'First installment', lot: 'Lot 2' },
          { id: 'a', type: 'application', amount: 80000, date: '2026-08-01', description: 'Applied to development', lot: 'Lot 2' },
          { id: 'b', type: 'refund', amount: 25000, date: '2026-08-17', description: 'Buyer refund', lot: 'Lot 2' },
        ],
      }]}
      projects={[{ id: 7, name: 'Tryon Rd' }]}
      onAddIncome={() => {}}
      onEditIncome={() => {}}
      onDeleteIncome={() => {}}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'View deposit ledger' }))
    const ledger = screen.getByLabelText('Deposit ledger for Pre-sale deposit')
    expect(within(ledger).getByText('Original deposit').parentElement).toHaveTextContent('$300,000.00')
    expect(within(ledger).getByText('Receipts documented').parentElement).toHaveTextContent('$100,000.00')
    expect(within(ledger).getByText('Receipts unreconciled').parentElement).toHaveTextContent('$200,000.00')
    expect(within(ledger).getByText('Applied').parentElement).toHaveTextContent('$80,000.00')
    expect(within(ledger).getByText('Refunded').parentElement).toHaveTextContent('$25,000.00')
    expect(within(ledger).getByText('Remaining balance').parentElement).toHaveTextContent('$195,000.00')
  })

  it('distinguishes direct bank matches from probable statement matches', () => {
    render(<IncomeSection
      incomes={[{
        id: 91, projectId: 7, description: 'Pre-sale deposit', source: 'Buyers', amount: 300000,
        date: '2026-07-14', type: 'pre_sale_deposit', activities: [
          { id: 'direct', type: 'receipt', amount: 20000, date: '2025-11-10', description: 'Nuri Ozturk', bankDetail: 'Incoming wire from NURI OZTURK', sourceStatement: 'eStmt_2025-11-28.pdf', reconciliationStatus: 'matched', matchBasis: 'Direct payer-name match.' },
          { id: 'probable', type: 'receipt', amount: 10000, date: '2025-11-10', description: 'Muhemmet Uyar', bankDetail: 'BKOFAMERICA MOBILE DEPOSIT', sourceStatement: 'eStmt_2025-11-28.pdf', reconciliationStatus: 'probable_match', matchBasis: 'Matched by amount, date, and elimination.' },
        ],
      }]}
      projects={[{ id: 7, name: 'Tryon Rd' }]}
      onAddIncome={vi.fn()}
      onEditIncome={vi.fn()}
      onDeleteIncome={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'View deposit ledger' }))
    expect(screen.getByText('Bank statement matched')).toBeInTheDocument()
    expect(screen.getByText('Probable bank match')).toBeInTheDocument()
    expect(screen.getByText('Incoming wire from NURI OZTURK')).toBeInTheDocument()
    expect(screen.getByText('Matched by amount, date, and elimination.')).toBeInTheDocument()
  })

  it('updates a received amount while preserving its agreement details and attachment', async () => {
    const onEditIncome = vi.fn().mockResolvedValue(undefined)
    const attachment = { id: 'agreement-1', name: 'signed-agreement.pdf' }
    render(<IncomeSection
      incomes={[{
        id: 91, projectId: 7, description: 'Pre-sale deposit', source: 'Buyer', amount: 300000,
        date: '2026-07-14', type: 'pre_sale_deposit', attachments: [], activities: [{
          id: 'receipt-a', type: 'receipt', amount: 100000, date: '2026-07-14', description: 'Volkan O deposit',
          lot: 'Lot 2', buyerNames: ['Volkan O'], agreementDate: '2026-06-10', attachment, recordedAt: '2026-07-14T12:00:00.000Z',
        }],
      }]}
      projects={[{ id: 7, name: 'Tryon Rd' }]}
      onAddIncome={vi.fn()}
      onEditIncome={onEditIncome}
      onDeleteIncome={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'View deposit ledger' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Volkan O deposit' }))
    expect(screen.getByRole('heading', { name: 'Edit deposit activity' })).toBeInTheDocument()
    expect(screen.getByLabelText('Deposit activity amount')).toHaveValue(100000)
    fireEvent.change(screen.getByLabelText('Deposit activity amount'), { target: { value: '90000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save activity changes' }))

    await waitFor(() => expect(onEditIncome).toHaveBeenCalledWith(91, expect.objectContaining({
      amount: 300000,
      activities: [expect.objectContaining({
        id: 'receipt-a', type: 'receipt', amount: 90000, buyerNames: ['Volkan O'],
        agreementDate: '2026-06-10', attachment, recordedAt: '2026-07-14T12:00:00.000Z',
      })],
    })))
  })

  it('offers receipt-specific refund and cancellation actions and confirms removal', async () => {
    const onEditIncome = vi.fn().mockResolvedValue(undefined)
    const income = {
      id: 91, projectId: 7, description: 'Pre-sale deposit', source: 'Buyer', amount: 300000,
      date: '2026-07-14', type: 'pre_sale_deposit', attachments: [], activities: [
        { id: 'receipt-a', type: 'receipt', amount: 50000, date: '2026-07-14', description: 'Salman Shabbir deposit', lot: 'Lot 3' },
      ],
    }
    render(<IncomeSection
      incomes={[income]}
      projects={[{ id: 7, name: 'Tryon Rd' }]}
      onAddIncome={vi.fn()}
      onEditIncome={onEditIncome}
      onDeleteIncome={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'View deposit ledger' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add refund payment for Salman Shabbir deposit' }))
    expect(screen.getByRole('heading', { name: 'Refund buyer deposit' })).toBeInTheDocument()
    expect(screen.getByLabelText('Deposit activity type')).toHaveValue('refund')
    expect(screen.getByLabelText('Deposit activity amount')).toHaveValue(50000)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel agreement for Salman Shabbir deposit' }))
    expect(screen.getByRole('heading', { name: 'Cancel buyer agreement' })).toBeInTheDocument()
    expect(screen.getByLabelText('Deposit activity type')).toHaveValue('cancellation')
    expect(screen.getByText('Required: signed cancellation agreement')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove Salman Shabbir deposit' }))
    expect(onEditIncome).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove Salman Shabbir deposit' }))
    await waitFor(() => expect(onEditIncome).toHaveBeenCalledWith(91, expect.objectContaining({ activities: [] })))
  })

  it('records multiple partial refund payments and caps them at the buyer deposit', async () => {
    const onEditIncome = vi.fn().mockResolvedValue(undefined)
    render(<IncomeSection
      incomes={[{
        id: 91, projectId: 7, description: 'Pre-sale deposit', source: 'Buyer', amount: 300000,
        date: '2026-07-14', type: 'pre_sale_deposit', attachments: [], activities: [
          { id: 'receipt-a', type: 'receipt', amount: 50000, date: '2026-07-14', description: 'Salman Shabbir deposit', lot: 'Lot 3' },
          { id: 'refund-a', relatedActivityId: 'receipt-a', type: 'refund', amount: 20000, date: '2026-08-01', description: 'First refund payment', lot: 'Lot 3' },
        ],
      }]}
      projects={[{ id: 7, name: 'Tryon Rd' }]}
      onAddIncome={vi.fn()}
      onEditIncome={onEditIncome}
      onDeleteIncome={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'View deposit ledger' }))
    expect(screen.getByText('Refunded $20,000.00 · $30,000.00 left to refund')).toBeInTheDocument()
    const linkedRefunds = screen.getByLabelText('Refund payments for Salman Shabbir deposit')
    expect(within(linkedRefunds).getByText('Refund payments')).toBeInTheDocument()
    expect(within(linkedRefunds).getByText('1 payment · $20,000.00')).toBeInTheDocument()
    expect(within(linkedRefunds).getByText('First refund payment')).toBeInTheDocument()
    expect(screen.getAllByText('First refund payment')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Add refund payment for Salman Shabbir deposit' }))
    expect(screen.getByLabelText('Deposit activity amount')).toHaveValue(30000)

    fireEvent.change(screen.getByLabelText('Deposit activity amount'), { target: { value: '40000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record refund' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/refund payments for this buyer exceed the received deposit/i)
    expect(onEditIncome).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Deposit activity amount'), { target: { value: '10000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record refund' }))
    await waitFor(() => expect(onEditIncome).toHaveBeenCalledWith(91, expect.objectContaining({
      activities: expect.arrayContaining([
        expect.objectContaining({ id: 'refund-a', amount: 20000, relatedActivityId: 'receipt-a' }),
        expect.objectContaining({ type: 'refund', amount: 10000, relatedActivityId: 'receipt-a' }),
      ]),
    })))
  })

  it('offers a non-monetary cancellation activity and requires its signed document', () => {
    const onEditIncome = vi.fn()
    render(<IncomeSection
      incomes={[{
        id: 91, projectId: 7, description: 'Pre-sale deposit', source: 'Buyer', amount: 300000,
        date: '2026-07-14', type: 'pre_sale_deposit', activities: [], attachments: [],
      }]}
      projects={[{ id: 7, name: 'Tryon Rd' }]}
      onAddIncome={vi.fn()}
      onEditIncome={onEditIncome}
      onDeleteIncome={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Add deposit activity' }))
    fireEvent.change(screen.getByLabelText('Deposit activity type'), { target: { value: 'cancellation' } })
    expect(screen.getByLabelText('Deposit activity amount')).toBeDisabled()
    expect(screen.getByText('Required: signed cancellation agreement')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Deposit activity date'), { target: { value: '2026-08-18' } })
    fireEvent.change(screen.getByLabelText('Deposit activity details'), { target: { value: 'Buyer signed cancellation agreement' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save deposit activity' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/attach the signed cancellation document/i)
    expect(onEditIncome).not.toHaveBeenCalled()
  })

  it('uploads, analyzes, and previews a deposit activity attachment', async () => {
    vi.mocked(extractTransactionFromImage).mockResolvedValueOnce({
      amount: 25000,
      date: '2026-08-12',
      details: 'Buyer cancellation refund under the purchase agreement.',
      description: 'Refund of pre-sale deposit',
      reference: 'CHECK-1104',
      notes: 'Refund approved.',
      lot: 'Lot 2',
    })
    const stored = { documentId: 'doc-refund', name: 'refund-check.pdf', storagePath: '7/refund-check.pdf', mimeType: 'application/pdf' }
    const onUploadDocument = vi.fn().mockResolvedValue(stored)
    const onOpenDocument = vi.fn().mockResolvedValue(undefined)
    render(<IncomeSection
      incomes={[{
        id: 91, projectId: 7, description: 'Pre-sale deposit', source: 'Buyer', amount: 300000,
        date: '2026-07-14', type: 'pre_sale_deposit', activities: [],
      }]}
      projects={[{ id: 7, name: 'Tryon Rd' }]}
      onAddIncome={() => {}}
      onEditIncome={() => {}}
      onDeleteIncome={() => {}}
      onUploadDocument={onUploadDocument}
      onOpenDocument={onOpenDocument}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Add deposit activity' }))
    const file = new File(['refund'], 'refund-check.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Deposit activity document'), { target: { files: [file] } })

    await waitFor(() => expect(screen.getByLabelText('Deposit activity amount')).toHaveValue(25000))
    expect(screen.getByLabelText('Deposit activity date')).toHaveValue('2026-08-12')
    expect(screen.getByLabelText('Deposit activity type')).toHaveValue('refund')
    expect(screen.getByLabelText('Deposit activity lot')).toHaveValue('Lot 2')
    expect(screen.getByLabelText('Deposit activity details').value).toContain('Buyer cancellation refund')
    expect(screen.getByRole('status')).toHaveTextContent(/filled amount, date, details, lot/i)
    expect(extractTransactionFromImage).toHaveBeenCalledWith(file, 'Tryon Rd', 7, { knownLots: ['Lot 1', 'Lot 2', 'Lot 3', 'Lot 4'] })

    fireEvent.click(screen.getByRole('button', { name: 'Preview attachment' }))
    expect(onOpenDocument).toHaveBeenCalledWith(expect.objectContaining({ id: 'doc-refund', name: 'refund-check.pdf' }))
  })

  it('shows the Providence first-advance plan across the three property lots', () => {
    const incomes = [{
      id: 900,
      projectId: 7,
      description: 'Draw 1st',
      source: 'Providence Bank',
      amount: 39000,
      date: '2026-07-14',
      type: 'loan_draw',
      lotBreakdown: [
        { lot: 'Lot 2', address: '5562/5564 Avent Ferry Road', constructionAvailable: 660000, completionPercentage: 2, amount: 13200 },
        { lot: 'Lot 3', address: '5556/5558 Avent Ferry Road', constructionAvailable: 660000, completionPercentage: 2, amount: 13200 },
        { lot: 'Lot 4', address: '5550/5552 Avent Ferry Road', constructionAvailable: 630000, completionPercentage: 2, amount: 12600 },
      ],
    }]

    render(<IncomeSection incomes={incomes} projects={[{ id: 7, name: 'Avent Ferry' }]} onAddIncome={() => {}} onEditIncome={() => {}} onDeleteIncome={() => {}} />)

    const plan = screen.getByRole('heading', { name: 'Providence advances by lot' }).closest('.draw-plan')
    expect(within(plan).getByText('$1,950,000.00')).toBeInTheDocument()
    expect(within(plan).getAllByText('$39,000.00')).toHaveLength(1)
    expect(within(plan).getByText('$1,911,000.00')).toBeInTheDocument()
    expect(within(plan).getByText('5562/5564 Avent Ferry Road')).toBeInTheDocument()
    expect(within(plan).getByText('5556/5558 Avent Ferry Road')).toBeInTheDocument()
    expect(within(plan).getByText('5550/5552 Avent Ferry Road')).toBeInTheDocument()
    expect(within(plan).getByText('Providence loan ••••0784')).toBeInTheDocument()
    expect(within(plan).getByText('Providence loan ••••0786')).toBeInTheDocument()
    expect(within(plan).getByText('Providence loan ••••0792')).toBeInTheDocument()
    expect(within(plan).getAllByText('2%')).toHaveLength(3)
    expect(within(plan).getByText('Next: advance 2')).toBeInTheDocument()
  })

  it('validates required fields and submits a complete income entry', () => {
    const onAddIncome = vi.fn()
    render(<IncomeSection incomes={[]} projects={[{ id: 7, name: 'Main Project' }]} onAddIncome={onAddIncome} onEditIncome={() => {}} onDeleteIncome={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: /add income/i }))
    expect(screen.getByRole('alert')).toHaveTextContent(/enter a description/i)

    fireEvent.change(screen.getByLabelText(/income description/i), { target: { value: 'Closing proceeds' } })
    fireEvent.change(screen.getByLabelText(/income source/i), { target: { value: 'Buyer' } })
    fireEvent.change(screen.getByLabelText(/income amount/i), { target: { value: '125000' } })
    fireEvent.change(screen.getByLabelText(/income date/i), { target: { value: '2026-07-13' } })
    fireEvent.click(screen.getByRole('button', { name: /add income/i }))

    expect(onAddIncome).toHaveBeenCalledWith({
      description: 'Closing proceeds',
      source: 'Buyer',
      amount: 125000,
      date: '2026-07-13',
      type: 'project_income',
      projectId: 7,
      lotBreakdown: [],
      attachments: [],
    })
  })

  it('requires the lot breakdown to add up to the total draw amount for loan draws', async () => {
    const onAddIncome = vi.fn()
    const onUploadDocument = vi.fn().mockResolvedValue({ documentId: 'draw-doc', name: 'advance.pdf', storagePath: '7/advance.pdf', mimeType: 'application/pdf' })
    render(<IncomeSection incomes={[]} projects={[{ id: 7, name: 'Main Project' }]} onAddIncome={onAddIncome} onEditIncome={() => {}} onDeleteIncome={() => {}} onUploadDocument={onUploadDocument} />)

    fireEvent.change(screen.getByLabelText(/income description/i), { target: { value: 'Providence draw 1' } })
    fireEvent.change(screen.getByLabelText(/income source/i), { target: { value: 'Providence Bank' } })
    fireEvent.change(screen.getByLabelText(/income amount/i), { target: { value: '90000' } })
    fireEvent.change(screen.getByLabelText(/income date/i), { target: { value: '2026-07-16' } })
    fireEvent.change(screen.getByLabelText('Income type'), { target: { value: 'loan_draw' } })
    fireEvent.change(screen.getByLabelText('Upload loan draw sheet'), { target: { files: [new File(['advance'], 'advance.pdf', { type: 'application/pdf' })] } })
    await screen.findByText('Attached: advance.pdf')

    fireEvent.change(screen.getByLabelText('Lot 2 draw amount'), { target: { value: '30000' } })
    fireEvent.change(screen.getByLabelText('Lot 3 draw amount'), { target: { value: '30000' } })
    fireEvent.click(screen.getByRole('button', { name: /add income/i }))

    expect(screen.getByRole('alert')).toHaveTextContent(/must add up to the total draw amount/i)
    expect(onAddIncome).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Lot 4 draw amount'), { target: { value: '30000' } })
    fireEvent.click(screen.getByRole('button', { name: /add income/i }))

    expect(onAddIncome).toHaveBeenCalledWith({
      description: 'Providence draw 1',
      source: 'Providence Bank',
      amount: 90000,
      date: '2026-07-16',
      type: 'loan_draw',
      projectId: 7,
      lotBreakdown: [
        { lot: 'Lot 2', amount: 30000 },
        { lot: 'Lot 3', amount: 30000 },
        { lot: 'Lot 4', amount: 30000 },
      ],
      attachments: [expect.objectContaining({ id: 'draw-doc', name: 'advance.pdf' })],
    })
  })

  it('allows a supporting attachment on non-draw income without running draw analysis', async () => {
    const onAddIncome = vi.fn()
    const stored = { documentId: 'income-doc', name: 'bank-record.pdf', storagePath: '7/bank-record.pdf', mimeType: 'application/pdf' }
    const onUploadDocument = vi.fn().mockResolvedValue(stored)
    const onOpenDocument = vi.fn().mockResolvedValue(undefined)
    const drawAnalysisCalls = vi.mocked(extractLoanDrawFromDocument).mock.calls.length
    render(<IncomeSection incomes={[]} projects={[{ id: 7, name: 'Main Project' }]} onAddIncome={onAddIncome} onEditIncome={() => {}} onDeleteIncome={() => {}} onUploadDocument={onUploadDocument} onOpenDocument={onOpenDocument} />)

    expect(screen.getByLabelText('Upload income attachment')).toBeInTheDocument()
    const file = new File(['bank record'], 'bank-record.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Upload income attachment'), { target: { files: [file] } })
    await screen.findByText('Attached: bank-record.pdf')
    fireEvent.click(screen.getByRole('button', { name: 'Preview attachment' }))
    expect(onOpenDocument).toHaveBeenCalledWith(expect.objectContaining({ id: 'income-doc', name: 'bank-record.pdf' }))

    fireEvent.change(screen.getByLabelText(/income description/i), { target: { value: 'Interest income' } })
    fireEvent.change(screen.getByLabelText(/income source/i), { target: { value: 'Bank' } })
    fireEvent.change(screen.getByLabelText(/income amount/i), { target: { value: '125' } })
    fireEvent.change(screen.getByLabelText(/income date/i), { target: { value: '2026-08-20' } })
    fireEvent.click(screen.getByRole('button', { name: /add income/i }))

    expect(onUploadDocument).toHaveBeenCalledWith(file)
    expect(vi.mocked(extractLoanDrawFromDocument).mock.calls).toHaveLength(drawAnalysisCalls)
    expect(onAddIncome).toHaveBeenCalledWith(expect.objectContaining({
      type: 'project_income',
      attachments: [expect.objectContaining({ id: 'income-doc', name: 'bank-record.pdf' })],
    }))
  })

  it('requires an uploaded and analyzed document before saving a loan advance', () => {
    const onAddIncome = vi.fn()
    render(<IncomeSection incomes={[]} projects={[{ id: 7, name: 'Main Project' }]} onAddIncome={onAddIncome} onEditIncome={() => {}} onDeleteIncome={() => {}} />)

    fireEvent.change(screen.getByLabelText(/income description/i), { target: { value: 'Providence advance 2' } })
    fireEvent.change(screen.getByLabelText(/income source/i), { target: { value: 'Providence Bank' } })
    fireEvent.change(screen.getByLabelText(/income amount/i), { target: { value: '30000' } })
    fireEvent.change(screen.getByLabelText(/income date/i), { target: { value: '2026-08-20' } })
    fireEvent.change(screen.getByLabelText('Income type'), { target: { value: 'loan_draw' } })
    fireEvent.change(screen.getByLabelText('Lot 2 draw amount'), { target: { value: '10000' } })
    fireEvent.change(screen.getByLabelText('Lot 3 draw amount'), { target: { value: '10000' } })
    fireEvent.change(screen.getByLabelText('Lot 4 draw amount'), { target: { value: '10000' } })
    fireEvent.click(screen.getByRole('button', { name: /add income/i }))

    expect(screen.getByRole('alert')).toHaveTextContent(/attach and analyze the draw or inspection document/i)
    expect(onAddIncome).not.toHaveBeenCalled()
  })

  it('shows a prominent "not saved yet" banner after uploading a draw sheet, until the form is actually submitted', async () => {
    const onAddIncome = vi.fn()
    const onUploadDocument = vi.fn().mockResolvedValue({
      documentId: 'doc-1', storageBucket: 'accounting-documents', storagePath: '7/draw-sheet.pdf', name: 'draw-sheet.pdf', mimeType: 'application/pdf', size: 100,
    })
    render(<IncomeSection incomes={[]} projects={[{ id: 7, name: 'Main Project' }]} onAddIncome={onAddIncome} onEditIncome={() => {}} onDeleteIncome={() => {}} onUploadDocument={onUploadDocument} />)

    fireEvent.change(screen.getByLabelText('Income type'), { target: { value: 'loan_draw' } })
    expect(screen.queryByText(/Not saved yet/)).not.toBeInTheDocument()

    const file = new File(['draw'], 'draw-sheet.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Upload loan draw sheet'), { target: { files: [file] } })

    expect(await screen.findByText(/Not saved yet/)).toBeInTheDocument()
    expect(screen.getByText('Attached: draw-sheet.pdf')).toBeInTheDocument()
    expect(extractLoanDrawFromDocument).toHaveBeenCalledWith(file, 7, [])

    fireEvent.change(screen.getByLabelText(/income description/i), { target: { value: 'Providence draw 2' } })
    fireEvent.change(screen.getByLabelText(/income source/i), { target: { value: 'Providence Bank' } })
    fireEvent.change(screen.getByLabelText(/income amount/i), { target: { value: '30000' } })
    fireEvent.change(screen.getByLabelText(/income date/i), { target: { value: '2026-07-18' } })
    fireEvent.change(screen.getByLabelText('Lot 2 draw amount'), { target: { value: '10000' } })
    fireEvent.change(screen.getByLabelText('Lot 3 draw amount'), { target: { value: '10000' } })
    fireEvent.change(screen.getByLabelText('Lot 4 draw amount'), { target: { value: '10000' } })
    fireEvent.click(screen.getByRole('button', { name: /add income/i }))

    expect(onAddIncome).toHaveBeenCalledWith(expect.objectContaining({
      attachments: [expect.objectContaining({ id: 'doc-1', name: 'draw-sheet.pdf' })],
    }))
    await waitFor(() => expect(screen.queryByText(/Not saved yet/)).not.toBeInTheDocument())
  })

  it('splits the amount evenly across the 3 lots, absorbing the rounding remainder in the last lot', async () => {
    const onAddIncome = vi.fn()
    const onUploadDocument = vi.fn().mockResolvedValue({ documentId: 'draw-doc', name: 'advance.pdf', storagePath: '7/advance.pdf', mimeType: 'application/pdf' })
    render(<IncomeSection incomes={[]} projects={[{ id: 7, name: 'Main Project' }]} onAddIncome={onAddIncome} onEditIncome={() => {}} onDeleteIncome={() => {}} onUploadDocument={onUploadDocument} />)

    fireEvent.change(screen.getByLabelText(/income description/i), { target: { value: 'Land Clearing for all 3 lots' } })
    fireEvent.change(screen.getByLabelText(/income source/i), { target: { value: 'Providence Bank' } })
    fireEvent.change(screen.getByLabelText(/income amount/i), { target: { value: '39600' } })
    fireEvent.change(screen.getByLabelText(/income date/i), { target: { value: '2026-07-16' } })
    fireEvent.change(screen.getByLabelText('Income type'), { target: { value: 'loan_draw' } })
    fireEvent.change(screen.getByLabelText('Upload loan draw sheet'), { target: { files: [new File(['advance'], 'advance.pdf', { type: 'application/pdf' })] } })
    await screen.findByText('Attached: advance.pdf')

    fireEvent.click(screen.getByRole('button', { name: 'Split evenly' }))

    expect(screen.getByLabelText('Lot 2 draw amount')).toHaveValue(13200)
    expect(screen.getByLabelText('Lot 3 draw amount')).toHaveValue(13200)
    expect(screen.getByLabelText('Lot 4 draw amount')).toHaveValue(13200)

    fireEvent.click(screen.getByRole('button', { name: /add income/i }))

    expect(onAddIncome).toHaveBeenCalledWith(expect.objectContaining({
      lotBreakdown: [
        { lot: 'Lot 2', amount: 13200 },
        { lot: 'Lot 3', amount: 13200 },
        { lot: 'Lot 4', amount: 13200 },
      ],
    }))
  })

  it('blocks splitting evenly until a valid amount is entered', () => {
    render(<IncomeSection incomes={[]} projects={[{ id: 7, name: 'Main Project' }]} onAddIncome={() => {}} onEditIncome={() => {}} onDeleteIncome={() => {}} />)

    fireEvent.change(screen.getByLabelText('Income type'), { target: { value: 'loan_draw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Split evenly' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/enter a valid income amount before splitting/i)
  })

  it('shows how much of a draw has been spent via checks, and what is left over', () => {
    const incomes = [{
      id: 900,
      projectId: 7,
      description: 'Land Clearing for all 3 lots',
      source: 'Providence Bank',
      amount: 39600,
      date: '2026-07-16',
      type: 'loan_draw',
      lotBreakdown: [
        { lot: 'Lot 2', amount: 13200 },
        { lot: 'Lot 3', amount: 13200 },
        { lot: 'Lot 4', amount: 13200 },
      ],
    }]
    const checks = [
      { id: 1, projectId: 7, checkNumber: '1042', payee: 'Triangle Concrete', memo: 'Lot 2 clearing', lot: 'Lot 2', fundedByIncomeId: 900, amount: 5000, status: 'printed' },
      { id: 2, projectId: 7, checkNumber: '1043', payee: 'Someone else', fundedByIncomeId: 900, amount: 3000, status: 'voided' },
    ]

    render(<IncomeSection
      incomes={incomes}
      checks={checks}
      projects={[{ id: 7, name: 'Main Project' }]}
      onAddIncome={() => {}}
      onEditIncome={() => {}}
      onDeleteIncome={() => {}}
    />)

    expect(screen.queryByLabelText('Draw details for Land Clearing for all 3 lots')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit income' })).not.toBeInTheDocument()
    const summary = screen.getByRole('button', { name: 'View draw details' })
    expect(summary).toHaveTextContent('Land Clearing for all 3 lots')
    expect(summary).toHaveTextContent('2026-07-16 · Providence Bank · 3 lots')
    fireEvent.click(summary)

    const details = screen.getByLabelText('Draw details for Land Clearing for all 3 lots')
    expect(within(details).getByText('Spent so far').parentElement).toHaveTextContent('$5,000.00')
    expect(within(details).getByText('Left from this draw').parentElement).toHaveTextContent('$34,600.00')
    expect(within(details).getByRole('button', { name: 'Edit income' })).toBeInTheDocument()
    expect(screen.getByText('#1042 · Triangle Concrete · Lot 2 clearing · Lot 2')).toBeInTheDocument()
    expect(screen.queryByText(/1043/)).not.toBeInTheDocument()
  })

  it('shows a placeholder when no checks are tagged to a draw yet', () => {
    const incomes = [{
      id: 901,
      projectId: 7,
      description: 'Fresh draw',
      source: 'Providence Bank',
      amount: 10000,
      date: '2026-07-16',
      type: 'loan_draw',
      lotBreakdown: [],
    }]

    render(<IncomeSection
      incomes={incomes}
      projects={[{ id: 7, name: 'Main Project' }]}
      onAddIncome={() => {}}
      onEditIncome={() => {}}
      onDeleteIncome={() => {}}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'View draw details' }))

    expect(screen.getByText('No checks tagged to this draw yet.')).toBeInTheDocument()
  })
})
