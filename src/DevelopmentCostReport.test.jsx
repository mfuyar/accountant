import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DevelopmentCostReport from './DevelopmentCostReport'

describe('DevelopmentCostReport', () => {
  it('shows pre-sale deposit funding separately from the development costs it funds', () => {
    render(<DevelopmentCostReport
      project={{ name: 'Tryon', totalBudget: 1000000 }}
      costs={[{ costId: 'cost-1', name: 'Land', phase: 'development', amount: 500000, date: '2026-07-01', lotAllocations: [] }]}
      incomes={[{ id: 'fund-1', description: 'Pre sale Deposits (Utilized)', type: 'pre_sale_deposit', amount: 300000 }]}
    />)

    const report = screen.getByRole('heading', { name: 'Development Cost Summary', level: 2 }).closest('.development-report-panel')
    expect(within(report).getByText('Recorded costs').parentElement).toHaveTextContent('$500,000.00')
    const utilization = within(report).getByRole('heading', { name: 'Pre-sale deposit utilization' }).closest('section')
    expect(within(utilization).getByText('Pre-sale deposits').parentElement).toHaveTextContent('$300,000.00')
    expect(within(utilization).getByText('Deposit utilized').parentElement).toHaveTextContent('$300,000.00')
    expect(within(utilization).getByText('Deposit remaining').parentElement).toHaveTextContent('$0.00')
  })

  it('summarizes top-level costs by phase, category, and lot without double counting', () => {
    render(<DevelopmentCostReport
      project={{ name: 'Tryon', totalBudget: 5000 }}
      owners={[{ id: 'owner-1', name: 'Greenfort' }]}
      costs={[
        { costId: 'cost-1', name: 'Permit', ownerId: 'owner-1', phase: 'development', category: 'Permits', amount: 1000, date: '2026-08-01', lotAllocations: [{ lot: 'Lot 1', amount: 600 }] },
        { costId: 'cost-2', name: 'Framing', ownerId: 'owner-1', phase: 'construction', category: 'Framing', amount: 2000, date: '2026-08-02', lotAllocations: [{ lot: 'Lot 2', amount: 2000 }] },
      ]}
    />)

    const report = screen.getByRole('heading', { name: 'Development Cost Summary', level: 2 }).closest('.development-report-panel')
    expect(within(report).getByText('Recorded costs').parentElement).toHaveTextContent('$3,000.00')
    expect(within(report).getByText('Remaining budget').parentElement).toHaveTextContent('$2,000.00')
    expect(within(report).getByText('Unassigned to lots').parentElement).toHaveTextContent('$400.00')
    const phaseTable = within(report).getByRole('heading', { name: 'Cost by phase' }).closest('section')
    const lotTable = within(report).getByRole('heading', { name: 'Cost by lot' }).closest('section')
    expect(within(phaseTable).getByText('Development').parentElement).toHaveTextContent('$1,000.00')
    expect(within(lotTable).getByText('Lot 2').parentElement).toHaveTextContent('$2,000.00')
  })

  it('does not invent a negative remaining balance when the project budget is not configured', () => {
    render(<DevelopmentCostReport
      project={{ name: 'Tryon' }}
      costs={[{ costId: 'cost-1', name: 'Land', phase: 'development', amount: 599000, lotAllocations: [] }]}
    />)

    const report = screen.getByRole('heading', { name: 'Development Cost Summary', level: 2 }).closest('.development-report-panel')
    expect(within(report).getByText('Project budget').parentElement).toHaveTextContent('Not set')
    expect(within(report).getByText('Remaining budget').parentElement).toHaveTextContent('Not available')
    expect(within(report).getByText('Remaining budget').parentElement).not.toHaveClass('negative')
  })

  it('shows the requested development parents as separate collapsible sections with breakdown controls', () => {
    const onAddBreakdown = vi.fn()
    render(<DevelopmentCostReport
      project={{ name: 'Tryon' }}
      costs={[
        { costId: 'land-parent', name: 'Land Cost', phase: 'development', amount: 639525, lotAllocations: [] },
        { costId: 'ground-parent', name: 'Ground Work — Narron', phase: 'development', amount: 582964.27, lotAllocations: [] },
      ]}
      breakdowns={[{ costId: 'land-purchase', parentCostId: 'land-parent', name: 'Original Land Purchase Price', phase: 'development', category: 'Land cost', amount: 599000 }]}
      onAddBreakdown={onAddBreakdown}
    />)

    const sections = screen.getByRole('heading', { name: 'Development Ledger Sections' }).closest('section')
    expect(within(sections).getByText('Land Cost')).toBeInTheDocument()
    expect(within(sections).getByText('Ground Work — Narron')).toBeInTheDocument()
    const ground = within(sections).getByText('Ground Work — Narron').closest('details')
    fireEvent.click(within(ground).getByRole('button', { name: 'Add breakdown' }))
    expect(onAddBreakdown).toHaveBeenCalledWith('ground-parent')
  })

  it('creates an accountant ledger from leaf breakdowns without counting merged groups or parents twice', () => {
    render(<DevelopmentCostReport
      project={{ name: 'Tryon', totalBudget: 2000 }}
      owners={[{ id: 'kemal', name: 'Kemal' }, { id: 'banu', name: 'Banu' }]}
      costs={[
        { costId: 'kemal-parent', name: 'Kemal development cost', ownerId: 'kemal', phase: 'development', category: 'Other', amount: 300, date: '2022-03-01' },
        { costId: 'banu-parent', name: 'Banu development cost', ownerId: 'banu', phase: 'development', category: 'Other', amount: 700, date: '2022-03-01' },
      ]}
      breakdowns={[
        { costId: 'land-1', parentCostId: 'kemal-parent', name: 'Land payment', ownerId: 'kemal', phase: 'development', category: 'Land cost', amount: 200, date: '2022-03-02' },
        { costId: 'permit-1', parentCostId: 'kemal-parent', name: 'Permit fee', ownerId: 'kemal', phase: 'development', category: 'Permits & municipal fees', amount: 100, date: '2022-03-03' },
        { costId: 'land-group', parentCostId: 'banu-parent', name: 'Initial land cost', ownerId: 'banu', phase: 'development', category: 'Land cost', amount: 700, date: '2022-03-04' },
        { costId: 'land-2', parentCostId: 'land-group', name: 'Closing payment', ownerId: 'banu', phase: 'development', category: 'Land cost', amount: 600, date: '2022-03-04' },
        { costId: 'permit-2', parentCostId: 'land-group', name: 'Recording fee', ownerId: 'banu', phase: 'development', category: 'Permits & municipal fees', amount: 100, date: '2022-03-04' },
      ]}
    />)

    const ledger = screen.getByRole('heading', { name: 'Ledger by category' }).closest('section')
    const categoryGroups = [...ledger.querySelectorAll('.development-category-group')]
    const land = categoryGroups.find((group) => group.querySelector('summary')?.textContent.includes('Land Acquisition'))?.querySelector('summary')
    const permits = categoryGroups.find((group) => group.querySelector('summary')?.textContent.includes('Soft / Development Costs'))?.querySelector('summary')
    expect(land).toHaveTextContent('$800.00')
    expect(permits).toHaveTextContent('$200.00')
    expect(within(ledger).queryByText('Initial land cost')).not.toBeInTheDocument()
    expect(ledger.querySelector('.development-category-ledger-heading')).toHaveTextContent('$1,000.00')
  })

  it('saves a category choice directly from a ledger detail row', async () => {
    const onUpdateCostCategory = vi.fn().mockResolvedValue({})
    render(<DevelopmentCostReport
      project={{ name: 'Tryon' }}
      costs={[{ costId: 'parent', name: 'All Development Cost', phase: 'development', amount: 100, date: '2022-04-01' }]}
      breakdowns={[{ costId: 'detail', parentCostId: 'parent', name: 'Engineering Fee', phase: 'development', amount: 100, date: '2022-04-01' }]}
      onUpdateCostCategory={onUpdateCostCategory}
    />)

    fireEvent.change(screen.getByLabelText('Category for Engineering Fee'), { target: { value: 'Professional fees' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onUpdateCostCategory).toHaveBeenCalledWith(expect.objectContaining({ costId: 'detail', name: 'Engineering Fee' }), 'Professional fees'))
    expect(await screen.findByRole('status')).toHaveTextContent('Engineering Fee saved as Professional fees')
  })

  it('opens the full editor and requires confirmation before deleting a ledger row', async () => {
    const onEditCost = vi.fn()
    const onDeleteCost = vi.fn().mockResolvedValue({})
    render(<DevelopmentCostReport
      project={{ name: 'Tryon' }}
      costs={[{ costId: 'permit', name: 'Permit fee', phase: 'development', category: 'Permits & municipal fees', amount: 100, date: '2022-04-01' }]}
      onEditCost={onEditCost}
      onDeleteCost={onDeleteCost}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit all details' }))
    expect(onEditCost).toHaveBeenCalledWith('permit')

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onDeleteCost).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
    await waitFor(() => expect(onDeleteCost).toHaveBeenCalledWith('permit'))
    expect(await screen.findByRole('status')).toHaveTextContent('Permit fee was deleted')
  })

  it('combines engineering development entries into an Engineering subtotal without hiding detail', () => {
    render(<DevelopmentCostReport
      project={{ name: 'Tryon' }}
      costs={[{ costId: 'parent', name: 'Development costs', phase: 'development', amount: 300, date: '2022-01-01' }]}
      breakdowns={[
        { costId: 'eng-1', parentCostId: 'parent', name: 'Engineering Fee', phase: 'development', amount: 100, date: '2022-01-02' },
        { costId: 'eng-2', parentCostId: 'parent', name: 'Engineering plan review', phase: 'development', amount: 200, date: '2022-01-03' },
      ]}
    />)

    const subtotals = screen.getByLabelText('Soft / Development Costs subcategory totals')
    expect(within(subtotals).getByText('Engineering').parentElement).toHaveTextContent('$300.00')
    expect(screen.getByText('Engineering Fee')).toBeInTheDocument()
    expect(screen.getByText('Engineering plan review')).toBeInTheDocument()
  })
})
