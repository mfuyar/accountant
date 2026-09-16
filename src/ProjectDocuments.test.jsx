import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ProjectDocuments from './ProjectDocuments'

describe('ProjectDocuments', () => {
  const document = { documentId: 'doc-1', name: 'Meeting notes', originalName: 'meeting-notes.pdf', documentDate: '2026-08-14', description: 'Notes from the project meeting.', mimeType: 'application/pdf', size: 2048, createdAt: '2026-08-16T12:00:00Z' }

  it('uploads, previews, downloads, and removes miscellaneous documents', async () => {
    const onUpload = vi.fn().mockResolvedValue({})
    const onOpen = vi.fn()
    const onDownload = vi.fn()
    const onDelete = vi.fn().mockResolvedValue()
    render(<ProjectDocuments documents={[document]} onUpload={onUpload} onOpen={onOpen} onDownload={onDownload} onDelete={onDelete} />)

    fireEvent.change(screen.getByLabelText('Upload miscellaneous document'), { target: { files: [new File(['memo'], 'memo.txt', { type: 'text/plain' })] } })
    await waitFor(() => expect(onUpload).toHaveBeenCalledWith(expect.objectContaining({ name: 'memo.txt' })))
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    expect(onOpen).toHaveBeenCalledWith(document)
    expect(onDownload).toHaveBeenCalledWith(document)

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove' }))
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(document))
  })

  it('filters documents by filename', () => {
    render(<ProjectDocuments documents={[document, { documentId: 'doc-2', name: 'survey.xlsx', size: 100 }]} onUpload={vi.fn()} onOpen={vi.fn()} onDownload={vi.fn()} onDelete={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Search miscellaneous documents'), { target: { value: 'survey' } })
    expect(screen.getByText('survey.xlsx')).toBeInTheDocument()
    expect(screen.queryByText('Meeting notes')).not.toBeInTheDocument()
  })

  it('filters documents by file type and missing details', () => {
    const spreadsheet = { documentId: 'doc-2', name: 'survey.xlsx', originalName: 'survey.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 100 }
    render(<ProjectDocuments documents={[document, spreadsheet]} onUpload={vi.fn()} onOpen={vi.fn()} onDownload={vi.fn()} onDelete={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Filter documents by file type'), { target: { value: 'office' } })
    expect(screen.getByText('survey.xlsx')).toBeInTheDocument()
    expect(screen.queryByText('Meeting notes')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Filter documents by details'), { target: { value: 'missing' } })
    expect(screen.getByText('1 of 2 documents')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByText('Meeting notes')).toBeInTheDocument()
  })

  it('renames, describes, and analyzes a document while retaining its original filename', async () => {
    const onUpdate = vi.fn().mockResolvedValue({})
    const onAnalyze = vi.fn().mockResolvedValue({})
    render(<ProjectDocuments documents={[document]} onUpload={vi.fn()} onOpen={vi.fn()} onDownload={vi.fn()} onDelete={vi.fn()} onUpdate={onUpdate} onAnalyze={onAnalyze} />)

    expect(screen.getByText('Notes from the project meeting.')).toBeInTheDocument()
    expect(screen.getByText('Original file: meeting-notes.pdf')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }))
    fireEvent.change(screen.getByLabelText('Document name for Meeting notes'), { target: { value: 'Utility approval' } })
    fireEvent.change(screen.getByLabelText('Document date for Meeting notes'), { target: { value: '2026-08-15' } })
    fireEvent.change(screen.getByLabelText('Description for Meeting notes'), { target: { value: 'Approval for electrical utility service.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith('doc-1', {
      name: 'Utility approval',
      documentDate: '2026-08-15',
      description: 'Approval for electrical utility service.',
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }))
    await waitFor(() => expect(onAnalyze).toHaveBeenCalledWith(document))
  })
})
