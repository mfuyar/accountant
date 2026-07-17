import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import LotCommitments from './LotCommitments'
import { classifyLotDocument, extractLotCommitmentFromDocument } from './lib/gemini'

vi.mock('./lib/gemini', () => ({
  extractLotCommitmentFromDocument: vi.fn().mockResolvedValue({ lot: null, address: '', commitmentAmount: null, notes: '' }),
  classifyLotDocument: vi.fn().mockResolvedValue({ lot: null, documentType: 'Other', address: '', commitmentAmount: null, notes: '' }),
}))

describe('LotCommitments', () => {
  it('starts collapsed and expands a lot to reveal its fields', () => {
    render(<LotCommitments activeProjectId={7} onSaveLotCommitment={() => {}} />)

    expect(screen.queryByLabelText('Lot 3 address')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Lot 3 details'))
    expect(screen.getByLabelText('Lot 3 address')).toBeInTheDocument()
  })

  it('saves a lot commitment with its address and amount', async () => {
    const onSaveLotCommitment = vi.fn().mockResolvedValue({})
    render(<LotCommitments activeProjectId={7} onSaveLotCommitment={onSaveLotCommitment} />)

    fireEvent.click(screen.getByLabelText('Lot 3 details'))
    fireEvent.change(screen.getByLabelText('Lot 3 address'), { target: { value: '123 Tryon Rd, Lot 3' } })
    fireEvent.change(screen.getByLabelText('Lot 3 commitment amount'), { target: { value: '150000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Lot 3 commitment' }))

    await waitFor(() => expect(onSaveLotCommitment).toHaveBeenCalledWith({
      projectId: 7,
      lot: 'Lot 3',
      address: '123 Tryon Rd, Lot 3',
      commitmentAmount: 150000,
      permitNumber: '',
      attachments: [],
    }))
  })

  it('saves and displays a permit number for a lot', async () => {
    const onSaveLotCommitment = vi.fn().mockResolvedValue({
      id: 1,
      projectId: 7,
      lot: 'Lot 3',
      address: '',
      commitmentAmount: 0,
      permitNumber: 'BLDR-007184-2026',
      attachments: [],
    })
    render(<LotCommitments activeProjectId={7} onSaveLotCommitment={onSaveLotCommitment} />)

    fireEvent.click(screen.getByLabelText('Lot 3 details'))
    fireEvent.change(screen.getByLabelText('Lot 3 permit number'), { target: { value: 'BLDR-007184-2026' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Lot 3 commitment' }))

    await waitFor(() => expect(onSaveLotCommitment).toHaveBeenCalledWith(expect.objectContaining({ permitNumber: 'BLDR-007184-2026' })))
    expect(screen.getByLabelText('Lot 3 permit number')).toHaveValue('BLDR-007184-2026')
    expect(screen.getByText('Permit BLDR-007184-2026')).toBeInTheDocument()
  })

  it('keeps the address visible after saving instead of reverting to blank', async () => {
    const onSaveLotCommitment = vi.fn().mockResolvedValue({
      id: 1,
      projectId: 7,
      lot: 'Lot 1',
      address: '456 Main St, Lot 1',
      commitmentAmount: 0,
      attachments: [],
    })
    render(<LotCommitments activeProjectId={7} onSaveLotCommitment={onSaveLotCommitment} />)

    fireEvent.click(screen.getByLabelText('Lot 1 details'))
    fireEvent.change(screen.getByLabelText('Lot 1 address'), { target: { value: '456 Main St, Lot 1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Lot 1 address' }))

    await waitFor(() => expect(onSaveLotCommitment).toHaveBeenCalled())
    expect(screen.getByLabelText('Lot 1 address')).toHaveValue('456 Main St, Lot 1')
  })

  it('shows drawn and remaining totals per lot from existing loan draws', () => {
    const incomes = [{
      id: 1,
      projectId: 7,
      description: 'Draw 1',
      source: 'Providence Bank',
      amount: 30000,
      date: '2026-07-16',
      type: 'loan_draw',
      lotBreakdown: [
        { lot: 'Lot 2', amount: 10000 },
        { lot: 'Lot 3', amount: 10000 },
        { lot: 'Lot 4', amount: 10000 },
      ],
    }]
    const lotCommitments = [{ id: 1, projectId: 7, lot: 'Lot 3', address: '123 Tryon Rd, Lot 3', commitmentAmount: 150000, attachments: [] }]

    render(<LotCommitments incomes={incomes} lotCommitments={lotCommitments} activeProjectId={7} onSaveLotCommitment={() => {}} />)

    fireEvent.click(screen.getByLabelText('Lot 3 details'))
    const lot3Card = screen.getByLabelText('Lot 3 address').closest('.lot-commitment-card')
    expect(screen.getByLabelText('Lot 3 address')).toHaveValue('123 Tryon Rd, Lot 3')
    expect(screen.getByLabelText('Lot 3 commitment amount')).toHaveValue(150000)
    expect(within(lot3Card).getByText('Drawn so far: $10,000.00')).toBeInTheDocument()
    expect(within(lot3Card).getByText('Left: $140,000.00')).toBeInTheDocument()
  })

  it('shows Lot 1 with an address and spending, but no loan commitment fields', () => {
    const checks = [
      { id: 1, projectId: 7, lot: 'Lot 1', amount: 4200, status: 'printed' },
      { id: 2, projectId: 7, lot: 'Lot 1', amount: 800, status: 'voided' },
    ]

    render(<LotCommitments checks={checks} activeProjectId={7} onSaveLotCommitment={() => {}} />)

    fireEvent.click(screen.getByLabelText('Lot 1 details'))
    const lot1Card = screen.getByLabelText('Lot 1 address').closest('.lot-commitment-card')
    expect(within(lot1Card).queryByLabelText('Lot 1 commitment amount')).not.toBeInTheDocument()
    expect(within(lot1Card).getByText('No loan on this lot — spending shown below is tracked from checks tagged to it.')).toBeInTheDocument()
    expect(within(lot1Card).getByText('Spent (checks tagged to Lot 1): $4,200.00')).toBeInTheDocument()
  })

  it('adds a labeled document like a plot plan to a lot, including Lot 1 which has no loan', async () => {
    const onUploadDocument = vi.fn().mockResolvedValue({
      documentId: 'doc-1',
      storageBucket: 'accounting-documents',
      storagePath: '7/doc-1-plot-plan.pdf',
      name: 'plot-plan.pdf',
      mimeType: 'application/pdf',
      size: 1234,
    })

    render(<LotCommitments activeProjectId={7} onSaveLotCommitment={() => {}} onUploadDocument={onUploadDocument} />)

    fireEvent.click(screen.getByLabelText('Lot 1 details'))
    const file = new File(['pdf'], 'plot-plan.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Lot 1 document label'), { target: { value: 'Plot Plan' } })
    fireEvent.change(screen.getByLabelText('Add Lot 1 document'), { target: { files: [file] } })

    await waitFor(() => expect(onUploadDocument).toHaveBeenCalledWith(file))
    expect(await screen.findByText('Plot Plan')).toBeInTheDocument()
    expect(screen.getByLabelText('Lot 1 document label')).toHaveValue('')
  })

  it('saves automatically after a document uploads, instead of leaving it as an unsaved draft', async () => {
    const onUploadDocument = vi.fn().mockResolvedValue({
      documentId: 'doc-2',
      storageBucket: 'accounting-documents',
      storagePath: '7/doc-2-elevation.pdf',
      name: 'elevation.pdf',
      mimeType: 'application/pdf',
      size: 2048,
    })
    const onSaveLotCommitment = vi.fn().mockResolvedValue({
      id: 1,
      projectId: 7,
      lot: 'Lot 1',
      address: '',
      commitmentAmount: 0,
      attachments: [{ id: 'doc-2', name: 'elevation.pdf', label: 'Elevation Drawings' }],
    })

    render(<LotCommitments activeProjectId={7} onSaveLotCommitment={onSaveLotCommitment} onUploadDocument={onUploadDocument} />)

    fireEvent.click(screen.getByLabelText('Lot 1 details'))
    const file = new File(['pdf'], 'elevation.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Lot 1 document label'), { target: { value: 'Elevation Drawings' } })
    fireEvent.change(screen.getByLabelText('Add Lot 1 document'), { target: { files: [file] } })

    await waitFor(() => expect(onSaveLotCommitment).toHaveBeenCalledWith(expect.objectContaining({
      lot: 'Lot 1',
      attachments: expect.arrayContaining([expect.objectContaining({ label: 'Elevation Drawings' })]),
    })))
    expect(await screen.findByRole('status')).toHaveTextContent('saved')
  })

  it('shows an inline preview of a document instead of only offering a download', async () => {
    const lotCommitments = [{
      id: 1,
      projectId: 7,
      lot: 'Lot 1',
      address: '',
      commitmentAmount: 0,
      attachments: [{ id: 'doc-3', name: 'plot-plan.pdf', label: 'Plot Plan', mimeType: 'application/pdf', storagePath: '7/doc-3.pdf' }],
    }]
    const onGetDocumentUrl = vi.fn().mockResolvedValue('https://example.com/signed/plot-plan.pdf')

    render(<LotCommitments lotCommitments={lotCommitments} activeProjectId={7} onSaveLotCommitment={() => {}} onGetDocumentUrl={onGetDocumentUrl} />)

    fireEvent.click(screen.getByLabelText('Lot 1 details'))
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    await waitFor(() => expect(onGetDocumentUrl).toHaveBeenCalledWith(lotCommitments[0].attachments[0]))
    const dialog = await screen.findByRole('dialog', { name: 'Preview of Plot Plan' })
    expect(within(dialog).getByTitle('Plot Plan')).toHaveAttribute('src', 'https://example.com/signed/plot-plan.pdf')
    expect(within(dialog).getByRole('link', { name: 'Download' })).toHaveAttribute('href', 'https://example.com/signed/plot-plan.pdf')
    const openLink = within(dialog).getByRole('link', { name: 'Open in new tab' })
    expect(openLink).toHaveAttribute('href', 'https://example.com/signed/plot-plan.pdf')
    expect(openLink).toHaveAttribute('target', '_blank')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renames a document from inside the preview modal', async () => {
    const lotCommitments = [{
      id: 1,
      projectId: 7,
      lot: 'Lot 1',
      address: '',
      commitmentAmount: 0,
      attachments: [{ id: 'doc-3', name: 'IMG_0042.pdf', label: 'Other', mimeType: 'application/pdf', storagePath: '7/doc-3.pdf' }],
    }]
    const onGetDocumentUrl = vi.fn().mockResolvedValue('https://example.com/signed/doc-3.pdf')
    const onSaveLotCommitment = vi.fn().mockImplementation((payload) => Promise.resolve({ id: 1, ...payload }))

    render(<LotCommitments lotCommitments={lotCommitments} activeProjectId={7} onSaveLotCommitment={onSaveLotCommitment} onGetDocumentUrl={onGetDocumentUrl} />)

    fireEvent.click(screen.getByLabelText('Lot 1 details'))
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    const dialog = await screen.findByRole('dialog', { name: 'Preview of Other' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rename' }))
    fireEvent.change(within(dialog).getByLabelText('Rename Other'), { target: { value: 'Elevation Drawings' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSaveLotCommitment).toHaveBeenCalledWith(expect.objectContaining({
      attachments: [expect.objectContaining({ id: 'doc-3', label: 'Elevation Drawings' })],
    })))
    expect(await screen.findByRole('dialog', { name: 'Preview of Elevation Drawings' })).toBeInTheDocument()
  })

  it('replaces the previous commitment letter instead of piling up duplicates', async () => {
    const lotCommitments = [{
      id: 1,
      projectId: 7,
      lot: 'Lot 3',
      address: '123 Tryon Rd, Lot 3',
      commitmentAmount: 150000,
      attachments: [
        { id: 'old-letter', name: 'old-commitment.pdf', label: 'Commitment Letter' },
        { id: 'plot-plan', name: 'plot-plan.pdf', label: 'Plot Plan' },
      ],
    }]
    const onUploadDocument = vi.fn().mockResolvedValue({
      documentId: 'new-letter',
      storageBucket: 'accounting-documents',
      storagePath: '7/new-commitment.pdf',
      name: 'new-commitment.pdf',
      mimeType: 'application/pdf',
      size: 4096,
    })
    const onSaveLotCommitment = vi.fn().mockResolvedValue({
      id: 1,
      projectId: 7,
      lot: 'Lot 3',
      address: '123 Tryon Rd, Lot 3',
      commitmentAmount: 150000,
      attachments: [
        { id: 'plot-plan', name: 'plot-plan.pdf', label: 'Plot Plan' },
        { id: 'new-letter', name: 'new-commitment.pdf', label: 'Commitment Letter' },
      ],
    })

    render(<LotCommitments lotCommitments={lotCommitments} activeProjectId={7} onSaveLotCommitment={onSaveLotCommitment} onUploadDocument={onUploadDocument} />)

    fireEvent.click(screen.getByLabelText('Lot 3 details'))
    const file = new File(['pdf'], 'new-commitment.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Upload Lot 3 commitment letter'), { target: { files: [file] } })

    await waitFor(() => expect(onSaveLotCommitment).toHaveBeenCalledWith(expect.objectContaining({
      attachments: [
        { id: 'plot-plan', name: 'plot-plan.pdf', label: 'Plot Plan' },
        expect.objectContaining({ label: 'Commitment Letter', name: 'new-commitment.pdf' }),
      ],
    })))
    expect(await screen.findByRole('status')).toHaveTextContent('Replaced the commitment letter')
    expect(screen.queryByText('old-commitment.pdf')).not.toBeInTheDocument()
    expect(screen.getByText('Plot Plan')).toBeInTheDocument()
  })

  it('deletes a document after confirming, and saves the change', async () => {
    const lotCommitments = [{
      id: 1,
      projectId: 7,
      lot: 'Lot 1',
      address: '',
      commitmentAmount: 0,
      attachments: [{ id: 'doc-1', name: 'old-plot-plan.pdf', label: 'Plot Plan' }],
    }]
    const onSaveLotCommitment = vi.fn().mockResolvedValue({
      id: 1,
      projectId: 7,
      lot: 'Lot 1',
      address: '',
      commitmentAmount: 0,
      attachments: [],
    })

    render(<LotCommitments lotCommitments={lotCommitments} activeProjectId={7} onSaveLotCommitment={onSaveLotCommitment} />)

    fireEvent.click(screen.getByLabelText('Lot 1 details'))
    expect(screen.getByText('Plot Plan')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByRole('button', { name: 'Confirm delete' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() => expect(onSaveLotCommitment).toHaveBeenCalledWith(expect.objectContaining({ attachments: [] })))
    expect(screen.queryByText('Plot Plan')).not.toBeInTheDocument()
  })

  it('renames a misclassified document label and saves the change', async () => {
    const lotCommitments = [{
      id: 1,
      projectId: 7,
      lot: 'Lot 1',
      address: '',
      commitmentAmount: 0,
      attachments: [{ id: 'doc-1', name: 'IMG_0042.jpg', label: 'Other' }],
    }]
    const onSaveLotCommitment = vi.fn().mockImplementation((payload) => Promise.resolve({ id: 1, ...payload }))

    render(<LotCommitments lotCommitments={lotCommitments} activeProjectId={7} onSaveLotCommitment={onSaveLotCommitment} />)

    fireEvent.click(screen.getByLabelText('Lot 1 details'))
    expect(screen.getByText('Other')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    fireEvent.change(screen.getByLabelText('Rename Other'), { target: { value: 'Elevation Drawings' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSaveLotCommitment).toHaveBeenCalledWith(expect.objectContaining({
      attachments: [expect.objectContaining({ id: 'doc-1', label: 'Elevation Drawings' })],
    })))
    expect(screen.queryByText('Other')).not.toBeInTheDocument()
    expect(screen.getByText('Elevation Drawings')).toBeInTheDocument()
  })

  it('hides the manual save button once a commitment letter is on file and nothing has changed', () => {
    const lotCommitments = [{
      id: 1,
      projectId: 7,
      lot: 'Lot 3',
      address: '789 Tryon Rd, Lot 3',
      commitmentAmount: 175000,
      attachments: [{ id: 'letter-1', name: 'commitment.pdf', label: 'Commitment Letter' }],
    }]

    render(<LotCommitments lotCommitments={lotCommitments} activeProjectId={7} onSaveLotCommitment={() => {}} />)

    fireEvent.click(screen.getByLabelText('Lot 3 details'))
    expect(screen.queryByRole('button', { name: 'Save Lot 3 commitment' })).not.toBeInTheDocument()
    expect(screen.getByText('Saved automatically from the commitment letter — no need to save again.')).toBeInTheDocument()
  })

  it('brings the save button back once you edit a field by hand, even with a commitment letter on file', () => {
    const lotCommitments = [{
      id: 1,
      projectId: 7,
      lot: 'Lot 3',
      address: '789 Tryon Rd, Lot 3',
      commitmentAmount: 175000,
      attachments: [{ id: 'letter-1', name: 'commitment.pdf', label: 'Commitment Letter' }],
    }]

    render(<LotCommitments lotCommitments={lotCommitments} activeProjectId={7} onSaveLotCommitment={() => {}} />)

    fireEvent.click(screen.getByLabelText('Lot 3 details'))
    fireEvent.change(screen.getByLabelText('Lot 3 address'), { target: { value: '789 Tryon Rd, Lot 3, Unit B' } })
    expect(screen.getByRole('button', { name: 'Save Lot 3 commitment' })).toBeInTheDocument()
  })

  it('updates the address and commitment amount from a replacement letter, not just the old ones', async () => {
    const lotCommitments = [{
      id: 1,
      projectId: 7,
      lot: 'Lot 3',
      address: 'Old wrong address',
      commitmentAmount: 100000,
      attachments: [{ id: 'old-letter', name: 'old-commitment.pdf', label: 'Commitment Letter' }],
    }]
    const onUploadDocument = vi.fn().mockResolvedValue({
      documentId: 'new-letter',
      storageBucket: 'accounting-documents',
      storagePath: '7/new-commitment.pdf',
      name: 'new-commitment.pdf',
      mimeType: 'application/pdf',
      size: 4096,
    })
    const onSaveLotCommitment = vi.fn().mockImplementation((payload) => Promise.resolve({ id: 1, ...payload }))
    extractLotCommitmentFromDocument.mockResolvedValueOnce({
      lot: 'Lot 3',
      address: '789 Corrected Ave, Lot 3',
      commitmentAmount: 175000,
      notes: '',
    })

    render(<LotCommitments lotCommitments={lotCommitments} activeProjectId={7} onSaveLotCommitment={onSaveLotCommitment} onUploadDocument={onUploadDocument} />)

    fireEvent.click(screen.getByLabelText('Lot 3 details'))
    const file = new File(['pdf'], 'new-commitment.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Upload Lot 3 commitment letter'), { target: { files: [file] } })

    await waitFor(() => expect(onSaveLotCommitment).toHaveBeenCalledWith(expect.objectContaining({
      address: '789 Corrected Ave, Lot 3',
      commitmentAmount: 175000,
    })))
    expect(screen.getByLabelText('Lot 3 address')).toHaveValue('789 Corrected Ave, Lot 3')
    expect(screen.getByLabelText('Lot 3 commitment amount')).toHaveValue(175000)
  })

  it('overwrites a manually-typed address and amount when the first commitment letter is uploaded', async () => {
    const onUploadDocument = vi.fn().mockResolvedValue({
      documentId: 'first-letter',
      storageBucket: 'accounting-documents',
      storagePath: '7/first-commitment.pdf',
      name: 'first-commitment.pdf',
      mimeType: 'application/pdf',
      size: 4096,
    })
    const onSaveLotCommitment = vi.fn().mockImplementation((payload) => Promise.resolve({ id: 1, ...payload }))
    extractLotCommitmentFromDocument.mockResolvedValueOnce({
      lot: 'Lot 3',
      address: '789 Corrected Ave, Lot 3',
      commitmentAmount: 175000,
      notes: '',
    })

    render(<LotCommitments activeProjectId={7} onSaveLotCommitment={onSaveLotCommitment} onUploadDocument={onUploadDocument} />)

    fireEvent.click(screen.getByLabelText('Lot 3 details'))
    fireEvent.change(screen.getByLabelText('Lot 3 address'), { target: { value: 'Placeholder address I typed by hand' } })
    fireEvent.change(screen.getByLabelText('Lot 3 commitment amount'), { target: { value: '1' } })

    const file = new File(['pdf'], 'first-commitment.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Upload Lot 3 commitment letter'), { target: { files: [file] } })

    await waitFor(() => expect(onSaveLotCommitment).toHaveBeenCalledWith(expect.objectContaining({
      address: '789 Corrected Ave, Lot 3',
      commitmentAmount: 175000,
    })))
    expect(screen.getByLabelText('Lot 3 address')).toHaveValue('789 Corrected Ave, Lot 3')
    expect(screen.getByLabelText('Lot 3 commitment amount')).toHaveValue(175000)
  })

  it('shows a Subdivision parent card above the individual lots for shared documents', () => {
    render(<LotCommitments activeProjectId={7} onSaveLotCommitment={() => {}} />)

    expect(screen.getByText('Subdivision (applies to all lots)')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Subdivision details'))
    expect(screen.getByLabelText('Subdivision address')).toBeInTheDocument()
    expect(screen.queryByLabelText('Subdivision commitment amount')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Subdivision address'), { target: { value: '4700 Tryon Subdivision' } })
    expect(screen.getByRole('button', { name: 'Save Subdivision address' })).toBeInTheDocument()
  })

  it('routes a bulk-uploaded subdivision-wide document to the Subdivision entry, not Lot 1', async () => {
    const onUploadDocument = vi.fn().mockResolvedValue({
      documentId: 'plat-1', storageBucket: 'accounting-documents', storagePath: '7/plat.pdf', name: 'plat.pdf', mimeType: 'application/pdf', size: 100,
    })
    classifyLotDocument.mockResolvedValueOnce({ lot: 'Subdivision', documentType: 'Subdivision Plat', address: '', commitmentAmount: null, notes: '' })
    const onSaveLotCommitment = vi.fn().mockImplementation((payload) => Promise.resolve({ id: 1, ...payload }))

    render(<LotCommitments activeProjectId={7} onSaveLotCommitment={onSaveLotCommitment} onUploadDocument={onUploadDocument} />)

    fireEvent.change(screen.getByLabelText('Bulk upload documents'), { target: { files: [new File(['a'], 'plat.pdf', { type: 'application/pdf' })] } })

    await waitFor(() => expect(onSaveLotCommitment).toHaveBeenCalledWith(expect.objectContaining({ lot: 'Subdivision' })))
    expect(screen.getByText('Subdivision · Subdivision Plat')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Subdivision details'))
    expect(screen.getByText('Subdivision Plat')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Subdivision details'))
    fireEvent.click(screen.getByLabelText('Lot 1 details'))
    expect(screen.queryByText('Subdivision Plat')).not.toBeInTheDocument()
  })

  it('keeps two different pre-sale contracts for the same lot instead of one overwriting the other', async () => {
    const onUploadDocument = vi.fn()
      .mockResolvedValueOnce({ documentId: 'contract-1', storageBucket: 'accounting-documents', storagePath: '7/BuyerOne.pdf', name: 'BuyerOne.pdf', mimeType: 'application/pdf', size: 100 })
      .mockResolvedValueOnce({ documentId: 'contract-2', storageBucket: 'accounting-documents', storagePath: '7/BuyerTwo.pdf', name: 'BuyerTwo.pdf', mimeType: 'application/pdf', size: 100 })
    classifyLotDocument
      .mockResolvedValueOnce({ lot: 'Lot 2', documentType: 'Contract', address: '', commitmentAmount: null, documentDate: '2025-11-01', notes: '' })
      .mockResolvedValueOnce({ lot: 'Lot 2', documentType: 'Contract', address: '', commitmentAmount: null, documentDate: '2026-02-01', notes: '' })
    const onSaveLotCommitment = vi.fn().mockImplementation((payload) => Promise.resolve({ id: 1, ...payload }))

    render(<LotCommitments activeProjectId={7} onSaveLotCommitment={onSaveLotCommitment} onUploadDocument={onUploadDocument} />)

    const files = [
      new File(['a'], 'BuyerOne.pdf', { type: 'application/pdf' }),
      new File(['b'], 'BuyerTwo.pdf', { type: 'application/pdf' }),
    ]
    fireEvent.change(screen.getByLabelText('Bulk upload documents'), { target: { files } })

    await waitFor(() => expect(onSaveLotCommitment).toHaveBeenLastCalledWith(expect.objectContaining({
      attachments: [
        expect.objectContaining({ label: 'Contract – BuyerOne' }),
        expect.objectContaining({ label: 'Contract – BuyerTwo' }),
      ],
    })))
    fireEvent.click(screen.getByLabelText('Lot 2 details'))
    expect(screen.getByText('Contract – BuyerOne')).toBeInTheDocument()
    expect(screen.getByText('Contract – BuyerTwo')).toBeInTheDocument()
  })

  it('sorts multiple bulk-uploaded documents to their classified lots and saves each one', async () => {
    const onUploadDocument = vi.fn()
      .mockResolvedValueOnce({ documentId: 'doc-a', storageBucket: 'accounting-documents', storagePath: '7/a.pdf', name: 'a.pdf', mimeType: 'application/pdf', size: 100 })
      .mockResolvedValueOnce({ documentId: 'doc-b', storageBucket: 'accounting-documents', storagePath: '7/b.pdf', name: 'b.pdf', mimeType: 'application/pdf', size: 100 })
      .mockResolvedValueOnce({ documentId: 'doc-c', storageBucket: 'accounting-documents', storagePath: '7/c.pdf', name: 'c.pdf', mimeType: 'application/pdf', size: 100 })
    classifyLotDocument
      .mockResolvedValueOnce({ lot: 'Lot 2', documentType: 'Plot Plan', address: '', commitmentAmount: null, notes: '' })
      .mockResolvedValueOnce({ lot: 'Lot 3', documentType: 'Commitment Letter', address: '111 Lot 3 St', commitmentAmount: 200000, notes: '' })
      .mockResolvedValueOnce({ lot: null, documentType: 'Survey', address: '', commitmentAmount: null, notes: '' })
    const onSaveLotCommitment = vi.fn().mockImplementation((payload) => Promise.resolve({ id: 1, ...payload }))

    render(<LotCommitments activeProjectId={7} onSaveLotCommitment={onSaveLotCommitment} onUploadDocument={onUploadDocument} />)

    const files = [
      new File(['a'], 'a.pdf', { type: 'application/pdf' }),
      new File(['b'], 'b.pdf', { type: 'application/pdf' }),
      new File(['c'], 'c.pdf', { type: 'application/pdf' }),
    ]
    fireEvent.change(screen.getByLabelText('Bulk upload documents'), { target: { files } })

    await waitFor(() => expect(onSaveLotCommitment).toHaveBeenCalledTimes(2))

    expect(await screen.findByText('Lot 2 · Plot Plan')).toBeInTheDocument()
    expect(screen.getByTitle('a.pdf')).toBeInTheDocument()
    expect(screen.getByText('Lot 3 · Commitment Letter')).toBeInTheDocument()
    expect(screen.getByTitle('b.pdf')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Lot 2 details'))
    expect(screen.getByText('Plot Plan')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Lot 3 details'))
    expect(screen.getByLabelText('Lot 3 address')).toHaveValue('111 Lot 3 St')
    expect(screen.getByLabelText('Lot 3 commitment amount')).toHaveValue(200000)

    // The third file couldn't be confidently matched to a lot, so it's held for manual review
    // instead of being guessed into Lot 1 and risking a collision with an unrelated document.
    expect(screen.getByText('needs review — pick a lot below')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Assign c.pdf to lot'), { target: { value: 'Lot 4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }))

    await waitFor(() => expect(onSaveLotCommitment).toHaveBeenCalledWith(expect.objectContaining({
      lot: 'Lot 4',
      attachments: [expect.objectContaining({ label: 'Survey' })],
    })))
    expect(screen.queryByLabelText('Assign c.pdf to lot')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Lot 4 details'))
    expect(within(screen.getByLabelText('Lot 4 details').closest('.lot-commitment-card')).getByText('Survey')).toBeInTheDocument()
  })

  it('replaces an older duplicate of the same document type in the same lot when both have dates', async () => {
    const lotCommitments = [{
      id: 1,
      projectId: 7,
      lot: 'Lot 2',
      address: '',
      commitmentAmount: 0,
      attachments: [{ id: 'old-survey', name: 'survey-jan.pdf', label: 'Survey', documentDate: '2026-01-10' }],
    }]
    const onUploadDocument = vi.fn().mockResolvedValue({
      documentId: 'new-survey', storageBucket: 'accounting-documents', storagePath: '7/survey-jun.pdf', name: 'survey-jun.pdf', mimeType: 'application/pdf', size: 100,
    })
    classifyLotDocument.mockResolvedValueOnce({ lot: 'Lot 2', documentType: 'Survey', address: '', commitmentAmount: null, documentDate: '2026-06-01', notes: '' })
    const onSaveLotCommitment = vi.fn().mockImplementation((payload) => Promise.resolve({ id: 1, ...payload }))

    render(<LotCommitments lotCommitments={lotCommitments} activeProjectId={7} onSaveLotCommitment={onSaveLotCommitment} onUploadDocument={onUploadDocument} />)

    fireEvent.change(screen.getByLabelText('Bulk upload documents'), { target: { files: [new File(['a'], 'survey-jun.pdf', { type: 'application/pdf' })] } })

    await waitFor(() => expect(onSaveLotCommitment).toHaveBeenCalledWith(expect.objectContaining({
      attachments: [expect.objectContaining({ name: 'survey-jun.pdf', documentDate: '2026-06-01' })],
    })))
    expect(await screen.findByText('replaced the older "Survey"')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Lot 2 details'))
    expect(screen.queryByText('survey-jan.pdf')).not.toBeInTheDocument()
  })

  it('flags a same-type duplicate for review instead of guessing when a date is unknown', async () => {
    const lotCommitments = [{
      id: 1,
      projectId: 7,
      lot: 'Lot 2',
      address: '',
      commitmentAmount: 0,
      attachments: [{ id: 'old-survey', name: 'survey-undated.pdf', label: 'Survey' }],
    }]
    const onUploadDocument = vi.fn().mockResolvedValue({
      documentId: 'new-survey', storageBucket: 'accounting-documents', storagePath: '7/survey-2.pdf', name: 'survey-2.pdf', mimeType: 'application/pdf', size: 100,
    })
    classifyLotDocument.mockResolvedValueOnce({ lot: 'Lot 2', documentType: 'Survey', address: '', commitmentAmount: null, documentDate: null, notes: '' })
    const onSaveLotCommitment = vi.fn().mockImplementation((payload) => Promise.resolve({ id: 1, ...payload }))

    render(<LotCommitments lotCommitments={lotCommitments} activeProjectId={7} onSaveLotCommitment={onSaveLotCommitment} onUploadDocument={onUploadDocument} />)

    fireEvent.change(screen.getByLabelText('Bulk upload documents'), { target: { files: [new File(['a'], 'survey-2.pdf', { type: 'application/pdf' })] } })

    await waitFor(() => expect(onSaveLotCommitment).toHaveBeenCalled())
    expect(await screen.findByText('flagged duplicate "Survey" for manual review (date unclear)')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Lot 2 details'))
    expect(screen.getByText('Survey')).toBeInTheDocument()
    expect(screen.getByText('Survey (needs review — duplicate, unclear date)')).toBeInTheDocument()
  })

  it('keeps processing remaining files when one upload fails instead of aborting the whole batch', async () => {
    const onUploadDocument = vi.fn()
      .mockRejectedValueOnce(new Error('storage quota exceeded'))
      .mockResolvedValueOnce({ documentId: 'doc-b', storageBucket: 'accounting-documents', storagePath: '7/b.pdf', name: 'b.pdf', mimeType: 'application/pdf', size: 100 })
    classifyLotDocument.mockResolvedValueOnce({ lot: 'Lot 2', documentType: 'Plot Plan', address: '', commitmentAmount: null, notes: '' })
    const onSaveLotCommitment = vi.fn().mockImplementation((payload) => Promise.resolve({ id: 1, ...payload }))

    render(<LotCommitments activeProjectId={7} onSaveLotCommitment={onSaveLotCommitment} onUploadDocument={onUploadDocument} />)

    const files = [
      new File(['a'], 'a.pdf', { type: 'application/pdf' }),
      new File(['b'], 'b.pdf', { type: 'application/pdf' }),
    ]
    fireEvent.change(screen.getByLabelText('Bulk upload documents'), { target: { files } })

    await waitFor(() => expect(onSaveLotCommitment).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/upload failed — storage quota exceeded/)).toBeInTheDocument()
    expect(screen.getByText('Lot 2 · Plot Plan')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Lot 2 details'))
    expect(screen.getByText('Plot Plan')).toBeInTheDocument()
  })
})
