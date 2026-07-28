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
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    expect(onDownload).toHaveBeenCalledWith(attachment)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })
})
