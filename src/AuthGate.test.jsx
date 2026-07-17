import { useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authChange: null,
  getSession: vi.fn(),
  signInWithPassword: vi.fn(),
  sendMagicLink: vi.fn(),
  fetchAccessProfile: vi.fn().mockResolvedValue({
    email: 'admin@example.com',
    is_global_admin: true,
    projectMemberships: [],
  }),
}))

vi.mock('./lib/supabase', () => ({
  fetchAccessProfile: mocks.fetchAccessProfile,
  sendMagicLink: mocks.sendMagicLink,
  signInWithPassword: mocks.signInWithPassword,
  updateAccountPassword: vi.fn(),
  supabase: {
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: vi.fn((callback) => {
        mocks.authChange = callback
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      }),
      signOut: vi.fn(),
    },
  },
}))

import AuthGate from './AuthGate'

function StatefulWorkspace() {
  const [count, setCount] = useState(0)
  return <button type="button" onClick={() => setCount((current) => current + 1)}>Workspace state {count}</button>
}

describe('AuthGate', () => {
  beforeEach(() => {
    mocks.getSession.mockReset().mockResolvedValue({
      data: { session: { access_token: 'first', user: { id: 'user-1', email: 'admin@example.com' } } },
    })
    mocks.signInWithPassword.mockReset().mockResolvedValue(undefined)
    mocks.sendMagicLink.mockReset().mockResolvedValue(undefined)
  })

  it('keeps the workspace mounted when Supabase refreshes the same user session', async () => {
    render(<AuthGate>{() => <StatefulWorkspace />}</AuthGate>)

    const workspace = await screen.findByRole('button', { name: 'Workspace state 0' })
    fireEvent.click(workspace)
    expect(screen.getByRole('button', { name: 'Workspace state 1' })).toBeInTheDocument()

    await act(async () => {
      mocks.authChange('TOKEN_REFRESHED', {
        access_token: 'refreshed',
        user: { id: 'user-1', email: 'admin@example.com' },
      })
    })

    expect(screen.getByRole('button', { name: 'Workspace state 1' })).toBeInTheDocument()
    expect(mocks.fetchAccessProfile).toHaveBeenCalledTimes(1)
  })

  it('uses email and password as the primary sign-in method', async () => {
    mocks.getSession.mockResolvedValueOnce({ data: { session: null } })
    render(<AuthGate>{() => <StatefulWorkspace />}</AuthGate>)

    fireEvent.change(await screen.findByLabelText('Sign-in email'), { target: { value: 'admin@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(mocks.signInWithPassword).toHaveBeenCalledWith('admin@example.com', 'correct-password')
    expect(mocks.sendMagicLink).not.toHaveBeenCalled()
  })

  it('offers an email sign-in link as the fallback', async () => {
    mocks.getSession.mockResolvedValueOnce({ data: { session: null } })
    render(<AuthGate>{() => <StatefulWorkspace />}</AuthGate>)

    fireEvent.change(await screen.findByLabelText('Sign-in email'), { target: { value: 'admin@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use email sign-in link instead' }))
    fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }))

    expect(mocks.sendMagicLink).toHaveBeenCalledWith('admin@example.com')
    expect(await screen.findByRole('status')).toHaveTextContent('secure sign-in link was sent')
  })
})
