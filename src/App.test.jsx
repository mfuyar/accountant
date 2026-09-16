import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App, { getConstructionLotCostTotals, getCostAmountForLotFilter, getPhaseTotalsForLotFilter, getTopLevelPhaseCostTotals, splitExistingLotAllocationsEvenly } from './App'
import ClassificationPage from './ClassificationPage'
import { extractTransactionFromImage } from './lib/gemini'

describe('App', () => {
  it('rebalances an increased parent total evenly across its existing lots', () => {
    expect(splitExistingLotAllocationsEvenly(424238, [
      { lot: 'Lot 1', amount: 105695 }, { lot: 'Lot 2', amount: 105695 },
      { lot: 'Lot 3', amount: 105695 }, { lot: 'Lot 4', amount: 105695 },
    ])).toEqual([
      { lot: 'Lot 1', amount: 106059.5 }, { lot: 'Lot 2', amount: 106059.5 },
      { lot: 'Lot 3', amount: 106059.5 }, { lot: 'Lot 4', amount: 106059.5 },
    ])
  })

  it('returns only the selected lot portion of a shared cost', () => {
    const cost = { amount: 42954, lotAllocations: [{ lot: 'Lot 1', amount: 10501 }, { lot: 'Lot 2', amount: 10966 }, { lot: 'Lot 3', amount: 10872 }, { lot: 'Lot 4', amount: 10615 }] }
    expect(getCostAmountForLotFilter(cost, 'Lot 1')).toBe(10501)
    expect(getCostAmountForLotFilter(cost, 'Lot 3')).toBe(10872)
    expect(getCostAmountForLotFilter(cost, 'all')).toBe(42954)
    expect(getCostAmountForLotFilter(cost, 'unassigned')).toBe(0)
    expect(getPhaseTotalsForLotFilter([
      { ...cost, phase: 'development' },
      { amount: 4000, phase: 'construction', lotAllocations: [{ lot: 'Lot 1', amount: 1000 }] },
    ], 'Lot 1')).toEqual({ development: 10501, construction: 1000 })
  })

  it('builds budget actuals from top-level costs by phase without double-counting breakdowns', () => {
    expect(getTopLevelPhaseCostTotals([
      { costId: 'development-parent', phase: 'development', amount: 100000, parentCostId: null },
      { costId: 'engineering-breakdown', phase: 'development', amount: 25000, parentCostId: 'development-parent' },
      { costId: 'foundation', phase: 'construction', amount: 75000, parentCostId: null },
      { costId: 'closing', phase: 'soft_cost', amount: 10000, parentCostId: null },
    ])).toEqual({ development: 100000, construction: 75000, soft_cost: 10000 })
  })

  it('builds separate construction actuals for all four lots and keeps unassigned costs visible', () => {
    expect(getConstructionLotCostTotals([
      { costId: 'permit', phase: 'construction', amount: 40000, parentCostId: null, lotAllocations: [{ lot: 'Lot 1', amount: 10000 }, { lot: 'Lot 2', amount: 12000 }, { lot: 'Lot 3', amount: 8000 }, { lot: 'Lot 4', amount: 10000 }] },
      { costId: 'foundation', phase: 'construction', amount: 25000, parentCostId: null, lotAllocations: [{ lot: 'Lot 3', amount: 20000 }] },
      { costId: 'foundation-detail', phase: 'construction', amount: 5000, parentCostId: 'foundation', lotAllocations: [{ lot: 'Lot 3', amount: 5000 }] },
      { costId: 'land', phase: 'development', amount: 100000, parentCostId: null, lotAllocations: [{ lot: 'Lot 1', amount: 25000 }] },
    ])).toEqual({
      byLot: { 'Lot 1': 10000, 'Lot 2': 12000, 'Lot 3': 28000, 'Lot 4': 10000 },
      unassigned: 5000,
    })
  })
  it('hides only the add-cost form while keeping saved costs visible', () => {
    render(<App />)

    const panel = screen.getByRole('heading', { name: 'Costs by owner and phase' }).closest('.panel')
    const toggle = within(panel).getByRole('button', { name: 'Hide add-cost form' })
    expect(within(panel).getByLabelText(/^cost name$/i)).toBeInTheDocument()
    expect(within(panel).getByText('Owner cost total')).toBeInTheDocument()

    fireEvent.click(toggle)
    expect(within(panel).queryByLabelText(/^cost name$/i)).not.toBeInTheDocument()
    expect(within(panel).getByText('Owner cost total')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Add a cost' })).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(within(panel).getByRole('button', { name: 'Add a cost' }))
    expect(within(panel).getByLabelText(/^cost name$/i)).toBeInTheDocument()
  })

  it('lets a user add a new owner contribution', () => {
    render(<App />)

    fireEvent.change(screen.getByLabelText(/owner name/i), {
      target: { value: 'New Project Owner' },
    })
    fireEvent.change(screen.getByLabelText(/contribution amount/i), {
      target: { value: '450000' },
    })
    fireEvent.click(screen.getByRole('button', { name: /add owner/i }))

    expect(screen.getByText('New Project Owner', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getAllByText(/450,000/i)).not.toHaveLength(0)
  })

  it('imports invoice details and keeps the extracted values visible', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /open intake page/i }))

    fireEvent.change(screen.getByLabelText(/invoice details/i), {
      target: {
        value: 'Invoice #INV-1001\nVendor: Horizon Concrete\nAmount: $12,500\nDescription: Concrete delivery for site prep',
      },
    })
    fireEvent.click(screen.getByRole('button', { name: /import invoice/i }))

    expect(await screen.findByText('INV-1001', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText(/\$12,500/i)).toBeInTheDocument()
    expect(screen.getByText(/Concrete/i)).toBeInTheDocument()
  })

  it('lets a user add owner-specific costs such as loan interest', () => {
    render(<App />)

    fireEvent.change(screen.getByLabelText(/owner name/i), { target: { value: 'Cost Owner' } })
    fireEvent.change(screen.getByLabelText(/contribution amount/i), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: /add owner/i }))
    fireEvent.change(screen.getByLabelText(/^cost name$/i), {
      target: { value: 'Personal loan interest' },
    })
    fireEvent.change(screen.getByLabelText(/^cost amount$/i), {
      target: { value: '1250' },
    })
    fireEvent.change(screen.getByLabelText(/^invoice date$/i), {
      target: { value: '2026-07-13' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^add cost$/i }))

    expect(screen.getAllByText(/Personal loan interest/i)).not.toHaveLength(0)
    expect(screen.getAllByText(/\$1,250/i)).not.toHaveLength(0)
    const savedCostsCard = screen.getByText('Saved costs').closest('.summary-card')
    expect(within(savedCostsCard).getByText(/\$1,250/i)).toBeInTheDocument()
  })

  it('opens a preselected breakdown form from the project dashboard', () => {
    render(<App />)

    fireEvent.change(screen.getByLabelText(/owner name/i), { target: { value: 'Banu U' } })
    fireEvent.change(screen.getByLabelText(/contribution amount/i), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: /add owner/i }))
    fireEvent.change(screen.getByLabelText(/^cost name$/i), { target: { value: 'All Development Cost' } })
    fireEvent.change(screen.getByLabelText(/^cost amount$/i), { target: { value: '372854' } })
    fireEvent.change(screen.getByLabelText(/^invoice date$/i), { target: { value: '2026-07-14' } })
    fireEvent.click(screen.getByRole('button', { name: /^add cost$/i }))

    const overviewPanel = screen.getByRole('heading', { name: 'Overview' }).closest('.panel')
    fireEvent.click(within(overviewPanel).getByRole('button', { name: 'Add breakdown' }))

    expect(screen.getByRole('heading', { name: /new breakdown for all development cost/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Parent cost').value).not.toBe('')
  })

  it('lets users switch overview costs between card and list views', () => {
    render(<App />)

    const overview = screen.getByRole('heading', { name: 'Overview' }).closest('.panel')
    const cardsButton = within(overview).getByRole('button', { name: 'Cards' })
    const listButton = within(overview).getByRole('button', { name: 'List' })
    expect(cardsButton).toHaveAttribute('aria-pressed', 'true')
    expect(overview.querySelector('.overview-cost-grid')).not.toHaveClass('is-list')
    fireEvent.click(listButton)
    expect(listButton).toHaveAttribute('aria-pressed', 'true')
    expect(within(overview).getByRole('table', { name: 'Overview cost list' })).toBeInTheDocument()
    expect(within(overview).getByRole('columnheader', { name: 'Cost' })).toBeInTheDocument()
    expect(within(overview).getByRole('columnheader', { name: 'Amount' })).toBeInTheDocument()
  })

  it('shows owner, allocation, and expandable breakdown details on the overview', async () => {
    render(<App />)

    fireEvent.change(screen.getByLabelText(/owner name/i), { target: { value: 'Banu U' } })
    fireEvent.change(screen.getByLabelText(/contribution amount/i), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: /add owner/i }))
    fireEvent.change(screen.getByLabelText(/^cost name$/i), { target: { value: 'All Development Cost' } })
    fireEvent.change(screen.getByLabelText(/^cost amount$/i), { target: { value: '100000' } })
    fireEvent.change(screen.getByLabelText(/^invoice date$/i), { target: { value: '2026-07-14' } })
    fireEvent.click(screen.getByRole('button', { name: /^add cost$/i }))

    let overview = screen.getByRole('heading', { name: 'Overview' }).closest('.panel')
    let costRow = within(overview).getByText('All Development Cost').closest('.dashboard-cost-row')
    expect(costRow).toHaveTextContent('Banu U')
    expect(costRow).toHaveTextContent('No breakdowns yet')
    expect(costRow).toHaveTextContent('Allocated $0.00')
    expect(costRow).toHaveTextContent('Remaining $100,000.00')
    fireEvent.click(within(costRow).getByRole('button', { name: 'Add breakdown' }))

    fireEvent.change(screen.getByLabelText(/^cost name$/i), { target: { value: 'Engineering plan' } })
    fireEvent.change(screen.getByLabelText(/^cost amount$/i), { target: { value: '105000' } })
    fireEvent.click(screen.getByRole('button', { name: /^add breakdown$/i }))
    await waitFor(() => expect(document.getElementById('cost-editor-form')).toHaveAttribute('hidden'))
    fireEvent.click(screen.getByRole('button', { name: 'Back to dashboard' }))

    overview = screen.getByRole('heading', { name: 'Overview' }).closest('.panel')
    costRow = within(overview).getByText('All Development Cost').closest('.dashboard-cost-row')
    expect(costRow).toHaveTextContent('1 breakdown')
    expect(costRow).toHaveTextContent('Allocated $105,000.00')
    expect(costRow).toHaveTextContent('Over allocated $5,000.00')
    fireEvent.click(within(costRow).getByRole('button', { name: 'Show details (1)' }))
    const details = overview.querySelector('.dashboard-cost-breakdowns')
    expect(within(details).getByText(/Engineering plan/)).toBeInTheDocument()
    expect(within(details).getByText('$105,000.00')).toBeInTheDocument()

    expect(costRow).toHaveTextContent('$100,000.00 + $5,000.00 = $105,000.00 breakdown total')
    fireEvent.click(within(costRow).getByRole('button', { name: 'Increase parent to breakdown total' }))
    fireEvent.click(within(costRow).getByRole('button', { name: 'Confirm increase to $105,000.00' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('now matches its breakdown total of $105,000.00'))
    costRow = within(overview).getByText('All Development Cost').closest('.dashboard-cost-row')
    expect(costRow.querySelector('.overview-cost-amount')).toHaveTextContent('$105,000.00')
    expect(costRow).toHaveTextContent('Remaining $0.00')
    expect(costRow).not.toHaveTextContent('Over allocated')
  })

  it('edits costs as new versions and soft deletes the latest version', () => {
    render(<App />)

    fireEvent.change(screen.getByLabelText(/owner name/i), { target: { value: 'Cost Owner' } })
    fireEvent.change(screen.getByLabelText(/contribution amount/i), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: /add owner/i }))
    fireEvent.change(screen.getByLabelText(/^cost name$/i), { target: { value: 'Land Acquisition' } })
    fireEvent.change(screen.getByLabelText(/^cost amount$/i), { target: { value: '320000' } })
    fireEvent.change(screen.getByLabelText(/^invoice date$/i), { target: { value: '2025-01-15' } })
    fireEvent.click(screen.getByRole('button', { name: /^add cost$/i }))

    fireEvent.click(screen.getByRole('button', { name: /open cost page/i }))
    const activeCostSection = screen.getByRole('heading', { name: /all tracked costs/i }).closest('section')
    const originalRow = [...activeCostSection.querySelectorAll('.cost-record-title')].find((node) => node.textContent === 'Land Acquisition')?.closest('.cost-record-card')

    fireEvent.click(within(originalRow).getByRole('button', { name: /^edit cost$/i }))
    expect(screen.getByLabelText(/^invoice date$/i)).toHaveValue('2025-01-15')
    fireEvent.change(screen.getByLabelText(/^cost amount$/i), { target: { value: '300000' } })
    fireEvent.change(screen.getByLabelText(/^invoice date$/i), { target: { value: '2025-01-20' } })
    fireEvent.click(screen.getByRole('button', { name: /save new version/i }))

    expect(screen.queryByText(/Land Acquisition · v2/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /show version history/i }))
    expect(screen.getByText(/Land Acquisition · v2/i)).toBeInTheDocument()
    const updatedRow = [...activeCostSection.querySelectorAll('.cost-record-title')].find((node) => node.textContent === 'Land Acquisition')?.closest('.cost-record-card')
    fireEvent.click(within(updatedRow).getByLabelText('More actions for Land Acquisition'))
    fireEvent.click(within(updatedRow).getByRole('menuitem', { name: /^delete cost$/i }))

    expect(activeCostSection.querySelector('.cost-record-title')).toHaveTextContent('Land Acquisition')
    fireEvent.click(within(updatedRow).getByRole('menuitem', { name: /confirm delete/i }))

    expect(activeCostSection.querySelector('.cost-record-title')).not.toBeInTheDocument()
    expect(screen.getByText(/Deleted \d{4}-\d{2}-\d{2}/i)).toBeInTheDocument()
  })

  it('treats pdf uploads as document intake instead of failing silently', async () => {
    const file = new File(['%PDF-1.4'], 'statement.pdf', { type: 'application/pdf' })
    const result = await extractTransactionFromImage(file, 'Greenfort')

    expect(result.description).toMatch(/pdf/i)
    expect(result.notes).toMatch(/pdf/i)
  })

  it('lets a user approve a bank statement review item and classify it', () => {
    const onApproveReviewItem = vi.fn()

    render(
      <ClassificationPage
        owners={[{ id: 1, name: 'Greenfort' }]}
        categories={[{ id: 1, phase: 'development', name: 'Permits & Fees' }]}
        reviewItems={[
          {
            id: 7,
            sourceName: 'statement.pdf',
            vendor: 'Bank of America',
            amount: 12450,
            description: 'ACH payout',
            date: '2025-05-15',
          },
        ]}
        onApproveReviewItem={onApproveReviewItem}
        onBack={() => {}}
      />,
    )

    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: /approve and save/i }))

    expect(onApproveReviewItem).toHaveBeenCalledWith(7, 1)
  })

  it('shows meaningful errors when required owner and invoice fields are missing', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /add owner/i }))
    expect(screen.getByRole('alert')).toHaveTextContent(/enter an owner name/i)

    fireEvent.click(screen.getByRole('button', { name: /open intake page/i }))
    fireEvent.click(screen.getByRole('button', { name: /import invoice/i }))
    expect(screen.getByRole('alert')).toHaveTextContent(/paste the invoice details/i)
  })

  it('lets a user edit an owner name and contribution', () => {
    render(<App />)

    fireEvent.change(screen.getByLabelText(/owner name/i), { target: { value: 'Original Owner' } })
    fireEvent.change(screen.getByLabelText(/contribution amount/i), { target: { value: '1000' } })
    fireEvent.click(screen.getByRole('button', { name: /add owner/i }))

    const ownerRow = screen.getByText('Original Owner', { selector: 'strong' }).closest('.table-row')
    fireEvent.click(within(ownerRow).getByRole('button', { name: /edit owner/i }))
    fireEvent.change(screen.getByLabelText(/owner name/i), { target: { value: 'Updated Owner' } })
    fireEvent.change(screen.getByLabelText(/contribution amount/i), { target: { value: '2500' } })
    fireEvent.click(screen.getByRole('button', { name: /save owner changes/i }))

    expect(screen.getByText('Updated Owner', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getAllByText(/\$2,500/i)).not.toHaveLength(0)
    expect(screen.queryByText('Original Owner')).not.toBeInTheDocument()
  })

  it('creates a project and makes it available to income entries', () => {
    render(<App accessProfile={{ email: 'admin@example.com', is_global_admin: true }} onSignOut={() => {}} />)

    fireEvent.change(screen.getByLabelText(/project name/i), { target: { value: 'Downtown Project' } })
    fireEvent.change(screen.getByLabelText(/project budget/i), { target: { value: '750000' } })
    fireEvent.change(screen.getByLabelText(/project address/i), { target: { value: '100 Main Street' } })
    fireEvent.click(screen.getByRole('button', { name: /create project/i }))

    expect(screen.getAllByText('Downtown Project').length).toBeGreaterThan(0)
    expect(screen.queryByLabelText(/income project/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Downtown Project/i }))
    expect(screen.queryByLabelText(/income project/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Draws & Income/i }))
    expect(screen.getByLabelText(/income project/i).value).toMatch(/^\d+$/)
    fireEvent.click(screen.getByRole('button', { name: /back to projects/i }))
    expect(screen.queryByLabelText(/income project/i)).not.toBeInTheDocument()
  })

  it('hides project creation from project administrators', () => {
    render(<App accessProfile={{ email: 'project-admin@example.com', is_global_admin: false }} onSignOut={() => {}} />)

    expect(screen.queryByRole('heading', { name: /create a project/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create project/i })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /your projects/i })).toBeInTheDocument()
  })

  it('lets a signed-in user set a password for future sign-ins', async () => {
    const onUpdatePassword = vi.fn().mockResolvedValue(undefined)
    render(<App
      accessProfile={{ email: 'admin@example.com', is_global_admin: true }}
      onSignOut={() => {}}
      onUpdatePassword={onUpdatePassword}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    fireEvent.click(screen.getByRole('button', { name: 'Account security' }))
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'secure-password-123' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'secure-password-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }))

    await waitFor(() => expect(onUpdatePassword).toHaveBeenCalledWith('secure-password-123'))
    expect(await screen.findByRole('status')).toHaveTextContent('Password saved')
  })
})
