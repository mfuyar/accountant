import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ConstructionDrafts from './ConstructionDrafts'

const hvacDraft = {
  id: 'draft-hvac',
  name: 'HVAC',
  details: '',
  plannedAmount: null,
  plannedDate: '',
  attachments: [],
  status: 'draft',
  convertedCostId: null,
  sourceEstimates: { lot_3: 38500, lot_2: 38500 },
}

describe('ConstructionDrafts', () => {
  it('saves planning details without creating an actual cost', async () => {
    const onSaveDraft = vi.fn().mockImplementation(async (_id, updates) => ({ ...hvacDraft, ...updates }))
    render(<ConstructionDrafts drafts={[hvacDraft]} onSaveDraft={onSaveDraft} />)

    fireEvent.click(screen.getByRole('button', { name: 'Show construction drafts (1)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Details & files' }))
    fireEvent.change(screen.getByLabelText('Details for HVAC'), { target: { value: 'Confirm final tonnage and subcontractor.' } })
    fireEvent.change(screen.getByLabelText('Planned amount for HVAC'), { target: { value: '18000' } })
    fireEvent.change(screen.getByLabelText('Planned date for HVAC'), { target: { value: '2026-10-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save draft details' }))

    await waitFor(() => expect(onSaveDraft).toHaveBeenCalledWith('draft-hvac', expect.objectContaining({
      details: 'Confirm final tonnage and subcontractor.',
      plannedAmount: 18000,
      plannedDate: '2026-10-01',
      status: 'draft',
    })))
    expect(await screen.findByText('HVAC draft saved.')).toBeInTheDocument()
  })

  it('uploads an invoice to the draft and preserves it as an attachment', async () => {
    const onUploadDocument = vi.fn().mockResolvedValue({
      documentId: 'document-1',
      name: 'hvac-quote.pdf',
      storagePath: 'project/hvac-quote.pdf',
    })
    const onSaveDraft = vi.fn().mockImplementation(async (_id, updates) => ({ ...hvacDraft, ...updates }))
    render(<ConstructionDrafts drafts={[hvacDraft]} onSaveDraft={onSaveDraft} onUploadDocument={onUploadDocument} />)

    fireEvent.click(screen.getByRole('button', { name: 'Show construction drafts (1)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Details & files' }))
    const file = new File(['invoice'], 'hvac-quote.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Attach document to HVAC'), { target: { files: [file] } })

    await waitFor(() => expect(onUploadDocument).toHaveBeenCalledWith(file))
    await waitFor(() => expect(onSaveDraft).toHaveBeenCalledWith('draft-hvac', expect.objectContaining({
      attachments: [expect.objectContaining({ documentId: 'document-1', name: 'hvac-quote.pdf' })],
    })))
    expect(await screen.findByText('hvac-quote.pdf attached to HVAC.')).toBeInTheDocument()
  })

  it('sends the selected draft to the cost editor', () => {
    const onUseDraft = vi.fn()
    render(<ConstructionDrafts drafts={[hvacDraft]} onUseDraft={onUseDraft} />)

    fireEvent.click(screen.getByRole('button', { name: 'Show construction drafts (1)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use as construction cost' }))

    expect(onUseDraft).toHaveBeenCalledWith(hvacDraft)
  })

  it('shows every lot estimate from the source sheet without treating missing cells as zero', () => {
    render(<ConstructionDrafts drafts={[hvacDraft]} />)

    expect(screen.getByLabelText('Expected construction totals from source sheet')).toHaveTextContent('Lot #3$38,500')
    fireEvent.click(screen.getByRole('button', { name: 'Show construction drafts (1)' }))
    const estimates = screen.getByLabelText('Expected costs for HVAC')
    expect(estimates).toHaveTextContent('Lot #3$38,500')
    expect(estimates).toHaveTextContent('Lot #2$38,500')
    expect(estimates).toHaveTextContent('Lot #1Not provided')
    expect(estimates).toHaveTextContent('Lot #4Not provided')
  })

  it('shows the live shared development cost split for the "Lot Cost" draft instead of "Not provided", and hides its convert button', () => {
    const lotCostDraft = {
      id: 'draft-lot-cost',
      name: 'Lot Cost',
      details: '',
      plannedAmount: null,
      plannedDate: null,
      attachments: [],
      status: 'draft',
      convertedCostId: null,
      sourceEstimates: {},
    }
    const onUseDraft = vi.fn()
    render(<ConstructionDrafts drafts={[lotCostDraft]} onUseDraft={onUseDraft} sharedDevelopmentCostTotal={40000} />)

    fireEvent.click(screen.getByRole('button', { name: 'Show construction drafts (1)' }))
    expect(screen.getByText('Shared across all lots — auto-calculated, no action needed')).toBeInTheDocument()

    const estimates = screen.getByLabelText('Expected costs for Lot Cost')
    expect(estimates).toHaveTextContent('Lot #3$10,000')
    expect(estimates).toHaveTextContent('Lot #2$10,000')
    expect(estimates).toHaveTextContent('Lot #1$10,000')
    expect(estimates).toHaveTextContent('Lot #4$10,000')
    expect(screen.queryByRole('button', { name: 'Use as construction cost' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Details & files' }))
    expect(screen.getByText("Amount and date are calculated automatically from total development costs and can't be edited here.")).toBeInTheDocument()
    expect(screen.queryByLabelText('Planned amount for Lot Cost')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Planned date for Lot Cost')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Details for Lot Cost')).toBeInTheDocument()
  })
})
