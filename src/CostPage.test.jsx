import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CostPage from './CostPage'
import { extractTransactionFromImage } from './lib/gemini'
import { extractPdfDocumentText } from './lib/pdfText'

vi.mock('./lib/gemini', () => ({
  extractTransactionFromImage: vi.fn().mockResolvedValue({
    vendor: 'Horizon Concrete',
    amount: 12500.75,
    date: '2026-07-10',
    costName: 'Horizon Concrete – Foundation Delivery',
    details: 'Concrete delivery for the foundation, including sales tax.',
    description: 'Concrete delivery',
    reference: 'HC-1042',
    notes: 'Paid by card.',
    phase: 'construction',
    category: 'Foundation',
    lot: 'Lot 2',
  }),
}))

vi.mock('./lib/pdfText', () => ({
  extractPdfDocumentText: vi.fn().mockResolvedValue(''),
}))

describe('CostPage invoice extraction', () => {
  it('fills a readable statement without depending on the AI service', async () => {
    extractPdfDocumentText.mockResolvedValueOnce('BALANCE 300.75 ALL ACCOUNTS ARE DUE 09/20/26 CUSTOMER 1234567 08/31/26 1234567 08/31/26 STATEMENT INVOICE NO. 08/21/26 100001I 09/20/26 100.50 PO# STUDS 100001I 100.50 08/28/26 100002I 09/20/26 200.25 PO# SHAFTWALL 100002I 200.25')
    const priorCalls = extractTransactionFromImage.mock.calls.length
    render(<CostPage activeProjectId={7} owners={[{ id: 1, name: 'GreenFort' }]} developmentCosts={[]} costVersions={[]} onBack={() => {}} onAddDevelopmentCost={() => {}} onEditDevelopmentCost={() => {}} onDeleteDevelopmentCost={() => {}} />)
    fireEvent.change(screen.getByLabelText(/upload receipt, cost image, or pdf/i), {
      target: { files: [new File(['statement'], 'statement.pdf', { type: 'application/pdf' })] },
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Analyze receipt' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Analyze receipt' }))
    await waitFor(() => expect(screen.getByLabelText(/^cost amount$/i)).toHaveValue(300.75))
    expect(screen.getByLabelText(/^invoice date$/i)).toHaveValue('2026-08-31')
    expect(screen.getByLabelText(/cost comments or receipt details/i).value).toContain('100001I')
    expect(screen.getByLabelText('Vendor or payee')).toHaveValue('')
    expect(extractTransactionFromImage.mock.calls.length).toBe(priorCalls)
  })

  it('keeps the add-cost editor collapsed when costs already exist and expands it on demand', () => {
    const existingCost = { id: 1, costId: 'cost-1', version: 1, name: 'Foundation', amount: 25000, ownerId: 1, phase: 'construction', date: '2026-07-16', attachments: [] }
    render(<CostPage
      owners={[{ id: 1, name: 'GreenFort' }]}
      developmentCosts={[existingCost]}
      costVersions={[existingCost]}
      onBack={() => {}}
      onAddDevelopmentCost={() => {}}
      onEditDevelopmentCost={() => {}}
      onDeleteDevelopmentCost={() => {}}
    />)

    expect(document.getElementById('cost-editor-form')).toHaveAttribute('hidden')
    fireEvent.click(screen.getByRole('button', { name: 'Expand cost form' }))
    expect(document.getElementById('cost-editor-form')).not.toHaveAttribute('hidden')
    fireEvent.click(screen.getByRole('button', { name: 'Collapse cost form' }))
    expect(document.getElementById('cost-editor-form')).toHaveAttribute('hidden')
  })

  it('shows the newest added cost first by default even when its invoice is older', () => {
    const olderEntry = { id: 1, costId: 'older-entry', name: 'Older entry', amount: 100, date: '2026-09-20', createdAt: '2026-09-20T12:00:00Z' }
    const newBackdatedEntry = { id: 2, costId: 'new-entry', name: 'New backdated entry', amount: 200, date: '2025-09-09', createdAt: '2026-09-25T12:00:00Z' }
    const costs = [olderEntry, newBackdatedEntry].map((cost) => ({ ...cost, version: 1, ownerId: 1, phase: 'construction', attachments: [], lotAllocations: [] }))
    const { container } = render(<CostPage
      owners={[{ id: 1, name: 'Green Fort' }]}
      developmentCosts={costs}
      costVersions={costs}
      onBack={() => {}}
      onAddDevelopmentCost={() => {}}
      onEditDevelopmentCost={() => {}}
      onDeleteDevelopmentCost={() => {}}
    />)

    const cards = () => container.querySelectorAll('.cost-record-card')
    expect(screen.getByLabelText('Order costs')).toHaveValue('added_desc')
    expect(cards()[0]).toHaveTextContent('New backdated entry')
    fireEvent.change(screen.getByLabelText('Order costs'), { target: { value: 'invoice_desc' } })
    expect(cards()[0]).toHaveTextContent('Older entry')
  })

  it('shows a confirmed payment without inventing a payment date', () => {
    const paidCost = {
      id: 1, costId: 'narron', version: 2, name: 'Ground Work — Narron', amount: 582964.27,
      ownerId: 1, phase: 'development', date: '2026-05-31', paymentStatus: 'paid',
      paymentDate: '', attachments: [], lotAllocations: [],
    }
    const { container } = render(<CostPage
      owners={[{ id: 1, name: 'Green Fort' }]}
      developmentCosts={[paidCost]}
      costVersions={[paidCost]}
      onBack={() => {}}
      onAddDevelopmentCost={() => {}}
      onEditDevelopmentCost={() => {}}
      onDeleteDevelopmentCost={() => {}}
    />)

    const card = container.querySelector('.cost-record-card')
    expect(card).toHaveTextContent('Paid · date not recorded')
    expect(card).not.toHaveTextContent('Payment warning')
    fireEvent.click(within(card).getByRole('button', { name: 'Edit cost' }))
    expect(screen.getByLabelText('Paid, date not known')).toBeChecked()
    expect(screen.getByLabelText('Payment date')).toHaveValue('')
  })

  it('shows a reimbursement clearly and reveals the matching expense when searched', () => {
    const reimbursement = {
      id: 1, costId: 'builders-expenses', version: 1,
      name: 'Builders Expenses — Mike Dehghan reimbursement', vendorName: 'Mike Dehghan',
      amount: 2743.68, ownerId: 1, phase: 'construction', date: '2026-09-25',
      createdAt: '2026-09-25T14:00:00Z', notes: 'Zelle planned',
      details: 'Eight expenses supported by the attached PDF.',
      lotAllocations: [1, 2, 3, 4].map((number) => ({ lot: `Lot ${number}`, amount: 685.92 })),
      attachments: [],
    }
    const older = { id: 2, costId: 'older', version: 1, name: 'Older cost', amount: 100, ownerId: 1, phase: 'construction', date: '2026-08-01', createdAt: '2026-08-01T14:00:00Z', attachments: [] }
    const breakdowns = [
      { id: 3, costId: 'portable-toilet', parentCostId: reimbursement.costId, name: 'Meridian portable toilet', amount: 53.10, phase: 'construction', date: '2025-09-09', details: 'Invoice 6842813' },
      { id: 4, costId: 'lumber', parentCostId: reimbursement.costId, name: 'Lowe’s lumber', amount: 2690.58, phase: 'construction', date: '2026-08-10' },
    ]
    const { container } = render(<CostPage
      owners={[{ id: 1, name: 'Green Fort' }]}
      developmentCosts={[older, reimbursement]}
      breakdownCosts={breakdowns}
      costVersions={[older, reimbursement, ...breakdowns]}
      onBack={() => {}}
      onAddDevelopmentCost={() => {}}
      onEditDevelopmentCost={() => {}}
      onDeleteDevelopmentCost={() => {}}
    />)

    const cards = container.querySelectorAll('.cost-record-card')
    expect(cards[0]).toHaveTextContent('Builders Expenses — Mike Dehghan reimbursement')
    expect(within(cards[0]).getByLabelText('Reimbursement summary')).toHaveTextContent('To reimburse: Mike Dehghan')
    expect(within(cards[0]).getByLabelText('Reimbursement summary')).toHaveTextContent('Zelle planned · payment not recorded')
    expect(within(cards[0]).getByLabelText('Reimbursement summary')).toHaveTextContent('4 lots · $685.92 per lot')
    fireEvent.click(within(cards[0]).getByRole('button', { name: 'View 2 expense items' }))
    expect(screen.getByText(/Meridian portable toilet/)).toBeInTheDocument()
    fireEvent.click(within(cards[0]).getByRole('button', { name: 'Hide expense items' }))
    fireEvent.change(screen.getByLabelText('Search costs'), { target: { value: '6842813' } })
    expect(screen.getByText(/Meridian portable toilet/)).toBeInTheDocument()
    expect(screen.getByText('Matching expense items shown below')).toBeInTheDocument()
  })

  it('shows a development phase total without double-counting its breakdown details', () => {
    const developmentCosts = [
      { id: 1, costId: 'kemal-parent', version: 1, name: 'Kemal development', amount: 424238, ownerId: 1, phase: 'development', date: '2022-03-15', attachments: [] },
      { id: 2, costId: 'banu-parent', version: 1, name: 'Banu development', amount: 377914.79, ownerId: 2, phase: 'development', date: '2022-03-15', attachments: [] },
      { id: 3, costId: 'construction-parent', version: 1, name: 'Construction', amount: 100000, ownerId: 1, phase: 'construction', date: '2026-07-01', attachments: [] },
    ]
    const breakdownCosts = [
      { id: 4, costId: 'kemal-land', parentCostId: 'kemal-parent', version: 1, name: 'Land', amount: 268533, ownerId: 1, phase: 'development', date: '2022-03-15', attachments: [] },
      { id: 5, costId: 'banu-heloc', parentCostId: 'banu-parent', version: 1, name: 'HELOC Interest', amount: 8047.49, ownerId: 2, phase: 'development', date: '2025-07-01', attachments: [] },
    ]
    render(<CostPage
      owners={[{ id: 1, name: 'Kemal I' }, { id: 2, name: 'Banu U' }]}
      developmentCosts={developmentCosts}
      breakdownCosts={breakdownCosts}
      costVersions={[...developmentCosts, ...breakdownCosts]}
      onBack={() => {}}
      onAddDevelopmentCost={() => {}}
      onEditDevelopmentCost={() => {}}
      onDeleteDevelopmentCost={() => {}}
    />)

    fireEvent.change(screen.getByLabelText('Filter costs by phase'), { target: { value: 'development' } })
    const summary = screen.getByLabelText('Development phase totals')
    expect(within(summary).getByRole('heading', { name: 'Development phase total' })).toBeInTheDocument()
    expect(summary).toHaveTextContent('$802,152.79')
    expect(summary).toHaveTextContent('Counts 2 top-level costs once')
    expect(summary).toHaveTextContent('2 breakdown rows')
    expect(summary).toHaveTextContent('Kemal I$424,238')
    expect(summary).toHaveTextContent('Banu U$377,914.79')
    expect(summary).toHaveTextContent('Breakdown details shown$276,580.49')
  })

  it('filters directly to 2022 invoice dates and keeps the historical fee editable', async () => {
    const historical = { id: 1, costId: 'fee-2022', version: 1, name: 'March 2022 fee', amount: 1458, ownerId: 1, phase: 'development', date: '2022-03-15', attachments: [] }
    const recent = { id: 2, costId: 'fee-2026', version: 1, name: 'July 2026 fee', amount: 500, ownerId: 1, phase: 'development', date: '2026-07-14', attachments: [] }
    render(<CostPage
      owners={[{ id: 1, name: 'Kemal I' }]}
      developmentCosts={[historical, recent]}
      breakdownCosts={[]}
      costVersions={[historical, recent]}
      onBack={() => {}}
      onAddDevelopmentCost={() => {}}
      onEditDevelopmentCost={() => {}}
      onDeleteDevelopmentCost={() => {}}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Date list' }))
    expect(screen.getByLabelText('Filter costs from invoice date')).not.toHaveAttribute('min')
    fireEvent.change(screen.getByLabelText('Filter costs from invoice date'), { target: { value: '2022-01-01' } })
    fireEvent.change(screen.getByLabelText('Filter costs through invoice date'), { target: { value: '2022-12-31' } })

    const dateList = screen.getByRole('table', { name: 'Costs ordered by invoice date' })
    expect(within(dateList).getByText('March 2022 fee')).toBeInTheDocument()
    expect(within(dateList).queryByText('July 2026 fee')).not.toBeInTheDocument()
    fireEvent.click(within(dateList).getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Edit project cost' })).toBeInTheDocument())
    expect(screen.getByLabelText('Invoice date')).toHaveValue('2022-03-15')
  })

  it('filters costs with common invoice date range presets and supports custom dates', () => {
    const localDate = (year, month, day) => [year, String(month + 1).padStart(2, '0'), String(day).padStart(2, '0')].join('-')
    const today = new Date()
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 10)
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 10)
    const fourMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 4, 10)
    const sevenMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 7, 10)
    const costs = [
      { id: 1, costId: 'this-month', name: 'This month cost', date: localDate(thisMonth.getFullYear(), thisMonth.getMonth(), 10) },
      { id: 2, costId: 'last-month', name: 'Last month cost', date: localDate(lastMonth.getFullYear(), lastMonth.getMonth(), 10) },
      { id: 3, costId: 'four-months', name: 'Four months ago cost', date: localDate(fourMonthsAgo.getFullYear(), fourMonthsAgo.getMonth(), 10) },
      { id: 4, costId: 'seven-months', name: 'Seven months ago cost', date: localDate(sevenMonthsAgo.getFullYear(), sevenMonthsAgo.getMonth(), 10) },
    ].map((cost) => ({ ...cost, version: 1, amount: 100, ownerId: 1, phase: 'construction', attachments: [], lotAllocations: [] }))
    const { container } = render(<CostPage
      owners={[{ id: 1, name: 'GreenFort' }]}
      developmentCosts={costs}
      costVersions={costs}
      onBack={() => {}}
      onAddDevelopmentCost={() => {}}
      onEditDevelopmentCost={() => {}}
      onDeleteDevelopmentCost={() => {}}
    />)

    const range = screen.getByLabelText('Filter costs by invoice date range')
    fireEvent.change(range, { target: { value: 'this_month' } })
    expect(container.querySelectorAll('.cost-record-card')).toHaveLength(1)
    expect(container.querySelector('.cost-record-card')).toHaveTextContent('This month cost')

    fireEvent.change(range, { target: { value: 'last_month' } })
    expect(container.querySelectorAll('.cost-record-card')).toHaveLength(1)
    expect(container.querySelector('.cost-record-card')).toHaveTextContent('Last month cost')

    fireEvent.change(range, { target: { value: 'last_6_months' } })
    expect(container.querySelectorAll('.cost-record-card')).toHaveLength(3)

    fireEvent.change(screen.getByLabelText('Filter costs from invoice date'), { target: { value: '2022-01-01' } })
    expect(range).toHaveValue('custom')

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(range).toHaveValue('all')
    expect(screen.getByLabelText('Filter costs from invoice date')).toHaveValue('')
    expect(screen.getByLabelText('Filter costs through invoice date')).toHaveValue('')
  })

  it('creates a detailed report from the active filters without adding breakdowns to the accounting total', () => {
    const parent = { id: 1, costId: 'land-parent', version: 1, name: 'Initial land cost', category: 'Land cost', amount: 300000, ownerId: 1, phase: 'development', date: '2022-03-15', paymentDate: '2022-03-16', paymentMethod: 'kemal_personal_bank', attachments: [] }
    const detail = { id: 2, costId: 'closing-fee', parentCostId: 'land-parent', version: 1, name: 'Closing fee', category: 'Permits & municipal fees', amount: 1458, ownerId: 1, phase: 'development', date: '2022-03-15', attachments: [] }
    render(<CostPage
      projectName="Tryon Road"
      owners={[{ id: 1, name: 'Kemal I' }]}
      developmentCosts={[parent]}
      breakdownCosts={[detail]}
      costVersions={[parent, detail]}
      onBack={() => {}}
      onAddDevelopmentCost={() => {}}
      onEditDevelopmentCost={() => {}}
      onDeleteDevelopmentCost={() => {}}
    />)

    fireEvent.change(screen.getByLabelText('Filter costs by phase'), { target: { value: 'development' } })
    fireEvent.change(screen.getByLabelText('Filter costs from invoice date'), { target: { value: '2022-01-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create detailed report' }))

    const report = screen.getByLabelText('Filtered cost report')
    expect(report).toHaveTextContent('Tryon Road · Filtered cost detail')
    expect(within(report).getByLabelText('Applied report filters')).toHaveTextContent('Phase: Development')
    expect(within(report).getByLabelText('Applied report filters')).toHaveTextContent('From invoice date: 2022-01-01')
    expect(report).toHaveTextContent('Initial land cost')
    expect(report).toHaveTextContent('Closing fee')
    expect(report).toHaveTextContent('included in parent total')
    expect(report).toHaveTextContent('Accounting total$300,000')
  })

  it('marks and merges Development breakdowns per owner while previewing one combined ledger sum', async () => {
    const parents = [
      { id: 1, costId: 'kemal-parent', version: 1, name: 'Kemal development', amount: 300, ownerId: 1, phase: 'development', date: '2022-03-01', attachments: [] },
      { id: 2, costId: 'banu-parent', version: 1, name: 'Banu development', amount: 700, ownerId: 2, phase: 'development', date: '2022-03-01', attachments: [] },
    ]
    const breakdowns = [
      { id: 3, costId: 'kemal-land-a', parentCostId: 'kemal-parent', name: 'Kemal land payment', amount: 100, ownerId: 1, phase: 'development', date: '2022-03-01', attachments: [] },
      { id: 4, costId: 'kemal-land-b', parentCostId: 'kemal-parent', name: 'Kemal closing fee', amount: 200, ownerId: 1, phase: 'development', date: '2022-03-02', attachments: [] },
      { id: 5, costId: 'banu-land-a', parentCostId: 'banu-parent', name: 'Banu land payment', amount: 300, ownerId: 2, phase: 'development', date: '2022-03-01', attachments: [] },
      { id: 6, costId: 'banu-land-b', parentCostId: 'banu-parent', name: 'Banu closing fee', amount: 400, ownerId: 2, phase: 'development', date: '2022-03-02', attachments: [] },
    ]
    const onMergeBreakdowns = vi.fn().mockResolvedValue({})
    render(<CostPage
      owners={[{ id: 1, name: 'Kemal I' }, { id: 2, name: 'Banu U' }]}
      developmentCosts={parents}
      breakdownCosts={breakdowns}
      costVersions={[...parents, ...breakdowns]}
      onBack={() => {}}
      onAddDevelopmentCost={() => {}}
      onEditDevelopmentCost={() => {}}
      onDeleteDevelopmentCost={() => {}}
      onMergeBreakdowns={onMergeBreakdowns}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Date list' }))
    fireEvent.change(screen.getByLabelText('Filter costs by phase'), { target: { value: 'development' } })
    for (const name of ['Kemal land payment', 'Kemal closing fee', 'Banu land payment', 'Banu closing fee']) {
      fireEvent.click(screen.getByLabelText(`Mark ${name} for Development ledger merge`))
    }
    const mergePanel = screen.getByLabelText('Development ledger merge')
    expect(mergePanel).toHaveTextContent('4 selected')
    expect(mergePanel).toHaveTextContent('$1,000')
    fireEvent.change(screen.getByLabelText('Development ledger group name'), { target: { value: 'Initial land cost' } })
    fireEvent.click(screen.getByRole('button', { name: 'Merge marked costs' }))

    await waitFor(() => expect(onMergeBreakdowns).toHaveBeenCalledTimes(2))
    expect(onMergeBreakdowns).toHaveBeenCalledWith('kemal-parent', ['kemal-land-a', 'kemal-land-b'], 'Initial land cost')
    expect(onMergeBreakdowns).toHaveBeenCalledWith('banu-parent', ['banu-land-a', 'banu-land-b'], 'Initial land cost')
  })

  it('shows a merged ledger group once and hides its retained audit items from the flat date list', () => {
    const parent = { id: 1, costId: 'kemal-parent', version: 1, name: 'Kemal development', amount: 300, ownerId: 1, phase: 'development', date: '2022-03-01', attachments: [] }
    const group = { id: 2, costId: 'land-group', parentCostId: 'kemal-parent', name: 'Initial land cost', amount: 300, ownerId: 1, phase: 'development', date: '2022-03-02', attachments: [] }
    const items = [
      { id: 3, costId: 'land-a', parentCostId: 'land-group', name: 'Land payment', amount: 100, ownerId: 1, phase: 'development', date: '2022-03-01', attachments: [] },
      { id: 4, costId: 'land-b', parentCostId: 'land-group', name: 'Closing fee', amount: 200, ownerId: 1, phase: 'development', date: '2022-03-02', attachments: [] },
    ]
    render(<CostPage
      owners={[{ id: 1, name: 'Kemal I' }]}
      developmentCosts={[parent]}
      breakdownCosts={[group, ...items]}
      costVersions={[parent, group, ...items]}
      onBack={() => {}}
      onAddDevelopmentCost={() => {}}
      onEditDevelopmentCost={() => {}}
      onDeleteDevelopmentCost={() => {}}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Date list' }))
    fireEvent.change(screen.getByLabelText('Filter costs by phase'), { target: { value: 'development' } })
    const dateList = screen.getByRole('table', { name: 'Costs ordered by invoice date' })
    expect(within(dateList).getByText('Initial land cost')).toBeInTheDocument()
    expect(within(dateList).queryByText('Land payment')).not.toBeInTheDocument()
    expect(within(dateList).queryByText('Closing fee')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Development phase totals')).toHaveTextContent('Breakdown details shown$300')
  })




  it('splits a multi-lot truss quote by its printed lot lines and allocates shared tax proportionally', async () => {
    vi.mocked(extractPdfDocumentText).mockResolvedValueOnce('TRYON TH LOT 1 22865.09 TRYON TH LOT 2 27918.74 TRYON TH LOT 3 27822.61 TRYON TH LOT 4 22649.71 TAX 7341.07 TOTAL 108597.22')
    vi.mocked(extractTransactionFromImage).mockResolvedValueOnce({
      vendor: 'Builders FirstSource', vendorMailingAddress: 'PO Box 896730, Charlotte, NC 28289-6730',
      amount: 108597.22, date: '2026-07-13', costName: 'Roof trusses',
      details: 'Quote for Tryon townhome roof trusses; estimate only.', description: 'Truss package for Lots 1–4',
      reference: '5100223', notes: 'Quote; not proof of payment.', phase: 'construction', category: 'Framing', lot: null,
      paymentMethod: 'unknown', paymentFeePercentage: null, paymentDate: null,
      lotAllocations: [],
    })
    const onAddDevelopmentCost = vi.fn()
    render(<CostPage
      activeProjectId={7}
      projectName="Tryon Rd"
      owners={[{ id: 1, name: 'Green Fort' }]}
      developmentCosts={[]}
      costVersions={[]}
      onBack={() => {}}
      onAddDevelopmentCost={onAddDevelopmentCost}
      onEditDevelopmentCost={() => {}}
      onDeleteDevelopmentCost={() => {}}
    />)

    fireEvent.change(screen.getByLabelText(/upload receipt, cost image, or pdf/i), {
      target: { files: [new File(['quote'], 'tryon_trusses.pdf', { type: 'application/pdf' })] },
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Analyze receipt' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Analyze receipt' }))

    await waitFor(() => expect(screen.getByLabelText('Cost lot')).toHaveValue('Shared'))
    expect(screen.getByLabelText('Cost name')).toHaveValue('Roof trusses')
    expect(screen.getByLabelText('Cost amount')).toHaveValue(108597.22)
    expect(screen.getByLabelText('Lot 1 allocation')).toHaveValue(24522.81)
    expect(screen.getByLabelText('Lot 2 allocation')).toHaveValue(29942.85)
    expect(screen.getByLabelText('Lot 3 allocation')).toHaveValue(29839.75)
    expect(screen.getByLabelText('Lot 4 allocation')).toHaveValue(24291.81)
    expect(screen.getByText(/split across 4 lots/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^add cost$/i }))
    await waitFor(() => expect(onAddDevelopmentCost).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Roof trusses', amount: 108597.22, phase: 'construction', category: 'Framing',
      lotAllocations: [
        { lot: 'Lot 1', amount: 24522.81 },
        { lot: 'Lot 2', amount: 29942.85 },
        { lot: 'Lot 3', amount: 29839.75 },
        { lot: 'Lot 4', amount: 24291.81 },
      ],
    })))
  })

  it('moves focus to the upper editor and clearly enters edit mode', () => {
    const scrollIntoView = vi.fn()
    const onOpenDocument = vi.fn().mockResolvedValue(undefined)
    Element.prototype.scrollIntoView = scrollIntoView
    const receipt = { documentId: 'receipt-1', name: 'engineering-invoice.pdf', storagePath: '2/engineering-invoice.pdf', mimeType: 'application/pdf' }
    const cost = { id: 1, costId: 'cost-1', version: 3, name: 'Engineering fees', amount: 1250, ownerId: 1, phase: 'soft_cost', date: '2026-07-01', attachments: [receipt] }
    render(
      <CostPage
        owners={[{ id: 1, name: 'Banu U' }]}
        developmentCosts={[cost]}
        breakdownCosts={[]}
        costVersions={[cost]}
        projectChecks={[{
          id: 7, costId: 'cost-1', checkNumber: '147', payee: 'Engineering Vendor', amount: 1250,
          date: '2026-07-02', accountLabel: 'Bank of America', status: 'printed', memo: 'Invoice payment', lot: 'Lot 2',
        }]}
        onBack={() => {}}
        onAddDevelopmentCost={() => {}}
        onEditDevelopmentCost={() => {}}
        onDeleteDevelopmentCost={() => {}}
        onOpenDocument={onOpenDocument}
      />,
    )

    fireEvent.click(screen.getByLabelText('More actions for Engineering fees'))
    expect(screen.getByRole('menuitem', { name: 'Delete cost' })).toHaveClass('destructive')
    expect(screen.queryByRole('menuitem', { name: 'Edit cost' })).not.toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    fireEvent.click(screen.getByRole('button', { name: 'Edit cost' }))

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    expect(screen.getByLabelText('Cost name')).toHaveFocus()
    expect(screen.getByRole('heading', { name: 'Edit project cost' })).toBeInTheDocument()
    expect(screen.getByText(/Update the fields below/)).toHaveTextContent('Save new version')
    expect(screen.getByText('Receipts attached to this cost')).toBeInTheDocument()
    const editorPaymentRecords = within(document.querySelector('.cost-editor-panel')).getByLabelText('Invoices and check details')
    expect(editorPaymentRecords).toHaveTextContent('engineering-invoice.pdf')
    expect(editorPaymentRecords).toHaveTextContent('Check #147')
    expect(editorPaymentRecords).toHaveTextContent('Engineering Vendor · Bank of America')
    expect(editorPaymentRecords).toHaveTextContent('Invoice payment')
    fireEvent.click(screen.getByRole('button', { name: 'Preview receipt: engineering-invoice.pdf' }))
    expect(onOpenDocument).toHaveBeenCalledWith(receipt)
  })

  it('shows a merged total while retaining its individual dated items', () => {
    const parent = { id: 1, costId: 'parent', version: 1, name: 'All Development Cost', amount: 1000, ownerId: 1, phase: 'development', date: '2026-07-14', attachments: [] }
    const merged = { ...parent, id: 2, costId: 'merged', parentCostId: 'parent', name: 'Merged fees', amount: 300, date: '2023-02-01' }
    const items = [
      { ...parent, id: 3, costId: 'item-a', parentCostId: 'merged', name: 'Fee A', amount: 100, date: '2023-01-01' },
      { ...parent, id: 4, costId: 'item-b', parentCostId: 'merged', name: 'Fee B', amount: 200, date: '2023-02-01' },
    ]
    render(
      <CostPage
        owners={[{ id: 1, name: 'Banu U' }]}
        developmentCosts={[parent]}
        breakdownCosts={[merged, ...items]}
        costVersions={[parent, merged, ...items]}
        onBack={() => {}}
        onAddDevelopmentCost={() => {}}
        onEditDevelopmentCost={() => {}}
        onDeleteDevelopmentCost={() => {}}
      />,
    )

    const parentCard = screen.getByText('All Development Cost', { selector: '.cost-record-title' }).closest('.cost-record-card')
    expect(parentCard.querySelector('.cost-record-amount')).toHaveTextContent('$1,000')
    expect(parentCard.querySelector('.allocation-status')).toHaveTextContent('Partially broken down')
    expect(parentCard.querySelector('.cost-allocation-summary')).toHaveTextContent(/Broken down\s*\$300/)
    expect(parentCard.querySelector('.cost-allocation-summary')).toHaveTextContent(/Not broken down\s*\$700/)
    expect(parentCard.querySelector('.cost-allocation-summary')).toHaveTextContent(/Breakdown items\s*1/)
    fireEvent.click(screen.getByRole('button', { name: 'Show breakdowns (1)' }))
    expect(screen.getByText('Merged breakdown total', { exact: false })).toBeInTheDocument()
    expect(screen.getAllByText('$300.00')).not.toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Show merged items (2)' }))
    expect(screen.getByText(/Fee A/)).toBeInTheDocument()
    expect(screen.getByText(/Individual item.*2023-01-01/i)).toBeInTheDocument()
    expect(screen.getByText(/Fee B/)).toBeInTheDocument()
    expect(screen.getByText(/Individual item.*2023-02-01/i)).toBeInTheDocument()
  })

  it('marks decimal breakdowns as fully broken down when they match to the cent', () => {
    const parent = { id: 1, costId: 'parent', version: 1, name: 'All Development Cost', amount: 377914.79, ownerId: 1, phase: 'development', date: '2026-07-14', attachments: [] }
    const amounts = [204219, 75500, 35450, 20000, 19629, 14841.47, 4141, 2553.22, 1581.10]
    const breakdowns = amounts.map((amount, index) => ({
      ...parent,
      id: index + 2,
      costId: `item-${index}`,
      parentCostId: 'parent',
      name: `Item ${index + 1}`,
      amount,
    }))

    render(<CostPage
      owners={[{ id: 1, name: 'Banu U' }]}
      developmentCosts={[parent]}
      breakdownCosts={breakdowns}
      costVersions={[parent, ...breakdowns]}
      onBack={() => {}}
      onAddDevelopmentCost={() => {}}
      onEditDevelopmentCost={() => {}}
      onDeleteDevelopmentCost={() => {}}
    />)

    const parentCard = screen.getByText('All Development Cost', { selector: '.cost-record-title' }).closest('.cost-record-card')
    expect(parentCard.querySelector('.allocation-status')).toHaveTextContent('Fully broken down')
    expect(parentCard.querySelector('.cost-allocation-summary')).toHaveTextContent(/Not broken down\s*\$0/)
  })

  it('adds another sibling to a merged group and can unmerge the group', async () => {
    const onAddItemsToGroup = vi.fn().mockResolvedValue({})
    const onUnmergeGroup = vi.fn().mockResolvedValue({})
    const parent = { id: 1, costId: 'parent', version: 1, name: 'All Development Cost', amount: 1000, ownerId: 1, phase: 'development', date: '2026-07-14', attachments: [] }
    const merged = { ...parent, id: 2, costId: 'merged', parentCostId: 'parent', name: 'Merged fees', amount: 300, date: '2023-02-01' }
    const items = [
      { ...parent, id: 3, costId: 'item-a', parentCostId: 'merged', name: 'Fee A', amount: 100, date: '2023-01-01' },
      { ...parent, id: 4, costId: 'item-b', parentCostId: 'merged', name: 'Fee B', amount: 200, date: '2023-02-01' },
    ]
    const sibling = { ...parent, id: 5, costId: 'item-c', parentCostId: 'parent', name: 'Fee C', amount: 75, date: '2023-03-01' }
    render(
      <CostPage
        owners={[{ id: 1, name: 'Banu U' }]}
        developmentCosts={[parent]}
        breakdownCosts={[merged, ...items, sibling]}
        costVersions={[parent, merged, ...items, sibling]}
        onBack={() => {}}
        onAddDevelopmentCost={() => {}}
        onEditDevelopmentCost={() => {}}
        onDeleteDevelopmentCost={() => {}}
        onAddItemsToGroup={onAddItemsToGroup}
        onUnmergeGroup={onUnmergeGroup}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show breakdowns (2)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add items to Merged fees' }))
    fireEvent.click(screen.getByLabelText('Add Fee C to Merged fees'))
    fireEvent.click(screen.getByRole('button', { name: 'Add selected to group (1)' }))
    await waitFor(() => expect(onAddItemsToGroup).toHaveBeenCalledWith('merged', ['item-c']))

    fireEvent.click(screen.getByRole('button', { name: 'Unmerge' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm unmerge' }))
    await waitFor(() => expect(onUnmergeGroup).toHaveBeenCalledWith('merged'))
  })

  it('selects sibling breakdowns and merges them under their parent', async () => {
    const onMergeBreakdowns = vi.fn().mockResolvedValue({})
    const parentCost = {
      id: 10, costId: 'parent-cost', version: 1, name: 'All Development cost',
      amount: 100000, ownerId: 1, phase: 'development', date: '2026-07-14', attachments: [],
    }
    const breakdownCosts = [
      { ...parentCost, id: 11, costId: 'child-a', parentCostId: 'parent-cost', name: 'Engineering A', amount: 100, date: '2022-01-01' },
      { ...parentCost, id: 12, costId: 'child-b', parentCostId: 'parent-cost', name: 'Engineering B', amount: 500, date: '2023-01-01' },
    ]
    render(
      <CostPage
        owners={[{ id: 1, name: 'Banu U' }]}
        developmentCosts={[parentCost]}
        breakdownCosts={breakdownCosts}
        costVersions={[parentCost, ...breakdownCosts]}
        onBack={() => {}}
        onAddDevelopmentCost={() => {}}
        onEditDevelopmentCost={() => {}}
        onDeleteDevelopmentCost={() => {}}
        onMergeBreakdowns={onMergeBreakdowns}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show breakdowns (2)' }))
    fireEvent.click(screen.getByLabelText('Select Engineering A for merge'))
    fireEvent.click(screen.getByLabelText('Select Engineering B for merge'))
    fireEvent.change(screen.getByLabelText('Merged breakdown name for All Development cost'), {
      target: { value: 'Combined Engineering' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Merge selected' }))

    expect(onMergeBreakdowns).toHaveBeenCalledWith(
      'parent-cost',
      expect.arrayContaining(['child-a', 'child-b']),
      'Combined Engineering',
    )
  })

  it('shows stored attachments and accepts files dropped directly onto a cost', async () => {
    const onAttachDocument = vi.fn().mockResolvedValue({})
    const onOpenDocument = vi.fn().mockResolvedValue(undefined)
    const parentCost = {
      id: 1, costId: 'parent', version: 1, name: 'HELOC Interest', amount: 8047.49,
      ownerId: 1, phase: 'development', date: '2026-07-14',
      attachments: [{ documentId: 'doc-1', name: 'flagstar.pdf', storagePath: '2/flagstar.pdf' }],
    }
    const { container } = render(
      <CostPage
        owners={[{ id: 1, name: 'Banu U' }]}
        developmentCosts={[parentCost]}
        breakdownCosts={[]}
        costVersions={[parentCost]}
        onBack={() => {}}
        onAddDevelopmentCost={() => {}}
        onEditDevelopmentCost={() => {}}
        onDeleteDevelopmentCost={() => {}}
        onAttachDocument={onAttachDocument}
        onOpenDocument={onOpenDocument}
      />,
    )

    expect(screen.getAllByText('$8,047.49')).not.toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Preview: flagstar.pdf' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Attachments (1)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Preview: flagstar.pdf' }))
    expect(onOpenDocument).toHaveBeenCalledWith(parentCost.attachments[0])
    const droppedFile = new File(['pdf'], 'new-statement.pdf', { type: 'application/pdf' })
    fireEvent.drop(container.querySelector('.cost-attachment-area'), { dataTransfer: { files: [droppedFile] } })
    expect(onAttachDocument).toHaveBeenCalledWith(parentCost, droppedFile)
  })

  it('offers every top-level cost in the parent breakdown dropdown', () => {
    const parentCosts = [
      { id: 1, costId: 'banu-one', version: 1, name: 'Banu Development', amount: 372854, ownerId: 1, phase: 'development', date: '2026-07-14', attachments: [] },
      { id: 2, costId: 'banu-two', version: 1, name: 'Banu Soft Costs', amount: 50000, ownerId: 1, phase: 'soft_cost', date: '2026-06-01', attachments: [] },
      { id: 3, costId: 'kemal-one', version: 1, name: 'Kemal Development', amount: 422780, ownerId: 2, phase: 'development', date: '2026-07-14', attachments: [] },
    ]
    render(
      <CostPage
        owners={[{ id: 1, name: 'Banu U' }, { id: 2, name: 'Kemal I' }]}
        developmentCosts={parentCosts}
        breakdownCosts={[]}
        costVersions={parentCosts}
        onBack={() => {}}
        onAddDevelopmentCost={() => {}}
        onEditDevelopmentCost={() => {}}
        onDeleteDevelopmentCost={() => {}}
      />,
    )

    fireEvent.change(screen.getByLabelText('Cost type'), { target: { value: 'breakdown' } })
    const parentSelect = screen.getByLabelText('Parent cost')
    expect(parentSelect).toHaveTextContent('Banu Development — Banu U — $372,854')
    expect(parentSelect).toHaveTextContent('Banu Soft Costs — Banu U — $50,000')
    expect(parentSelect).toHaveTextContent('Kemal Development — Kemal I — $422,780')
    fireEvent.change(parentSelect, { target: { value: 'banu-two' } })
    expect(screen.getByLabelText('Owner')).toHaveValue('1')
    expect(screen.getByLabelText('Cost phase')).toHaveValue('soft_cost')
    expect(screen.getByLabelText('Invoice date')).toHaveValue('2026-06-01')
  })

  it('defaults breakdowns to newest added and can sort by amount, date, or description', () => {
    const parentCost = {
      id: 10, costId: 'parent-cost', version: 1, name: 'All Development cost',
      amount: 100000, ownerId: 1, phase: 'development', date: '2026-07-14', attachments: [],
    }
    const breakdownCosts = [
      { ...parentCost, id: 11, costId: 'child-a', parentCostId: 'parent-cost', name: 'Older small item', amount: 100, date: '2022-01-01', createdAt: '2026-09-25T12:00:00Z' },
      { ...parentCost, id: 12, costId: 'child-b', parentCostId: 'parent-cost', name: 'Newer large item', amount: 500, date: '2023-01-01', createdAt: '2026-07-14T12:00:00Z' },
    ]
    const { container } = render(
      <CostPage
        owners={[{ id: 1, name: 'Kemal I' }]}
        developmentCosts={[parentCost]}
        breakdownCosts={breakdownCosts}
        costVersions={[parentCost, ...breakdownCosts]}
        onBack={() => {}}
        onAddDevelopmentCost={() => {}}
        onEditDevelopmentCost={() => {}}
        onDeleteDevelopmentCost={() => {}}
      />,
    )

    expect(container.querySelectorAll('.cost-breakdown-row')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Show breakdowns (2)' }))
    let rows = container.querySelectorAll('.cost-breakdown-row')
    expect(screen.getByLabelText('Sort breakdowns')).toHaveValue('added_desc')
    expect(rows[0]).toHaveTextContent('Older small item')
    fireEvent.change(screen.getByLabelText('Sort breakdowns'), { target: { value: 'amount_desc' } })
    rows = container.querySelectorAll('.cost-breakdown-row')
    expect(rows[0]).toHaveTextContent('Newer large item')
    fireEvent.change(screen.getByLabelText('Sort breakdowns'), { target: { value: 'date_asc' } })
    rows = container.querySelectorAll('.cost-breakdown-row')
    expect(rows[0]).toHaveTextContent('Older small item')
    fireEvent.change(screen.getByLabelText('Sort breakdowns'), { target: { value: 'name_desc' } })
    rows = container.querySelectorAll('.cost-breakdown-row')
    expect(rows[0]).toHaveTextContent('Older small item')
    fireEvent.click(screen.getByRole('button', { name: 'Hide breakdowns' }))
    expect(container.querySelectorAll('.cost-breakdown-row')).toHaveLength(0)
    fireEvent.change(screen.getByLabelText('Sort breakdowns'), { target: { value: 'amount_asc' } })
    rows = container.querySelectorAll('.cost-breakdown-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Older small item')
  })

  it('filters the cost list by search, phase, and owner', () => {
    const costs = [
      { id: 1, costId: 'banu', version: 1, name: 'Engineering', amount: 100, ownerId: 1, phase: 'soft_cost', category: 'Professional fees', paymentMethod: 'bank_transfer', date: '2026-07-01', attachments: [], lotAllocations: [] },
      { id: 2, costId: 'kemal', version: 1, name: 'Land interest', amount: 200, ownerId: 2, phase: 'development', category: 'Financing costs', constructionDraftId: 'job-1', paymentMethod: 'amex_business', paymentDate: '2026-07-05', date: '2026-07-02', attachments: [], lotAllocations: [{ lot: 'Lot 1', amount: 200 }] },
    ]
    const { container } = render(
      <CostPage
        owners={[{ id: 1, name: 'Banu U' }, { id: 2, name: 'Kemal I' }]}
        developmentCosts={costs}
        breakdownCosts={[]}
        costVersions={costs}
        constructionDrafts={[{ id: 'job-1', name: 'Site Work Job', sourceEstimates: {} }]}
        onBack={() => {}}
        onAddDevelopmentCost={() => {}}
        onEditDevelopmentCost={() => {}}
        onDeleteDevelopmentCost={() => {}}
      />,
    )

    expect(container.querySelectorAll('.cost-parent-row')).toHaveLength(2)
    fireEvent.change(screen.getByLabelText('Filter costs by owner'), { target: { value: '2' } })
    expect(container.querySelectorAll('.cost-parent-row')).toHaveLength(1)
    expect(container.querySelector('.cost-parent-row')).toHaveTextContent('Land interest')
    fireEvent.change(screen.getByLabelText('Filter costs by owner'), { target: { value: 'all' } })
    fireEvent.change(screen.getByLabelText('Filter costs by phase'), { target: { value: 'soft_cost' } })
    expect(container.querySelectorAll('.cost-parent-row')).toHaveLength(1)
    expect(container.querySelector('.cost-parent-row')).toHaveTextContent('Engineering')
    fireEvent.change(screen.getByLabelText('Search costs'), { target: { value: 'no match' } })
    expect(screen.getByText('No costs match these filters')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(container.querySelectorAll('.cost-parent-row')).toHaveLength(2)

    fireEvent.change(screen.getByLabelText('Filter costs by category'), { target: { value: 'Financing costs' } })
    expect(container.querySelectorAll('.cost-parent-row')).toHaveLength(1)
    expect(container.querySelector('.cost-parent-row')).toHaveTextContent('Land interest')
    fireEvent.change(screen.getByLabelText('Filter costs by job'), { target: { value: 'job-1' } })
    expect(container.querySelectorAll('.cost-parent-row')).toHaveLength(1)
    fireEvent.change(screen.getByLabelText('Filter costs by lot'), { target: { value: 'Lot 1' } })
    expect(container.querySelectorAll('.cost-parent-row')).toHaveLength(1)
    fireEvent.change(screen.getByLabelText('Filter costs by payment method'), { target: { value: 'amex_business' } })
    expect(container.querySelectorAll('.cost-parent-row')).toHaveLength(1)
    fireEvent.change(screen.getByLabelText('Filter costs by payment status'), { target: { value: 'paid' } })
    expect(container.querySelectorAll('.cost-parent-row')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByLabelText('Filter costs by category')).toHaveValue('all')
    expect(screen.getByLabelText('Filter costs by job')).toHaveValue('all')
    expect(screen.getByLabelText('Filter costs by lot')).toHaveValue('all')
    expect(screen.getByLabelText('Filter costs by payment method')).toHaveValue('all')
    expect(screen.getByLabelText('Filter costs by payment status')).toHaveValue('all')
  })

  it('saves a check-paid cost and opens a prefilled check draft', async () => {
    const onAddDevelopmentCost = vi.fn().mockResolvedValue({ costId: 'saved-cost', amount: 250 })
    const onCreateCheck = vi.fn()
    render(<CostPage
      owners={[{ id: 1, name: 'GreenFort' }]}
      developmentCosts={[]}
      costVersions={[]}
      onBack={() => {}}
      onAddDevelopmentCost={onAddDevelopmentCost}
      onEditDevelopmentCost={() => {}}
      onDeleteDevelopmentCost={() => {}}
      onCreateCheck={onCreateCheck}
    />)

    fireEvent.change(screen.getByLabelText('Cost name'), { target: { value: 'Plumbing payment' } })
    fireEvent.change(screen.getByLabelText('Cost amount'), { target: { value: '250' } })
    fireEvent.change(screen.getByLabelText('Invoice date'), { target: { value: '2026-08-02' } })
    fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'bofa_check' } })
    fireEvent.change(screen.getByLabelText('Cost lot'), { target: { value: 'Lot 2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save & create check' }))

    await waitFor(() => expect(onCreateCheck).toHaveBeenCalledWith({
      costId: 'saved-cost', payee: 'Plumbing payment', amount: 250, memo: 'Plumbing payment · Lot 2', mailingAddress: '', lot: 'Lot 2',
      templateKey: 'bofa', accountLabel: 'Bank of America',
    }))
  })

  it('offers a compact date-ordered list and free-searches category, lot, phase, and date', () => {
    const costs = [
      { id: 1, costId: 'engineering', version: 2, name: 'Engineering', amount: 100, ownerId: 1, phase: 'soft_cost', category: 'Professional fees', date: '2026-07-01', createdAt: '2026-08-05T15:00:00Z', attachments: [], lotAllocations: [] },
      { id: 2, costId: 'foundation', version: 1, name: 'Foundation contract', amount: 200, ownerId: 2, phase: 'construction', category: 'Foundation', date: '2026-07-03', createdAt: '2026-08-02T15:00:00Z', attachments: [], lotAllocations: [{ lot: 'Lot 2', amount: 200 }] },
    ]
    const breakdowns = [
      { id: 3, costId: 'concrete', parentCostId: 'foundation', version: 1, name: 'Concrete pour', amount: 75, ownerId: 2, phase: 'construction', category: 'Foundation', date: '2026-07-04', createdAt: '2026-08-03T15:00:00Z', attachments: [], lotAllocations: [] },
    ]
    render(
      <CostPage
        owners={[{ id: 1, name: 'Banu U' }, { id: 2, name: 'Kemal I' }]}
        developmentCosts={costs}
        breakdownCosts={breakdowns}
        costVersions={[{ ...costs[0], id: 4, version: 1, createdAt: '2026-08-01T09:00:00Z' }, ...costs, ...breakdowns]}
        onBack={() => {}}
        onAddDevelopmentCost={() => {}}
        onEditDevelopmentCost={() => {}}
        onDeleteDevelopmentCost={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Date list' }))
    expect(screen.getByRole('columnheader', { name: 'Invoice date' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Added date' })).toBeInTheDocument()
    let rows = screen.getAllByTestId('cost-date-list-row')
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Concrete pour'),
      expect.stringContaining('Foundation contract'),
      expect.stringContaining('Engineering'),
    ])

    fireEvent.change(screen.getByLabelText('Order costs by invoice date'), { target: { value: 'asc' } })
    rows = screen.getAllByTestId('cost-date-list-row')
    expect(rows[0]).toHaveTextContent('Engineering')
    expect(rows[0]).toHaveTextContent('2026-08-01')

    fireEvent.change(screen.getByLabelText('Search costs'), { target: { value: 'Lot 2' } })
    rows = screen.getAllByTestId('cost-date-list-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('Foundation contract')

    fireEvent.change(screen.getByLabelText('Search costs'), { target: { value: '2026-07-01' } })
    expect(screen.getByTestId('cost-date-list-row')).toHaveTextContent('Engineering')
  })

  it('adds a breakdown inside a parent cost without changing the parent amount', async () => {
    const onAddDevelopmentCost = vi.fn()
    const parentCost = {
      id: 10,
      costId: 'parent-cost',
      version: 1,
      name: 'All Development cost',
      amount: 100000,
      ownerId: 1,
      phase: 'development',
      date: '2026-07-14',
      attachments: [],
    }
    render(
      <CostPage
        owners={[{ id: 1, name: 'Kemal I' }]}
        developmentCosts={[parentCost]}
        breakdownCosts={[]}
        costVersions={[parentCost]}
        onBack={() => {}}
        onAddDevelopmentCost={onAddDevelopmentCost}
        onEditDevelopmentCost={() => {}}
        onDeleteDevelopmentCost={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /add breakdown/i }))
    expect(screen.getByRole('heading', { name: /new breakdown for all development cost/i })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/^cost name$/i), { target: { value: 'Engineering' } })
    fireEvent.change(screen.getByLabelText(/^cost amount$/i), { target: { value: '25000' } })
    fireEvent.click(screen.getByRole('button', { name: /^add breakdown$/i }))

    expect(onAddDevelopmentCost).toHaveBeenCalledWith(expect.objectContaining({
      parentCostId: 'parent-cost',
      name: 'Engineering',
      amount: 25000,
    }))
    expect(screen.getAllByText('$100,000.00')).not.toHaveLength(0)
  })

  it('saves soft cost and other phase options', async () => {
    const onAddDevelopmentCost = vi.fn()
    render(
      <CostPage
        owners={[{ id: 1, name: 'GreenFort' }]}
        developmentCosts={[]}
        costVersions={[]}
        onBack={() => {}}
        onAddDevelopmentCost={onAddDevelopmentCost}
        onEditDevelopmentCost={() => {}}
        onDeleteDevelopmentCost={() => {}}
      />,
    )

    expect(screen.getAllByRole('option', { name: 'Soft Cost' })).not.toHaveLength(0)
    expect(screen.getAllByRole('option', { name: 'Other' })).not.toHaveLength(0)
    fireEvent.change(screen.getByLabelText(/^cost name$/i), { target: { value: 'Architect fee' } })
    fireEvent.change(screen.getByLabelText(/^cost amount$/i), { target: { value: '500' } })
    fireEvent.change(screen.getByLabelText(/^invoice date$/i), { target: { value: '2026-07-14' } })
    fireEvent.change(screen.getByLabelText(/^cost phase$/i), { target: { value: 'soft_cost' } })
    fireEvent.click(screen.getByRole('button', { name: /^add cost$/i }))

    expect(onAddDevelopmentCost).toHaveBeenCalledWith(expect.objectContaining({ phase: 'soft_cost' }))
  })

  it('stages an uploaded invoice, then fills available cost fields when Analyze receipt is selected', async () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:receipt-preview')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const onAddDevelopmentCost = vi.fn()
    render(
      <CostPage
        activeProjectId={7}
        projectName="Tryon Rd"
        owners={[{ id: 1, name: 'GreenFort' }]}
        developmentCosts={[]}
        costVersions={[]}
        lotCommitments={[{ id: 1, lot: 'Lot 2', attachments: [] }]}
        onBack={() => {}}
        onAddDevelopmentCost={onAddDevelopmentCost}
        onEditDevelopmentCost={() => {}}
        onDeleteDevelopmentCost={() => {}}
      />,
    )

    const invoice = new File(['invoice'], 'invoice.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText(/upload receipt, cost image, or pdf/i), {
      target: { files: [invoice] },
    })

    expect(screen.getByLabelText(/^cost amount$/i)).toHaveValue(null)
    const analyzeButton = screen.getByRole('button', { name: 'Analyze receipt' })
    await waitFor(() => expect(analyzeButton).toBeEnabled())
    fireEvent.click(analyzeButton)

    expect(await screen.findByDisplayValue('Horizon Concrete – Foundation Delivery')).toBeInTheDocument()
    expect(screen.getByLabelText('Vendor or payee')).toHaveValue('Horizon Concrete')
    expect(screen.getByLabelText(/cost comments or receipt details/i)).toHaveValue('Concrete delivery for the foundation, including sales tax.\nConcrete delivery\nReference: HC-1042\nPaid by card.')
    expect(screen.getByLabelText(/^cost amount$/i)).toHaveValue(12500.75)
    expect(screen.getByLabelText(/^invoice date$/i)).toHaveValue('2026-07-10')
    expect(screen.getByLabelText(/^cost phase$/i)).toHaveValue('construction')
    expect(screen.getByLabelText(/^cost category$/i)).toHaveValue('Foundation')
    await waitFor(() => expect(screen.getByLabelText(/^cost lot$/i)).toHaveValue('Lot 2'))
    expect(extractTransactionFromImage).toHaveBeenLastCalledWith(invoice, 'Tryon Rd', 7, { knownLots: ['Lot 1', 'Lot 2', 'Lot 3', 'Lot 4'] })
    expect(screen.getByText('Receipt fields completed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Preview receipt' }))
    expect(await screen.findByRole('dialog', { name: 'Preview of invoice.png' })).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: 'invoice.png' })).toHaveAttribute('src', 'blob:receipt-preview')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:receipt-preview'))
    fireEvent.click(screen.getByRole('button', { name: /^add cost$/i }))
    await waitFor(() => expect(onAddDevelopmentCost).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Horizon Concrete – Foundation Delivery',
      details: 'Concrete delivery for the foundation, including sales tax.\nConcrete delivery\nReference: HC-1042\nPaid by card.',
    })))
    vi.unstubAllGlobals()
  })

  it('clearly lists required fields that receipt analysis could not read', async () => {
    vi.mocked(extractTransactionFromImage).mockResolvedValueOnce({
      vendor: 'Unclear vendor', amount: 0, date: '', description: '',
    })
    render(
      <CostPage
        owners={[]}
        developmentCosts={[]}
        costVersions={[]}
        onBack={() => {}}
        onAddDevelopmentCost={() => {}}
        onEditDevelopmentCost={() => {}}
        onDeleteDevelopmentCost={() => {}}
      />,
    )

    fireEvent.change(screen.getByLabelText(/upload receipt, cost image, or pdf/i), {
      target: { files: [new File(['invoice'], 'unclear.pdf', { type: 'application/pdf' })] },
    })
    const analyzeButton = screen.getByRole('button', { name: 'Analyze receipt' })
    await waitFor(() => expect(analyzeButton).toBeEnabled())
    fireEvent.click(analyzeButton)

    expect(await screen.findByText('Complete the highlighted information')).toBeInTheDocument()
    expect(screen.getByText(/Please add: amount, invoice date, owner/)).toBeInTheDocument()
  })

  it('replaces values from the previous analysis when a new receipt is analyzed', async () => {
    vi.mocked(extractTransactionFromImage)
      .mockResolvedValueOnce({
        vendor: 'First Vendor', amount: 866.27, date: '2026-08-15', costName: 'First loan payment',
        details: 'First payment confirmation', description: 'First payment', reference: 'FIRST-1',
        phase: 'soft_cost', category: 'Financing costs', lot: 'Lot 2', paymentMethod: 'ach', paymentDate: '2026-08-15',
      })
      .mockResolvedValueOnce({
        vendor: 'Providence Bank', amount: 870.62, date: '2026-08-16', costName: 'Second loan payment',
        details: 'Second payment confirmation', description: 'Second payment', reference: '459614',
        phase: 'soft_cost', category: 'Financing costs', lot: 'Lot 3', paymentMethod: 'ach', paymentDate: '2026-08-16',
      })

    render(<CostPage
      activeProjectId={7}
      projectName="Tryon Rd"
      owners={[{ id: 1, name: 'GreenFort' }]}
      developmentCosts={[]}
      costVersions={[]}
      onBack={() => {}}
      onAddDevelopmentCost={() => {}}
      onEditDevelopmentCost={() => {}}
      onDeleteDevelopmentCost={() => {}}
    />)

    const uploader = screen.getByLabelText(/upload receipt, cost image, or pdf/i)
    fireEvent.change(uploader, { target: { files: [new File(['first'], 'first.png', { type: 'image/png' })] } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Analyze receipt' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Analyze receipt' }))
    await waitFor(() => expect(screen.getByLabelText('Cost amount')).toHaveValue(866.27))

    fireEvent.change(uploader, { target: { files: [new File(['second'], 'second.png', { type: 'image/png' })] } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Analyze receipt' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Analyze receipt' }))

    await waitFor(() => expect(screen.getByLabelText('Cost amount')).toHaveValue(870.62))
    expect(screen.getByLabelText('Cost name')).toHaveValue('Second loan payment')
    expect(screen.getByLabelText('Invoice date')).toHaveValue('2026-08-16')
    expect(screen.getByLabelText('Cost lot')).toHaveValue('Lot 3')
    expect(screen.getByLabelText('Payment date')).toHaveValue('2026-08-16')
    expect(screen.getByLabelText(/cost comments or receipt details/i).value).toContain('Second payment confirmation')
    expect(screen.getByLabelText(/cost comments or receipt details/i).value).not.toContain('First payment confirmation')
  })

  it('categorizes a Providence loan receipt as financing cost for its mapped lot', async () => {
    vi.mocked(extractPdfDocumentText).mockResolvedValueOnce('Payment Confirmation Loan Account 053112657 -*0786 - CLxxxxx0786 Note ID 100500786 Amount Due $870.62')
    vi.mocked(extractTransactionFromImage).mockResolvedValueOnce({
      vendor: 'Providence Bank', amount: 870.62, date: '2026-08-16', costName: 'Loan payment request',
      details: 'Providence loan payment confirmation', description: 'Loan payment', reference: '459614',
      phase: 'other', category: 'Other', lot: null, paymentMethod: 'unknown', paymentDate: '2026-08-16',
    })

    render(<CostPage
      activeProjectId={7}
      projectName="Tryon Rd"
      owners={[{ id: 1, name: 'GreenFort' }]}
      developmentCosts={[]}
      costVersions={[]}
      onBack={() => {}}
      onAddDevelopmentCost={() => {}}
      onEditDevelopmentCost={() => {}}
      onDeleteDevelopmentCost={() => {}}
    />)

    fireEvent.change(screen.getByLabelText(/upload receipt, cost image, or pdf/i), {
      target: { files: [new File(['confirmation'], 'payment.pdf', { type: 'application/pdf' })] },
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Analyze receipt' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Analyze receipt' }))

    await waitFor(() => expect(screen.getByLabelText('Cost lot')).toHaveValue('Lot 3'))
    expect(screen.getByLabelText('Cost phase')).toHaveValue('soft_cost')
    expect(screen.getByLabelText('Cost category')).toHaveValue('Financing costs')
    expect(screen.getByLabelText('Payment method')).toHaveValue('providence_ach')
    expect(screen.getByLabelText(/cost comments or receipt details/i).value).toContain('CLxxxxx0786 / Note ID 100500786 mapped to Lot 3')
  })

  it('maps a plumbing receipt to the Plumbing Job and recognizes Amex Business', async () => {
    vi.mocked(extractPdfDocumentText).mockResolvedValueOnce('BILL TO 4700 Tryon Rd Lot 4 Raleigh NC FINISHED UNDER SLAB PLUMBING BACKWATER VALVES 5,880.00')
    vi.mocked(extractTransactionFromImage).mockResolvedValueOnce({
      vendor: 'Plumbing Supply Co', amount: 1000, date: '2026-07-20',
      costName: 'Finished under slab plumbing and roughed in under slab for backwater valves at 4700 Tryon Rd Lot 4',
      description: 'Finished under slab plumbing and roughed in backwater valves at 4700 Tryon Rd Lot 4',
      details: 'Under-slab work completed for backwater valves at 4700 Tryon Rd, Lot 4.', paymentMethod: 'amex_business',
      phase: 'construction', category: 'Plumbing', lot: null, reference: 'PS-12', notes: '',
    })
    const onAddDevelopmentCost = vi.fn()
    render(<CostPage
      activeProjectId={7}
      projectName="Tryon Rd"
      owners={[{ id: 1, name: 'GreenFort' }]}
      constructionDrafts={[{ id: 'plumbing-job', name: 'Plumbing Job', sourceEstimates: {} }]}
      developmentCosts={[]}
      costVersions={[]}
      onBack={() => {}}
      onAddDevelopmentCost={onAddDevelopmentCost}
      onEditDevelopmentCost={() => {}}
      onDeleteDevelopmentCost={() => {}}
    />)

    fireEvent.change(screen.getByLabelText(/upload receipt, cost image, or pdf/i), {
      target: { files: [new File(['receipt'], 'plumbing.pdf', { type: 'application/pdf' })] },
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Analyze receipt' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Analyze receipt' }))

    await waitFor(() => expect(screen.getByLabelText('Construction job')).toHaveValue('plumbing-job'))
    expect(screen.getByLabelText('Cost name')).toHaveValue('Under-slab plumbing')
    expect(screen.getByLabelText(/^cost lot$/i)).toHaveValue('Lot 4')
    expect(screen.getByLabelText(/^phase$/i)).toHaveValue('construction')
    expect(screen.getByLabelText(/^cost category$/i)).toHaveValue('Plumbing')
    expect(screen.getByLabelText(/cost comments or receipt details/i).value).toContain('backwater valves')
    expect(screen.getByLabelText('Payment method')).toHaveValue('amex_business')
    expect(screen.getByLabelText('Card fee percentage')).toHaveValue(3)
    fireEvent.change(screen.getByLabelText('Payment date'), { target: { value: '2026-08-15' } })
    expect(screen.getByLabelText('Total cost after card fee')).toHaveTextContent('$1,030')
    fireEvent.click(screen.getByRole('button', { name: /^add cost$/i }))
    await waitFor(() => expect(onAddDevelopmentCost).toHaveBeenCalledWith(expect.objectContaining({
      constructionDraftId: 'plumbing-job', paymentMethod: 'amex_business', paymentFeePercentage: 3,
      invoiceAmount: 1000, paymentFeeAmount: 30, amount: 1030, paymentDate: '2026-08-15',
      lotAllocations: [{ lot: 'Lot 4', amount: 1030 }],
    })))
  })

  it('explains why an unsupported invoice file cannot be uploaded', () => {
    render(
      <CostPage
        owners={[{ id: 1, name: 'GreenFort' }]}
        developmentCosts={[]}
        costVersions={[]}
        onBack={() => {}}
        onAddDevelopmentCost={() => {}}
        onEditDevelopmentCost={() => {}}
        onDeleteDevelopmentCost={() => {}}
      />,
    )

    const unsupportedFile = new File(['data'], 'invoice.txt', { type: 'text/plain' })
    fireEvent.change(screen.getByLabelText(/upload receipt, cost image, or pdf/i), {
      target: { files: [unsupportedFile] },
    })

    expect(screen.getByRole('alert')).toHaveTextContent(/image or pdf invoice/i)
  })

  it('converts a construction draft only after an actual amount and date are saved', async () => {
    const onAddDevelopmentCost = vi.fn().mockResolvedValue({ costId: 'cost-hvac' })
    const onConvertConstructionDraft = vi.fn().mockResolvedValue({})
    const constructionDraft = {
      id: 'draft-hvac', name: 'HVAC', details: 'Confirm final equipment.', plannedAmount: null,
      plannedDate: '', attachments: [], status: 'draft', convertedCostId: null,
    }
    Element.prototype.scrollIntoView = vi.fn()
    render(
      <CostPage
        owners={[{ id: 1, name: 'GreenFort' }]}
        developmentCosts={[]}
        costVersions={[]}
        constructionDrafts={[constructionDraft]}
        onBack={() => {}}
        onAddDevelopmentCost={onAddDevelopmentCost}
        onEditDevelopmentCost={() => {}}
        onDeleteDevelopmentCost={() => {}}
        onConvertConstructionDraft={onConvertConstructionDraft}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show construction drafts (1)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use as construction cost' }))

    expect(screen.getByLabelText('Cost name')).toHaveValue('HVAC')
    expect(screen.getByLabelText('Cost phase')).toHaveValue('construction')
    expect(screen.getByLabelText('Cost amount')).toHaveValue(null)
    expect(screen.getByLabelText('Invoice date')).toHaveValue('')

    fireEvent.change(screen.getByLabelText('Cost amount'), { target: { value: '17500' } })
    fireEvent.change(screen.getByLabelText('Invoice date'), { target: { value: '2026-10-15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add cost' }))

    await waitFor(() => expect(onAddDevelopmentCost).toHaveBeenCalledWith(expect.objectContaining({
      name: 'HVAC', amount: 17500, phase: 'construction', date: '2026-10-15',
    })))
    await waitFor(() => expect(onConvertConstructionDraft).toHaveBeenCalledWith('draft-hvac', 'cost-hvac'))
  })

  it('shows checks attached to parent costs and breakdowns', () => {
    const parent = { id: 1, costId: 'parent', version: 1, name: 'Foundation', amount: 25000, ownerId: 1, phase: 'construction', date: '2026-07-16', attachments: [] }
    const child = { ...parent, id: 2, costId: 'child', parentCostId: 'parent', name: 'Concrete delivery', amount: 5000 }
    render(<CostPage
      owners={[{ id: 1, name: 'GreenFort' }]}
      developmentCosts={[parent]}
      breakdownCosts={[child]}
      costVersions={[parent, child]}
      projectChecks={[
        { id: 10, costId: 'parent', checkNumber: '1042', amount: 1250.75, status: 'printed' },
        { id: 11, costId: 'child', checkNumber: '1043', amount: 500, status: 'draft' },
      ]}
      onBack={() => {}}
      onAddDevelopmentCost={() => {}}
      onEditDevelopmentCost={() => {}}
      onDeleteDevelopmentCost={() => {}}
    />)

    const paymentPanel = screen.getByLabelText('Invoices and check details')
    expect(paymentPanel).not.toHaveAttribute('open')
    fireEvent.click(within(paymentPanel).getByText('Invoices and payment records'))
    expect(paymentPanel).toHaveAttribute('open')
    expect(screen.getByText('#1042 · $1,250.75 · printed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show breakdowns (1)' }))
    expect(screen.getByText('#1043 · $500.00 · draft')).toBeInTheDocument()
  })

  it('saves a categorized lot cost', async () => {
    const onAddDevelopmentCost = vi.fn().mockResolvedValue({ costId: 'utility-cost' })
    render(<CostPage
      owners={[{ id: 1, name: 'GreenFort' }]}
      developmentCosts={[]}
      costVersions={[]}
      lotCommitments={[{ lot: 'Lot 2' }, { lot: 'Lot 3' }]}
      onBack={() => {}}
      onAddDevelopmentCost={onAddDevelopmentCost}
      onEditDevelopmentCost={() => {}}
      onDeleteDevelopmentCost={() => {}}
    />)

    fireEvent.change(screen.getByLabelText('Cost name'), { target: { value: 'Water connection' } })
    fireEvent.change(screen.getByLabelText('Cost amount'), { target: { value: '8197.15' } })
    fireEvent.change(screen.getByLabelText('Invoice date'), { target: { value: '2026-07-17' } })
    fireEvent.change(screen.getByLabelText('Cost phase'), { target: { value: 'construction' } })
    fireEvent.change(screen.getByLabelText('Cost category'), { target: { value: 'Site utilities' } })
    fireEvent.change(screen.getByLabelText('Vendor or payee'), { target: { value: 'City Utilities' } })
    fireEvent.change(screen.getByLabelText('Main cost category'), { target: { value: 'Soft / Development Costs' } })
    fireEvent.change(screen.getByLabelText('Cost subcategory'), { target: { value: 'Water / Sewer Fees' } })
    fireEvent.change(screen.getByLabelText('Paid by'), { target: { value: 'company' } })
    fireEvent.change(screen.getByLabelText('Payment source'), { target: { value: 'Providence operating account' } })
    fireEvent.change(screen.getByLabelText('Payment reference'), { target: { value: 'ACH-4471' } })
    fireEvent.click(screen.getByLabelText('Loan related / loan funded'))
    fireEvent.change(screen.getByLabelText('Cost lot'), { target: { value: 'Lot 3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add cost' }))

    await waitFor(() => expect(onAddDevelopmentCost).toHaveBeenCalledWith(expect.objectContaining({
      category: 'Site utilities',
      vendorName: 'City Utilities',
      mainCategory: 'Soft / Development Costs',
      subcategory: 'Water / Sewer Fees',
      payerType: 'company',
      paymentSource: 'Providence operating account',
      referenceNumber: 'ACH-4471',
      loanRelated: true,
      lotAllocations: [{ lot: 'Lot 3', amount: 8197.15 }],
    })))
  })

  it('assigns attorney fees in the construction phase to the construction legal category', async () => {
    const onAddDevelopmentCost = vi.fn().mockResolvedValue({ costId: 'legal-cost' })
    render(<CostPage
      owners={[{ id: 1, name: 'GreenFort' }]}
      developmentCosts={[]}
      costVersions={[]}
      onBack={() => {}}
      onAddDevelopmentCost={onAddDevelopmentCost}
      onEditDevelopmentCost={() => {}}
      onDeleteDevelopmentCost={() => {}}
    />)

    fireEvent.change(screen.getByLabelText('Cost name'), { target: { value: 'Attorney legal fee' } })
    fireEvent.change(screen.getByLabelText('Cost amount'), { target: { value: '2500' } })
    fireEvent.change(screen.getByLabelText('Invoice date'), { target: { value: '2026-08-27' } })
    fireEvent.change(screen.getByLabelText('Cost phase'), { target: { value: 'construction' } })
    fireEvent.change(screen.getByLabelText('Cost category'), { target: { value: 'Legal / attorney fees' } })

    expect(screen.getByLabelText('Main cost category')).toHaveValue('Legal & Professional Fees')
    expect(screen.getByLabelText('Cost subcategory')).toHaveValue('Attorney Fees')
    fireEvent.click(screen.getByRole('button', { name: 'Add cost' }))

    await waitFor(() => expect(onAddDevelopmentCost).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Attorney legal fee',
      phase: 'construction',
      category: 'Legal / attorney fees',
      mainCategory: 'Legal & Professional Fees',
      subcategory: 'Attorney Fees',
    })))
  })

  it('marks a top-level cost as the Soft Cost parent for child breakdowns', async () => {
    const onAddDevelopmentCost = vi.fn().mockResolvedValue({ costId: 'soft-parent' })
    render(<CostPage
      owners={[{ id: 1, name: 'Green Fort' }]}
      developmentCosts={[]}
      breakdownCosts={[]}
      costVersions={[]}
      onBack={() => {}}
      onAddDevelopmentCost={onAddDevelopmentCost}
      onEditDevelopmentCost={() => {}}
      onDeleteDevelopmentCost={() => {}}
    />)

    fireEvent.change(screen.getByLabelText('Cost name'), { target: { value: 'All Soft Costs' } })
    fireEvent.change(screen.getByLabelText('Cost amount'), { target: { value: '100000' } })
    fireEvent.change(screen.getByLabelText('Invoice date'), { target: { value: '2022-01-01' } })
    fireEvent.click(screen.getByLabelText('Use as Soft Cost parent'))
    expect(screen.getByLabelText('Cost phase')).toHaveValue('soft_cost')
    expect(screen.getByLabelText('Main cost category')).toHaveValue('Soft / Development Costs')
    fireEvent.click(screen.getByRole('button', { name: 'Add cost' }))

    await waitFor(() => expect(onAddDevelopmentCost).toHaveBeenCalledWith(expect.objectContaining({
      name: 'All Soft Costs', phase: 'soft_cost', mainCategory: 'Soft / Development Costs', isSoftCostParent: true,
    })))
  })

  it('allows a March 2022 development breakdown categorized as land cost', async () => {
    const parent = { id: 1, costId: 'kemal-development', version: 1, name: 'Kemal development costs', amount: 100000, ownerId: 2, phase: 'development', date: '2026-07-01', attachments: [] }
    const onAddDevelopmentCost = vi.fn().mockResolvedValue({ costId: 'land-breakdown' })
    render(<CostPage
      owners={[{ id: 2, name: 'Kemal Ilter' }]}
      developmentCosts={[parent]}
      breakdownCosts={[]}
      costVersions={[parent]}
      initialParentCostId="kemal-development"
      onBack={() => {}}
      onAddDevelopmentCost={onAddDevelopmentCost}
      onEditDevelopmentCost={() => {}}
      onDeleteDevelopmentCost={() => {}}
    />)

    expect(screen.getByLabelText('Invoice date')).not.toHaveAttribute('min')
    expect(within(screen.getByLabelText('Cost category')).getByRole('option', { name: 'Loan interest' })).toBeInTheDocument()
    expect(within(screen.getByLabelText('Cost category')).getByRole('option', { name: 'Owner contribution' })).toBeInTheDocument()
    expect(within(screen.getByLabelText('Cost category')).getByRole('option', { name: 'Kemal Equity Interest' })).toBeInTheDocument()
    expect(within(screen.getByLabelText('Cost category')).getByRole('option', { name: 'Banu Equity Interest' })).toBeInTheDocument()
    expect(within(screen.getByLabelText('Payment method')).getByRole('option', { name: 'Kemal Personal Bank Account' })).toBeInTheDocument()
    expect(within(screen.getByLabelText('Payment method')).getByRole('option', { name: 'Banu Personal Bank Account' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Cost name'), { target: { value: 'Original land acquisition' } })
    fireEvent.change(screen.getByLabelText('Cost amount'), { target: { value: '50000' } })
    fireEvent.change(screen.getByLabelText('Invoice date'), { target: { value: '2022-03-15' } })
    fireEvent.change(screen.getByLabelText('Cost category'), { target: { value: 'Land cost' } })
    fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'kemal_personal_bank' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add breakdown' }))

    await waitFor(() => expect(onAddDevelopmentCost).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 2,
      parentCostId: 'kemal-development',
      phase: 'development',
      category: 'Land cost',
      paymentMethod: 'kemal_personal_bank',
      date: '2022-03-15',
    })))
  })

  it('splits a shared cost evenly across individual lots to the cent', async () => {
    const onAddDevelopmentCost = vi.fn().mockResolvedValue({ costId: 'shared-cost' })
    render(<CostPage
      owners={[{ id: 1, name: 'GreenFort' }]}
      developmentCosts={[]}
      costVersions={[]}
      lotCommitments={[{ lot: 'Subdivision' }, { lot: 'Lot 1' }, { lot: 'Lot 2' }, { lot: 'Lot 3' }, { lot: 'Lot 4' }]}
      onBack={() => {}}
      onAddDevelopmentCost={onAddDevelopmentCost}
      onEditDevelopmentCost={() => {}}
      onDeleteDevelopmentCost={() => {}}
    />)
    fireEvent.change(screen.getByLabelText('Cost name'), { target: { value: 'Shared development' } })
    fireEvent.change(screen.getByLabelText('Cost amount'), { target: { value: '100.03' } })
    fireEvent.change(screen.getByLabelText('Invoice date'), { target: { value: '2026-07-22' } })
    fireEvent.change(screen.getByLabelText('Cost lot'), { target: { value: 'Shared' } })
    fireEvent.click(screen.getByRole('button', { name: 'Split evenly across 4 lots' }))
    expect(screen.getByLabelText('Lot 1 allocation')).toHaveValue(25.01)
    expect(screen.getByLabelText('Lot 4 allocation')).toHaveValue(25)
    fireEvent.click(screen.getByRole('button', { name: 'Add cost' }))
    await waitFor(() => expect(onAddDevelopmentCost).toHaveBeenCalledWith(expect.objectContaining({
      lotAllocations: [
        { lot: 'Lot 1', amount: 25.01 }, { lot: 'Lot 2', amount: 25.01 },
        { lot: 'Lot 3', amount: 25.01 }, { lot: 'Lot 4', amount: 25 },
      ],
    })))
  })

  it('reconciles stale shared allocations evenly when saving a higher total as a new version', async () => {
    const cost = {
      id: 1, costId: 'kemal-development', version: 2, name: 'Kemal development costs',
      amount: 424238, invoiceAmount: 424238, ownerId: 2, phase: 'development', category: 'Land cost',
      date: '2022-03-15', attachments: [],
      lotAllocations: ['Lot 1', 'Lot 2', 'Lot 3', 'Lot 4'].map((lot) => ({ lot, amount: 105695 })),
    }
    const onEditDevelopmentCost = vi.fn().mockResolvedValue({ ...cost, version: 3 })
    render(<CostPage
      owners={[{ id: 2, name: 'Kemal Ilter' }]}
      developmentCosts={[cost]}
      breakdownCosts={[]}
      costVersions={[cost]}
      initialEditCostId="kemal-development"
      onBack={() => {}}
      onAddDevelopmentCost={() => {}}
      onEditDevelopmentCost={onEditDevelopmentCost}
      onDeleteDevelopmentCost={() => {}}
    />)

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Edit project cost' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Save new version' }))

    await waitFor(() => expect(onEditDevelopmentCost).toHaveBeenCalledWith(expect.objectContaining({
      amount: 424238,
      lotAllocations: [
        { lot: 'Lot 1', amount: 106059.5 },
        { lot: 'Lot 2', amount: 106059.5 },
        { lot: 'Lot 3', amount: 106059.5 },
        { lot: 'Lot 4', amount: 106059.5 },
      ],
    })))
    expect(screen.queryByText(/Shared lot allocations must equal/)).not.toBeInTheDocument()
  })

  it('keeps the invoice total unchanged and removes a card fee exactly once when switching to check', async () => {
    const onAddDevelopmentCost = vi.fn().mockResolvedValue({ costId: 'shared-cost' })
    render(<CostPage
      owners={[{ id: 1, name: 'GreenFort' }]}
      developmentCosts={[]}
      costVersions={[]}
      lotCommitments={[{ lot: 'Lot 1' }, { lot: 'Lot 2' }, { lot: 'Lot 3' }, { lot: 'Lot 4' }]}
      onBack={() => {}}
      onAddDevelopmentCost={onAddDevelopmentCost}
      onEditDevelopmentCost={() => {}}
      onDeleteDevelopmentCost={() => {}}
    />)

    fireEvent.change(screen.getByLabelText('Cost name'), { target: { value: 'Shared invoice' } })
    fireEvent.change(screen.getByLabelText('Cost amount'), { target: { value: '1000' } })
    fireEvent.change(screen.getByLabelText('Invoice date'), { target: { value: '2026-08-13' } })
    fireEvent.change(screen.getByLabelText('Cost lot'), { target: { value: 'Shared' } })
    fireEvent.click(screen.getByRole('button', { name: 'Split evenly across 4 lots' }))

    fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'amex_business' } })
    expect(screen.getByLabelText('Cost amount')).toHaveValue(1000)
    expect(screen.getByLabelText('Card processing fee')).toHaveTextContent('$30')
    expect(screen.getByLabelText('Total cost after card fee')).toHaveTextContent('$1,030')
    expect(screen.getByLabelText('Lot 1 allocation')).toHaveValue(257.5)

    fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'check' } })
    expect(screen.getByLabelText('Cost amount')).toHaveValue(1000)
    expect(screen.queryByLabelText('Card processing fee')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Total cost after card fee')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Lot 1 allocation')).toHaveValue(250)

    fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'amex_business' } })
    fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'check' } })
    expect(screen.getByLabelText('Cost amount')).toHaveValue(1000)
    expect(screen.getByLabelText('Lot 1 allocation')).toHaveValue(250)

    fireEvent.click(screen.getByRole('button', { name: 'Add cost' }))
    await waitFor(() => expect(onAddDevelopmentCost).toHaveBeenCalledWith(expect.objectContaining({
      invoiceAmount: 1000,
      paymentMethod: 'check',
      paymentFeePercentage: null,
      paymentFeeAmount: null,
      amount: 1000,
      lotAllocations: [
        { lot: 'Lot 1', amount: 250 }, { lot: 'Lot 2', amount: 250 },
        { lot: 'Lot 3', amount: 250 }, { lot: 'Lot 4', amount: 250 },
      ],
    })))
  })

  it('shows top-level totals by lot and category without counting breakdowns twice', () => {
    const permit = { id: 1, costId: 'permit', version: 1, name: 'Building Permit', amount: 42954, ownerId: 1, phase: 'construction', category: 'Permits & municipal fees', lotAllocations: [{ lot: 'Lot 3', amount: 10872 }, { lot: 'Lot 4', amount: 32082 }], date: '2026-07-17', attachments: [] }
    const utility = { id: 2, costId: 'utility', version: 1, name: 'Water/Sewer Connection – Lot 3', amount: 8197.15, ownerId: 1, phase: 'construction', category: 'Site utilities', lotAllocations: [{ lot: 'Lot 3', amount: 8197.15 }], date: '2026-07-17', attachments: [] }
    const detail = { ...permit, id: 3, costId: 'detail', parentCostId: 'permit', name: 'Permit detail', amount: 1000 }
    render(<CostPage
      owners={[{ id: 1, name: 'GreenFort' }]}
      developmentCosts={[permit, utility]}
      breakdownCosts={[detail]}
      costVersions={[permit, utility, detail]}
      lotCommitments={[{ lot: 'Lot 3' }, { lot: 'Lot 4' }]}
      onBack={() => {}}
      onAddDevelopmentCost={() => {}}
      onEditDevelopmentCost={() => {}}
      onDeleteDevelopmentCost={() => {}}
    />)

    expect(screen.getByRole('heading', { name: 'All costs by lot and category' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Cost analysis view' })).toBeInTheDocument()
    expect(screen.getByLabelText('Sort cost analysis')).toHaveValue('amount_desc')
    fireEvent.change(screen.getByLabelText('Sort cost analysis'), { target: { value: 'date_desc' } })
    expect(screen.getByLabelText('Sort cost analysis')).toHaveValue('date_desc')
    expect(screen.getByLabelText('Costs grouped by lot')).toBeInTheDocument()
    expect(screen.getByText('$19,069.15')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'By category' }))
    expect(screen.getByLabelText('Costs grouped by category')).toBeInTheDocument()
    expect(screen.getAllByText('$51,151.15').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Permits & municipal fees').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Site utilities').length).toBeGreaterThan(0)
  })

  it('displays All lots instead of listing all four shared lots', () => {
    const sharedCost = {
      id: 1,
      costId: 'shared-cost',
      version: 1,
      name: 'Shared site work',
      amount: 400,
      ownerId: 1,
      phase: 'development',
      date: '2026-07-17',
      attachments: [],
      lotAllocations: [
        { lot: 'Lot 1', amount: 100 },
        { lot: 'Lot 2', amount: 100 },
        { lot: 'Lot 3', amount: 100 },
        { lot: 'Lot 4', amount: 100 },
      ],
    }
    const { container } = render(<CostPage
      owners={[{ id: 1, name: 'GreenFort' }]}
      developmentCosts={[sharedCost]}
      costVersions={[sharedCost]}
      onBack={() => {}}
      onAddDevelopmentCost={() => {}}
      onEditDevelopmentCost={() => {}}
      onDeleteDevelopmentCost={() => {}}
    />)

    const costCard = container.querySelector('.cost-record-card')
    expect(costCard).toHaveTextContent('All lots')
    expect(costCard).not.toHaveTextContent('Shared: Lot 1, Lot 2, Lot 3, Lot 4')
  })

  it('closes the three-dot cost menu when clicking elsewhere or choosing an action', () => {
    const cost = {
      id: 1, costId: 'menu-cost', version: 1, name: 'Menu test cost', amount: 100,
      ownerId: 1, phase: 'development', date: '2026-08-03', attachments: [], lotAllocations: [],
    }
    const { container } = render(<CostPage
      owners={[{ id: 1, name: 'GreenFort' }]}
      developmentCosts={[cost]}
      costVersions={[cost]}
      onBack={() => {}}
      onAddDevelopmentCost={() => {}}
      onEditDevelopmentCost={() => {}}
      onDeleteDevelopmentCost={() => {}}
    />)

    const menu = container.querySelector('.cost-overflow-menu')
    expect(container.querySelector('.cost-allocation-summary')).toHaveTextContent('No breakdowns added (optional)')
    expect(container.querySelector('.cost-allocation-summary')).not.toHaveTextContent('Not allocated')
    fireEvent.click(screen.getByLabelText('More actions for Menu test cost'))
    expect(menu).toHaveAttribute('open')
    fireEvent.pointerDown(document.body)
    expect(menu).not.toHaveAttribute('open')

    fireEvent.click(screen.getByLabelText('More actions for Menu test cost'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete cost' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Confirm delete' }))
    expect(menu).not.toHaveAttribute('open')
  })

  it('treats a voided linked check as unpaid and offers flexible recovery actions', () => {
    const cost = {
      id: 1, costId: 'voided-cost', version: 1, name: 'Under-slab plumbing', amount: 5880,
      ownerId: 1, phase: 'construction', category: 'Plumbing', paymentMethod: 'check', paymentDate: '2026-08-03', date: '2026-07-31', attachments: [], lotAllocations: [],
    }
    const onCreateCheck = vi.fn()
    const { container } = render(<CostPage
      owners={[{ id: 1, name: 'GreenFort' }]}
      developmentCosts={[cost]}
      costVersions={[cost]}
      projectChecks={[{ id: 9, costId: 'voided-cost', checkNumber: '1042', amount: 5880, status: 'voided' }]}
      onBack={() => {}}
      onAddDevelopmentCost={() => {}}
      onEditDevelopmentCost={() => {}}
      onDeleteDevelopmentCost={() => {}}
      onCreateCheck={onCreateCheck}
    />)

    const warning = screen.getByText('This cost is unpaid').closest('[role="alert"]')
    expect(warning).toHaveTextContent('Check #1042 was voided')
    expect(container.querySelector('.cost-record-badges')).toHaveTextContent('Unpaid')
    expect(container.querySelector('.voided-check-link')).toHaveTextContent('does not count as paid')
    fireEvent.click(screen.getByRole('button', { name: 'Create replacement check' }))
    expect(onCreateCheck).toHaveBeenCalledWith(expect.objectContaining({ costId: 'voided-cost', amount: 5880 }))

    fireEvent.change(screen.getByLabelText('Filter costs by payment status'), { target: { value: 'paid' } })
    expect(container.querySelectorAll('.cost-record-card')).toHaveLength(0)
  })

  it('treats a completed ACH as paid after earlier linked checks were voided', () => {
    const cost = {
      id: 1, costId: 'ach-after-voids', version: 1, name: 'Under-slab plumbing', amount: 7980,
      ownerId: 1, phase: 'construction', category: 'Plumbing', paymentMethod: 'bofa_ach',
      paymentDate: '2026-08-20', date: '2026-07-28', attachments: [], lotAllocations: [],
    }
    const { container } = render(<CostPage
      owners={[{ id: 1, name: 'GreenFort' }]}
      developmentCosts={[cost]}
      costVersions={[cost]}
      projectChecks={[
        { id: 145, costId: 'ach-after-voids', checkNumber: '145', amount: 7980, status: 'voided' },
        { id: 147, costId: 'ach-after-voids', checkNumber: '147', amount: 7980, status: 'voided' },
      ]}
      onBack={() => {}}
      onAddDevelopmentCost={() => {}}
      onEditDevelopmentCost={() => {}}
      onDeleteDevelopmentCost={() => {}}
    />)

    const badges = container.querySelector('.cost-record-badges')
    expect(badges).toHaveTextContent('Bank of America ACH')
    expect(badges).toHaveTextContent('Paid 2026-08-20')
    expect(badges).not.toHaveTextContent('Unpaid')
    expect(screen.queryByText('This cost is unpaid')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.voided-check-link')).toHaveLength(2)
  })

  it('treats a printed linked check as paid even when the cost has no check payment method', () => {
    const cost = {
      id: 1, costId: 'imported-permit-cost', version: 1, name: 'Building Permit', amount: 42954,
      ownerId: 1, phase: 'construction', category: 'Permits & municipal fees',
      date: '2026-07-17', attachments: [], lotAllocations: [],
    }
    const { container } = render(<CostPage
      owners={[{ id: 1, name: 'GreenFort' }]}
      developmentCosts={[cost]}
      costVersions={[cost]}
      projectChecks={[
        { id: 1, costId: 'imported-permit-cost', checkNumber: 'INV-00384377', amount: 10872, status: 'printed' },
        { id: 2, costId: 'imported-permit-cost', checkNumber: 'INV-00383387', amount: 10966, status: 'printed' },
        { id: 3, costId: 'imported-permit-cost', checkNumber: 'INV-00383635', amount: 10501, status: 'printed' },
        { id: 4, costId: 'imported-permit-cost', checkNumber: 'INV-00384001', amount: 10615, status: 'printed' },
      ]}
      onBack={() => {}}
      onAddDevelopmentCost={() => {}}
      onEditDevelopmentCost={() => {}}
      onDeleteDevelopmentCost={() => {}}
    />)

    const badges = container.querySelector('.cost-record-badges')
    expect(badges).toHaveTextContent('Paid by GreenFort')
    expect(badges).toHaveTextContent('Paid by printed check')
    expect(badges).not.toHaveTextContent('Unpaid')

    fireEvent.change(screen.getByLabelText('Filter costs by payment status'), { target: { value: 'paid' } })
    expect(container.querySelectorAll('.cost-record-card')).toHaveLength(1)
  })

  it('treats a fully broken-down parent as paid when every breakdown is paid', () => {
    const parent = {
      id: 1, costId: 'land-financing', version: 1, name: 'Land Interest & Financing', amount: 155822.69,
      ownerId: 1, phase: 'development', category: 'Loan interest', date: '2026-07-14', attachments: [], lotAllocations: [],
    }
    const amounts = [30000, 31000, 32000, 30000, 32822.69]
    const breakdowns = amounts.map((amount, index) => ({
      ...parent,
      id: index + 2,
      costId: `land-financing-${index + 1}`,
      parentCostId: parent.costId,
      name: `Financing payment ${index + 1}`,
      amount,
      paymentMethod: 'bofa_ach',
      paymentDate: `2026-0${index + 2}-14`,
    }))
    const { container } = render(<CostPage
      owners={[{ id: 1, name: 'GreenFort' }]}
      developmentCosts={[parent]}
      breakdownCosts={breakdowns}
      costVersions={[parent, ...breakdowns]}
      onBack={() => {}}
      onAddDevelopmentCost={() => {}}
      onEditDevelopmentCost={() => {}}
      onDeleteDevelopmentCost={() => {}}
    />)

    const badges = container.querySelector('.cost-record-badges')
    expect(badges).toHaveTextContent('Paid by GreenFort')
    expect(badges).toHaveTextContent('Paid through breakdowns')
    expect(badges).not.toHaveTextContent('Unpaid')

    fireEvent.change(screen.getByLabelText('Filter costs by payment status'), { target: { value: 'paid' } })
    expect(container.querySelectorAll('.cost-record-card')).toHaveLength(1)
  })

  it('keeps a fully broken-down parent unpaid when any breakdown is unpaid', () => {
    const parent = {
      id: 1, costId: 'partly-paid-parent', version: 1, name: 'Partly paid parent', amount: 1000,
      ownerId: 1, phase: 'development', date: '2026-07-14', attachments: [], lotAllocations: [],
    }
    const paidChild = { ...parent, id: 2, costId: 'paid-child', parentCostId: parent.costId, name: 'Paid child', amount: 600, paymentDate: '2026-07-15' }
    const unpaidChild = { ...parent, id: 3, costId: 'unpaid-child', parentCostId: parent.costId, name: 'Unpaid child', amount: 400 }
    const { container } = render(<CostPage
      owners={[{ id: 1, name: 'GreenFort' }]}
      developmentCosts={[parent]}
      breakdownCosts={[paidChild, unpaidChild]}
      costVersions={[parent, paidChild, unpaidChild]}
      onBack={() => {}}
      onAddDevelopmentCost={() => {}}
      onEditDevelopmentCost={() => {}}
      onDeleteDevelopmentCost={() => {}}
    />)

    expect(container.querySelector('.cost-record-badges')).toHaveTextContent('Unpaid')
    expect(container.querySelector('.cost-record-badges')).not.toHaveTextContent('Paid through breakdowns')
  })

  it('does not claim an unpaid invoice was paid merely because an owner is assigned as payer', () => {
    const cost = {
      id: 1, costId: 'banu-cost', version: 1, name: 'Other', amount: 1556.10,
      ownerId: 9, payerType: 'owner', payerOwnerId: 9, phase: 'development',
      date: '2023-02-15', attachments: [], lotAllocations: [],
    }
    const { container } = render(<CostPage
      owners={[{ id: 9, name: 'Banu U' }]}
      developmentCosts={[cost]}
      costVersions={[cost]}
      onBack={() => {}}
      onAddDevelopmentCost={() => {}}
      onEditDevelopmentCost={() => {}}
      onDeleteDevelopmentCost={() => {}}
    />)

    const badges = container.querySelector('.cost-record-badges')
    expect(badges).toHaveTextContent('Payment assigned to Banu U')
    expect(badges).toHaveTextContent('Unpaid')
    expect(badges).not.toHaveTextContent('Paid by Banu U')
  })
})
