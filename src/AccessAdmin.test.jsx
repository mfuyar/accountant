import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AccessAdmin from './AccessAdmin'
import { assignProjectAdmin, fetchProjectAccess, sendProjectAdminInvite } from './lib/supabase'

vi.mock('./lib/supabase', () => ({
  assignProjectAdmin: vi.fn(),
  fetchProjectAccess: vi.fn(),
  sendProjectAdminInvite: vi.fn(),
}))

describe('AccessAdmin', () => {
  beforeEach(() => {
    fetchProjectAccess.mockResolvedValue({ members: [], invitations: [] })
    assignProjectAdmin.mockResolvedValue('invited')
    sendProjectAdminInvite.mockResolvedValue({ delivery: 'invite' })
  })

  it('assigns an administrator to a selected project by email', async () => {
    render(
      <AccessAdmin
        projects={[{ id: 2, name: 'Tryon Rd' }]}
        accessProfile={{ email: 'mfuyar@gmail.com', is_global_admin: true }}
      />,
    )

    fireEvent.change(screen.getByLabelText(/project administrator email/i), { target: { value: 'project.admin@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /assign only/i }))

    await waitFor(() => expect(assignProjectAdmin).toHaveBeenCalledWith(2, 'project.admin@example.com'))
    expect(await screen.findByRole('status')).toHaveTextContent(/when they first sign in/i)
  })

  it('assigns access and sends an invitation email', async () => {
    render(<AccessAdmin projects={[{ id: 2, name: 'Tryon Rd' }]} accessProfile={{ is_global_admin: true }} />)
    fireEvent.change(screen.getByLabelText(/project administrator email/i), { target: { value: 'kemalilter2+gfadmin@gmail.com' } })
    fireEvent.click(screen.getByRole('button', { name: /assign & send invite/i }))

    await waitFor(() => expect(sendProjectAdminInvite).toHaveBeenCalledWith(2, 'kemalilter2+gfadmin@gmail.com'))
    expect(await screen.findByRole('status')).toHaveTextContent(/invitation email sent/i)
  })

  it('resends email for a pending invitation', async () => {
    fetchProjectAccess.mockResolvedValue({
      members: [],
      invitations: [{ id: 9, project_id: 2, email: 'kemalilter2+gfadmin@gmail.com', role: 'project_admin' }],
    })
    render(<AccessAdmin projects={[{ id: 2, name: 'Tryon Rd' }]} accessProfile={{ is_global_admin: true }} />)

    const resendButton = await screen.findByRole('button', { name: 'Resend invite' })
    fireEvent.click(resendButton)

    await waitFor(() => expect(sendProjectAdminInvite).toHaveBeenCalledWith(2, 'kemalilter2+gfadmin@gmail.com'))
    expect(await screen.findByRole('status')).toHaveTextContent(/invitation email resent/i)
  })
})
