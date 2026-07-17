import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CostPage from './CostPage'

vi.mock('./lib/gemini', () => ({
  extractTransactionFromImage: vi.fn().mockResolvedValue({
    vendor: 'Horizon Concrete',
    amount: 12500.75,
    date: '2026-07-10',
    description: 'Concrete delivery',
  }),
}))

describe('CostPage invoice extraction', () => {
  it('moves focus to the upper editor and clearly enters edit mode', () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const cost = { id: 1, costId: 'cost-1', version: 3, name: 'Engineering fees', amount: 1250, ownerId: 1, phase: 'soft_cost', date: '2026-07-01', attachments: [] }
    render(
      <CostPage
        owners={[{ id: 1, name: 'Banu U' }]}
        developmentCosts={[cost]}
        breakdownCosts={[]}
        costVersions={[cost]}
        onBack={() => {}}
        onAddDevelopmentCost={() => {}}
        onEditDevelopmentCost={() => {}}
        onDeleteDevelopmentCost={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit cost' }))

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    expect(screen.getByLabelText('Cost name')).toHaveFocus()
    expect(screen.getByRole('heading', { name: 'Edit project cost' })).toBeInTheDocument()
    expect(screen.getByText(/Update the fields below/)).toHaveTextContent('Save new version')
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

    fireEvent.click(screen.getByRole('button', { name: 'Show breakdowns (1)' }))
    expect(screen.getByText('Merged breakdown total', { exact: false })).toBeInTheDocument()
    expect(screen.getAllByText('$300')).not.toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Show merged items (2)' }))
    expect(screen.getByText(/Fee A/)).toBeInTheDocument()
    expect(screen.getByText(/Individual item.*2023-01-01/i)).toBeInTheDocument()
    expect(screen.getByText(/Fee B/)).toBeInTheDocument()
    expect(screen.getByText(/Individual item.*2023-02-01/i)).toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('button', { name: 'flagstar.pdf' }))
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
    expect(screen.getByLabelText('Cost date')).toHaveValue('2026-06-01')
  })

  it('sorts breakdowns by amount, date, or description', () => {
    const parentCost = {
      id: 10, costId: 'parent-cost', version: 1, name: 'All Development cost',
      amount: 100000, ownerId: 1, phase: 'development', date: '2026-07-14', attachments: [],
    }
    const breakdownCosts = [
      { ...parentCost, id: 11, costId: 'child-a', parentCostId: 'parent-cost', name: 'Older small item', amount: 100, date: '2022-01-01' },
      { ...parentCost, id: 12, costId: 'child-b', parentCostId: 'parent-cost', name: 'Newer large item', amount: 500, date: '2023-01-01' },
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
    expect(rows[0]).toHaveTextContent('Newer large item')
    fireEvent.change(screen.getByLabelText('Sort breakdowns'), { target: { value: 'date_asc' } })
    rows = container.querySelectorAll('.cost-breakdown-row')
    expect(rows[0]).toHaveTextContent('Older small item')
    fireEvent.change(screen.getByLabelText('Sort breakdowns'), { target: { value: 'name_desc' } })
    rows = container.querySelectorAll('.cost-breakdown-row')
    expect(rows[0]).toHaveTextContent('Older small item')
    fireEvent.click(screen.getByRole('button', { name: 'Hide breakdowns' }))
    expect(container.querySelectorAll('.cost-breakdown-row')).toHaveLength(0)
  })

  it('filters the cost list by search, phase, and owner', () => {
    const costs = [
      { id: 1, costId: 'banu', version: 1, name: 'Engineering', amount: 100, ownerId: 1, phase: 'soft_cost', date: '2026-07-01', attachments: [] },
      { id: 2, costId: 'kemal', version: 1, name: 'Land interest', amount: 200, ownerId: 2, phase: 'development', date: '2026-07-02', attachments: [] },
    ]
    const { container } = render(
      <CostPage
        owners={[{ id: 1, name: 'Banu U' }, { id: 2, name: 'Kemal I' }]}
        developmentCosts={costs}
        breakdownCosts={[]}
        costVersions={costs}
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
    expect(screen.getAllByText('$100,000')).not.toHaveLength(0)
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
    fireEvent.change(screen.getByLabelText(/^cost date$/i), { target: { value: '2026-07-14' } })
    fireEvent.change(screen.getByLabelText(/^cost phase$/i), { target: { value: 'soft_cost' } })
    fireEvent.click(screen.getByRole('button', { name: /^add cost$/i }))

    expect(onAddDevelopmentCost).toHaveBeenCalledWith(expect.objectContaining({ phase: 'soft_cost' }))
  })

  it('fills available cost fields from an uploaded invoice', async () => {
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

    const invoice = new File(['invoice'], 'invoice.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText(/upload receipt, cost image, or pdf/i), {
      target: { files: [invoice] },
    })

    expect(await screen.findByDisplayValue('Concrete delivery')).toBeInTheDocument()
    expect(screen.getByLabelText(/^cost amount$/i)).toHaveValue(12500.75)
    expect(screen.getByLabelText(/^cost date$/i)).toHaveValue('2026-07-10')
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
    expect(screen.getByLabelText('Cost date')).toHaveValue('')

    fireEvent.change(screen.getByLabelText('Cost amount'), { target: { value: '17500' } })
    fireEvent.change(screen.getByLabelText('Cost date'), { target: { value: '2026-10-15' } })
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

    expect(screen.getByText('#1042 · $1,250.75 · printed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show breakdowns (1)' }))
    expect(screen.getByText('#1043 · $500 · draft')).toBeInTheDocument()
  })
})
