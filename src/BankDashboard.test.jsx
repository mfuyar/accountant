import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  it('shows stored original statements with preview and download controls', () => {
    const statement = {
      documentId: 'statement-1',
      name: 'eStmt_2026-07-31.pdf',
      mimeType: 'application/pdf',
      size: 192978,
      createdAt: '2026-08-18T14:47:14Z',
      bank: 'boa',
    }
    const onOpenStatement = vi.fn()
    const onDownloadStatement = vi.fn()

    render(<BankDashboard
      transactions={[]}
      statements={[statement]}
      onImport={vi.fn()}
      onChangeOwner={vi.fn()}
      onOpenStatement={onOpenStatement}
      onDownloadStatement={onDownloadStatement}
    />)

    expect(screen.getByText('Original bank statements')).toBeInTheDocument()
    expect(screen.getByText('eStmt_2026-07-31.pdf')).toBeInTheDocument()
    expect(screen.getAllByText('Providence Bank').length).toBeGreaterThan(0)
    expect(screen.getAllByText('American Express').length).toBeGreaterThan(0)
    expect(screen.getByText('Original bank statements').closest('details')).not.toHaveAttribute('open')
    fireEvent.click(screen.getByText('Original bank statements').closest('summary'))
    expect(screen.getByText('Original bank statements').closest('details')).toHaveAttribute('open')
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    expect(onOpenStatement).toHaveBeenCalledWith(statement)
    expect(onDownloadStatement).toHaveBeenCalledWith(statement)
  })

  it('previews the matching original statement from a transaction row', () => {
    const statement = {
      documentId: 'statement-1',
      name: 'January statement',
      originalName: 'January statement',
      bank: 'boa',
      mimeType: 'application/pdf',
    }
    const onOpenStatement = vi.fn()

    render(<BankDashboard
      transactions={[transactions[0]]}
      statements={[statement]}
      onImport={vi.fn()}
      onChangeOwner={vi.fn()}
      onOpenStatement={onOpenStatement}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Preview statement' }))
    expect(onOpenStatement).toHaveBeenCalledWith(statement)
  })

  it('matches same-named statement files by bank as well as filename', () => {
    const boaStatement = { documentId: 'boa-1', name: 'statement.pdf', bank: 'boa' }
    const amexStatement = { documentId: 'amex-1', name: 'statement.pdf', bank: 'amex' }
    const onOpenStatement = vi.fn()
    render(<BankDashboard
      transactions={[{ ...transactions[0], bank: 'amex', sourceName: 'statement.pdf' }]}
      statements={[boaStatement, amexStatement]}
      onImport={vi.fn()}
      onChangeOwner={vi.fn()}
      onOpenStatement={onOpenStatement}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Preview statement' }))
    expect(onOpenStatement).toHaveBeenCalledWith(amexStatement)
  })

  it('connects Bank of America through Plaid and performs the first transaction sync', async () => {
    const onFetchConnections = vi.fn().mockResolvedValue({ configured: true, connections: [] })
    const onCreateLinkToken = vi.fn().mockResolvedValue({ linkToken: 'link-token' })
    const onExchangePublicToken = vi.fn().mockResolvedValue({ connection: { id: 'connection-1', institutionName: 'Bank of America' } })
    const onSyncConnection = vi.fn().mockResolvedValue({ added: 2, modified: 0, removed: 0 })
    const destroy = vi.fn()
    const onLoadPlaidLink = vi.fn().mockResolvedValue({
      create: (options) => ({ open: () => options.onSuccess('public-token', { institution: { name: 'Bank of America' } }), destroy }),
    })

    render(<BankDashboard
      projectId={1}
      transactions={[]}
      onImport={vi.fn()}
      onChangeOwner={vi.fn()}
      onApproveCategory={vi.fn()}
      canConnect
      onFetchConnections={onFetchConnections}
      onCreateLinkToken={onCreateLinkToken}
      onExchangePublicToken={onExchangePublicToken}
      onLoadPlaidLink={onLoadPlaidLink}
      onSyncConnection={onSyncConnection}
      onDisconnectConnection={vi.fn()}
    />)

    fireEvent.click(await screen.findByRole('button', { name: 'Connect Bank of America' }))

    await waitFor(() => expect(onExchangePublicToken).toHaveBeenCalledWith('public-token', 'Bank of America'))
    expect(onSyncConnection).toHaveBeenCalledWith('connection-1')
    expect(await screen.findByText(/Bank of America connected/i)).toBeInTheDocument()
  })

  it('shows connected account balances and allows a manual sync', async () => {
    const connection = {
      id: 'connection-1',
      institutionName: 'Bank of America',
      accounts: [{ id: 'account-1', name: 'Business Checking', mask: '1234', currentBalance: 4567.89 }],
      lastSyncedAt: '2026-08-16T12:00:00Z',
    }
    const onSyncConnection = vi.fn().mockResolvedValue({ added: 1, modified: 2, removed: 0 })
    render(<BankDashboard
      projectId={1}
      transactions={[]}
      onImport={vi.fn()}
      onChangeOwner={vi.fn()}
      onApproveCategory={vi.fn()}
      canConnect
      onFetchConnections={vi.fn().mockResolvedValue({ configured: true, connections: [connection] })}
      onCreateLinkToken={vi.fn()}
      onExchangePublicToken={vi.fn()}
      onLoadPlaidLink={vi.fn()}
      onSyncConnection={onSyncConnection}
      onDisconnectConnection={vi.fn()}
    />)

    expect(await screen.findByText(/Business Checking ••1234/)).toHaveTextContent('$4,567.89')
    fireEvent.click(screen.getByRole('button', { name: 'Sync transactions' }))
    await waitFor(() => expect(onSyncConnection).toHaveBeenCalledWith('connection-1'))
    expect(await screen.findByText(/1 new, 2 updated, and 0 removed/i)).toBeInTheDocument()
  })

  it('separates pending and classified transactions into collapsible menus', () => {
    render(<BankDashboard transactions={transactions} onImport={vi.fn()} onChangeOwner={vi.fn()} onRemove={vi.fn()} />)

    expect(screen.getByText('Needs approval').closest('details')).toHaveAttribute('open')
    expect(screen.getByText('Approved / classified').closest('details')).not.toHaveAttribute('open')
  })

  it('shows the raw bank detail needed to identify a transaction', () => {
    render(<BankDashboard
      transactions={[{
        ...transactions[0],
        description: 'Incoming funds',
        memo: 'Mobile transfer Confirmation# s6nl0xgo4; ILTER, KEMAL',
        rawDescription: 'Mobile transfer Confirmation# s6nl0xgo4; ILTER, KEMAL',
        account: 'Business Checking ••6481',
      }]}
      onImport={vi.fn()}
      onChangeOwner={vi.fn()}
    />)

    expect(screen.getByText(/Bank detail:/).closest('small')).toHaveTextContent('Confirmation# s6nl0xgo4; ILTER, KEMAL')
    expect(screen.getByText(/Account:/).closest('small')).toHaveTextContent('Business Checking ••6481')
    expect(screen.getAllByText(/Confirmation# s6nl0xgo4/)).toHaveLength(1)
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

  it('shows self-payee checks between BOFA and Flagstar as account transfers, not checks', () => {
    const transfer = {
      id: 'transfer-1', bank: 'boa', owner: 'GreenFort', date: '2026-01-09',
      description: 'Green Fort LLC', amount: -7500, sourceName: 'January statement',
      category: 'Bank Transfer', transactionType: 'Check', reviewReasons: [],
    }
    render(<BankDashboard transactions={[...transactions, transfer]} onImport={vi.fn()} onChangeOwner={vi.fn()} onRemove={vi.fn()} />)

    fireEvent.change(screen.getByLabelText(/filter transaction type/i), { target: { value: 'transfer' } })

    expect(screen.getByText('Green Fort LLC')).toBeInTheDocument()
    expect(screen.queryByText('Concrete contractor')).not.toBeInTheDocument()
    expect(screen.getByText('Account transfers (1)').nextSibling).toHaveTextContent('$7,500.00')
    expect(screen.getByText(/Bank of America.*Account transfer.*January statement/)).toBeInTheDocument()
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

  it('offers Bank Cash Back as an approval category', () => {
    render(<BankDashboard
      transactions={transactions}
      onImport={vi.fn()}
      onChangeOwner={vi.fn()}
      onApproveCategory={vi.fn()}
    />)

    expect(screen.getByLabelText('Category for Concrete contractor')).toHaveTextContent('Bank Cash Back')
  })

  it('reviews BOFA debits with Soft Cost first and posts the selected classification', async () => {
    const debit = transactions.find((item) => item.id === 'check-1')
    const onPostDebitCosts = vi.fn().mockResolvedValue({ posted: 1, excluded: 0, existing: 0 })
    render(<BankDashboard
      transactions={[debit]}
      onImport={vi.fn()}
      onChangeOwner={vi.fn()}
      ledgerCosts={[]}
      onPostDebitCosts={onPostDebitCosts}
    />)

    expect(screen.getByRole('heading', { name: 'Review every Bank of America debit' })).toBeInTheDocument()
    const choices = screen.getByRole('group', { name: 'Cost classification' })
    expect(choices.querySelector('label span')).toHaveTextContent('Soft Cost')

    fireEvent.click(screen.getByLabelText('Select debit Concrete contractor'))
    fireEvent.click(screen.getByLabelText('Soft Cost for Concrete contractor'))
    fireEvent.click(screen.getByRole('button', { name: 'Post selected to ledger (1)' }))

    await waitFor(() => expect(onPostDebitCosts).toHaveBeenCalledWith([{
      transaction: debit,
      classification: 'soft_cost',
    }]))
    expect(await screen.findByText(/1 debit added to the real cost ledger/i)).toBeInTheDocument()
  })
})
