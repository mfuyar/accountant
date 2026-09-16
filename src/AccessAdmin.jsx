import { useEffect, useState } from 'react'
import { fetchProjectAccess, removeProjectAdmin, sendProjectAdminInvite } from './lib/supabase'

function AccessAdmin({ projects, accessProfile }) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const [email, setEmail] = useState('')
  const [members, setMembers] = useState([])
  const [invitations, setInvitations] = useState([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [resendingEmail, setResendingEmail] = useState('')
  const [remindingEmail, setRemindingEmail] = useState('')
  const [removingUserId, setRemovingUserId] = useState('')

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

  const handleInvite = async (event) => {
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
      const result = await sendProjectAdminInvite(projectId, normalizedEmail)
      setMessage(result?.delivery === 'magic_link'
        ? `${normalizedEmail} already has an account. A sign-in link was sent and project administrator access was added.`
        : `Invitation email sent to ${normalizedEmail}. They will have administrator access to this project only.`)
      setEmail('')
      await loadAccess(projectId)
    } catch (assignError) {
      setError(assignError.message || 'The administrator could not be assigned.')
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async (member) => {
    const memberEmail = member.profiles?.email || 'this administrator'
    if (!window.confirm(`Remove ${memberEmail} as an administrator for this project?`)) return
    setError('')
    setMessage('')
    setRemovingUserId(member.user_id)
    try {
      await removeProjectAdmin(projectId, member.user_id)
      setMessage(`${memberEmail} no longer has administrator access to this project.`)
      await loadAccess(projectId)
    } catch (removeError) {
      setError(removeError.message || 'The administrator could not be removed.')
    } finally {
      setRemovingUserId('')
    }
  }

  const handleResendInvite = async (invitation) => {
    setError('')
    setMessage('')
    setResendingEmail(invitation.email)
    try {
      const result = await sendProjectAdminInvite(projectId, invitation.email, { sendCopy: true })
      setMessage(result?.copyDelivery === 'sent'
        ? `An administrator invitation reminder was sent to ${invitation.email}, with a confirmation copy sent to you.`
        : `The invitation reminder was sent to ${invitation.email}, but the confirmation copy could not be sent. Ask a global administrator to configure reminder email copies.`)
      await loadAccess(projectId)
    } catch (resendError) {
      setError(resendError.message || 'The invitation email could not be resent.')
    } finally {
      setResendingEmail('')
    }
  }

  const handleReminder = async (member) => {
    const memberEmail = member.profiles?.email
    if (!memberEmail) return
    setError('')
    setMessage('')
    setRemindingEmail(memberEmail)
    try {
      const result = await sendProjectAdminInvite(projectId, memberEmail, { sendCopy: true })
      setMessage(result?.copyDelivery === 'sent'
        ? `A secure sign-in reminder was sent to ${memberEmail}, with a confirmation copy sent to you. Their access has not changed.`
        : `The sign-in reminder was sent to ${memberEmail}, but the confirmation copy could not be sent. Their access has not changed.`)
      await loadAccess(projectId)
    } catch (reminderError) {
      setError(reminderError.message || 'The reminder email could not be sent.')
    } finally {
      setRemindingEmail('')
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
        <form className="owner-form" noValidate onSubmit={handleInvite}>
          <div>
            <h3>Invite another administrator</h3>
            <p>They can manage accounting and invite administrators for the selected project only.</p>
          </div>
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
            <button type="submit" className="action-button" disabled={saving}>{saving ? 'Sending invitation…' : 'Send admin invitation'}</button>
          </div>
        </form>
        <div className="table-card">
          {members.map((member) => (
            <div key={member.user_id} className="table-row">
              <div><strong>{member.profiles?.full_name || member.profiles?.email}</strong><p>{member.profiles?.email}</p></div>
              <div className="button-row">
                <span>{member.profiles?.is_global_admin ? 'Global admin' : 'Project admin'}</span>
                {member.profiles?.email?.toLowerCase() !== accessProfile.email?.toLowerCase() ? (
                  <button type="button" className="secondary-button" disabled={remindingEmail === member.profiles?.email} onClick={() => handleReminder(member)}>
                    {remindingEmail === member.profiles?.email ? 'Sending…' : 'Send sign-in reminder'}
                  </button>
                ) : null}
                {!member.profiles?.is_global_admin && member.profiles?.email?.toLowerCase() !== accessProfile.email?.toLowerCase() ? (
                  <button type="button" className="secondary-button" disabled={removingUserId === member.user_id} onClick={() => handleRemove(member)}>
                    {removingUserId === member.user_id ? 'Removing…' : 'Remove'}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          {invitations.map((invitation) => (
            <div key={invitation.id} className="table-row">
              <div><strong>{invitation.email}</strong><p>Waiting for first sign-in</p></div>
              <div className="button-row">
                <span>Invited admin</span>
                <button type="button" className="secondary-button" disabled={resendingEmail === invitation.email} onClick={() => handleResendInvite(invitation)}>
                  {resendingEmail === invitation.email ? 'Sending reminder…' : 'Send invitation reminder'}
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
