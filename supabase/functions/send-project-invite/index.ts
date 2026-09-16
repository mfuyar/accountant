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

const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;')

const sendAdminCopy = async ({ recipient, remindedEmail, projectName }: { recipient: string, remindedEmail: string, projectName: string }) => {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('REMINDER_EMAIL_FROM')
  if (!apiKey || !from) return 'not_configured'

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [recipient],
      subject: `Admin reminder sent – ${projectName}`,
      html: `<p>You sent an administrator reminder for <strong>${escapeHtml(projectName)}</strong>.</p><p>Recipient: ${escapeHtml(remindedEmail)}</p><p>This is a confirmation copy only. For security, the recipient's sign-in link is not included.</p>`,
    }),
  })
  return response.ok ? 'sent' : 'failed'
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

    const { projectId, email, redirectTo, sendCopy } = await request.json()
    const normalizedEmail = String(email || '').trim().toLowerCase()
    if (!Number.isFinite(Number(projectId)) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
      return json({ error: 'A valid project and email address are required.' }, 400)
    }

    const callerClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: callerData, error: callerError } = await callerClient.auth.getUser()
    if (callerError || !callerData.user?.email) return json({ error: 'The signed-in administrator could not be verified.' }, 401)
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

    let delivery = 'invite'
    if (inviteError && /already|registered|exists/i.test(inviteError.message)) {
      const emailClient = createClient(supabaseUrl, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const { error: magicLinkError } = await emailClient.auth.signInWithOtp({
        email: normalizedEmail,
        options: { shouldCreateUser: false, emailRedirectTo: validatedRedirect },
      })
      if (magicLinkError) return json({ error: magicLinkError.message }, 400)
      delivery = 'magic_link'
    } else if (inviteError) {
      return json({ error: inviteError.message }, 400)
    }

    let copyDelivery = 'not_requested'
    if (sendCopy === true) {
      const { data: project } = await adminClient.from('projects').select('name').eq('id', Number(projectId)).maybeSingle()
      try {
        copyDelivery = await sendAdminCopy({
          recipient: callerData.user.email,
          remindedEmail: normalizedEmail,
          projectName: project?.name || `Project ${projectId}`,
        })
      } catch {
        copyDelivery = 'failed'
      }
    }
    return json({ assignment, delivery, copyDelivery })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Invitation email could not be sent.' }, 500)
  }
})
