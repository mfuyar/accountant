export async function analysisErrorMessage(error) {
  const response = error?.context
  if (response && typeof response.clone === 'function') {
    try {
      const body = await response.clone().json()
      if (typeof body?.error === 'string') return body.error
      if (typeof body?.message === 'string') return body.message
    } catch { /* Gateways may return HTML or an empty response. */ }
    if (response.status === 401) return 'Your session has expired. Sign in again and retry analysis.'
    if (response.status === 503) return 'Document analysis is not configured. Check the Supabase function secrets.'
  }
  return error?.message || 'Document analysis is unavailable'
}
