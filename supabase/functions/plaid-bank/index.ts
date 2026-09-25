import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
})

const plaidHost = () => {
  const environment = (Deno.env.get('PLAID_ENV') || 'sandbox').toLowerCase()
  if (!['sandbox', 'development', 'production'].includes(environment)) throw new Error('PLAID_ENV must be sandbox, development, or production.')
  return `https://${environment}.plaid.com`
}

const plaidRequest = async (path: string, body: Record<string, unknown>) => {
  const clientId = Deno.env.get('PLAID_CLIENT_ID')
  const secret = Deno.env.get('PLAID_SECRET')
  if (!clientId || !secret) throw new Error('Plaid is not configured. Add PLAID_CLIENT_ID and PLAID_SECRET.')
  const response = await fetch(`${plaidHost()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'PLAID-CLIENT-ID': clientId, 'PLAID-SECRET': secret },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data?.error_message || data?.error_code || 'Bank connection request failed.')
  return data
}

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}

const base64ToBytes = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0))

const encryptionKey = async () => {
  const secret = Deno.env.get('PLAID_TOKEN_ENCRYPTION_KEY')
  if (!secret || secret.length < 32) throw new Error('PLAID_TOKEN_ENCRYPTION_KEY must contain at least 32 characters.')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

const encryptToken = async (token: string) => {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(), new TextEncoder().encode(token))
  const packed = new Uint8Array(iv.length + encrypted.byteLength)
  packed.set(iv)
  packed.set(new Uint8Array(encrypted), iv.length)
  return bytesToBase64(packed)
}

const decryptToken = async (ciphertext: string) => {
  const packed = base64ToBytes(ciphertext)
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: packed.slice(0, 12) }, await encryptionKey(), packed.slice(12))
  return new TextDecoder().decode(decrypted)
}

const publicConnection = (row: Record<string, any>) => ({
  id: row.id,
  institutionId: row.institution_id,
  institutionName: row.institution_name,
  accounts: Array.isArray(row.accounts) ? row.accounts : [],
  status: row.status,
  lastError: row.last_error,
  lastSyncedAt: row.last_synced_at,
  createdAt: row.created_at,
})

const accountSummary = (account: Record<string, any>) => ({
  id: account.account_id,
  name: account.name || account.official_name || 'Account',
  officialName: account.official_name || '',
  mask: account.mask || '',
  type: account.type || '',
  subtype: account.subtype || '',
  currentBalance: account.balances?.current ?? null,
  availableBalance: account.balances?.available ?? null,
  currency: account.balances?.iso_currency_code || 'USD',
})

const requireProjectAdmin = async (caller: any, userId: string, projectId: number) => {
  const [{ data: profile }, { data: membership }] = await Promise.all([
    caller.from('profiles').select('is_global_admin').eq('id', userId).maybeSingle(),
    caller.from('project_members').select('role').eq('project_id', projectId).eq('user_id', userId).maybeSingle(),
  ])
  if (!profile?.is_global_admin && membership?.role !== 'project_admin') throw new Error('Only a project administrator can manage bank connections.')
}

const isGreenFortParty = (value: unknown) => {
  const normalized = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return /^(?:green fort|greenfort)(?: llc)?$/.test(normalized)
}

const classifyPlaidTransaction = (transaction: Record<string, any>, account: Record<string, any>, itemId: string, projectId: number) => {
  const amount = -Number(transaction.amount || 0)
  const description = transaction.merchant_name || transaction.name || transaction.original_description || 'Bank transaction'
  const counterparties = Array.isArray(transaction.counterparties) ? transaction.counterparties.map((entry: Record<string, any>) => entry?.name) : []
  const transferText = [description, transaction.name, transaction.original_description, ...counterparties].filter(Boolean).join(' ').toLowerCase()
  const isAccountTransfer = [transaction.merchant_name, description, ...counterparties].some(isGreenFortParty)
    || ((/\bgreen\s*fort(?:\s*\*?\s*l\.?l\.?c\.?)?\b|\bgreenfort(?:\s+l\.?l\.?c\.?)?\b/.test(transferText))
      && (/\bflagstar\b|\bflagbk\b/.test(transferText))
      && (/\btransfer\b|webxfr|acctverify|account verify/.test(transferText)))
  const category = isAccountTransfer ? 'Bank Transfer' : transaction.personal_finance_category?.primary?.replaceAll('_', ' ') || null
  return {
    project_id: projectId,
    source_row_id: `plaid:${itemId}:${transaction.transaction_id}`,
    bank: 'boa',
    owner: 'Project / Unassigned',
    is_owner_contribution: false,
    date: transaction.date || transaction.authorized_date || null,
    description,
    amount,
    balance: null,
    account: [account?.name, account?.mask ? `••${account.mask}` : ''].filter(Boolean).join(' '),
    source_name: 'Plaid live connection',
    category,
    phase: null,
    vendor: transaction.merchant_name || null,
    memo: transaction.payment_channel || null,
    confidence: null,
    transaction_type: amount >= 0 ? 'Credit' : (transaction.check_number ? 'Check' : 'Debit'),
    raw_description: transaction.original_description || transaction.name || null,
    review_reasons: isAccountTransfer ? [] : ['Review live bank transaction'],
    classification_status: isAccountTransfer ? 'auto_classified' : 'needs_review',
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const publishableKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const authorization = request.headers.get('Authorization')
    if (!supabaseUrl || !publishableKey || !serviceRoleKey || !authorization) return json({ error: 'Bank connection service is not configured.' }, 500)

    const caller = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: authData, error: authError } = await caller.auth.getUser()
    if (authError || !authData.user) return json({ error: 'Sign in before managing a bank connection.' }, 401)

    const body = await request.json()
    const projectId = Number(body.projectId)
    if (!Number.isSafeInteger(projectId) || projectId <= 0) return json({ error: 'Select a valid project.' }, 400)
    await requireProjectAdmin(caller, authData.user.id, projectId)

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })

    if (body.action === 'status') {
      const { data, error } = await admin.from('bank_connections').select('*').eq('project_id', projectId).neq('status', 'disconnected').order('created_at')
      if (error) throw error
      return json({ connections: (data || []).map(publicConnection), configured: Boolean(Deno.env.get('PLAID_CLIENT_ID') && Deno.env.get('PLAID_SECRET') && Deno.env.get('PLAID_TOKEN_ENCRYPTION_KEY')) })
    }

    if (body.action === 'create_link_token') {
      const redirectUri = Deno.env.get('PLAID_REDIRECT_URI')
      const linkBody: Record<string, unknown> = {
        client_name: 'Greenfort Accountant',
        language: 'en',
        country_codes: ['US'],
        products: ['transactions'],
        user: { client_user_id: authData.user.id },
      }
      if (redirectUri) linkBody.redirect_uri = redirectUri
      const result = await plaidRequest('/link/token/create', linkBody)
      return json({ linkToken: result.link_token, expiration: result.expiration })
    }

    if (body.action === 'exchange_public_token') {
      if (!body.publicToken) return json({ error: 'Plaid did not return a public token.' }, 400)
      const exchanged = await plaidRequest('/item/public_token/exchange', { public_token: body.publicToken })
      const [item, balances] = await Promise.all([
        plaidRequest('/item/get', { access_token: exchanged.access_token }),
        plaidRequest('/accounts/balance/get', { access_token: exchanged.access_token }),
      ])
      let institutionName = String(body.institutionName || 'Connected bank')
      if (item.item?.institution_id) {
        try {
          const institution = await plaidRequest('/institutions/get_by_id', { institution_id: item.item.institution_id, country_codes: ['US'] })
          institutionName = institution.institution?.name || institutionName
        } catch { /* The connection remains usable when institution metadata is temporarily unavailable. */ }
      }
      if ((Deno.env.get('PLAID_ENV') || 'sandbox').toLowerCase() === 'production' && !/bank of america/i.test(institutionName)) {
        await plaidRequest('/item/remove', { access_token: exchanged.access_token })
        return json({ error: 'This connection is limited to Bank of America accounts.' }, 400)
      }
      const { data, error } = await admin.from('bank_connections').upsert({
        project_id: projectId,
        institution_id: item.item?.institution_id || null,
        institution_name: institutionName,
        item_id: exchanged.item_id,
        access_token_ciphertext: await encryptToken(exchanged.access_token),
        accounts: (balances.accounts || []).map(accountSummary),
        status: 'connected',
        last_error: null,
        connected_by: authData.user.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'item_id' }).select('*').single()
      if (error) throw error
      return json({ connection: publicConnection(data) })
    }

    const connectionId = String(body.connectionId || '')
    const { data: connection, error: connectionError } = await admin.from('bank_connections').select('*').eq('id', connectionId).eq('project_id', projectId).maybeSingle()
    if (connectionError) throw connectionError
    if (!connection) return json({ error: 'Bank connection not found.' }, 404)
    const accessToken = await decryptToken(connection.access_token_ciphertext)

    if (body.action === 'disconnect') {
      await plaidRequest('/item/remove', { access_token: accessToken })
      const { error } = await admin.from('bank_connections').update({ status: 'disconnected', access_token_ciphertext: '', updated_at: new Date().toISOString() }).eq('id', connection.id)
      if (error) throw error
      return json({ disconnected: true })
    }

    if (body.action === 'sync') {
      let cursor = connection.sync_cursor || undefined
      let hasMore = true
      let added: Record<string, any>[] = []
      let modified: Record<string, any>[] = []
      let removed: Record<string, any>[] = []
      while (hasMore) {
        const page = await plaidRequest('/transactions/sync', { access_token: accessToken, ...(cursor ? { cursor } : {}), count: 500, options: { include_original_description: true } })
        added = added.concat(page.added || [])
        modified = modified.concat(page.modified || [])
        removed = removed.concat(page.removed || [])
        cursor = page.next_cursor
        hasMore = Boolean(page.has_more)
      }
      const balances = await plaidRequest('/accounts/balance/get', { access_token: accessToken })
      const accountsById = Object.fromEntries((balances.accounts || []).map((account: Record<string, any>) => [account.account_id, account]))
      const incoming = [...added, ...modified].map((transaction) => classifyPlaidTransaction(transaction, accountsById[transaction.account_id], connection.item_id, projectId))
      if (incoming.length) {
        const keys = incoming.map((row) => row.source_row_id)
        const { data: existingRows, error: existingError } = await admin.from('bank_transactions').select('source_row_id,owner,is_owner_contribution,category,phase,review_reasons,classification_status,reviewed_at').eq('project_id', projectId).in('source_row_id', keys)
        if (existingError) throw existingError
        const existing = Object.fromEntries((existingRows || []).map((row: Record<string, any>) => [row.source_row_id, row]))
        const rows = incoming.map((row) => existing[row.source_row_id] ? { ...row, ...existing[row.source_row_id] } : row)
        const { error } = await admin.from('bank_transactions').upsert(rows, { onConflict: 'project_id,source_row_id' })
        if (error) throw error
      }
      if (removed.length) {
        const removedKeys = removed.map((entry) => `plaid:${connection.item_id}:${entry.transaction_id}`)
        const { error } = await admin.from('bank_transactions').delete().eq('project_id', projectId).in('source_row_id', removedKeys)
        if (error) throw error
      }
      const syncedAt = new Date().toISOString()
      const { data: updated, error: updateError } = await admin.from('bank_connections').update({
        sync_cursor: cursor || connection.sync_cursor,
        accounts: (balances.accounts || []).map(accountSummary),
        status: 'connected',
        last_error: null,
        last_synced_at: syncedAt,
        updated_at: syncedAt,
      }).eq('id', connection.id).select('*').single()
      if (updateError) throw updateError
      return json({ connection: publicConnection(updated), added: added.length, modified: modified.length, removed: removed.length })
    }

    return json({ error: 'Unknown bank connection action.' }, 400)
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'The bank connection request failed.' }, 500)
  }
})
