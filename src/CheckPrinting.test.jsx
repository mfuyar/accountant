import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CheckPrinting from './CheckPrinting'
import { amountToCheckWords } from './lib/checks'

const savedCheck = {
  id: 1,
  projectId: 7,
  checkNumber: '1042',
  payee: 'Triangle Concrete',
  amount: 1250.75,
  date: '2026-07-16',
  memo: 'Foundation materials',
  accountLabel: 'Bank of America Operating',
  status: 'draft',
  templateKey: 'bofa',
}

describe('CheckPrinting', () => {
  it('writes currency as check-safe words', () => {
    expect(amountToCheckWords(1250.75)).toBe('One Thousand Two Hundred Fifty and 75/100 Dollars')
    expect(amountToCheckWords(0.05)).toBe('Zero and 05/100 Dollars')
  })

  it('validates and saves a project check', async () => {
    const onSaveCheck = vi.fn().mockResolvedValue({ ...savedCheck, invoiceId: 50 })
    render(<CheckPrinting
      project={{ id: 7, name: 'Tryon Rd' }}
      invoices={[{ id: 50, invoiceNumber: 'INV-50', vendorName: 'Triangle Concrete', amount: 1250.75 }]}
      onSaveCheck={onSaveCheck}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Save check to register' }))
    expect(screen.getByRole('alert')).toHaveTextContent('number printed on the check')

    fireEvent.change(screen.getByLabelText('Check number'), { target: { value: '1042' } })
    fireEvent.change(screen.getByLabelText('Check payee'), { target: { value: 'Triangle Concrete' } })
    fireEvent.change(screen.getByLabelText('Check amount'), { target: { value: '1250.75' } })
    fireEvent.change(screen.getByLabelText('Check date'), { target: { value: '2026-07-16' } })
    fireEvent.change(screen.getByLabelText('Check account label'), { target: { value: 'Bank of America Operating' } })
    fireEvent.change(screen.getByLabelText('Check memo'), { target: { value: 'Foundation materials' } })
    fireEvent.change(screen.getByLabelText('Check accounting attachment'), { target: { value: 'invoice:50' } })

    const preview = screen.getByLabelText('Live check preview')
    expect(preview).toHaveTextContent('Triangle Concrete')
    expect(preview).toHaveTextContent('1,250.75')
    expect(preview).toHaveTextContent('Foundation materials')
    expect(preview).toHaveTextContent('07/16/')
    expect(screen.getByText('One Thousand Two Hundred Fifty and 75/100 Dollars')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save check to register' }))

    await waitFor(() => expect(onSaveCheck).toHaveBeenCalledWith({
      projectId: 7,
      checkNumber: '1042',
      payee: 'Triangle Concrete',
      amount: 1250.75,
      date: '2026-07-16',
      memo: 'Foundation materials',
      accountLabel: 'Bank of America Operating',
      templateKey: 'bofa',
      invoiceId: 50,
      costId: null,
      fundedByIncomeId: null,
      lot: null,
    }))
    expect(screen.getByLabelText('Saved check preview 1042')).toHaveTextContent('Triangle Concrete')
    expect(screen.getByRole('heading', { name: 'Check #1042' })).toBeInTheDocument()
  })

  it('explains when the check number is already saved', () => {
    const onSaveCheck = vi.fn()
    render(<CheckPrinting project={{ id: 7, name: 'Tryon Rd' }} checks={[savedCheck]} onSaveCheck={onSaveCheck} />)

    fireEvent.change(screen.getByLabelText('Check number'), { target: { value: '1042' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save check to register' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Check #1042 is already saved for Tryon Rd')
    expect(screen.getByRole('alert')).toHaveTextContent('view or reprint it')
    expect(onSaveCheck).not.toHaveBeenCalled()
  })

  it('translates a database duplicate error if another save wins the race', async () => {
    const onSaveCheck = vi.fn().mockRejectedValue({ code: '23505', message: 'duplicate key value violates unique constraint' })
    render(<CheckPrinting project={{ id: 7, name: 'Tryon Rd' }} onSaveCheck={onSaveCheck} />)

    fireEvent.change(screen.getByLabelText('Check number'), { target: { value: '1042' } })
    fireEvent.change(screen.getByLabelText('Check payee'), { target: { value: 'Triangle Concrete' } })
    fireEvent.change(screen.getByLabelText('Check amount'), { target: { value: '1250.75' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save check to register' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Check #1042 is already saved for Tryon Rd')
    expect(screen.queryByText(/Unknown error/)).not.toBeInTheDocument()
  })

  it('defaults to Bank of America and switches to the Providence layout', () => {
    render(<CheckPrinting project={{ id: 7, name: 'Tryon Rd' }} />)

    expect(screen.getByLabelText('Check template')).toHaveValue('bofa')
    expect(screen.getByLabelText('Printer feed preset')).toHaveValue('direct')
    expect(screen.getByLabelText('Horizontal check print adjustment')).toHaveValue(0)
    expect(screen.getByText(/pads the check to 6 × 3 in/)).toBeInTheDocument()
    expect(screen.getByText(/Horizontal feed: 6-inch side across the tray/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Bank of America · 6 × 2.7' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Check template'), { target: { value: 'providence' } })

    expect(screen.getByLabelText('Check template')).toHaveValue('providence')
    expect(screen.getByLabelText('Check account label')).toHaveValue('Providence Bank')
    expect(screen.getByRole('heading', { name: 'Providence Bank · 6 × 2.7' })).toBeInTheDocument()
    expect(screen.getByLabelText('Live check preview')).toHaveClass('providence')
    expect(screen.getByLabelText('Live check preview')).toHaveTextContent('Providence Bank')
  })

  it('prints four full-size BOFA and Flagstar calibration templates on Letter paper', async () => {
    window.print = vi.fn()
    render(<CheckPrinting project={{ id: 7, name: 'Tryon Rd' }} />)

    fireEvent.click(screen.getByRole('button', { name: 'Print BOFA + Flagstar templates' }))

    await waitFor(() => expect(window.print).toHaveBeenCalled())
    const sheet = screen.getByLabelText('Printable BOFA and Flagstar template sheet')
    expect(sheet.querySelectorAll('.calibration-check')).toHaveLength(4)
    expect(sheet.querySelectorAll('.calibration-check.bofa')).toHaveLength(2)
    expect(sheet.querySelectorAll('.calibration-check.flagstar')).toHaveLength(2)
    expect(sheet).toHaveTextContent('VOID · CALIBRATION ONLY')
    expect(sheet).toHaveTextContent('no routing/account data')
    expect(sheet).not.toHaveTextContent('PAYEE NAME')
    expect(sheet).not.toHaveTextContent('0,000.00')
    expect(sheet).not.toHaveTextContent('AMOUNT IN WORDS')
    expect(screen.getAllByLabelText('Blank payee field')).toHaveLength(4)
  })

  it('prints a repeatable mock check without saving or changing check status', async () => {
    window.print = vi.fn()
    const onSaveCheck = vi.fn()
    const onUpdateStatus = vi.fn()
    render(<CheckPrinting project={{ id: 7, name: 'Tryon Rd' }} onSaveCheck={onSaveCheck} onUpdateStatus={onUpdateStatus} />)

    fireEvent.click(screen.getByRole('button', { name: 'Print 6 × 3 mock alignment check' }))

    await waitFor(() => expect(window.print).toHaveBeenCalled())
    const mock = screen.getByLabelText('Printable check TEST')
    expect(mock).toHaveClass('print-page-direct')
    expect(mock.querySelector('style')).toHaveTextContent('size: 6in 3in')
    expect(mock).toHaveTextContent('Alignment Test Payee')
    expect(mock).toHaveTextContent('123.45')
    expect(mock).toHaveTextContent('One Hundred Twenty-Three and 45/100')
    expect(mock).toHaveTextContent('Alignment test')
    expect(onSaveCheck).not.toHaveBeenCalled()
    expect(onUpdateStatus).not.toHaveBeenCalled()
  })

  it('honors the selected printer preset when printing the mock alignment check', async () => {
    window.print = vi.fn()
    render(<CheckPrinting project={{ id: 7, name: 'Tryon Rd' }} />)

    fireEvent.change(screen.getByLabelText('Printer feed preset'), { target: { value: 'direct_rotated' } })
    fireEvent.click(screen.getByRole('button', { name: 'Print 2.7 × 6 rotated mock alignment check' }))

    await waitFor(() => expect(window.print).toHaveBeenCalled())
    const mock = screen.getByLabelText('Printable check TEST')
    expect(mock).toHaveClass('print-page-direct_rotated')
    expect(mock.querySelector('style')).toHaveTextContent('size: 2.7in 6in')
  })

  it('changes an already-saved check to the Providence template', async () => {
    const onUpdateTemplate = vi.fn().mockResolvedValue({ ...savedCheck, templateKey: 'providence', accountLabel: 'Providence Bank' })
    render(<CheckPrinting project={{ id: 7, name: 'Tryon Rd' }} checks={[savedCheck]} onUpdateTemplate={onUpdateTemplate} />)

    fireEvent.click(screen.getByRole('button', { name: 'View check' }))
    fireEvent.change(screen.getByLabelText('Template for saved check 1042'), { target: { value: 'providence' } })

    await waitFor(() => expect(onUpdateTemplate).toHaveBeenCalledWith(1, 'providence', 'Providence Bank'))
    expect(screen.getByLabelText('Saved check preview 1042')).toHaveClass('providence')
    expect(await screen.findByRole('status')).toHaveTextContent('Providence Bank layout')
  })

  it('does not draw a legacy zero check number on the saved-check face', () => {
    render(<CheckPrinting project={{ id: 7, name: 'Tryon Rd' }} checks={[{ ...savedCheck, checkNumber: '0' }]} />)

    fireEvent.click(screen.getByRole('button', { name: 'View check' }))

    const preview = screen.getByLabelText('Saved check preview 0')
    expect(preview.querySelector('.preview-check-number')).toHaveTextContent('')
    expect(preview.querySelector('.preview-check-number')).not.toHaveTextContent('0')
  })

  it('learns frequent payees and can attach a saved check to a cost', async () => {
    const checks = [savedCheck, { ...savedCheck, id: 2, checkNumber: '1043', amount: 500 }]
    const onUpdateLink = vi.fn().mockResolvedValue({ ...savedCheck, costId: 'cost-1' })
    render(<CheckPrinting
      project={{ id: 7, name: 'Tryon Rd' }}
      checks={checks}
      costs={[{ costId: 'cost-1', name: 'Foundation', amount: 25000 }]}
      onUpdateLink={onUpdateLink}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Triangle Concrete 2×' }))
    expect(screen.getByLabelText('Check payee')).toHaveValue('Triangle Concrete')
    expect(screen.getByLabelText('Check account label')).toHaveValue('Bank of America Operating')

    fireEvent.change(screen.getByLabelText('Attachment for check 1042'), { target: { value: 'cost:cost-1' } })
    await waitFor(() => expect(onUpdateLink).toHaveBeenCalledWith(1, { invoiceId: null, costId: 'cost-1' }))
    expect(await screen.findByRole('status')).toHaveTextContent('attached to Cost Foundation')
  })

  it('prints and voids checks while retaining the register entry', async () => {
    window.print = vi.fn()
    const onUpdateStatus = vi.fn().mockImplementation(async (_id, status) => ({ ...savedCheck, status }))
    render(<CheckPrinting project={{ id: 7, name: 'Tryon Rd' }} checks={[savedCheck]} onUpdateStatus={onUpdateStatus} />)

    fireEvent.click(screen.getByRole('button', { name: 'View check' }))
    expect(screen.getByLabelText('Saved check preview 1042')).toHaveTextContent('Foundation materials')
    fireEvent.click(screen.getByRole('button', { name: 'Print' }))
    await waitFor(() => expect(onUpdateStatus).toHaveBeenCalledWith(1, 'printed'))
    await waitFor(() => expect(window.print).toHaveBeenCalled())
    expect(document.body.querySelector(':scope > .print-check-sheet')).toHaveClass('print-page-direct')
    expect(document.body.querySelector(':scope > .print-check-sheet')).toHaveStyle({ '--check-offset-x': '0in', '--check-offset-y': '0in' })
    expect(screen.getByLabelText('Printable check 1042').querySelector('style')).toHaveTextContent('size: 6in 3in')
    expect(screen.getByLabelText('Printable check 1042')).toHaveTextContent('Triangle Concrete')
    expect(screen.getByLabelText('Printable check 1042')).toHaveTextContent('1,250.75')
    expect(screen.getByLabelText('Printable check 1042')).toHaveTextContent('07/16/')
    expect(screen.getByLabelText('Printable check 1042')).toHaveTextContent('26')
    expect(screen.getByLabelText('Printable check 1042')).not.toHaveTextContent('Bank of America')
    expect(screen.getByLabelText('Printable check 1042')).not.toHaveTextContent('Check #1042')

    fireEvent.click(screen.getByRole('button', { name: 'Void' }))
    await waitFor(() => expect(onUpdateStatus).toHaveBeenCalledWith(1, 'voided'))
  })

  it('blocks an offset that would clip fields off the six-inch check', async () => {
    window.print = vi.fn()
    const onUpdateStatus = vi.fn()
    render(<CheckPrinting project={{ id: 7, name: 'Tryon Rd' }} checks={[savedCheck]} onUpdateStatus={onUpdateStatus} />)

    fireEvent.change(screen.getByLabelText('Printer feed preset'), { target: { value: 'direct' } })
    fireEvent.change(screen.getByLabelText('Horizontal check print adjustment'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Print' }))

    expect(screen.getByRole('alert')).toHaveTextContent('would cut fields off the 6-inch check')
    expect(screen.getByRole('alert')).toHaveTextContent('side guides')
    expect(onUpdateStatus).not.toHaveBeenCalled()
    expect(window.print).not.toHaveBeenCalled()
  })

  it('prints a Letter carrier guide with an exact 6 by 2.7 check position', async () => {
    window.print = vi.fn()
    render(<CheckPrinting project={{ id: 7, name: 'Tryon Rd' }} />)

    fireEvent.change(screen.getByLabelText('Printer feed preset'), { target: { value: 'hp1102_carrier' } })
    fireEvent.click(screen.getByRole('button', { name: 'Print carrier placement guide' }))

    await waitFor(() => expect(window.print).toHaveBeenCalled())
    const guide = screen.getByLabelText('Printable HP P1102 carrier placement guide')
    expect(guide).toHaveTextContent('PLACE 6 × 2.7 CHECK HERE')
    expect(guide.querySelector('style')).toHaveTextContent('size: 8.5in 11in')
    expect(guide).toHaveStyle({ '--guide-offset-x': '0in', '--guide-offset-y': '0in' })
    expect(guide).toHaveTextContent('1.25in left · 1.00in top')
  })

  it('applies the move right/left and move down/up offsets to the carrier placement guide', async () => {
    window.print = vi.fn()
    render(<CheckPrinting project={{ id: 7, name: 'Tryon Rd' }} />)

    fireEvent.change(screen.getByLabelText('Printer feed preset'), { target: { value: 'hp1102_carrier' } })
    fireEvent.change(screen.getByLabelText('Horizontal check print adjustment'), { target: { value: '0.3' } })
    fireEvent.change(screen.getByLabelText('Vertical check print adjustment'), { target: { value: '-0.2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Print carrier placement guide' }))

    await waitFor(() => expect(window.print).toHaveBeenCalled())
    const guide = screen.getByLabelText('Printable HP P1102 carrier placement guide')
    expect(guide).toHaveStyle({ '--guide-offset-x': '0.3in', '--guide-offset-y': '-0.2in' })
    expect(guide).toHaveTextContent('1.55in left · 0.80in top')
  })

  it('shows remaining draw balance and saves a check tagged with the funding draw', async () => {
    const onSaveCheck = vi.fn().mockResolvedValue({ ...savedCheck, id: 2, checkNumber: '1043', fundedByIncomeId: 900 })
    const loanDraws = [{ id: 900, description: 'Land Clearing for all 3 lots', date: '2026-07-16', amount: 39600 }]
    const existingChecks = [{ ...savedCheck, fundedByIncomeId: 900, amount: 5000 }]
    render(<CheckPrinting project={{ id: 7, name: 'Tryon Rd' }} checks={existingChecks} loanDraws={loanDraws} onSaveCheck={onSaveCheck} />)

    expect(within(screen.getByLabelText('Check draw funding')).getByText(/Land Clearing for all 3 lots · 2026-07-16 · \$34,600.00 left of \$39,600.00/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Check number'), { target: { value: '1043' } })
    fireEvent.change(screen.getByLabelText('Check payee'), { target: { value: 'Triangle Concrete' } })
    fireEvent.change(screen.getByLabelText('Check amount'), { target: { value: '5000' } })
    fireEvent.change(screen.getByLabelText('Check draw funding'), { target: { value: '900' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save check to register' }))

    await waitFor(() => expect(onSaveCheck).toHaveBeenCalledWith(expect.objectContaining({ fundedByIncomeId: 900 })))
  })

  it('changes which draw funds an already-saved check from the register', async () => {
    const onUpdateFunding = vi.fn().mockResolvedValue({ ...savedCheck, fundedByIncomeId: 900 })
    const loanDraws = [{ id: 900, description: 'Land Clearing for all 3 lots', date: '2026-07-16', amount: 39600 }]
    render(<CheckPrinting project={{ id: 7, name: 'Tryon Rd' }} checks={[savedCheck]} loanDraws={loanDraws} onUpdateFunding={onUpdateFunding} />)

    fireEvent.change(screen.getByLabelText('Draw funding for check 1042'), { target: { value: '900' } })

    await waitFor(() => expect(onUpdateFunding).toHaveBeenCalledWith(1, 900))
    expect(await screen.findByRole('status')).toHaveTextContent('marked as funded by')
  })

  it('saves a check tagged to a specific lot, including Lot 1 which has no loan', async () => {
    const onSaveCheck = vi.fn().mockResolvedValue({ ...savedCheck, id: 2, checkNumber: '1044', lot: 'Lot 1' })
    render(<CheckPrinting project={{ id: 7, name: 'Tryon Rd' }} onSaveCheck={onSaveCheck} />)

    expect(screen.getByLabelText('Check job lot')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Check number'), { target: { value: '1044' } })
    fireEvent.change(screen.getByLabelText('Check payee'), { target: { value: 'Lot 1 Contractor' } })
    fireEvent.change(screen.getByLabelText('Check amount'), { target: { value: '2000' } })
    fireEvent.change(screen.getByLabelText('Check job lot'), { target: { value: 'Lot 1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save check to register' }))

    await waitFor(() => expect(onSaveCheck).toHaveBeenCalledWith(expect.objectContaining({ lot: 'Lot 1' })))
  })

  it('changes which lot an already-saved check is tagged to', async () => {
    const onUpdateLot = vi.fn().mockResolvedValue({ ...savedCheck, lot: 'Lot 1' })
    render(<CheckPrinting project={{ id: 7, name: 'Tryon Rd' }} checks={[savedCheck]} onUpdateLot={onUpdateLot} />)

    fireEvent.change(screen.getByLabelText('Lot for check 1042'), { target: { value: 'Lot 1' } })

    await waitFor(() => expect(onUpdateLot).toHaveBeenCalledWith(1, 'Lot 1'))
    expect(await screen.findByRole('status')).toHaveTextContent('marked as spending for Lot 1')
  })
})
