import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import BankDashboard from './BankDashboard'

const transactions = [
  {
    id: 'credit-1',
    bank: 'boa',
    owner: 'Banu U',
    date: '2026-01-02',
    description: 'Owner funding',
    amount: 1000,
    sourceName: 'January statement',
    category: 'Owner Contribution',
    phase: 'Funding',
    transactionType: 'Credit',
    isOwnerContribution: true,
    reviewReasons: [],
  },
  {
    id: 'check-1',
    bank: 'boa',
    owner: 'Kemal I',
    date: '2026-01-05',
    description: 'Concrete contractor',
    amount: -450,
    sourceName: 'January statement',
    category: 'General Contractor',
    phase: 'Construction',
    transactionType: 'Check',
    reviewReasons: ['spreadsheet marked for review'],
  },
  {
    id: 'fee-1',
    bank: 'boa',
    owner: 'Banu U',
    date: '2026-01-06',
    description: 'Monthly bank fee',
    amount: -12,
    sourceName: 'January statement',
    category: 'Bank Fees',
    phase: 'Overhead',
    transactionType: 'Fee',
    reviewReasons: [],
  },
  {
    id: 'software-fee-1',
    bank: 'boa',
    owner: 'Project / Unassigned',
    date: '2026-01-07',
    description: 'Lovable (software)',
    amount: -20,
    sourceName: 'January statement',
    category: 'Software & Technology (Overhead)',
    phase: 'Overhead',
    transactionType: 'Debit',
    reviewReasons: [],
  },
  {
    id: 'loan-1',
    bank: 'boa',
    owner: 'GreenFort',
    date: '2026-01-08',
    description: 'Providence Bank — GreenFort loan payment',
    amount: -3017,
    sourceName: 'January statement',
    category: 'Financing',
    phase: 'Development',
    transactionType: 'Debit',
    memo: 'PROVIDENCE BANK DES:AT TRNSFER',
    reviewReasons: [],
  },
]

describe('BankDashboard filters', () => {
  it('separates pending and classified transactions into collapsible menus', () => {
    render(<BankDashboard transactions={transactions} onImport={vi.fn()} onChangeOwner={vi.fn()} onRemove={vi.fn()} />)

    expect(screen.getByText('Needs approval').closest('details')).toHaveAttribute('open')
    expect(screen.getByText('Approved / classified').closest('details')).not.toHaveAttribute('open')
  })

  it('filters checks and restores all transactions', () => {
    render(<BankDashboard transactions={transactions} onImport={vi.fn()} onChangeOwner={vi.fn()} onRemove={vi.fn()} />)

    fireEvent.change(screen.getByLabelText(/filter transaction type/i), { target: { value: 'check' } })

    expect(screen.getByText('Concrete contractor')).toBeInTheDocument()
    expect(screen.queryByText('Owner funding')).not.toBeInTheDocument()
    expect(screen.getByText('Transactions shown').nextSibling).toHaveTextContent('1')

    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }))

    expect(screen.getByText('Owner funding')).toBeInTheDocument()
    expect(screen.getByText('Monthly bank fee')).toBeInTheDocument()
  })

  it('combines search and review-status filters', () => {
    render(<BankDashboard transactions={transactions} onImport={vi.fn()} onChangeOwner={vi.fn()} onRemove={vi.fn()} />)

    fireEvent.change(screen.getByLabelText(/search bank transactions/i), { target: { value: 'contractor' } })
    fireEvent.change(screen.getByLabelText(/filter review status/i), { target: { value: 'review' } })

    expect(screen.getByText('Concrete contractor')).toBeInTheDocument()
    expect(screen.queryByText('Monthly bank fee')).not.toBeInTheDocument()
    const reviewSummary = screen.getAllByText('Needs review').find((element) => element.tagName === 'SPAN')
    expect(reviewSummary.nextSibling).toHaveTextContent('1')
  })

  it('counts bank fees and software services such as Lovable as fees', () => {
    render(<BankDashboard transactions={transactions} onImport={vi.fn()} onChangeOwner={vi.fn()} onRemove={vi.fn()} />)

    fireEvent.change(screen.getByLabelText(/filter transaction type/i), { target: { value: 'fee' } })

    expect(screen.getByText('Monthly bank fee')).toBeInTheDocument()
    expect(screen.getByText('Lovable (software)')).toBeInTheDocument()
    expect(screen.queryByText('Concrete contractor')).not.toBeInTheDocument()
    expect(screen.getByText('Fees (2)').nextSibling).toHaveTextContent('$32.00')
  })

  it('separates Providence Bank payments as GreenFort loan payments', () => {
    render(<BankDashboard transactions={transactions} onImport={vi.fn()} onChangeOwner={vi.fn()} onRemove={vi.fn()} />)

    fireEvent.change(screen.getByLabelText(/filter transaction type/i), { target: { value: 'loan' } })

    expect(screen.getByText('Providence Bank — GreenFort loan payment')).toBeInTheDocument()
    expect(screen.queryByText('Concrete contractor')).not.toBeInTheDocument()
    expect(screen.getByText('Loan payments (1)').nextSibling).toHaveTextContent('$3,017.00')
  })

  it('lets the user approve a category for an uncertain transaction', () => {
    const onApproveCategory = vi.fn()
    render(
      <BankDashboard
        transactions={transactions}
        onImport={vi.fn()}
        onChangeOwner={vi.fn()}
        onApproveCategory={onApproveCategory}
        onRemove={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText('Category for Concrete contractor'), { target: { value: 'General Contractor' } })
    fireEvent.click(screen.getByRole('button', { name: /approve category/i }))

    expect(onApproveCategory).toHaveBeenCalledWith('check-1', 'General Contractor')
  })
})
