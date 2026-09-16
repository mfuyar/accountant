import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AccessAdmin from './AccessAdmin'
import { fetchProjectAccess, removeProjectAdmin, sendProjectAdminInvite } from './lib/supabase'

vi.mock('./lib/supabase', () => ({
  fetchProjectAccess: vi.fn(),
  removeProjectAdmin: vi.fn(),
  sendProjectAdminInvite: vi.fn(),
}))

describe('AccessAdmin', () => {
  beforeEach(() => {
    fetchProjectAccess.mockResolvedValue({ members: [], invitations: [] })
    removeProjectAdmin.mockResolvedValue()
    sendProjectAdminInvite.mockResolvedValue({ delivery: 'invite', copyDelivery: 'sent' })
  })

  it('lets a project administrator invite another administrator', async () => {
    render(
      <AccessAdmin
        projects={[{ id: 2, name: 'Tryon Rd' }]}
        accessProfile={{ email: 'current.admin@example.com', is_global_admin: false }}
      />,
    )

    fireEvent.change(screen.getByLabelText(/project administrator email/i), { target: { value: 'project.admin@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /send admin invitation/i }))

    await waitFor(() => expect(sendProjectAdminInvite).toHaveBeenCalledWith(2, 'project.admin@example.com'))
    expect(await screen.findByRole('status')).toHaveTextContent(/this project only/i)
  })

  it('assigns access and sends an invitation email', async () => {
    render(<AccessAdmin projects={[{ id: 2, name: 'Tryon Rd' }]} accessProfile={{ is_global_admin: true }} />)
    fireEvent.change(screen.getByLabelText(/project administrator email/i), { target: { value: 'kemalilter2+gfadmin@gmail.com' } })
    fireEvent.click(screen.getByRole('button', { name: /send admin invitation/i }))

    await waitFor(() => expect(sendProjectAdminInvite).toHaveBeenCalledWith(2, 'kemalilter2+gfadmin@gmail.com'))
    expect(await screen.findByRole('status')).toHaveTextContent(/invitation email sent/i)
  })

  it('removes another project administrator after confirmation', async () => {
    fetchProjectAccess
      .mockResolvedValueOnce({
        members: [{ user_id: 'user-2', profiles: { email: 'other.admin@example.com', full_name: 'Other Admin', is_global_admin: false } }],
        invitations: [],
      })
      .mockResolvedValueOnce({ members: [], invitations: [] })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<AccessAdmin projects={[{ id: 2, name: 'Tryon Rd' }]} accessProfile={{ email: 'current.admin@example.com', is_global_admin: false }} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(removeProjectAdmin).toHaveBeenCalledWith(2, 'user-2'))
    expect(await screen.findByRole('status')).toHaveTextContent(/no longer has administrator access/i)
  })

  it('sends an active administrator a sign-in reminder without changing access', async () => {
    fetchProjectAccess.mockResolvedValue({
      members: [{ user_id: 'user-2', profiles: { email: 'other.admin@example.com', full_name: 'Other Admin', is_global_admin: false } }],
      invitations: [],
    })

    render(<AccessAdmin projects={[{ id: 2, name: 'Tryon Rd' }]} accessProfile={{ email: 'current.admin@example.com', is_global_admin: false }} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Send sign-in reminder' }))

    await waitFor(() => expect(sendProjectAdminInvite).toHaveBeenCalledWith(2, 'other.admin@example.com', { sendCopy: true }))
    expect(await screen.findByRole('status')).toHaveTextContent(/access has not changed/i)
  })

  it('resends email for a pending invitation', async () => {
    fetchProjectAccess.mockResolvedValue({
      members: [],
      invitations: [{ id: 9, project_id: 2, email: 'kemalilter2+gfadmin@gmail.com', role: 'project_admin' }],
    })
    render(<AccessAdmin projects={[{ id: 2, name: 'Tryon Rd' }]} accessProfile={{ is_global_admin: true }} />)

    const resendButton = await screen.findByRole('button', { name: 'Send invitation reminder' })
    fireEvent.click(resendButton)

    await waitFor(() => expect(sendProjectAdminInvite).toHaveBeenCalledWith(2, 'kemalilter2+gfadmin@gmail.com', { sendCopy: true }))
    expect(await screen.findByRole('status')).toHaveTextContent(/invitation reminder was sent/i)
  })
})
