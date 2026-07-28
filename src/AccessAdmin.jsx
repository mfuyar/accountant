import { useEffect, useState } from 'react'
import { assignProjectAdmin, fetchProjectAccess, sendProjectAdminInvite } from './lib/supabase'

function AccessAdmin({ projects, accessProfile }) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const [email, setEmail] = useState('')
  const [members, setMembers] = useState([])
  const [invitations, setInvitations] = useState([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [resendingEmail, setResendingEmail] = useState('')

  const loadAccess = async (selectedProjectId) => {
    if (selectedProjectId === '') return
    try {
      const data = await fetchProjectAccess(selectedProjectId)
      setMembers(data.members)
      setInvitations(data.invitations)
      setError('')
    } catch (loadError) {
      setError(loadError.message || 'Project access could not be loaded.')
    }
  }

  useEffect(() => {
    if (!projects.some((project) => String(project.id) === String(projectId))) {
      setProjectId(projects[0]?.id ?? '')
      return
    }
    loadAccess(projectId)
  }, [projectId, projects])

  const handleAssign = async (event, sendEmail = false) => {
    event.preventDefault()
    setError('')
    setMessage('')
    if (projectId === '') {
      setError('Select a project before assigning an administrator.')
      return
    }
    if (!email.trim() || !email.includes('@')) {
      setError('Enter a valid administrator email address.')
      return
    }
    setSaving(true)
    try {
      const normalizedEmail = email.trim().toLowerCase()
      if (sendEmail) {
        await sendProjectAdminInvite(projectId, normalizedEmail)
        setMessage(`Invitation email sent to ${normalizedEmail}. They will receive project administrator access when they sign in.`)
      } else {
        const result = await assignProjectAdmin(projectId, normalizedEmail)
        setMessage(result === 'assigned'
          ? `${normalizedEmail} is now a project administrator.`
          : `${normalizedEmail} will become a project administrator when they first sign in.`)
      }
      setEmail('')
      await loadAccess(projectId)
    } catch (assignError) {
      setError(assignError.message || 'The administrator could not be assigned.')
    } finally {
      setSaving(false)
    }
  }

  const handleResendInvite = async (invitation) => {
    setError('')
    setMessage('')
    setResendingEmail(invitation.email)
    try {
      await sendProjectAdminInvite(projectId, invitation.email)
      setMessage(`Invitation email resent to ${invitation.email}.`)
      await loadAccess(projectId)
    } catch (resendError) {
      setError(resendError.message || 'The invitation email could not be resent.')
    } finally {
      setResendingEmail('')
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Authorization</p>
          <h2>Project administrators</h2>
          <p>{accessProfile.is_global_admin ? 'Global administrator: access to every project.' : 'Manage administrators for your assigned projects.'}</p>
        </div>
      </div>
      <div className="section-grid">
        <form className="owner-form" noValidate onSubmit={handleAssign}>
          <label>
            Project
            <select aria-label="Administrator project" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          <label>
            Administrator email
            <input aria-label="Project administrator email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          {error ? <p className="validation-error" role="alert">{error}</p> : null}
          {message ? <p role="status">{message}</p> : null}
          <div className="button-row">
            <button type="submit" className="secondary-button" disabled={saving}>Assign only</button>
            <button type="button" className="action-button" disabled={saving} onClick={(event) => handleAssign(event, true)}>{saving ? 'Sending…' : 'Assign & send invite'}</button>
          </div>
        </form>
        <div className="table-card">
          {members.map((member) => (
            <div key={member.user_id} className="table-row">
              <div><strong>{member.profiles?.full_name || member.profiles?.email}</strong><p>{member.profiles?.email}</p></div>
              <span>{member.profiles?.is_global_admin ? 'Global admin' : 'Project admin'}</span>
            </div>
          ))}
          {invitations.map((invitation) => (
            <div key={invitation.id} className="table-row">
              <div><strong>{invitation.email}</strong><p>Waiting for first sign-in</p></div>
              <div className="button-row">
                <span>Invited admin</span>
                <button type="button" className="secondary-button" disabled={resendingEmail === invitation.email} onClick={() => handleResendInvite(invitation)}>
                  {resendingEmail === invitation.email ? 'Resending…' : 'Resend invite'}
                </button>
              </div>
            </div>
          ))}
          {!members.length && !invitations.length ? <div className="table-row"><strong>No project-specific administrators yet.</strong></div> : null}
        </div>
      </div>
    </section>
  )
}

export default AccessAdmin
