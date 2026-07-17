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
})
