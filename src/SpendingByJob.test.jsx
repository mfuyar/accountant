import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import SpendingByJob from './SpendingByJob'

describe('SpendingByJob', () => {
  it('splits a job\'s estimate and actual spend by lot, matched via the check\'s attached cost', () => {
    const constructionDrafts = [{
      id: 'draft-1',
      name: 'Framing Materials',
      sourceEstimates: { lot_2: 80000, lot_3: 80000 },
      convertedCostId: 'cost-framing',
    }]
    const activeCosts = [{ costId: 'cost-framing', name: 'Framing Materials', amount: 160000 }]
    const checks = [
      { id: 1, costId: 'cost-framing', lot: 'Lot 2', amount: 40000, status: 'printed' },
      { id: 2, costId: 'cost-framing', lot: 'Lot 3', amount: 35000, status: 'printed' },
      { id: 3, costId: 'cost-framing', lot: 'Lot 3', amount: 5000, status: 'voided' },
      { id: 4, costId: 'cost-unrelated', lot: 'Lot 2', amount: 999, status: 'printed' },
    ]

    render(<SpendingByJob constructionDrafts={constructionDrafts} checks={checks} activeCosts={activeCosts} />)

    const row = screen.getByText('Framing Materials').closest('tr')
    const cells = within(row).getAllByRole('cell')
    // cells[0] job name, cells[1..4] Lot 1..4, cells[5] total
    expect(within(cells[1]).getByText('$0')).toBeInTheDocument()
    expect(within(cells[2]).getByText('$40,000')).toBeInTheDocument()
    expect(within(cells[2]).getByText('of $80,000')).toBeInTheDocument()
    expect(within(cells[3]).getByText('$35,000')).toBeInTheDocument()
    expect(within(cells[5]).getByText('$75,000')).toBeInTheDocument()
  })

  it('reports checks attached to a job\'s cost but without a lot tag as unassigned', () => {
    const constructionDrafts = [{ id: 'draft-2', name: 'Permit', sourceEstimates: {}, convertedCostId: 'cost-permit' }]
    const activeCosts = [{ costId: 'cost-permit', name: 'Permit', amount: 2000 }]
    const checks = [{ id: 1, costId: 'cost-permit', lot: '', amount: 1800, status: 'printed' }]

    render(<SpendingByJob constructionDrafts={constructionDrafts} checks={checks} activeCosts={activeCosts} />)

    expect(screen.getByText('(+$1,800 unassigned lot)')).toBeInTheDocument()
  })

  it('shows a placeholder when there are no construction draft jobs', () => {
    render(<SpendingByJob />)

    expect(screen.getByText('No construction draft jobs recorded yet.')).toBeInTheDocument()
  })

  it('drives the "Lot Cost" job row from the project\'s total development cost, split evenly per lot, instead of matched checks', () => {
    const constructionDrafts = [
      { id: 'draft-lot-cost', name: 'Lot Cost', sourceEstimates: {}, convertedCostId: null },
      {
        id: 'draft-framing',
        name: 'Framing Materials',
        sourceEstimates: { lot_2: 80000 },
        convertedCostId: 'cost-framing',
      },
    ]
    const activeCosts = [{ costId: 'cost-framing', name: 'Framing Materials', amount: 80000 }]
    const checks = [{ id: 1, costId: 'cost-framing', lot: 'Lot 2', amount: 40000, status: 'printed' }]

    render(<SpendingByJob constructionDrafts={constructionDrafts} checks={checks} activeCosts={activeCosts} sharedDevelopmentCostTotal={40000} />)

    const lotCostRow = screen.getByText('Lot Cost').closest('tr')
    const lotCostCells = within(lotCostRow).getAllByRole('cell')
    // cells[0] job name, cells[1..4] Lot 1..4, cells[5] total — each lot gets an equal $10,000 share.
    expect(within(lotCostCells[1]).getByText('$10,000')).toBeInTheDocument()
    expect(within(lotCostCells[1]).getByText('of $10,000')).toBeInTheDocument()
    expect(within(lotCostCells[4]).getByText('$10,000')).toBeInTheDocument()
    expect(within(lotCostCells[5]).getByText('$40,000')).toBeInTheDocument()
    expect(lotCostRow).toHaveClass('spending-by-job-shared-row')

    // The grand total in the header/footer naturally includes it, since it's just another row:
    // $40,000 (Lot Cost) + $40,000 (Framing spent) of $40,000 (Lot Cost) + $80,000 (Framing estimated).
    expect(screen.getByText('$80,000 of $120,000')).toBeInTheDocument()
  })
})
