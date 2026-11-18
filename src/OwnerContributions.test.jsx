import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import OwnerContributions from './OwnerContributions'

const entry = { id: 1, projectId: 2, ownerId: 9, counterparty: 'Banugul', type: 'owner_contribution', status: 'completed', amount: 1000, date: '2026-11-01', capital: { loanNumber: '3600818310', loanLabel: 'SBA' } }
const props = { project: { id: 2 }, owners: [{ id: 9, name: 'Banugul' }], entries: [entry, { ...entry, id: 2, status: 'planned', amount: 150 }] }
describe('Owner contributions screen', () => {
  it('shows the repayable balance independently of planned entries, other projects and profit payouts', () => {
    render(<OwnerContributions {...props} entries={[...props.entries, { ...entry, id: 3, type: 'owner_distribution', amount: 5000 }, { ...entry, id: 4, projectId: 3, amount: 7000 }]} />)
    expect(screen.getByText('Owner contributions paid').parentElement).toHaveTextContent('$1,000.00')
    expect(screen.getByText('Due back to owners').parentElement).toHaveTextContent('$1,000.00')
    expect(screen.getByText('Pending confirmation').parentElement).toHaveTextContent('$150.00')
  })
  it('records a return once and rejects amounts exceeding the owner balance', async () => {
    const onSave = vi.fn().mockResolvedValue({ id: 4 })
    render(<OwnerContributions {...props} onSave={onSave} />)
    fireEvent.change(screen.getByLabelText('Contribution return owner'), { target: { value: '9' } })
    fireEvent.change(screen.getByLabelText('Contribution return amount'), { target: { value: '1100' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record contribution returned' }))
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Contribution return amount'), { target: { value: '200' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record contribution returned' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ type: 'owner_contribution_return', ownerId: 9, amount: 200, status: 'completed' })))
  })
  it('keeps source documents accessible and confirms pending owner payments without adding another entry', async () => {
    const onStatusChange = vi.fn().mockResolvedValue({})
    const onOpenDocument = vi.fn()
    const document = { documentId: 'statement', name: 'Flagstar.pdf' }
    render(<OwnerContributions {...props} entries={[{ ...entry, status: 'planned', capital: { ...entry.capital, documents: [document] } }]} onStatusChange={onStatusChange} onOpenDocument={onOpenDocument} />)
    fireEvent.click(screen.getByRole('button', { name: 'View Flagstar.pdf' }))
    expect(onOpenDocument).toHaveBeenCalledWith(document)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm owner paid' }))
    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith(1, 'completed'))
  })
})
