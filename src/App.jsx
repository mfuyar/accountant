import { Fragment, useEffect, useMemo, useState } from 'react'
import './App.css'
import IntakePage from './IntakePage'
import CostPage from './CostPage'
import ClassificationPage from './ClassificationPage'
import IncomeSection from './IncomeSection'
import LotCommitments from './LotCommitments'
import SpendingByJob from './SpendingByJob'
import TaxAudit from './TaxAudit'
import BankDashboard from './BankDashboard'
import AccessAdmin from './AccessAdmin'
import CheckPrinting from './CheckPrinting'
import {
  initialCategories,
  initialInvoices,
  initialProjects,
  initialTransactions,
  initialVendors,
  sampleImportRows,
} from './data'
import {
  addCostsToBreakdownGroup,
  approveReviewItem,
  createCostVersion,
  createDocumentSignedUrl,
  deleteIncome,
  fetchBankTransactions,
  fetchOwners,
  fetchProjectData,
  fetchProjectWorkspace,
  mergeCostBreakdowns,
  removeReviewItem,
  saveBankTransactions,
  saveIncome,
  saveIntakeItem,
  saveLotCommitment,
  saveManualTransaction,
  saveOwner,
  saveProject,
  saveProjectCheck,
  supabase,
  updateBankTransaction,
  updateConstructionDraft,
  updateIncome,
  updateOwner,
  updateProjectCheckStatus,
  updateProjectCheckFunding,
  updateProjectCheckLot,
  updateProjectCheckLink,
  updateProjectCheckTemplate,
  unmergeCostBreakdownGroup,
  uploadProjectDocument,
} from './lib/supabase'
import { getActiveCosts } from './lib/costVersions'

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

const costPhaseLabel = (phase) => ({
  development: 'Development',
  construction: 'Construction',
  soft_cost: 'Soft Cost',
  other: 'Other',
}[phase] || phase || 'Development')

function App({ accessProfile = null, authUser = null, onSignOut = null, onUpdatePassword = null }) {
  const persistenceEnabled = Boolean(supabase && accessProfile && authUser)
  const [projects, setProjects] = useState(initialProjects)
  const [projectName, setProjectName] = useState('')
  const [projectAddress, setProjectAddress] = useState('')
  const [projectBudget, setProjectBudget] = useState('')
  const [projectStartDate, setProjectStartDate] = useState('')
  const [projectStatus, setProjectStatus] = useState('planning')
  const [projectNotes, setProjectNotes] = useState('')
  const [projectFormError, setProjectFormError] = useState('')
  const [projectSaveMessage, setProjectSaveMessage] = useState('')
  const [categories, setCategories] = useState(initialCategories)
  const [vendors] = useState(initialVendors)
  const [invoices, setInvoices] = useState(initialInvoices)
  const [transactions, setTransactions] = useState(initialTransactions)
  const [importRows, setImportRows] = useState(sampleImportRows)
  const [reviewItems, setReviewItems] = useState([])
  const [constructionDrafts, setConstructionDrafts] = useState([])
  const [projectChecks, setProjectChecks] = useState([])
  const [owners, setOwners] = useState([])
  const [ownerName, setOwnerName] = useState('')
  const [ownerContribution, setOwnerContribution] = useState('')
  const [ownerFormError, setOwnerFormError] = useState('')
  const [editingOwnerId, setEditingOwnerId] = useState(null)
  const [developmentCostName, setDevelopmentCostName] = useState('')
  const [developmentCostAmount, setDevelopmentCostAmount] = useState('')
  const [developmentCostDate, setDevelopmentCostDate] = useState('')
  const [developmentCostPhase, setDevelopmentCostPhase] = useState('development')
  const [developmentCostError, setDevelopmentCostError] = useState('')
  const [selectedOwnerId, setSelectedOwnerId] = useState(null)
  const [developmentCosts, setDevelopmentCosts] = useState([])
  const [portfolioCostTotals, setPortfolioCostTotals] = useState({})
  const [incomes, setIncomes] = useState([])
  const [lotCommitments, setLotCommitments] = useState([])
  const [bankTransactions, setBankTransactions] = useState([])
  const [activeProjectId, setActiveProjectId] = useState(initialProjects[0]?.id ?? null)
  const [showIntakePage, setShowIntakePage] = useState(false)
  const [showCostPage, setShowCostPage] = useState(false)
  const [breakdownParentCostId, setBreakdownParentCostId] = useState(null)
  const [showClassificationPage, setShowClassificationPage] = useState(false)
  const [workspaceView, setWorkspaceView] = useState(() => accessProfile ? 'portfolio' : 'project')
  const [workspaceLoadError, setWorkspaceLoadError] = useState('')
  const [workspaceReloadKey, setWorkspaceReloadKey] = useState(0)
  const [projectSection, setProjectSection] = useState('overview')
  const [showOwnerPhaseCostForm, setShowOwnerPhaseCostForm] = useState(true)
  const [expandedOverviewCostIds, setExpandedOverviewCostIds] = useState(() => new Set())
  const [pendingSquareCostId, setPendingSquareCostId] = useState(null)
  const [squaringCostId, setSquaringCostId] = useState(null)
  const [overviewCostMessage, setOverviewCostMessage] = useState(null)
  const [showAccountSecurity, setShowAccountSecurity] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordMessage, setPasswordMessage] = useState(null)
  const [updatingPassword, setUpdatingPassword] = useState(false)

  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0]

  const handlePasswordUpdate = async (event) => {
    event.preventDefault()
    setPasswordMessage(null)
    if (newPassword.length < 8) {
      setPasswordMessage({ type: 'error', text: 'Use at least 8 characters for your password.' })
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'The password confirmation does not match.' })
      return
    }
    if (!onUpdatePassword) {
      setPasswordMessage({ type: 'error', text: 'Password updates are unavailable. Sign in again and retry.' })
      return
    }
    setUpdatingPassword(true)
    try {
      await onUpdatePassword(newPassword)
      setNewPassword('')
      setConfirmPassword('')
      setPasswordMessage({ type: 'success', text: 'Password saved. You can use it for your next sign-in.' })
    } catch (error) {
      setPasswordMessage({ type: 'error', text: `Password could not be saved: ${error instanceof Error ? error.message : 'Unknown error'}` })
    } finally {
      setUpdatingPassword(false)
    }
  }

  const projectMetrics = useMemo(() => {
    return projects.map((project) => {
      const projectCategories = categories.filter((category) => category.projectId === project.id)
      const projectTransactions = transactions.filter((transaction) => transaction.projectId === project.id)
      const categoryBudget = projectCategories.reduce((sum, category) => sum + Number(category.budgetedAmount || 0), 0)
      const totalBudget = categoryBudget > 0 ? categoryBudget : Number(project.totalBudget ?? project.total_budget ?? 0)
      const actualSpent = projectTransactions.reduce((sum, transaction) => sum + transaction.amount, 0)
      return {
        ...project,
        totalBudget,
        actualSpent,
        savedCosts: Number(portfolioCostTotals[project.id] || 0),
        variance: totalBudget - actualSpent,
        utilization: totalBudget === 0 ? 0 : Math.round((actualSpent / totalBudget) * 100),
      }
    })
  }, [categories, portfolioCostTotals, projects, transactions])

  const selectedProjectCategories = categories.filter((category) => category.projectId === activeProjectId)
  const projectTransactions = transactions.filter((transaction) => transaction.projectId === activeProjectId)
  const projectInvoices = invoices.filter((invoice) => invoice.projectId === activeProjectId)
  const runningBalance = [...projectTransactions]
    .sort((a, b) => a.date.localeCompare(b.date))
    .reduce((acc, transaction) => {
      const running = acc.length === 0 ? transaction.amount : acc[acc.length - 1].runningBalance + transaction.amount
      acc.push({ ...transaction, runningBalance: running })
      return acc
    }, [])

  useEffect(() => {
    let isMounted = true

    async function loadRemoteData() {
      try {
        const data = await fetchProjectData()
        if (data && isMounted) {
          if (data.projects?.length) {
            setProjects(data.projects)
            const tryonProject = data.projects.find((project) => project.name?.trim().toLowerCase() === 'tryon rd')
            setActiveProjectId((current) => data.projects.some((project) => project.id === current)
              ? current
              : (tryonProject || data.projects[0]).id)
          }
          if (data.owners?.length) {
            setOwners(data.owners)
          }
          setPortfolioCostTotals(data.projectCostTotals || {})
        }
      } catch {
        // Leave the workspace empty when Supabase is unavailable.
      }
    }

    if (persistenceEnabled) {
      loadRemoteData()
    }

    return () => {
      isMounted = false
    }
  }, [persistenceEnabled])

  useEffect(() => {
    let isMounted = true

    async function loadOwnersFromSupabase() {
      try {
        const remoteOwners = await fetchOwners(activeProjectId)
        if (isMounted) {
          setOwners(remoteOwners.map((owner) => ({
            id: owner.id,
            name: owner.name,
            contributionAmount: Number(owner.contribution_amount || 0),
          })))
        }
      } catch {
        // Keep the current owners when Supabase is unavailable.
      }
    }

    if (persistenceEnabled && activeProjectId != null) {
      loadOwnersFromSupabase()
    }

    return () => {
      isMounted = false
    }
  }, [activeProjectId, persistenceEnabled])

  useEffect(() => {
    let isMounted = true
    if (!persistenceEnabled || activeProjectId == null) return undefined

    fetchProjectWorkspace(activeProjectId)
      .then((data) => {
        if (!isMounted) return
        setWorkspaceLoadError(data.warnings?.length ? `Some project sections could not load: ${data.warnings.join(' · ')}` : '')
        setCategories(data.categories)
        setInvoices(data.invoices)
        setTransactions(data.transactions)
        setDevelopmentCosts(data.costVersions)
        const workspaceParentTotal = getActiveCosts(data.costVersions)
          .filter((cost) => !cost.parentCostId)
          .reduce((sum, cost) => sum + Number(cost.amount || 0), 0)
        setPortfolioCostTotals((current) => ({
          ...current,
          [activeProjectId]: workspaceParentTotal,
        }))
        setIncomes(data.incomes)
        setReviewItems(data.reviewItems)
        setConstructionDrafts(data.constructionDrafts)
        setProjectChecks(data.projectChecks)
        setLotCommitments(data.lotCommitments)
      })
      .catch((error) => {
        if (!isMounted) return
        setWorkspaceLoadError(`Saved costs are still in the database, but the cost ledger could not be loaded: ${error instanceof Error ? error.message : 'Unknown error'}`)
      })

    return () => {
      isMounted = false
    }
  }, [activeProjectId, persistenceEnabled, workspaceReloadKey])

  useEffect(() => {
    localStorage.removeItem('greenfort-bank-transactions-v1')
    localStorage.removeItem('greenfort-bank-transactions-v2')
    localStorage.removeItem('greenfort-bank-transactions-v3')
  }, [])

  useEffect(() => {
    let isMounted = true
    if (!persistenceEnabled || activeProjectId == null) return undefined
    fetchBankTransactions(activeProjectId)
      .then((rows) => {
        if (isMounted) setBankTransactions(rows)
      })
      .catch(() => {
        if (isMounted) setBankTransactions([])
      })
    return () => {
      isMounted = false
    }
  }, [activeProjectId, persistenceEnabled])

  const totalOwnerContribution = useMemo(() => {
    return owners.reduce((sum, owner) => sum + Number(owner.contributionAmount || 0), 0)
  }, [owners])

  const projectCostVersions = useMemo(
    () => developmentCosts.filter((cost) => String(cost.projectId ?? '') === String(activeProjectId ?? '')),
    [activeProjectId, developmentCosts],
  )
  const activeCostRecords = useMemo(() => getActiveCosts(projectCostVersions), [projectCostVersions])
  const activeDevelopmentCosts = useMemo(
    () => activeCostRecords.filter((cost) => !cost.parentCostId),
    [activeCostRecords],
  )
  const activeBreakdownCosts = useMemo(
    () => activeCostRecords.filter((cost) => cost.parentCostId),
    [activeCostRecords],
  )
  const projectIncomes = useMemo(
    () => incomes.filter((income) => String(income.projectId) === String(activeProjectId)),
    [activeProjectId, incomes],
  )
  const projectLotCommitments = useMemo(
    () => lotCommitments.filter((commitment) => String(commitment.projectId) === String(activeProjectId)),
    [activeProjectId, lotCommitments],
  )

  const ownerCostTotal = useMemo(() => {
    return activeDevelopmentCosts.reduce((sum, cost) => sum + Number(cost.amount || 0), 0)
  }, [activeDevelopmentCosts])

  const phaseCostTotals = useMemo(() => activeDevelopmentCosts.reduce((totals, cost) => ({
    ...totals,
    [cost.phase]: Number(totals[cost.phase] || 0) + Number(cost.amount || 0),
  }), {}), [activeDevelopmentCosts])

  const handleRemoveReviewItem = async (itemId) => {
    if (persistenceEnabled) {
      const saved = await removeReviewItem(itemId)
      setReviewItems((current) => current.map((item) => item.id === itemId ? saved : item))
      return
    }
    setReviewItems((current) => current.filter((item) => item.id !== itemId))
  }

  const handleApproveReviewItem = async (itemId, categoryId, notes = '') => {
    const currentItem = reviewItems.find((item) => item.id === itemId)
    if (!currentItem) {
      return false
    }

    if (persistenceEnabled) {
      const savedTransaction = await approveReviewItem(itemId, categoryId, notes)
      setTransactions((current) => [...current, savedTransaction])
      setReviewItems((current) => current.map((item) => item.id === itemId ? {
        ...item,
        status: 'approved',
        categoryId,
      } : item))
      return true
    }

    const payload = {
      id: Date.now(),
      projectId: activeProjectId,
      categoryId: Number(categoryId) || selectedProjectCategories[0]?.id || null,
      date: currentItem.date || new Date().toISOString().slice(0, 10),
      description: currentItem.description || currentItem.vendor || currentItem.sourceName || 'Reviewed statement',
      amount: Number(currentItem.amount || 0),
      source: 'bank_import',
      matchedInvoiceId: null,
      rawImportRow: {
        reviewItemId: currentItem.id,
        sourceName: currentItem.sourceName,
        vendor: currentItem.vendor,
      },
    }

    setTransactions((current) => [...current, payload])
    setReviewItems((current) => current.filter((item) => item.id !== itemId))
    return true
  }

  const handleImportReview = async (rowIndex) => {
    const selectedRow = importRows[rowIndex]
    if (persistenceEnabled) {
      const saved = await saveManualTransaction(activeProjectId, selectedRow, selectedProjectCategories[0]?.id ?? null)
      setTransactions((current) => [...current, saved])
      setImportRows((current) => current.filter((_, index) => index !== rowIndex))
      return
    }
    const payload = {
      id: transactions.length + 1,
      projectId: activeProjectId,
      categoryId: selectedProjectCategories[0]?.id ?? null,
      date: selectedRow.date,
      description: selectedRow.description,
      amount: selectedRow.amount,
      source: 'bank_import',
      matchedInvoiceId: null,
      rawImportRow: selectedRow.rawImportRow,
    }
    setTransactions((current) => [...current, payload])
    setImportRows((current) => current.filter((_, index) => index !== rowIndex))
  }

  const handleOwnerSubmit = async (event) => {
    event.preventDefault()
    if (!ownerName.trim()) {
      setOwnerFormError('Enter an owner name before adding the owner.')
      return
    }

    if (ownerContribution === '') {
      setOwnerFormError('Enter the owner contribution amount. Use 0 if there is no contribution yet.')
      return
    }

    const contributionValue = Number(ownerContribution)
    if (!Number.isFinite(contributionValue) || contributionValue < 0) {
      setOwnerFormError('Contribution amount must be a valid number of 0 or greater.')
      return
    }

    if (owners.some((owner) => owner.id !== editingOwnerId && owner.name.trim().toLowerCase() === ownerName.trim().toLowerCase())) {
      setOwnerFormError('An owner with this name already exists.')
      return
    }

    if (editingOwnerId != null) {
      if (persistenceEnabled) {
        const savedOwner = await updateOwner(editingOwnerId, {
          name: ownerName.trim(),
          contribution_amount: contributionValue,
        })
        if (!savedOwner) {
          setOwnerFormError('Supabase could not save the owner changes. Please try again.')
          return
        }
      }
      setOwners((current) => current.map((owner) => owner.id === editingOwnerId ? {
        ...owner,
        name: ownerName.trim(),
        contributionAmount: contributionValue,
      } : owner))
      setOwnerName('')
      setOwnerContribution('')
      setOwnerFormError('')
      setEditingOwnerId(null)

      return
    }

    const newOwner = {
      id: Date.now(),
      name: ownerName.trim(),
      contributionAmount: contributionValue,
    }

    setOwners((current) => [...current, newOwner])
    setOwnerName('')
    setOwnerContribution('')
    setOwnerFormError('')
    setSelectedOwnerId(newOwner.id)

    try {
      const savedOwner = await saveOwner({
        name: newOwner.name,
        contribution_amount: newOwner.contributionAmount,
        project_id: activeProjectId,
      })
      if (savedOwner) {
        const normalizedOwner = {
          id: savedOwner.id,
          name: savedOwner.name,
          contributionAmount: Number(savedOwner.contribution_amount || 0),
        }
        setOwners((current) => current.map((owner) => owner.id === newOwner.id ? normalizedOwner : owner))
        setSelectedOwnerId(savedOwner.id)
      } else if (persistenceEnabled) {
        setOwners((current) => current.filter((owner) => owner.id !== newOwner.id))
        setSelectedOwnerId(null)
        setOwnerFormError('Supabase could not save this owner. Please try again.')
      }
    } catch (error) {
      setOwners((current) => current.filter((owner) => owner.id !== newOwner.id))
      setSelectedOwnerId(null)
      setOwnerFormError(error instanceof Error ? error.message : 'Supabase could not save this owner.')
    }
  }

  const handleProjectSubmit = async (event) => {
    event.preventDefault()
    if (!projectName.trim()) {
      setProjectFormError('Enter a project name before creating the project.')
      return
    }
    const budget = Number(projectBudget)
    if (projectBudget === '' || !Number.isFinite(budget) || budget < 0) {
      setProjectFormError('Enter a valid project budget of 0 or greater.')
      return
    }

    const temporaryId = Date.now()
    const newProject = {
      id: temporaryId,
      name: projectName.trim(),
      address: projectAddress.trim(),
      status: projectStatus,
      startDate: projectStartDate || null,
      totalBudget: budget,
      notes: projectNotes.trim(),
    }

    setProjects((current) => [...current, newProject])
    setActiveProjectId(temporaryId)
    setProjectName('')
    setProjectAddress('')
    setProjectBudget('')
    setProjectStartDate('')
    setProjectStatus('planning')
    setProjectNotes('')
    setProjectFormError('')
    setProjectSaveMessage('Saving project…')

    if (!persistenceEnabled) {
      setProjectSaveMessage('Project created.')
      return
    }

    const savedProject = await saveProject({
      name: newProject.name,
      address: newProject.address || null,
      status: newProject.status,
      start_date: newProject.startDate,
      total_budget: newProject.totalBudget,
      notes: newProject.notes || null,
    })

    if (savedProject) {
      const normalizedProject = {
        ...savedProject,
        startDate: savedProject.start_date,
        totalBudget: Number(savedProject.total_budget || 0),
      }
      setProjects((current) => current.map((project) => project.id === temporaryId ? normalizedProject : project))
      setActiveProjectId(savedProject.id)
      setProjectSaveMessage('Project saved to Supabase.')
    } else {
      setProjects((current) => current.filter((project) => project.id !== temporaryId))
      setActiveProjectId(projects[0]?.id ?? null)
      setProjectSaveMessage('Supabase did not save the project. No unsaved project was kept in the dashboard.')
    }
  }

  const handleStartOwnerEdit = (owner) => {
    setEditingOwnerId(owner.id)
    setOwnerName(owner.name)
    setOwnerContribution(String(owner.contributionAmount ?? 0))
    setOwnerFormError('')
  }

  const handleCancelOwnerEdit = () => {
    setEditingOwnerId(null)
    setOwnerName('')
    setOwnerContribution('')
    setOwnerFormError('')
  }

  const handleDevelopmentCostSubmit = async (event) => {
    event?.preventDefault?.()
    if (!developmentCostName.trim()) {
      setDevelopmentCostError('Enter a cost name before adding the cost.')
      return
    }
    const amount = Number(developmentCostAmount)
    if (developmentCostAmount === '' || !Number.isFinite(amount) || amount <= 0) {
      setDevelopmentCostError('Enter a valid cost amount greater than 0.')
      return
    }
    if (!developmentCostDate) {
      setDevelopmentCostError('Select the date when the cost occurred.')
      return
    }
    if (selectedOwnerId == null) {
      setDevelopmentCostError('Add and select an owner before adding a cost.')
      return
    }

    if (persistenceEnabled) {
      try {
        const saved = await createCostVersion(activeProjectId, {
          name: developmentCostName.trim(), amount, ownerId: selectedOwnerId,
          phase: developmentCostPhase, date: developmentCostDate, attachments: [],
        })
        setDevelopmentCosts((current) => [...current, saved])
        setPortfolioCostTotals((current) => ({
          ...current,
          [activeProjectId]: Number(current[activeProjectId] || 0) + saved.amount,
        }))
      } catch (error) {
        setDevelopmentCostError(error instanceof Error ? error.message : 'Supabase could not save this cost.')
        return
      }
    } else {
      const costId = crypto.randomUUID()
      const newCost = {
        id: `${costId}-v1`, costId, version: 1, projectId: activeProjectId,
        name: developmentCostName.trim(), amount, ownerId: selectedOwnerId,
        phase: developmentCostPhase, date: developmentCostDate, deletedAt: null,
        createdAt: new Date().toISOString(), attachments: [],
      }
      setDevelopmentCosts((current) => [...current, newCost])
      setPortfolioCostTotals((current) => ({
        ...current,
        [activeProjectId]: Number(current[activeProjectId] || 0) + newCost.amount,
      }))
    }
    setDevelopmentCostName('')
    setDevelopmentCostAmount('')
    setDevelopmentCostDate('')
    setDevelopmentCostPhase('development')
    setDevelopmentCostError('')
  }

  const handleCostPageAdd = async ({ name, amount, ownerId, phase, date, attachments = [], parentCostId = null }) => {
    if (persistenceEnabled) {
      const saved = await createCostVersion(activeProjectId, { name, amount, ownerId, phase, date, attachments, parentCostId })
      setDevelopmentCosts((current) => [...current, saved])
      if (!saved.parentCostId) {
        setPortfolioCostTotals((current) => ({
          ...current,
          [activeProjectId]: Number(current[activeProjectId] || 0) + saved.amount,
        }))
      }
      return saved
    }
    const costId = crypto.randomUUID()
    const newCost = {
      id: `${costId}-v1`,
      costId,
      version: 1,
      projectId: activeProjectId,
      name,
      amount,
      ownerId,
      phase,
      date,
      parentCostId,
      attachments,
      deletedAt: null,
      createdAt: new Date().toISOString(),
    }

    setDevelopmentCosts((current) => [...current, newCost])
    if (!parentCostId) {
      setPortfolioCostTotals((current) => ({
        ...current,
        [activeProjectId]: Number(current[activeProjectId] || 0) + newCost.amount,
      }))
    }
    return newCost
  }

  const handleCostPageEdit = async ({ costId, ...updates }) => {
    if (persistenceEnabled) {
      const previous = getActiveCosts(projectCostVersions).find((cost) => cost.costId === costId)
      const saved = await createCostVersion(activeProjectId, { costId, ...updates })
      setDevelopmentCosts((current) => [...current, saved])
      if (!saved.parentCostId) {
        setPortfolioCostTotals((current) => ({
          ...current,
          [activeProjectId]: Number(current[activeProjectId] || 0) - Number(previous?.amount || 0) + saved.amount,
        }))
      }
      return saved
    }
    setDevelopmentCosts((current) => {
      const latest = getActiveCosts(current.filter((cost) => String(cost.projectId ?? '') === String(activeProjectId ?? ''))).find((cost) => cost.costId === costId)
      if (!latest) {
        return current
      }

      const nextVersion = latest.version + 1
      return [...current, {
        ...latest,
        ...updates,
        id: `${costId}-v${nextVersion}`,
        costId,
        version: nextVersion,
        deletedAt: null,
        createdAt: new Date().toISOString(),
      }]
    })
  }

  const handleSquareCostToBreakdowns = async (cost, breakdownTotal) => {
    setSquaringCostId(cost.costId)
    setOverviewCostMessage(null)
    try {
      await handleCostPageEdit({
        costId: cost.costId,
        name: cost.name,
        amount: breakdownTotal,
        ownerId: cost.ownerId,
        phase: cost.phase,
        date: cost.date,
        attachments: cost.attachments || [],
        parentCostId: cost.parentCostId || null,
      })
      setPendingSquareCostId(null)
      setOverviewCostMessage({ type: 'success', text: `${cost.name} now matches its breakdown total of ${currency.format(breakdownTotal)}. A new version was saved.` })
    } catch (error) {
      setOverviewCostMessage({ type: 'error', text: `The parent total could not be updated: ${error instanceof Error ? error.message : 'Unknown error'}` })
    } finally {
      setSquaringCostId(null)
    }
  }

  const handleCostPageDelete = async (costId) => {
    if (persistenceEnabled) {
      const latest = getActiveCosts(projectCostVersions).find((cost) => cost.costId === costId)
      if (!latest) return null
      const saved = await createCostVersion(activeProjectId, { ...latest, deleted: true })
      setDevelopmentCosts((current) => [...current, saved])
      if (!latest.parentCostId) {
        setPortfolioCostTotals((current) => ({
          ...current,
          [activeProjectId]: Math.max(0, Number(current[activeProjectId] || 0) - Number(latest.amount || 0)),
        }))
      }
      return saved
    }
    setDevelopmentCosts((current) => {
      const latest = getActiveCosts(current.filter((cost) => String(cost.projectId ?? '') === String(activeProjectId ?? ''))).find((cost) => cost.costId === costId)
      if (!latest) {
        return current
      }

      const nextVersion = latest.version + 1
      const deletedAt = new Date().toISOString()
      return [...current, {
        ...latest,
        id: `${costId}-v${nextVersion}`,
        version: nextVersion,
        deletedAt,
        createdAt: deletedAt,
      }]
    })
  }

  const handleAddIncome = async (income) => {
    const saved = persistenceEnabled ? await saveIncome(income) : { ...income, id: Date.now() }
    setIncomes((current) => [saved, ...current])
    return saved
  }

  const handleEditIncome = async (incomeId, updates) => {
    const saved = persistenceEnabled ? await updateIncome(incomeId, updates) : { id: incomeId, ...updates }
    setIncomes((current) => current.map((income) => income.id === incomeId ? saved : income))
    return saved
  }

  const handleSaveLotCommitment = async (commitment) => {
    if (!persistenceEnabled) throw new Error('Sign in before saving lot commitment details')
    const saved = await saveLotCommitment(commitment)
    setLotCommitments((current) => [...current.filter((entry) => !(entry.lot === saved.lot && String(entry.projectId) === String(saved.projectId))), saved])
    return saved
  }

  const handleDeleteIncome = async (incomeId) => {
    if (persistenceEnabled) await deleteIncome(incomeId)
    setIncomes((current) => current.filter((income) => income.id !== incomeId))
  }

  const handleSaveIntakeItem = async (item, file = null) => {
    if (!persistenceEnabled) {
      const reviewItem = { ...item, id: Date.now(), projectId: activeProjectId, status: 'pending', rawData: item }
      setReviewItems((current) => [reviewItem, ...current])
      return { reviewItem, invoice: null }
    }
    const saved = await saveIntakeItem(activeProjectId, item, file)
    setReviewItems((current) => [saved.reviewItem, ...current])
    if (saved.invoice) setInvoices((current) => [saved.invoice, ...current])
    return saved
  }

  const handleUploadCostDocument = persistenceEnabled
    ? (file) => uploadProjectDocument(activeProjectId, file)
    : null

  const handleAttachCostDocument = async (cost, file) => {
    if (!persistenceEnabled) {
      throw new Error('Sign in before attaching a document')
    }
    const storedDocument = await uploadProjectDocument(activeProjectId, file)
    const attachment = {
      ...storedDocument,
      id: storedDocument.documentId,
      name: storedDocument.name || file.name,
      uploadedAt: new Date().toISOString(),
    }
    const saved = await createCostVersion(activeProjectId, {
      ...cost,
      attachments: [attachment, ...(cost.attachments || [])],
    })
    setDevelopmentCosts((current) => [...current, saved])
    return saved
  }

  const handleOpenCostDocument = async (attachment) => {
    const attachmentWindow = window.open('about:blank', '_blank')
    try {
      const signedUrl = await createDocumentSignedUrl(attachment)
      if (!attachmentWindow) throw new Error('Allow pop-ups to open this attachment')
      attachmentWindow.opener = null
      attachmentWindow.location.href = signedUrl
    } catch (error) {
      attachmentWindow?.close()
      throw error
    }
  }

  const handleSaveConstructionDraft = async (draftId, updates) => {
    if (!persistenceEnabled) throw new Error('Sign in before saving construction drafts')
    const saved = await updateConstructionDraft(activeProjectId, draftId, updates)
    setConstructionDrafts((current) => current.map((draft) => draft.id === draftId ? saved : draft))
    return saved
  }

  const handleConvertConstructionDraft = async (draftId, convertedCostId) => {
    const draft = constructionDrafts.find((entry) => entry.id === draftId)
    if (!draft) return null
    return handleSaveConstructionDraft(draftId, {
      ...draft,
      status: 'converted',
      convertedCostId,
    })
  }

  const handleMergeCostBreakdowns = async (parentCostId, costIds, name) => {
    if (!persistenceEnabled) throw new Error('Sign in before merging breakdowns')
    const merged = await mergeCostBreakdowns(activeProjectId, parentCostId, costIds, name)
    const workspace = await fetchProjectWorkspace(activeProjectId)
    setDevelopmentCosts(workspace.costVersions)
    return merged
  }

  const handleAddCostsToBreakdownGroup = async (groupCostId, costIds) => {
    if (!persistenceEnabled) throw new Error('Sign in before changing a breakdown group')
    const updated = await addCostsToBreakdownGroup(activeProjectId, groupCostId, costIds)
    const workspace = await fetchProjectWorkspace(activeProjectId)
    setDevelopmentCosts(workspace.costVersions)
    return updated
  }

  const handleUnmergeCostBreakdownGroup = async (groupCostId) => {
    if (!persistenceEnabled) throw new Error('Sign in before unmerging a breakdown group')
    await unmergeCostBreakdownGroup(activeProjectId, groupCostId)
    const workspace = await fetchProjectWorkspace(activeProjectId)
    setDevelopmentCosts(workspace.costVersions)
  }

  const handleBankImport = async (importedRows) => {
    const savedRows = await saveBankTransactions(activeProjectId, importedRows)
    setBankTransactions((current) => {
      const existingIds = new Set(current.map((item) => item.id))
      return [...savedRows.filter((item) => !existingIds.has(item.id)), ...current]
    })
  }

  const handleSaveProjectCheck = async (check) => {
    if (!persistenceEnabled) throw new Error('Sign in before saving a check')
    const saved = await saveProjectCheck(check)
    setProjectChecks((current) => [saved, ...current])
    return saved
  }

  const handleProjectCheckStatus = async (checkId, status) => {
    if (!persistenceEnabled) throw new Error('Sign in before changing a check')
    const saved = await updateProjectCheckStatus(checkId, status)
    setProjectChecks((current) => current.map((check) => check.id === checkId ? saved : check))
    return saved
  }

  const handleProjectCheckLink = async (checkId, link) => {
    if (!persistenceEnabled) throw new Error('Sign in before attaching a check')
    const saved = await updateProjectCheckLink(checkId, link)
    setProjectChecks((current) => current.map((check) => check.id === checkId ? saved : check))
    return saved
  }

  const handleProjectCheckTemplate = async (checkId, nextTemplateKey, nextAccountLabel) => {
    if (!persistenceEnabled) throw new Error('Sign in before changing a check template')
    const saved = await updateProjectCheckTemplate(checkId, nextTemplateKey, nextAccountLabel)
    setProjectChecks((current) => current.map((check) => check.id === checkId ? saved : check))
    return saved
  }

  const handleProjectCheckFunding = async (checkId, fundedByIncomeId) => {
    if (!persistenceEnabled) throw new Error('Sign in before changing which draw funded a check')
    const saved = await updateProjectCheckFunding(checkId, fundedByIncomeId)
    setProjectChecks((current) => current.map((check) => check.id === checkId ? saved : check))
    return saved
  }

  const handleProjectCheckLot = async (checkId, lot) => {
    if (!persistenceEnabled) throw new Error('Sign in before changing which lot a check is for')
    const saved = await updateProjectCheckLot(checkId, lot)
    setProjectChecks((current) => current.map((check) => check.id === checkId ? saved : check))
    return saved
  }

  const handleBankOwnerChange = async (transactionId, owner) => {
    const currentItem = bankTransactions.find((item) => item.id === transactionId)
    if (!currentItem) return
    const updates = {
      owner,
      isOwnerContribution: currentItem.amount > 0
        && currentItem.category?.toLowerCase().includes('owner contribution')
        && (owner === 'Banu U' || owner === 'Kemal I'),
    }
    setBankTransactions((current) => current.map((item) => item.id === transactionId ? {
      ...item,
      ...updates,
    } : item))
    await updateBankTransaction(transactionId, updates)
  }

  const handleBankCategoryApproval = async (transactionId, category) => {
    const currentItem = bankTransactions.find((item) => item.id === transactionId)
    if (!currentItem) return
    const updates = {
      category,
      isOwnerContribution: currentItem.amount > 0
        && category === 'Owner Contribution'
        && (currentItem.owner === 'Banu U' || currentItem.owner === 'Kemal I'),
      reviewReasons: [],
      classificationStatus: 'user_approved',
      reviewedAt: new Date().toISOString(),
    }
    setBankTransactions((current) => current.map((item) => item.id === transactionId ? {
      ...item,
      ...updates,
    } : item))
    await updateBankTransaction(transactionId, updates)
  }

  const handleOpenProject = (projectId) => {
    setActiveProjectId(projectId)
    setProjectSection('overview')
    setWorkspaceView('project')
  }

  const handleOpenCostBreakdown = (costId) => {
    setBreakdownParentCostId(costId)
    setShowCostPage(true)
  }

  const toggleOverviewCostDetails = (costId) => {
    setExpandedOverviewCostIds((current) => {
      const next = new Set(current)
      if (next.has(costId)) next.delete(costId)
      else next.add(costId)
      return next
    })
  }

  if (showIntakePage) {
    return (
      <IntakePage
        activeProject={activeProject}
        savedItems={reviewItems}
        onSaveIntakeItem={handleSaveIntakeItem}
        onBack={() => setShowIntakePage(false)}
      />
    )
  }

  if (showCostPage) {
    return (
      <CostPage
        owners={owners}
        developmentCosts={activeDevelopmentCosts}
        breakdownCosts={activeBreakdownCosts}
        costVersions={projectCostVersions}
        constructionDrafts={constructionDrafts}
        projectChecks={projectChecks.filter((check) => String(check.projectId) === String(activeProjectId))}
        initialParentCostId={breakdownParentCostId}
        onBack={() => {
          setShowCostPage(false)
          setBreakdownParentCostId(null)
        }}
        onAddDevelopmentCost={handleCostPageAdd}
        onEditDevelopmentCost={handleCostPageEdit}
        onDeleteDevelopmentCost={handleCostPageDelete}
        onUploadDocument={handleUploadCostDocument}
        onAttachDocument={handleAttachCostDocument}
        onOpenDocument={handleOpenCostDocument}
        onMergeBreakdowns={handleMergeCostBreakdowns}
        onAddItemsToGroup={handleAddCostsToBreakdownGroup}
        onUnmergeGroup={handleUnmergeCostBreakdownGroup}
        onSaveConstructionDraft={handleSaveConstructionDraft}
        onConvertConstructionDraft={handleConvertConstructionDraft}
        sharedDevelopmentCostTotal={ownerCostTotal}
      />
    )
  }

  if (showClassificationPage) {
    return (
      <ClassificationPage
        owners={owners}
        categories={categories}
        reviewItems={reviewItems.filter((item) => item.status === 'pending')}
        onApproveReviewItem={handleApproveReviewItem}
        onRemoveReviewItem={handleRemoveReviewItem}
        onBack={() => setShowClassificationPage(false)}
      />
    )
  }

  const workspaceHeader = (
    <header className="hero-card">
      <div>
        <p className="eyebrow">Construction accounting workspace</p>
        <h1>Greenfort Accountant</h1>
        <p className="hero-copy">
          Track development and construction costs, review invoices, and reconcile imports without losing traceability.
        </p>
      </div>
      <div className="hero-actions">
        {accessProfile ? (
          <div className="access-badge">
            <strong>{accessProfile.is_global_admin ? 'Global administrator' : 'Project administrator'}</strong>
            <span>{authUser?.email || accessProfile.email}</span>
            {persistenceEnabled ? <span>Live database connected • UI changes save to Supabase</span> : null}
            {onUpdatePassword ? <button type="button" className="secondary-button" aria-expanded={showAccountSecurity} onClick={() => {
              setShowAccountSecurity((current) => !current)
              setPasswordMessage(null)
            }}>{showAccountSecurity ? 'Close account security' : 'Account security'}</button> : null}
            {showAccountSecurity ? <form className="account-security-form" noValidate onSubmit={handlePasswordUpdate}>
              <strong>Set or change password</strong>
              <input aria-label="New password" type="password" autoComplete="new-password" placeholder="At least 8 characters" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
              <input aria-label="Confirm new password" type="password" autoComplete="new-password" placeholder="Confirm password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
              {passwordMessage ? <small className={passwordMessage.type === 'error' ? 'validation-error' : 'password-success'} role={passwordMessage.type === 'error' ? 'alert' : 'status'}>{passwordMessage.text}</small> : null}
              <button type="submit" className="action-button" disabled={updatingPassword}>{updatingPassword ? 'Saving…' : 'Save password'}</button>
            </form> : null}
            <button type="button" className="secondary-button" onClick={onSignOut}>Sign out</button>
          </div>
        ) : null}
        <div className="hero-stat">
          <span>Portfolio budget</span>
          <strong>{currency.format(projectMetrics.reduce((sum, project) => sum + project.totalBudget, 0))}</strong>
          <small>{projectMetrics.length} active projects</small>
        </div>
      </div>
    </header>
  )

  if (workspaceView === 'portfolio') {
    return (
      <div className="app-shell">
        {workspaceHeader}

        {accessProfile?.is_global_admin ? (
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Portfolio setup</p>
                <h2>Create a project</h2>
              </div>
            </div>
            <form className="owner-form portfolio-project-form" noValidate onSubmit={handleProjectSubmit}>
              <label>
                Project name
                <input aria-label="Project name" required value={projectName} onChange={(event) => setProjectName(event.target.value)} />
              </label>
              <label>
                Address
                <input aria-label="Project address" value={projectAddress} onChange={(event) => setProjectAddress(event.target.value)} />
              </label>
              <label>
                Total budget
                <input aria-label="Project budget" type="number" min="0" step="0.01" required value={projectBudget} onChange={(event) => setProjectBudget(event.target.value)} />
              </label>
              <label>
                Start date
                <input aria-label="Project start date" type="date" value={projectStartDate} onChange={(event) => setProjectStartDate(event.target.value)} />
              </label>
              <label>
                Status
                <select aria-label="Project status" value={projectStatus} onChange={(event) => setProjectStatus(event.target.value)}>
                  <option value="planning">Planning</option>
                  <option value="development">Development</option>
                  <option value="construction">Construction</option>
                  <option value="completed">Completed</option>
                </select>
              </label>
              <label>
                Notes
                <textarea aria-label="Project notes" rows="3" value={projectNotes} onChange={(event) => setProjectNotes(event.target.value)} />
              </label>
              {projectFormError ? <p className="validation-error" role="alert">{projectFormError}</p> : null}
              {projectSaveMessage ? <p role="status">{projectSaveMessage}</p> : null}
              <button type="submit" className="action-button">Create project</button>
            </form>
          </section>
        ) : null}

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Your portfolio</p>
              <h2>Your projects</h2>
              <p>Select a project to open its workspace.</p>
            </div>
          </div>
          <div className="project-list portfolio-project-list">
            {projectMetrics.length === 0 ? (
              <div className="table-row"><div><strong>No projects available</strong><p>{accessProfile?.is_global_admin ? 'Create your first project above.' : 'Ask a global administrator to assign you to a project.'}</p></div></div>
            ) : null}
            {projectMetrics.map((project) => (
              <button key={project.id} type="button" className="project-card" onClick={() => handleOpenProject(project.id)}>
                <div><strong>{project.name}</strong><p>{project.address || 'Address not set'} • {project.status}</p></div>
                <div className="metric-stack">
                  <span>Saved costs {currency.format(project.savedCosts)}</span>
                  <small>Classified {currency.format(project.actualSpent)} • Budget {currency.format(project.totalBudget)}</small>
                  <small>Open project →</small>
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>
    )
  }

  const showProjectSection = (section) => accessProfile == null || projectSection === section

  return (
    <div className="app-shell">
      {workspaceHeader}

      <section className="panel project-workspace-menu">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Current project</p>
            <h2>{activeProject?.name || 'No project selected'}</h2>
          </div>
          <button type="button" className="secondary-button" onClick={() => setWorkspaceView('portfolio')}>Back to projects</button>
        </div>
        <nav className="project-section-nav" aria-label="Project sections">
          {[
            ['overview', 'Overview'],
            ['costs', 'Owners & Costs'],
            ['lots', 'Lots'],
            ['jobs', 'Spending by Job'],
            ['income', 'Income'],
            ['bank', 'Bank'],
            ['checks', 'Checks'],
            ['audit', 'Tax & Audit'],
            ['review', 'Review'],
            ['access', 'Access'],
          ].map(([section, label]) => (
            <button
              key={section}
              type="button"
              className={projectSection === section ? 'active' : ''}
              aria-pressed={projectSection === section}
              onClick={() => setProjectSection(section)}
            >
              {label}
            </button>
          ))}
        </nav>
      </section>

      {workspaceLoadError ? <div className="workspace-load-warning" role="alert">
        <span>{workspaceLoadError}</span>
        <button type="button" className="secondary-button" onClick={() => setWorkspaceReloadKey((current) => current + 1)}>Retry loading project</button>
      </div> : null}

      {showProjectSection('overview') ? <section className="section-grid project-detail-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Project position</p>
              <h2>Overview</h2>
            </div>
          </div>
          <div className="summary-grid overview-summary-grid">
            <div className="summary-card">
              <span>Budget</span>
              <strong>{currency.format(projectMetrics.find((project) => project.id === activeProjectId)?.totalBudget ?? 0)}</strong>
            </div>
            <div className="summary-card">
              <span>Saved costs</span>
              <strong>{currency.format(ownerCostTotal)}</strong>
              <small>Latest active cost versions</small>
            </div>
            <div className="summary-card">
              <span>Remaining vs saved costs</span>
              <strong>{currency.format((projectMetrics.find((project) => project.id === activeProjectId)?.totalBudget ?? 0) - ownerCostTotal)}</strong>
            </div>
            <div className="summary-card">
              <span>Classified transactions</span>
              <strong>{currency.format(projectMetrics.find((project) => project.id === activeProjectId)?.actualSpent ?? 0)}</strong>
            </div>
          </div>
          <div className="overview-section-heading">
            <div>
              <p className="eyebrow">Cost distribution</p>
              <h3>Saved costs by phase</h3>
            </div>
            <strong>{currency.format(ownerCostTotal)}</strong>
          </div>
          <div className="overview-phase-grid">
            {['development', 'construction', 'soft_cost', 'other'].map((phase) => (
              <div key={phase} className="overview-phase-card">
                <span>{costPhaseLabel(phase)}</span>
                <strong>{currency.format(phaseCostTotals[phase] || 0)}</strong>
              </div>
            ))}
          </div>

          <div className="overview-section-heading overview-cost-heading">
            <div>
              <p className="eyebrow">Project costs</p>
              <h3>{activeDevelopmentCosts.length} active cost{activeDevelopmentCosts.length === 1 ? '' : 's'}</h3>
            </div>
            <button type="button" className="action-button" onClick={() => {
              setBreakdownParentCostId(null)
              setShowCostPage(true)
            }}>Open full cost page</button>
          </div>
          {overviewCostMessage ? <div className={`overview-cost-message ${overviewCostMessage.type}`} role={overviewCostMessage.type === 'error' ? 'alert' : 'status'}>
            <span>{overviewCostMessage.text}</span>
            <button type="button" aria-label="Dismiss cost message" onClick={() => setOverviewCostMessage(null)}>×</button>
          </div> : null}
          <div className="overview-cost-grid">
            {activeDevelopmentCosts.map((cost) => {
              const owner = owners.find((entry) => entry.id === cost.ownerId)
              const breakdowns = activeBreakdownCosts.filter((entry) => entry.parentCostId === cost.costId)
              const allocated = Math.round(breakdowns.reduce((sum, entry) => sum + Number(entry.amount || 0), 0) * 100) / 100
              const unallocated = Number(cost.amount || 0) - allocated
              const isOverAllocated = unallocated < 0
              const allocationPercent = Number(cost.amount || 0) > 0 ? (allocated / Number(cost.amount)) * 100 : 0
              const detailsExpanded = expandedOverviewCostIds.has(cost.costId)
              const attachedChecks = projectChecks.filter((check) => check.costId === cost.costId && check.status !== 'voided')
              return <article key={cost.id} className={`dashboard-cost-row overview-cost-card${detailsExpanded ? ' is-expanded' : ''}${isOverAllocated ? ' is-over-allocated' : ''}`}>
                <div className="overview-cost-card-main">
                  <div className="overview-cost-title-row">
                    <div>
                      <strong>{cost.name}</strong>
                      <p>{owner?.name || 'Owner not assigned'} • {costPhaseLabel(cost.phase)} • {cost.date}</p>
                    </div>
                    <strong className="overview-cost-amount">{currency.format(cost.amount)}</strong>
                  </div>
                  <div className="overview-allocation-row">
                    <span>{breakdowns.length ? `${breakdowns.length} breakdown${breakdowns.length === 1 ? '' : 's'}` : 'No breakdowns yet'}</span>
                    <span>Allocated {currency.format(allocated)}</span>
                    <strong className={isOverAllocated ? 'warning' : ''}>
                      {isOverAllocated ? `Over allocated ${currency.format(Math.abs(unallocated))}` : `Remaining ${currency.format(unallocated)}`}
                    </strong>
                  </div>
                  {attachedChecks.length ? <div className="check-link-summary"><strong>Attached checks</strong>{attachedChecks.map((check) => <span key={check.id}>#{check.checkNumber} · {currency.format(check.amount)} · {check.status}</span>)}</div> : null}
                  <div className={`allocation-progress${isOverAllocated ? ' warning' : ''}`} aria-label={`${Math.round(allocationPercent)} percent allocated`}>
                    <span style={{ width: `${Math.min(100, Math.max(0, allocationPercent))}%` }} />
                  </div>
                  {isOverAllocated ? <div className="allocation-reconcile">
                    <p>Increase the parent by {currency.format(Math.abs(unallocated))}: {currency.format(cost.amount)} + {currency.format(Math.abs(unallocated))} = {currency.format(allocated)} breakdown total.</p>
                    {pendingSquareCostId === cost.costId ? <div className="button-row">
                      <button
                        type="button"
                        className="action-button"
                        disabled={squaringCostId === cost.costId}
                        onClick={() => handleSquareCostToBreakdowns(cost, allocated)}
                      >{squaringCostId === cost.costId ? 'Updating…' : `Confirm increase to ${currency.format(allocated)}`}</button>
                      <button type="button" className="secondary-button" disabled={squaringCostId === cost.costId} onClick={() => setPendingSquareCostId(null)}>Cancel</button>
                    </div> : <button type="button" className="secondary-button" onClick={() => setPendingSquareCostId(cost.costId)}>Increase parent to breakdown total</button>}
                  </div> : null}
                  <div className="button-row overview-cost-actions">
                    {breakdowns.length ? <button
                      type="button"
                      className="secondary-button"
                      aria-expanded={detailsExpanded}
                      aria-controls={`overview-cost-details-${cost.costId}`}
                      onClick={() => toggleOverviewCostDetails(cost.costId)}
                    >{detailsExpanded ? 'Hide details' : `Show details (${breakdowns.length})`}</button> : null}
                    <button type="button" className="secondary-button" onClick={() => handleOpenCostBreakdown(cost.costId)}>Add breakdown</button>
                  </div>
                </div>
                {detailsExpanded ? <div id={`overview-cost-details-${cost.costId}`} className="dashboard-cost-breakdowns">
                  {breakdowns.map((breakdown) => {
                    const groupedItems = activeBreakdownCosts.filter((entry) => entry.parentCostId === breakdown.costId)
                    return <Fragment key={breakdown.id}>
                      <div className="table-row dashboard-breakdown-row">
                        <div>
                          <strong>↳ {breakdown.name}</strong>
                          <p>{groupedItems.length ? `Merged group • ${groupedItems.length} items` : 'Breakdown'} • {costPhaseLabel(breakdown.phase)} • {breakdown.date}</p>
                        </div>
                        <div>{currency.format(breakdown.amount)}</div>
                      </div>
                      {groupedItems.map((item) => <div key={item.id} className="table-row dashboard-breakdown-row dashboard-grouped-item-row">
                        <div>
                          <strong>↳↳ {item.name}</strong>
                          <p>Grouped item • {item.date}</p>
                        </div>
                        <div>{currency.format(item.amount)}</div>
                      </div>)}
                    </Fragment>
                  })}
                </div> : null}
              </article>
            })}
            {activeDevelopmentCosts.length === 0 ? <div className="cost-empty-state">
              <strong>No project costs yet</strong>
              <p>Add the first cost from the Owners & Costs section or open the full cost page.</p>
            </div> : null}
          </div>

          <div className="overview-section-heading overview-category-heading">
            <div>
              <p className="eyebrow">Budget tracking</p>
              <h3>Cost categories</h3>
            </div>
          </div>
          <div className="category-list overview-category-list">
            {selectedProjectCategories.length === 0 ? (
              <div className="table-row">
                <div>
                  <strong>No cost categories</strong>
                  <p>Project categories will appear here when available.</p>
                </div>
              </div>
            ) : null}
            {selectedProjectCategories.map((category) => {
              const actual = projectTransactions.filter((transaction) => transaction.categoryId === category.id).reduce((sum, item) => sum + item.amount, 0)
              const variance = category.budgetedAmount - actual
              return (
                <div key={category.id} className="category-row">
                  <div>
                    <strong>{category.name}</strong>
                    <p>{category.phase}</p>
                  </div>
                  <div className="metric-stack">
                    <span>{currency.format(actual)} / {currency.format(category.budgetedAmount)}</span>
                    <small className={variance < 0 ? 'warning' : ''}>Variance {currency.format(variance)}</small>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section> : null}

      {showProjectSection('access') && accessProfile && activeProject ? <AccessAdmin projects={[activeProject]} accessProfile={accessProfile} /> : null}

      {showProjectSection('costs') ? <section className="section-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Owner contributions</p>
              <h2>Create owners</h2>
            </div>
          </div>
          <form className="owner-form" noValidate onSubmit={handleOwnerSubmit}>
            <label>
              {editingOwnerId != null ? 'Edit owner name' : 'Owner name'}
              <input aria-label="Owner name" required value={ownerName} onChange={(event) => setOwnerName(event.target.value)} />
            </label>
            <label>
              Contribution amount
              <input aria-label="Contribution amount" type="number" min="0" step="0.01" required value={ownerContribution} onChange={(event) => setOwnerContribution(event.target.value)} />
            </label>
            {ownerFormError ? <p className="validation-error" role="alert">{ownerFormError}</p> : null}
            <div className="button-row">
              <button type="submit" className="action-button">{editingOwnerId != null ? 'Save owner changes' : 'Add owner'}</button>
              {editingOwnerId != null ? <button type="button" className="secondary-button" onClick={handleCancelOwnerEdit}>Cancel</button> : null}
            </div>
          </form>
          <div className="table-card">
            {owners.length === 0 ? (
              <div className="table-row">
                <div>
                  <strong>No owners yet</strong>
                  <p>Add the first owner above.</p>
                </div>
              </div>
            ) : null}
            {owners.map((owner) => (
              <div key={owner.id} className="table-row">
                <div>
                  <strong>{owner.name}</strong>
                  <p>Separate contribution</p>
                </div>
                <div>{currency.format(Number(owner.contributionAmount || 0))}</div>
                <button type="button" className="secondary-button" onClick={() => handleStartOwnerEdit(owner)}>Edit owner</button>
              </div>
            ))}
            <div className="table-row total-row">
              <div>
                <strong>Combined project cost</strong>
                <p>Owner contributions + project spend</p>
              </div>
              <div>{currency.format(totalOwnerContribution)}</div>
            </div>
            <div className="table-row total-row">
              <div>
                <strong>Greenfort project cost</strong>
                <p>Owner costs plus project spend</p>
              </div>
              <div>{currency.format(totalOwnerContribution + ownerCostTotal + projectTransactions.reduce((sum, transaction) => sum + transaction.amount, 0))}</div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Project spending</p>
              <h2>Costs by owner and phase</h2>
            </div>
            <div className="button-row">
              <button
                type="button"
                className="secondary-button"
                aria-expanded={showOwnerPhaseCostForm}
                aria-controls="owner-phase-cost-form"
                onClick={() => setShowOwnerPhaseCostForm((current) => !current)}
              >
                {showOwnerPhaseCostForm ? 'Hide add-cost form' : 'Add a cost'}
              </button>
              <button type="button" className="action-button" onClick={() => {
                setBreakdownParentCostId(null)
                setShowCostPage(true)
              }}>Open cost page</button>
            </div>
          </div>
          {showOwnerPhaseCostForm ? <form id="owner-phase-cost-form" className="owner-form" noValidate onSubmit={handleDevelopmentCostSubmit}>
            <label>
              Cost name
              <input aria-label="Cost name" required value={developmentCostName} onChange={(event) => setDevelopmentCostName(event.target.value)} />
            </label>
            <label>
              Amount
              <input aria-label="Cost amount" type="number" min="0.01" step="0.01" required value={developmentCostAmount} onChange={(event) => setDevelopmentCostAmount(event.target.value)} />
            </label>
            <label>
              Cost date
              <input aria-label="Cost date" type="date" required value={developmentCostDate} onChange={(event) => setDevelopmentCostDate(event.target.value)} />
            </label>
            <label>
              Phase
              <select aria-label="Cost phase" value={developmentCostPhase} onChange={(event) => setDevelopmentCostPhase(event.target.value)}>
                <option value="development">Development</option>
                <option value="construction">Construction</option>
                <option value="soft_cost">Soft Cost</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Owner
              <select aria-label="Owner" value={selectedOwnerId ?? ''} onChange={(event) => setSelectedOwnerId(event.target.value ? Number(event.target.value) : null)}>
                {owners.length === 0 ? <option value="">Add an owner first</option> : null}
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>{owner.name}</option>
                ))}
              </select>
            </label>
            {developmentCostError ? <p className="validation-error" role="alert">{developmentCostError}</p> : null}
            <button type="button" className="action-button" onClick={handleDevelopmentCostSubmit}>Add cost</button>
          </form> : null}
          <div className="table-card">
            {activeDevelopmentCosts.map((cost) => {
              const owner = owners.find((entry) => entry.id === cost.ownerId)
              const breakdowns = activeBreakdownCosts.filter((entry) => entry.parentCostId === cost.costId)
              const allocated = Math.round(breakdowns.reduce((sum, entry) => sum + Number(entry.amount || 0), 0) * 100) / 100
              return (
                <div key={cost.id} className="table-row">
                  <div>
                    <strong>{cost.name}</strong>
                    <p>{owner?.name || 'Owner'} • {costPhaseLabel(cost.phase)} • {cost.date}</p>
                    <small>{breakdowns.length} breakdown{breakdowns.length === 1 ? '' : 's'} • Allocated {currency.format(allocated)} • Unallocated {currency.format(Number(cost.amount || 0) - allocated)}</small>
                  </div>
                  <div>{currency.format(cost.amount)}</div>
                  <button type="button" className="secondary-button" onClick={() => handleOpenCostBreakdown(cost.costId)}>Add breakdown</button>
                </div>
              )
            })}
            <div className="table-row total-row">
              <div>
                <strong>Owner cost total</strong>
                <p>All owner-linked project costs</p>
              </div>
              <div>{currency.format(ownerCostTotal)}</div>
            </div>
          </div>
        </div>

      </section> : null}

      {showProjectSection('review') ? <section className="section-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Document intake</p>
              <h2>Receipts and invoices</h2>
            </div>
          </div>
          <div className="button-row">
            <button type="button" className="action-button" onClick={() => setShowIntakePage(true)}>Open intake page</button>
            <button type="button" className="action-button" onClick={() => setShowClassificationPage(true)}>Open review page</button>
          </div>
          <div className="table-card">
            {projectInvoices.map((invoice) => {
              const vendor = vendors.find((entry) => entry.id === invoice.vendorId)
              const attachedChecks = projectChecks.filter((check) => check.invoiceId === invoice.id && check.status !== 'voided')
              return (
                <div key={invoice.id} className="table-row">
                  <div>
                    <strong>{invoice.invoiceNumber}</strong>
                    <p>{vendor?.name}</p>
                    {attachedChecks.length ? <p className="check-link-summary"><strong>Checks:</strong> {attachedChecks.map((check) => `#${check.checkNumber} (${currency.format(check.amount)})`).join(', ')}</p> : null}
                  </div>
                  <div>{currency.format(invoice.amount)}</div>
                  <div>{invoice.status}</div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Import review</p>
              <h2>CSV review queue</h2>
            </div>
          </div>
          <div className="table-card">
            {importRows.map((row, index) => (
              <div key={`${row.rowNumber}-${row.description}`} className="table-row">
                <div>
                  <strong>{row.description}</strong>
                  <p>{row.date} • {row.suggestedProject}</p>
                </div>
                <div>{currency.format(row.amount)}</div>
                <button type="button" className="action-button" onClick={() => handleImportReview(index)}>Review & commit</button>
              </div>
            ))}
          </div>
        </div>
      </section> : null}

      {showProjectSection('lots') ? <LotCommitments
        lotCommitments={projectLotCommitments}
        incomes={projectIncomes}
        checks={projectChecks.filter((check) => String(check.projectId) === String(activeProjectId))}
        activeProjectId={activeProjectId}
        onSaveLotCommitment={handleSaveLotCommitment}
        onUploadDocument={handleUploadCostDocument}
        onOpenDocument={handleOpenCostDocument}
        onGetDocumentUrl={createDocumentSignedUrl}
        sharedDevelopmentCostTotal={ownerCostTotal}
      /> : null}

      {showProjectSection('jobs') ? <SpendingByJob
        constructionDrafts={constructionDrafts}
        checks={projectChecks.filter((check) => String(check.projectId) === String(activeProjectId))}
        activeCosts={activeCostRecords}
        sharedDevelopmentCostTotal={ownerCostTotal}
      /> : null}

      {showProjectSection('income') ? <IncomeSection
        incomes={projectIncomes}
        checks={projectChecks.filter((check) => String(check.projectId) === String(activeProjectId))}
        projects={activeProject ? [activeProject] : []}
        onAddIncome={handleAddIncome}
        onEditIncome={handleEditIncome}
        onDeleteIncome={handleDeleteIncome}
        onUploadDocument={handleUploadCostDocument}
        onOpenDocument={handleOpenCostDocument}
      /> : null}

      {showProjectSection('bank') ? <BankDashboard
        transactions={bankTransactions}
        onImport={handleBankImport}
        onChangeOwner={handleBankOwnerChange}
        onApproveCategory={handleBankCategoryApproval}
      /> : null}

      {showProjectSection('checks') && activeProject ? <CheckPrinting
        project={activeProject}
        checks={projectChecks.filter((check) => String(check.projectId) === String(activeProjectId))}
        invoices={projectInvoices}
        costs={activeCostRecords}
        loanDraws={projectIncomes.filter((income) => income.type === 'loan_draw')}
        onSaveCheck={handleSaveProjectCheck}
        onUpdateStatus={handleProjectCheckStatus}
        onUpdateLink={handleProjectCheckLink}
        onUpdateTemplate={handleProjectCheckTemplate}
        onUpdateFunding={handleProjectCheckFunding}
        onUpdateLot={handleProjectCheckLot}
      /> : null}

      {showProjectSection('audit') ? <TaxAudit
        checks={projectChecks.filter((check) => String(check.projectId) === String(activeProjectId))}
        incomes={projectIncomes}
        activeCosts={activeDevelopmentCosts}
        lotCommitments={projectLotCommitments}
        projectName={activeProject?.name}
      /> : null}

      {showProjectSection('overview') ? <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Cash flow</p>
            <h2>Running balance</h2>
          </div>
        </div>
        <div className="table-card">
          {runningBalance.map((entry) => (
            <div key={entry.id} className="table-row">
              <div>
                <strong>{entry.description}</strong>
                <p>{entry.date}</p>
              </div>
              <div>{currency.format(entry.amount)}</div>
              <div>{currency.format(entry.runningBalance)}</div>
            </div>
          ))}
        </div>
      </section> : null}
    </div>
  )
}

export default App
