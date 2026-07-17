import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import IncomeSection from './IncomeSection'

describe('IncomeSection', () => {
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
    render(<IncomeSection incomes={[]} projects={[{ id: 7, name: 'Main Project' }]} onAddIncome={onAddIncome} onEditIncome={() => {}} onDeleteIncome={() => {}} />)

    fireEvent.change(screen.getByLabelText(/income description/i), { target: { value: 'Providence draw 1' } })
    fireEvent.change(screen.getByLabelText(/income source/i), { target: { value: 'Providence Bank' } })
    fireEvent.change(screen.getByLabelText(/income amount/i), { target: { value: '90000' } })
    fireEvent.change(screen.getByLabelText(/income date/i), { target: { value: '2026-07-16' } })
    fireEvent.change(screen.getByLabelText('Income type'), { target: { value: 'loan_draw' } })

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
      attachments: [],
    })
  })

  it('splits the amount evenly across the 3 lots, absorbing the rounding remainder in the last lot', () => {
    const onAddIncome = vi.fn()
    render(<IncomeSection incomes={[]} projects={[{ id: 7, name: 'Main Project' }]} onAddIncome={onAddIncome} onEditIncome={() => {}} onDeleteIncome={() => {}} />)

    fireEvent.change(screen.getByLabelText(/income description/i), { target: { value: 'Land Clearing for all 3 lots' } })
    fireEvent.change(screen.getByLabelText(/income source/i), { target: { value: 'Providence Bank' } })
    fireEvent.change(screen.getByLabelText(/income amount/i), { target: { value: '39600' } })
    fireEvent.change(screen.getByLabelText(/income date/i), { target: { value: '2026-07-16' } })
    fireEvent.change(screen.getByLabelText('Income type'), { target: { value: 'loan_draw' } })

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

    fireEvent.click(screen.getByRole('button', { name: 'View draw details' }))

    expect(screen.getByText('Spent so far: $5,000.00')).toBeInTheDocument()
    expect(screen.getByText('Left from this draw: $34,600.00')).toBeInTheDocument()
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
