import { useEffect, useState } from 'react'
import { assignProjectAdmin, fetchProjectAccess } from './lib/supabase'

function AccessAdmin({ projects, accessProfile }) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const [email, setEmail] = useState('')
  const [members, setMembers] = useState([])
  const [invitations, setInvitations] = useState([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

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

  const handleAssign = async (event) => {
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
    try {
      const result = await assignProjectAdmin(projectId, email)
      setMessage(result === 'assigned'
        ? `${email.trim().toLowerCase()} is now a project administrator.`
        : `${email.trim().toLowerCase()} will become a project administrator when they first sign in.`)
      setEmail('')
      await loadAccess(projectId)
    } catch (assignError) {
      setError(assignError.message || 'The administrator could not be assigned.')
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
          <button type="submit" className="action-button">Assign project admin</button>
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
              <span>Invited admin</span>
            </div>
          ))}
          {!members.length && !invitations.length ? <div className="table-row"><strong>No project-specific administrators yet.</strong></div> : null}
        </div>
      </div>
    </section>
  )
}

export default AccessAdmin
