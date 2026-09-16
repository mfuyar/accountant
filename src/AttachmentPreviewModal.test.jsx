import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AttachmentPreviewModal from './AttachmentPreviewModal'

describe('AttachmentPreviewModal', () => {
  it('previews an image and offers download and close actions', async () => {
    const attachment = { name: 'permit.png', mimeType: 'image/png', storagePath: '2/permit.png' }
    const onGetUrl = vi.fn().mockResolvedValue('https://example.test/permit.png')
    const onDownload = vi.fn()
    const onClose = vi.fn()
    render(<AttachmentPreviewModal attachment={attachment} onGetUrl={onGetUrl} onDownload={onDownload} onClose={onClose} />)

    await waitFor(() => expect(screen.getByRole('img', { name: 'permit.png' })).toHaveAttribute('src', 'https://example.test/permit.png'))
    expect(screen.getByRole('dialog')).toContainElement(document.querySelector('.document-preview-panel'))
    expect(document.querySelector('.document-preview-body')).toContainElement(screen.getByRole('img', { name: 'permit.png' }))
    expect(document.querySelector('.document-preview-actions')).toContainElement(screen.getByRole('button', { name: 'Download a copy' }))
    fireEvent.click(screen.getByRole('button', { name: 'Download a copy' }))
    expect(onDownload).toHaveBeenCalledWith(attachment)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('previews an image when older attachment metadata has only a filename', async () => {
    const attachment = { name: 'receipt.jpg', storagePath: '2/receipt.jpg' }
    render(<AttachmentPreviewModal attachment={attachment} onGetUrl={vi.fn().mockResolvedValue('https://example.test/receipt.jpg')} onDownload={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByRole('img', { name: 'receipt.jpg' })).toHaveAttribute('src', 'https://example.test/receipt.jpg'))
  })

  it('prints a temporary paid-watermark copy without changing the original attachment', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})
    const attachment = { name: 'invoice.png', mimeType: 'image/png', storagePath: '2/invoice.png' }
    render(<AttachmentPreviewModal
      attachment={attachment}
      paidWatermark={{ checkNumber: '1042', date: '2026-07-16', payee: 'Triangle Concrete', amount: '$1,250.75' }}
      onGetUrl={vi.fn().mockResolvedValue('https://example.test/invoice.png')}
      onClose={vi.fn()}
    />)

    await waitFor(() => expect(screen.getByRole('img', { name: 'invoice.png' })).toBeInTheDocument())
    expect(screen.getByText('PAID')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Print invoice with PAID watermark' }))

    const printable = await screen.findByLabelText('Printable paid copy of invoice.png')
    expect(printable).toHaveTextContent('PAID')
    expect(printable).toHaveTextContent('Check #1042 · 2026-07-16 · $1,250.75')
    expect(printable).toHaveTextContent('Triangle Concrete')
    await waitFor(() => expect(printSpy).toHaveBeenCalled())
    printSpy.mockRestore()
  })
})
