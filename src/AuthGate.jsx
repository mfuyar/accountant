import { useEffect, useState } from 'react'
import { fetchAccessProfile, sendMagicLink, signInWithPassword, supabase, updateAccountPassword } from './lib/supabase'

function AuthGate({ children }) {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(undefined)
  const [email, setEmail] = useState('mfuyar@gmail.com')
  const [password, setPassword] = useState('')
  const [showLinkFallback, setShowLinkFallback] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const sessionUserId = session?.user?.id

  useEffect(() => {
    if (!supabase) {
      setSession(null)
      setProfile(null)
      return undefined
    }

    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!sessionUserId) {
      setProfile(null)
      return
    }
    setProfile(undefined)
    fetchAccessProfile(sessionUserId)
      .then(setProfile)
      .catch((profileError) => {
        setError(profileError.message)
        setProfile(null)
      })
  }, [sessionUserId])

  const handleMagicLink = async (event) => {
    event?.preventDefault()
    setError('')
    setMessage('')
    if (!email.trim() || !email.includes('@')) {
      setError('Enter a valid email address.')
      return
    }
    try {
      setSubmitting(true)
      await sendMagicLink(email)
      setMessage(`A secure sign-in link was sent to ${email.trim().toLowerCase()}.`)
    } catch (sendError) {
      setError(sendError.message || 'The sign-in link could not be sent.')
    } finally {
      setSubmitting(false)
    }
  }

  const handlePasswordSignIn = async (event) => {
    event.preventDefault()
    setError('')
    setMessage('')
    if (!email.trim() || !email.includes('@')) {
      setError('Enter a valid email address.')
      return
    }
    if (!password) {
      setError('Enter your password, or use the email sign-in link below.')
      return
    }
    try {
      setSubmitting(true)
      await signInWithPassword(email, password)
    } catch (signInError) {
      const detail = signInError?.message || 'Email or password is incorrect.'
      setError(`${detail} You can use the email sign-in link below.`)
      setShowLinkFallback(true)
    } finally {
      setSubmitting(false)
    }
  }

  if (!supabase) {
    return <div className="auth-shell"><div className="panel"><h1>Configuration required</h1><p>Supabase must be configured before accessing Greenfort Accountant.</p></div></div>
  }

  if (session === undefined || (session && profile === undefined)) {
    return <div className="auth-shell"><div className="panel"><p>Checking access…</p></div></div>
  }

  if (!session) {
    return (
      <main className="auth-shell">
        <section className="panel auth-card">
          <p className="eyebrow">Protected workspace</p>
          <h1>Sign in to Greenfort Accountant</h1>
          <p>Use your email and password. If you have not set a password yet, use the secure email link.</p>
          <form className="owner-form auth-password-form" noValidate onSubmit={handlePasswordSignIn}>
            <label>
              Email address
              <input aria-label="Sign-in email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label>
              Password
              <input aria-label="Password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            {error ? <p className="validation-error" role="alert">{error}</p> : null}
            {message ? <p role="status">{message}</p> : null}
            <button type="submit" className="action-button" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'}</button>
            <button type="button" className="text-button" aria-expanded={showLinkFallback} onClick={() => setShowLinkFallback((current) => !current)}>
              {showLinkFallback ? 'Hide email-link option' : 'Use email sign-in link instead'}
            </button>
            {showLinkFallback ? <div className="auth-link-fallback">
              <p>We will send a secure one-time link to the email address above. After signing in, you can set a password from your account menu.</p>
              <button type="button" className="secondary-button" disabled={submitting} onClick={handleMagicLink}>{submitting ? 'Sending…' : 'Email me a sign-in link'}</button>
            </div> : null}
          </form>
        </section>
      </main>
    )
  }

  if (!profile || (!profile.is_global_admin && !profile.projectMemberships?.length)) {
    return (
      <main className="auth-shell">
        <section className="panel auth-card">
          <h1>Access not assigned</h1>
          <p>{session.user.email} has signed in but does not have a GreenFort profile or project assignment.</p>
          {error ? <p className="validation-error">{error}</p> : null}
          <button type="button" className="secondary-button" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </section>
      </main>
    )
  }

  return children({
    accessProfile: profile,
    authUser: session.user,
    onSignOut: () => supabase.auth.signOut(),
    onUpdatePassword: updateAccountPassword,
  })
}

export default AuthGate
