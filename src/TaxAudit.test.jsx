import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TaxAudit from './TaxAudit'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TaxAudit', () => {
  it('computes cost basis per lot from lot-tagged checks plus an equal share of development cost', () => {
    const checks = [
      { id: 1, payee: 'Triangle Concrete', amount: 20000, date: '2026-03-01', lot: 'Lot 2', status: 'printed', memo: 'Foundation' },
      { id: 2, payee: 'Triangle Concrete', amount: 5000, date: '2026-03-05', lot: 'Lot 2', status: 'voided', memo: 'Voided' },
      { id: 3, payee: 'City of Raleigh', amount: 10000, date: '2026-03-10', lot: 'Lot 4', status: 'printed', memo: 'Permit' },
    ]
    const activeCosts = [{ costId: 'c1', name: 'Lot Cost', amount: 40000 }]
    const lotCommitments = [{ lot: 'Lot 2', address: '5562 Avent Ferry Rd' }]

    render(<TaxAudit checks={checks} incomes={[]} activeCosts={activeCosts} lotCommitments={lotCommitments} projectName="Tryon Rd" />)

    const lot2Row = screen.getByText('Lot 2').closest('tr')
    const lot2Cells = within(lot2Row).getAllByRole('cell')
    expect(within(lot2Cells[1]).getByText('5562 Avent Ferry Rd')).toBeInTheDocument()
    expect(within(lot2Cells[2]).getByText('$20,000.00')).toBeInTheDocument()
    expect(within(lot2Cells[3]).getByText('$10,000.00')).toBeInTheDocument()
    expect(within(lot2Cells[4]).getByText('$30,000.00')).toBeInTheDocument()

    const lot1Row = screen.getByText('Lot 1').closest('tr')
    const lot1Cells = within(lot1Row).getAllByRole('cell')
    expect(within(lot1Cells[2]).getByText('$0.00')).toBeInTheDocument()
    expect(within(lot1Cells[4]).getByText('$10,000.00')).toBeInTheDocument()

    // Grand total: (20,000 Lot 2 + 10,000 Lot 4 spent) + 40,000 shared dev cost = $70,000.00,
    // shown both in the header metric and the table's footer total.
    expect(screen.getAllByText('$70,000.00')).toHaveLength(2)
  })

  it('flags vendors paid $600 or more in a calendar year as likely needing a 1099-NEC', () => {
    const checks = [
      { id: 1, payee: 'Small Handyman', amount: 500, date: '2026-01-10', lot: '', status: 'printed' },
      { id: 2, payee: 'Small Handyman', amount: 300, date: '2026-02-10', lot: '', status: 'printed' },
      { id: 3, payee: 'Big Contractor LLC', amount: 400, date: '2026-01-10', lot: '', status: 'printed' },
      { id: 4, payee: 'Big Contractor LLC', amount: 400, date: '2025-12-10', lot: '', status: 'printed' },
    ]

    render(<TaxAudit checks={checks} incomes={[]} />)

    const handymanRow = screen.getByText('Small Handyman').closest('tr')
    expect(within(handymanRow).getByText('$800.00')).toBeInTheDocument()
    expect(within(handymanRow).getByText('Yes')).toBeInTheDocument()

    const contractorRows = screen.getAllByText('Big Contractor LLC').map((cell) => cell.closest('tr'))
    contractorRows.forEach((row) => {
      expect(within(row).getByText('$400.00')).toBeInTheDocument()
      expect(within(row).getByText('No')).toBeInTheDocument()
    })
  })

  it('excludes voided checks from both the cost basis and vendor summary', () => {
    const checks = [{ id: 1, payee: 'Refunded Vendor', amount: 900, date: '2026-01-01', lot: 'Lot 1', status: 'voided' }]

    render(<TaxAudit checks={checks} incomes={[]} />)

    expect(screen.queryByText('Refunded Vendor')).not.toBeInTheDocument()
    const lot1Row = screen.getByText('Lot 1').closest('tr')
    const lot1Cells = within(lot1Row).getAllByRole('cell')
    expect(within(lot1Cells[2]).getByText('$0.00')).toBeInTheDocument()
  })

  it('exports a CSV file when a download button is clicked', () => {
    const checks = [{ id: 1, payee: 'Triangle Concrete', amount: 1000, date: '2026-01-01', lot: 'Lot 2', memo: 'Foundation', status: 'printed' }]
    const incomes = [{ description: 'Draw 1', source: 'Providence Bank', amount: 5000, date: '2026-01-02' }]
    const createObjectURL = vi.fn().mockReturnValue('blob:mock')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(<TaxAudit checks={checks} incomes={incomes} projectName="Tryon Rd" />)
    fireEvent.click(screen.getByRole('button', { name: 'Export full ledger (CSV)' }))

    expect(createObjectURL).toHaveBeenCalled()
    expect(clickSpy).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock')
  })
})
