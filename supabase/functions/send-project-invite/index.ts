import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    ...corsHeaders,
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  },
})

const safeRedirectUrl = (requested: unknown) => {
  if (!requested) return undefined
  try {
    const url = new URL(String(requested))
    const allowedOrigins = (Deno.env.get('ALLOWED_REDIRECT_ORIGINS') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
    return allowedOrigins.includes(url.origin) ? url.origin : undefined
  } catch {
    return undefined
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
    if (!supabaseUrl || !publishableKey || !serviceRoleKey || !authorization) {
      return json({ error: 'Invitation service is not configured.' }, 500)
    }

    const { projectId, email, redirectTo } = await request.json()
    const normalizedEmail = String(email || '').trim().toLowerCase()
    if (!Number.isFinite(Number(projectId)) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
      return json({ error: 'A valid project and email address are required.' }, 400)
    }

    const callerClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: assignment, error: assignmentError } = await callerClient.rpc('assign_project_admin', {
      p_project_id: Number(projectId),
      p_email: normalizedEmail,
    })
    if (assignmentError) return json({ error: assignmentError.message }, 403)

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const validatedRedirect = safeRedirectUrl(redirectTo)
    const inviteOptions = validatedRedirect ? { redirectTo: validatedRedirect } : undefined
    const { error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(normalizedEmail, inviteOptions)

    if (inviteError && /already|registered|exists/i.test(inviteError.message)) {
      const emailClient = createClient(supabaseUrl, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const { error: magicLinkError } = await emailClient.auth.signInWithOtp({
        email: normalizedEmail,
        options: { shouldCreateUser: false, emailRedirectTo: validatedRedirect },
      })
      if (magicLinkError) return json({ error: magicLinkError.message }, 400)
      return json({ assignment, delivery: 'magic_link' })
    }
    if (inviteError) return json({ error: inviteError.message }, 400)
    return json({ assignment, delivery: 'invite' })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Invitation email could not be sent.' }, 500)
  }
})
