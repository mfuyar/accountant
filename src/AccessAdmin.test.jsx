import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AccessAdmin from './AccessAdmin'
import { assignProjectAdmin, fetchProjectAccess } from './lib/supabase'

vi.mock('./lib/supabase', () => ({
  assignProjectAdmin: vi.fn(),
  fetchProjectAccess: vi.fn(),
}))

describe('AccessAdmin', () => {
  beforeEach(() => {
    fetchProjectAccess.mockResolvedValue({ members: [], invitations: [] })
    assignProjectAdmin.mockResolvedValue('invited')
  })

  it('assigns an administrator to a selected project by email', async () => {
    render(
      <AccessAdmin
        projects={[{ id: 2, name: 'Tryon Rd' }]}
        accessProfile={{ email: 'mfuyar@gmail.com', is_global_admin: true }}
      />,
    )

    fireEvent.change(screen.getByLabelText(/project administrator email/i), { target: { value: 'project.admin@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /assign project admin/i }))

    await waitFor(() => expect(assignProjectAdmin).toHaveBeenCalledWith(2, 'project.admin@example.com'))
    expect(await screen.findByRole('status')).toHaveTextContent(/when they first sign in/i)
  })
})
