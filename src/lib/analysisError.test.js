import { describe, expect, it } from 'vitest'
import { analysisErrorMessage } from './analysisError'

describe('analysis errors', () => {
  it('shows the function error instead of the generic SDK message', async () => {
    expect(await analysisErrorMessage({ message: 'Edge Function returned a non-2xx status code', context: new Response(JSON.stringify({ error: 'Document analysis is not configured' }), { status: 503 }) }))
      .toBe('Document analysis is not configured')
  })
  it('handles gateway authentication messages', async () => {
    expect(await analysisErrorMessage({ context: new Response(JSON.stringify({ message: 'Invalid JWT' }), { status: 401 }) })).toBe('Invalid JWT')
  })
  it('handles non-JSON errors and network failures', async () => {
    expect(await analysisErrorMessage({ context: new Response('Unavailable', { status: 503 }) })).toContain('not configured')
    expect(await analysisErrorMessage({ message: 'Failed to fetch' })).toBe('Failed to fetch')
  })
})
