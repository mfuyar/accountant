import { supabase } from './supabase'

const invokePlaid = async (body) => {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.functions.invoke('plaid-bank', { body })
  if (error) throw new Error(error.message || 'The bank connection request failed.')
  if (data?.error) throw new Error(data.error)
  return data
}

export const fetchBankConnections = (projectId) => invokePlaid({ action: 'status', projectId })

export const createBankLinkToken = (projectId) => invokePlaid({ action: 'create_link_token', projectId })

export const exchangeBankPublicToken = (projectId, publicToken, institutionName) => invokePlaid({
  action: 'exchange_public_token',
  projectId,
  publicToken,
  institutionName,
})

export const syncBankConnection = (projectId, connectionId) => invokePlaid({ action: 'sync', projectId, connectionId })

export const disconnectBankConnection = (projectId, connectionId) => invokePlaid({ action: 'disconnect', projectId, connectionId })

let plaidScriptPromise

export const loadPlaidLink = () => {
  if (window.Plaid) return Promise.resolve(window.Plaid)
  if (plaidScriptPromise) return plaidScriptPromise
  plaidScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-greenfort-plaid-link]')
    const script = existing || document.createElement('script')
    const handleLoad = () => window.Plaid ? resolve(window.Plaid) : reject(new Error('Plaid Link did not load.'))
    const handleError = () => reject(new Error('Plaid Link could not be loaded. Check your internet connection.'))
    script.addEventListener('load', handleLoad, { once: true })
    script.addEventListener('error', handleError, { once: true })
    if (!existing) {
      script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js'
      script.async = true
      script.dataset.greenfortPlaidLink = 'true'
      document.head.appendChild(script)
    }
  }).catch((error) => {
    plaidScriptPromise = undefined
    throw error
  })
  return plaidScriptPromise
}

