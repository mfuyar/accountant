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
    expect(within(cells[1]).getByText('$0.00')).toBeInTheDocument()
    expect(within(cells[2]).getByText('$40,000.00')).toBeInTheDocument()
    expect(within(cells[2]).getByText('of $80,000.00')).toBeInTheDocument()
    expect(within(cells[3]).getByText('$35,000.00')).toBeInTheDocument()
    expect(within(cells[5]).getByText('$75,000.00')).toBeInTheDocument()
  })

  it('reports checks attached to a job\'s cost but without a lot tag as unassigned', () => {
    const constructionDrafts = [{ id: 'draft-2', name: 'Permit', sourceEstimates: {}, convertedCostId: 'cost-permit' }]
    const activeCosts = [{ costId: 'cost-permit', name: 'Permit', amount: 2000 }]
    const checks = [{ id: 1, costId: 'cost-permit', lot: '', amount: 1800, status: 'printed' }]

    render(<SpendingByJob constructionDrafts={constructionDrafts} checks={checks} activeCosts={activeCosts} />)

    expect(screen.getByText('(+$1,800.00 unassigned lot)')).toBeInTheDocument()
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
    expect(within(lotCostCells[1]).getByText('$10,000.00')).toBeInTheDocument()
    expect(within(lotCostCells[1]).getByText('of $10,000.00')).toBeInTheDocument()
    expect(within(lotCostCells[4]).getByText('$10,000.00')).toBeInTheDocument()
    expect(within(lotCostCells[5]).getByText('$40,000.00')).toBeInTheDocument()
    expect(lotCostRow).toHaveClass('spending-by-job-shared-row')

    // The grand total in the header/footer naturally includes it, since it's just another row:
    // $40,000 (Lot Cost) + $40,000 (Framing spent) of $40,000 (Lot Cost) + $80,000 (Framing estimated).
    expect(screen.getByText('$80,000.00 of $120,000.00')).toBeInTheDocument()
  })

  it('groups manually entered construction costs by category and saved lot allocation', () => {
    const activeCosts = [
      { costId: 'permit', name: 'Building Permit', amount: 42954, phase: 'construction', category: 'Permits & municipal fees', date: '2026-07-17', lotAllocations: [{ lot: 'Lot 1', amount: 10501 }, { lot: 'Lot 2', amount: 10966 }, { lot: 'Lot 3', amount: 10872 }, { lot: 'Lot 4', amount: 10615 }] },
      { costId: 'utility', name: 'Water/Sewer Connection', amount: 8197.15, phase: 'construction', category: 'Site utilities', date: '2026-07-17', lotAllocations: [{ lot: 'Lot 3', amount: 8197.15 }] },
      { costId: 'utility-detail', parentCostId: 'utility', name: 'Receipt detail', amount: 8197.15, phase: 'construction', category: 'Site utilities', lotAllocations: [{ lot: 'Lot 3', amount: 8197.15 }] },
    ]

    render(<SpendingByJob activeCosts={activeCosts} />)

    const permitCategory = screen.getByText('Permits & municipal fees', { selector: 'strong' }).closest('tr')
    const cells = within(permitCategory).getAllByRole('cell')
    expect(within(cells[1]).getByText('$10,501.00')).toBeInTheDocument()
    expect(within(cells[3]).getByText('$10,872.00')).toBeInTheDocument()
    expect(within(cells[5]).getByText('$42,954.00')).toBeInTheDocument()
    expect(screen.getByText('Water/Sewer Connection')).toBeInTheDocument()
    expect(screen.getByText('Lot 3: $8,197.15')).toBeInTheDocument()
    expect(screen.queryByText('Receipt detail')).not.toBeInTheDocument()
    expect(screen.getByText('$51,151.15 of $0.00')).toBeInTheDocument()
  })

  it('maps receipt costs directly to an existing job and splits spending by saved lot allocations', () => {
    const constructionDrafts = [{
      id: 'plumbing-job',
      name: 'Plumbing Job',
      sourceEstimates: { lot_1: 25000, lot_2: 25000, lot_3: 25000, lot_4: 25000 },
    }]
    const activeCosts = [{
      costId: 'plumbing-receipt',
      constructionDraftId: 'plumbing-job',
      paymentMethod: 'amex_business',
      name: 'Plumbing rough-in payment',
      amount: 1000,
      phase: 'construction',
      category: 'Plumbing',
      lotAllocations: [
        { lot: 'Lot 1', amount: 250 }, { lot: 'Lot 2', amount: 250 },
        { lot: 'Lot 3', amount: 250 }, { lot: 'Lot 4', amount: 250 },
      ],
    }]

    render(<SpendingByJob constructionDrafts={constructionDrafts} activeCosts={activeCosts} />)

    const row = screen.getByText('Plumbing Job').closest('tr')
    const cells = within(row).getAllByRole('cell')
    expect(within(cells[1]).getByText('$250.00')).toBeInTheDocument()
    expect(within(cells[4]).getByText('$250.00')).toBeInTheDocument()
    expect(within(cells[5]).getByText('$1,000.00')).toBeInTheDocument()
    expect(screen.queryByText('Plumbing rough-in payment')).not.toBeInTheDocument()
  })
})
