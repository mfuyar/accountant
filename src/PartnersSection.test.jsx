import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import PartnersSection from './PartnersSection'

const project = { id: 7, name: 'Tryon Road' }
const owners = [
  { id: 1, name: 'Green Fort', ownershipPercentage: 100 },
  { id: 2, name: 'Kemal', ownershipPercentage: 50 },
  { id: 3, name: 'Banu', ownershipPercentage: 50 },
]

describe('PartnersSection', () => {
  it('identifies Habitech as the Builder / GC from its payout and nests the individual owners beneath Green Fort', () => {
    render(<PartnersSection
      project={project}
      owners={owners}
      entries={[
        { id: 1, type: 'owner_distribution', status: 'completed', counterparty: 'Habitech Builders', ownerId: null, amount: 25000, date: '2026-08-21', paymentMethod: 'check', reference: '149', notes: 'Builder / GC partner payout — advance profit share.' },
        { id: 2, type: 'owner_distribution', status: 'completed', counterparty: 'Kemal', ownerId: 2, amount: 2500, date: '2026-08-02' },
        { id: 3, type: 'owner_distribution', status: 'planned', counterparty: 'Banu', ownerId: 3, amount: 1500, date: '2026-09-01' },
      ]}
      onSave={() => {}}
      onDelete={() => {}}
    />)

    const hierarchy = screen.getByLabelText('Partner hierarchy')
    expect(within(hierarchy).getByRole('heading', { name: 'Habitech Builders' })).toBeInTheDocument()
    expect(within(hierarchy).getByRole('heading', { name: 'Green Fort' })).toBeInTheDocument()
    expect(hierarchy).toHaveTextContent('Kemal$2,500.00')
    expect(hierarchy).toHaveTextContent('Banu$0.00')
    expect(screen.getByText('Profit paid to date').parentElement).toHaveTextContent('$27,500.00')
    expect(screen.getByText('Planned profit payouts').parentElement).toHaveTextContent('$1,500.00')
    expect(screen.getByText(/approved project profit share/)).toBeInTheDocument()
  })

  it('records a child-owner withdrawal as a completed owner distribution', async () => {
    const onSave = vi.fn().mockResolvedValue({ id: 9 })
    render(<PartnersSection project={project} owners={owners} entries={[]} onSave={onSave} onDelete={() => {}} />)

    fireEvent.change(screen.getByLabelText('Withdrawal recipient'), { target: { value: 'owner:3' } })
    fireEvent.change(screen.getByLabelText('Withdrawal amount'), { target: { value: '4000' } })
    fireEvent.change(screen.getByLabelText('Withdrawal date'), { target: { value: '2026-08-31' } })
    fireEvent.change(screen.getByLabelText('Withdrawal payment method'), { target: { value: 'amex_business' } })
    fireEvent.change(screen.getByLabelText('Withdrawal reference'), { target: { value: 'AMEX-99' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profit payout' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 7,
      type: 'owner_distribution',
      status: 'completed',
      counterparty: 'Banu',
      ownerId: 3,
      amount: 4000,
      paymentMethod: 'amex_business',
      reference: 'AMEX-99',
    })))
    expect(screen.getByRole('status')).toHaveTextContent('deducted from that party’s remaining profit payable')
  })

  it('shows itemized Amex charges as children of one Banu payout', () => {
    render(<PartnersSection project={project} owners={owners} entries={[{
      id: 10,
      type: 'owner_distribution',
      status: 'completed',
      counterparty: 'Banu',
      ownerId: 3,
      amount: 345.12,
      date: '2026-08-30',
      paymentMethod: 'amex_business',
      reference: 'AMEX-AIRLINE-2026-08-30',
      notes: 'Amex airline charges for Banu.\nPayout details:\n2026-08-30 | DELTA AIR LINES | 5.60\n2026-08-30 | DELTA AIR LINES | 60.13\n2026-08-29 | MEM RWDS AIRLINE TAX OFFSET FEE | 99.00',
    }]} onSave={() => {}} onDelete={() => {}} />)

    expect(screen.getByText('Profit paid to date').parentElement).toHaveTextContent('$345.12')
    const hierarchy = screen.getByLabelText('Partner hierarchy')
    const details = within(hierarchy).getByLabelText('Banu payout details')
    expect(within(details).getAllByText('DELTA AIR LINES')).toHaveLength(2)
    expect(within(details).getByText('MEM RWDS AIRLINE TAX OFFSET FEE')).toBeInTheDocument()
    expect(within(details).getByText('$99.00')).toBeInTheDocument()
  })
})
