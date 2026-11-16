import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ConstructionLedger from './ConstructionLedger'
import { buildConstructionLedger, constructionLedgerCsv } from './lib/constructionLedger'

const costs = [
  { costId: 'framing', name: 'Framing', phase: 'construction', amount: 1000, date: '2026-10-01', category: 'Carpentry', lotAllocations: [{ lot: 'Lot 1', amount: 600 }] },
  { costId: 'detail', parentCostId: 'framing', name: 'Materials', phase: 'construction', amount: 400 },
  { costId: 'plumbing', name: 'Plumbing', phase: 'construction', amount: 300, date: '2026-10-02', paymentStatus: 'paid', lotAllocations: [{ lot: 'Lot 2', amount: 300 }] },
  { costId: 'land', name: 'Land', phase: 'development', amount: 9000 },
]
const checks = [
  { id: 'paid', costId: 'detail', amount: 200, status: 'printed' },
  { id: 'voided', costId: 'framing', amount: 500, status: 'voided' },
  { id: 'draft', costId: 'framing', amount: 500, status: 'draft' },
  { id: 'transfer', costId: 'framing', amount: 500, status: 'printed', checkType: 'internal_transfer' },
]

describe('ConstructionLedger', () => {
  it('counts parent costs once and settles only confirmed payments including child checks', () => {
    const rows = buildConstructionLedger(costs, checks)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ costId: 'framing', unassigned: 400, status: 'Partially paid', balance: { paid: 200, remaining: 800 } })
    expect(rows[1]).toMatchObject({ status: 'Paid', balance: { paid: 300, remaining: 0 } })
  })

  it('filters by lot, status, search and dates while retaining full cost amounts', () => {
    render(<ConstructionLedger costs={costs} checks={checks} />)
    const table = screen.getByRole('table')
    expect(within(table).getByText('Framing')).toBeInTheDocument()
    expect(within(table).queryByText('Materials')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Lot'), { target: { value: 'unassigned' } })
    expect(within(table).queryByText('Plumbing')).not.toBeInTheDocument()
    expect(within(table).getAllByText('$1,000.00')).toHaveLength(3)
    fireEvent.change(screen.getByLabelText('Payment status'), { target: { value: 'Paid' } })
    expect(screen.getByText('No construction costs match these filters.')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Clear filters'))
    fireEvent.change(screen.getByLabelText('Search construction'), { target: { value: 'plumb' } })
    expect(within(table).queryByText('Framing')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-10-03' } })
    expect(screen.getByText('No construction costs match these filters.')).toBeInTheDocument()
  })

  it('exports filtered records with safe text, exact totals and allocation detail', () => {
    const csv = constructionLedgerCsv(buildConstructionLedger([{ ...costs[0], name: '=HYPERLINK("bad")' }, costs[2]], checks))
    expect(csv).toContain('\'=HYPERLINK(""bad"")')
    expect(csv).toContain('Lot 1: 600.00; Unassigned: 400.00')
    expect(csv).toContain('"1300.00"')
    expect(csv).not.toContain('Materials')
  })

  it('opens the existing cost editor and breakdown for the chosen record', () => {
    const onEditCost = vi.fn()
    const onAddBreakdown = vi.fn()
    render(<ConstructionLedger costs={costs} onEditCost={onEditCost} onAddBreakdown={onAddBreakdown} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit Framing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Breakdown for Framing' }))
    expect(onEditCost).toHaveBeenCalledWith('framing')
    expect(onAddBreakdown).toHaveBeenCalledWith('framing')
  })
})
