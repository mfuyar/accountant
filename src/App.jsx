import { Fragment, useEffect, useMemo, useState } from 'react'
import './App.css'
import IntakePage from './IntakePage'
import CostPage from './CostPage'
import ClassificationPage from './ClassificationPage'
import IncomeSection from './IncomeSection'
import LotCommitments from './LotCommitments'
import SpendingByJob from './SpendingByJob'
import AttachmentPreviewModal from './AttachmentPreviewModal'
import TaxAudit from './TaxAudit'
import BankDashboard from './BankDashboard'
import AccessAdmin from './AccessAdmin'
import CheckPrinting from './CheckPrinting'
import FinancingLedger from './FinancingLedger'
import DevelopmentCostReport from './DevelopmentCostReport'
import ProjectDocuments from './ProjectDocuments'
import PartnersSection from './PartnersSection'
import { analyzeMiscellaneousDocument, extractTransactionFromImage } from './lib/gemini'
import { extractPdfDocumentText } from './lib/pdfText'
import { extractVendorMailingAddressFromText } from './lib/vendorAddress'
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
  deleteFinancingTransaction,
  deleteIncome,
  fetchBankTransactions,
  fetchBankStatementDocuments,
  fetchMiscellaneousDocuments,
  fetchOwners,
  fetchProjectData,
  fetchProjectWorkspace,
  mergeCostBreakdowns,
  removeReviewItem,
  saveBankTransactions,
  saveFinancingTransaction,
  updateFinancingTransactionStatus,
  updateFinancingTransaction,
  updateFinancingTransactionTreatment,
  saveIncome,
  saveIntakeItem,
  saveLotCommitment,
  saveManualTransaction,
  saveOwner,
  saveProject,
  saveProjectCheck,
  saveVendorAddress,
  supabase,
  updateBankTransaction,
  updateCostCategoryBudget,
  updateConstructionDraft,
  updateIncome,
  updateOwner,
  updateProjectCheckStatus,
  updateProjectCheckFunding,
  updateProjectCheck,
  updateProjectCheckLot,
  updateProjectCheckLink,
  updateProjectCheckTemplate,
  unmergeCostBreakdownGroup,
  uploadProjectDocument,
  uploadBankStatementDocument,
  uploadMiscellaneousDocument,
  deleteMiscellaneousDocument,
  updateMiscellaneousDocument,
} from './lib/supabase'
import { getActiveCosts } from './lib/costVersions'
import InvoicePaymentWarning from './InvoicePaymentWarning'
import { deriveDevelopmentFundingIncomes, isPreSaleDepositCost } from './lib/developmentFunding'
import { currency } from './lib/currency'
import {
  createBankLinkToken,
  disconnectBankConnection,
  exchangeBankPublicToken,
  fetchBankConnections,
  loadPlaidLink,
  syncBankConnection,
} from './lib/plaid'

const costPhaseLabel = (phase) => ({
  development: 'Development',
  construction: 'Construction',
  soft_cost: 'Soft Cost',
  other: 'Other',
}[phase] || phase || 'Development')

export const getCostAmountForLotFilter = (cost, lotFilter) => {
  const amount = Number(cost.amount || 0)
  if (lotFilter === 'all') return amount
  const allocations = cost.lotAllocations || []
  if (lotFilter === 'unassigned') {
    return Math.max(0, amount - allocations.reduce((sum, entry) => sum + Number(entry.amount || 0), 0))
  }
  return allocations.filter((entry) => entry.lot === lotFilter).reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
}

export const getPhaseTotalsForLotFilter = (costs, lotFilter) => costs.reduce((totals, cost) => ({
  ...totals,
  [cost.phase || 'other']: Number(totals[cost.phase || 'other'] || 0) + getCostAmountForLotFilter(cost, lotFilter),
}), {})

export const getTopLevelPhaseCostTotals = (costs) => costs
  .filter((cost) => !cost.parentCostId)
  .reduce((totals, cost) => ({
    ...totals,
    [cost.phase || 'other']: Number(totals[cost.phase || 'other'] || 0) + Number(cost.amount || 0),
  }), {})

export const getConstructionLotCostTotals = (costs) => costs
  .filter((cost) => !cost.parentCostId && cost.phase === 'construction')
  .reduce((result, cost) => {
    const amount = Number(cost.amount || 0)
    const allocated = (cost.lotAllocations || []).reduce((sum, allocation) => {
      const allocationAmount = Number(allocation.amount || 0)
      result.byLot[allocation.lot] = Number(result.byLot[allocation.lot] || 0) + allocationAmount
      return sum + allocationAmount
    }, 0)
    result.unassigned += Math.max(0, amount - allocated)
    return result
  }, { byLot: {}, unassigned: 0 })

export const splitExistingLotAllocationsEvenly = (amount, allocations = []) => {
  const lots = [...new Set(allocations.map((entry) => entry?.lot).filter(Boolean))]
  if (!lots.length) return []
  const totalCents = Math.round(Number(amount || 0) * 100)
  const baseCents = Math.floor(totalCents / lots.length)
  const remainder = totalCents - (baseCents * lots.length)
  return lots.map((lot, index) => ({
    lot,
    amount: (baseCents + (index < remainder ? 1 : 0)) / 100,
  }))
}

const CONSTRUCTION_BUDGET_LOTS = ['Lot 1', 'Lot 2', 'Lot 3', 'Lot 4']

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
  const [categoryBudgetDrafts, setCategoryBudgetDrafts] = useState({})
  const [categoryLotBudgetDrafts, setCategoryLotBudgetDrafts] = useState({})
  const [savingCategoryBudgetId, setSavingCategoryBudgetId] = useState(null)
  const [categoryBudgetMessage, setCategoryBudgetMessage] = useState(null)
  const [vendors, setVendors] = useState(initialVendors)
  const [invoices, setInvoices] = useState(initialInvoices)
  const [transactions, setTransactions] = useState(initialTransactions)
  const [importRows, setImportRows] = useState(sampleImportRows)
  const [reviewItems, setReviewItems] = useState([])
  const [constructionDrafts, setConstructionDrafts] = useState([])
  const [projectChecks, setProjectChecks] = useState([])
  const [financingTransactions, setFinancingTransactions] = useState([])
  const [owners, setOwners] = useState([])
  const [ownerName, setOwnerName] = useState('')
  const [ownerContribution, setOwnerContribution] = useState('')
  const [ownerOwnershipPercentage, setOwnerOwnershipPercentage] = useState('50')
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
  const [bankStatementDocuments, setBankStatementDocuments] = useState([])
  const [miscellaneousDocuments, setMiscellaneousDocuments] = useState([])
  const [activeProjectId, setActiveProjectId] = useState(initialProjects[0]?.id ?? null)
  const [showIntakePage, setShowIntakePage] = useState(false)
  const [showCostPage, setShowCostPage] = useState(false)
  const [breakdownParentCostId, setBreakdownParentCostId] = useState(null)
  const [costPageEditCostId, setCostPageEditCostId] = useState(null)
  const [showClassificationPage, setShowClassificationPage] = useState(false)
  const [workspaceView, setWorkspaceView] = useState(() => accessProfile ? 'portfolio' : 'project')
  const [workspaceLoadError, setWorkspaceLoadError] = useState('')
  const [workspaceReloadKey, setWorkspaceReloadKey] = useState(0)
  const [projectSection, setProjectSection] = useState('overview')
  const [showOwnerPhaseCostForm, setShowOwnerPhaseCostForm] = useState(true)
  const [expandedOverviewCostIds, setExpandedOverviewCostIds] = useState(() => new Set())
  const [overviewLotFilter, setOverviewLotFilter] = useState('all')
  const [overviewCostView, setOverviewCostView] = useState('cards')
  const [pendingSquareCostId, setPendingSquareCostId] = useState(null)
  const [squaringCostId, setSquaringCostId] = useState(null)
  const [overviewCostMessage, setOverviewCostMessage] = useState(null)
  const [overviewPreviewAttachment, setOverviewPreviewAttachment] = useState(null)
  const [paidInvoicePreview, setPaidInvoicePreview] = useState(null)
  const [pendingCheckDraft, setPendingCheckDraft] = useState(null)
  const [showAccountSecurity, setShowAccountSecurity] = useState(false)
  const [showAccountMenu, setShowAccountMenu] = useState(false)
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
          setVendors(data.vendors || [])
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
            ownershipPercentage: Number(owner.ownership_percentage ?? 50),
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
    if (!persistenceEnabled || activeProjectId == null) {
      setMiscellaneousDocuments([])
      return undefined
    }
    fetchMiscellaneousDocuments(activeProjectId)
      .then((rows) => { if (isMounted) setMiscellaneousDocuments(rows) })
      .catch(() => { if (isMounted) setMiscellaneousDocuments([]) })
    return () => { isMounted = false }
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
        setFinancingTransactions(data.financingTransactions || [])
        setLotCommitments(data.lotCommitments)
        const extractedAddresses = new Map()
        getActiveCosts(data.costVersions).forEach((cost) => {
          ;(cost.attachments || []).forEach((attachment) => {
            const name = String(attachment.vendor || '').trim()
            const mailingAddress = String(attachment.vendorMailingAddress || '').trim()
            if (name && mailingAddress) extractedAddresses.set(name.toLowerCase(), { name, mailingAddress })
          })
        })
        Promise.all([...extractedAddresses.values()].map((vendor) => saveVendorAddress(activeProjectId, vendor)))
          .then((savedVendors) => {
            if (!isMounted) return
            setVendors((current) => savedVendors.reduce((next, saved) => [
              ...next.filter((entry) => entry.name.trim().toLowerCase() !== saved.name.trim().toLowerCase()),
              saved,
            ], current).sort((a, b) => a.name.localeCompare(b.name)))
          })
          .catch(() => {})
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
    fetchBankStatementDocuments(activeProjectId)
      .then((statements) => {
        if (isMounted) setBankStatementDocuments(statements)
      })
      .catch(() => {
        if (isMounted) setBankStatementDocuments([])
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
  const developmentFundingCosts = useMemo(
    () => activeCostRecords.filter((cost) => !cost.parentCostId && isPreSaleDepositCost(cost)),
    [activeCostRecords],
  )
  const accountingCostRecords = useMemo(
    // Pre-sale deposits are a funding source, not a project expense. Keep them
    // available to the income/funding report without adding them to cost totals.
    () => activeCostRecords.filter((cost) => !isPreSaleDepositCost(cost)),
    [activeCostRecords],
  )
  const originalCostAddedDates = useMemo(() => {
    const dates = new Map()
    projectCostVersions.forEach((cost) => {
      if (!cost.createdAt) return
      const key = String(cost.costId ?? cost.id)
      const current = dates.get(key)
      if (!current || String(cost.createdAt) < current) dates.set(key, String(cost.createdAt))
    })
    return dates
  }, [projectCostVersions])
  const costAddedDate = (cost) => String(originalCostAddedDates.get(String(cost.costId ?? cost.id)) || cost.createdAt || '').slice(0, 10) || 'Not available'
  const activeDevelopmentCosts = useMemo(
    () => accountingCostRecords.filter((cost) => !cost.parentCostId),
    [accountingCostRecords],
  )
  const activeBreakdownCosts = useMemo(
    () => accountingCostRecords.filter((cost) => cost.parentCostId),
    [accountingCostRecords],
  )
  const persistedProjectIncomes = useMemo(
    () => incomes.filter((income) => String(income.projectId) === String(activeProjectId)),
    [activeProjectId, incomes],
  )
  const projectIncomes = useMemo(
    () => deriveDevelopmentFundingIncomes(developmentFundingCosts, persistedProjectIncomes, owners),
    [developmentFundingCosts, owners, persistedProjectIncomes],
  )
  const projectLotCommitments = useMemo(
    () => lotCommitments.filter((commitment) => String(commitment.projectId) === String(activeProjectId)),
    [activeProjectId, lotCommitments],
  )

  const ownerCostTotal = useMemo(() => {
    return activeDevelopmentCosts.reduce((sum, cost) => sum + Number(cost.amount || 0), 0)
  }, [activeDevelopmentCosts])

  const phaseCostTotals = useMemo(() => getTopLevelPhaseCostTotals(accountingCostRecords), [accountingCostRecords])
  const constructionLotCostTotals = useMemo(() => getConstructionLotCostTotals(accountingCostRecords), [accountingCostRecords])

  const lotCostSummary = useMemo(() => {
    const totals = {}
    let assigned = 0
    activeDevelopmentCosts.forEach((cost) => {
      ;(cost.lotAllocations || []).forEach((allocation) => {
        const amount = Number(allocation.amount || 0)
        totals[allocation.lot] = Number(totals[allocation.lot] || 0) + amount
        assigned += amount
      })
    })
    return { totals, unassigned: Math.max(0, ownerCostTotal - assigned) }
  }, [activeDevelopmentCosts, ownerCostTotal])

  const overviewFilteredCosts = useMemo(() => {
    if (overviewLotFilter === 'all') return activeDevelopmentCosts
    return activeDevelopmentCosts.filter((cost) => getCostAmountForLotFilter(cost, overviewLotFilter) > 0)
  }, [activeDevelopmentCosts, overviewLotFilter])

  const overviewFilteredTotal = useMemo(
    () => overviewFilteredCosts.reduce((sum, cost) => sum + getCostAmountForLotFilter(cost, overviewLotFilter), 0),
    [overviewFilteredCosts, overviewLotFilter],
  )
  const overviewFilteredPhaseTotals = useMemo(
    () => getPhaseTotalsForLotFilter(overviewFilteredCosts, overviewLotFilter),
    [overviewFilteredCosts, overviewLotFilter],
  )

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
    const ownershipValue = Number(ownerOwnershipPercentage)
    if (!Number.isFinite(ownershipValue) || ownershipValue < 0 || ownershipValue > 100) {
      setOwnerFormError('Ownership percentage must be between 0 and 100.')
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
          ownership_percentage: ownershipValue,
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
        ownershipPercentage: ownershipValue,
      } : owner))
      setOwnerName('')
      setOwnerContribution('')
      setOwnerOwnershipPercentage('50')
      setOwnerFormError('')
      setEditingOwnerId(null)

      return
    }

    const newOwner = {
      id: Date.now(),
      name: ownerName.trim(),
      contributionAmount: contributionValue,
      ownershipPercentage: ownershipValue,
    }

    setOwners((current) => [...current, newOwner])
    setOwnerName('')
    setOwnerContribution('')
    setOwnerOwnershipPercentage('50')
    setOwnerFormError('')
    setSelectedOwnerId(newOwner.id)

    try {
      const savedOwner = await saveOwner({
        name: newOwner.name,
        contribution_amount: newOwner.contributionAmount,
        ownership_percentage: newOwner.ownershipPercentage,
        project_id: activeProjectId,
      })
      if (savedOwner) {
        const normalizedOwner = {
          id: savedOwner.id,
          name: savedOwner.name,
          contributionAmount: Number(savedOwner.contribution_amount || 0),
          ownershipPercentage: Number(savedOwner.ownership_percentage ?? 50),
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

  const handleCategoryBudgetSave = async (event, category) => {
    event.preventDefault()
    const isConstruction = category.phase === 'construction'
    const lotBudgets = isConstruction ? Object.fromEntries(CONSTRUCTION_BUDGET_LOTS.map((lot) => [
      lot,
      Number(categoryLotBudgetDrafts[category.id]?.[lot] ?? category.lotBudgets?.[lot] ?? 0),
    ])) : undefined
    const draft = categoryBudgetDrafts[category.id]
    const amount = isConstruction
      ? Object.values(lotBudgets).reduce((sum, value) => sum + value, 0)
      : Number(draft ?? category.budgetedAmount)
    if (!Number.isFinite(amount) || amount < 0) {
      setCategoryBudgetMessage({ type: 'error', text: `Enter a valid budget of 0 or greater for ${category.name}.` })
      return
    }
    if (isConstruction && Object.values(lotBudgets).some((value) => !Number.isFinite(value) || value < 0)) {
      setCategoryBudgetMessage({ type: 'error', text: 'Enter a valid construction budget of 0 or greater for every lot.' })
      return
    }

    setSavingCategoryBudgetId(category.id)
    setCategoryBudgetMessage(null)
    try {
      const saved = persistenceEnabled
        ? await updateCostCategoryBudget(activeProjectId, category.id, amount, lotBudgets)
        : { ...category, budgetedAmount: amount, ...(lotBudgets ? { lotBudgets } : {}) }
      setCategories((current) => current.map((entry) => entry.id === category.id ? saved : entry))
      setCategoryBudgetDrafts((current) => {
        const next = { ...current }
        delete next[category.id]
        return next
      })
      setCategoryLotBudgetDrafts((current) => {
        const next = { ...current }
        delete next[category.id]
        return next
      })
      setCategoryBudgetMessage({ type: 'success', text: `${category.name} budget saved.` })
    } catch (error) {
      setCategoryBudgetMessage({
        type: 'error',
        text: `The ${category.name} budget could not be saved: ${error instanceof Error ? error.message : 'Unknown error'}`,
      })
    } finally {
      setSavingCategoryBudgetId(null)
    }
  }

  const handleStartOwnerEdit = (owner) => {
    setEditingOwnerId(owner.id)
    setOwnerName(owner.name)
    setOwnerContribution(String(owner.contributionAmount ?? 0))
    setOwnerOwnershipPercentage(String(owner.ownershipPercentage ?? 50))
    setOwnerFormError('')
  }

  const handleCancelOwnerEdit = () => {
    setEditingOwnerId(null)
    setOwnerName('')
    setOwnerContribution('')
    setOwnerOwnershipPercentage('50')
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

  const handleCostPageAdd = async ({ name, details = '', constructionDraftId = null, paymentMethod = null, paymentStatus = '', paymentFeePercentage = null, paymentFeeAmount = null, paymentDate = null, invoiceAmount = null, amount, ownerId, phase, category = '', lotAllocations = [], date, attachments = [], parentCostId = null, vendorName = '', mainCategory = '', subcategory = '', payerType = '', payerOwnerId = null, payerName = '', paymentSource = '', referenceNumber = '', reimbursable = false, loanRelated = false, notes = '', recurringFrequency = '', isSoftCostParent = false }) => {
    const ledgerFields = { vendorName, mainCategory, subcategory, payerType, payerOwnerId, payerName, paymentSource, referenceNumber, reimbursable, loanRelated, notes, recurringFrequency, isSoftCostParent }
    if (persistenceEnabled) {
      const saved = await createCostVersion(activeProjectId, { name, details, constructionDraftId, paymentMethod, paymentStatus, paymentFeePercentage, paymentFeeAmount, paymentDate, invoiceAmount, amount, ownerId, phase, category, lotAllocations, date, attachments, parentCostId, ...ledgerFields })
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
      details,
      constructionDraftId,
      paymentMethod,
      paymentStatus,
      paymentFeePercentage,
      paymentFeeAmount,
      paymentDate,
      invoiceAmount,
      amount,
      ownerId,
      phase,
      category,
      lotAllocations,
      date,
      parentCostId,
      attachments,
      ...ledgerFields,
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
      const saved = await createCostVersion(activeProjectId, { costId, ...updates, paymentStatus: updates.paymentStatus ?? previous?.paymentStatus ?? '' })
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
      const nextLotAllocations = splitExistingLotAllocationsEvenly(breakdownTotal, cost.lotAllocations)
      const feePercentage = Number(cost.paymentFeePercentage)
      const hasCardFee = cost.invoiceAmount != null && cost.paymentFeeAmount != null && Number.isFinite(feePercentage)
      const nextInvoiceAmount = cost.invoiceAmount == null
        ? null
        : hasCardFee ? Math.round((breakdownTotal / (1 + feePercentage / 100)) * 100) / 100 : breakdownTotal
      const nextPaymentFeeAmount = cost.paymentFeeAmount == null
        ? null
        : Math.round((breakdownTotal - Number(nextInvoiceAmount || 0)) * 100) / 100
      await handleCostPageEdit({
        costId: cost.costId,
        name: cost.name,
        details: cost.details || '',
        constructionDraftId: cost.constructionDraftId || null,
        paymentMethod: cost.paymentMethod || null,
        paymentFeePercentage: cost.paymentFeePercentage ?? null,
        paymentFeeAmount: nextPaymentFeeAmount,
        paymentDate: cost.paymentDate || null,
        invoiceAmount: nextInvoiceAmount,
        amount: breakdownTotal,
        ownerId: cost.ownerId,
        phase: cost.phase,
        category: cost.category || '',
        lotAllocations: nextLotAllocations,
        date: cost.date,
        attachments: cost.attachments || [],
        parentCostId: cost.parentCostId || null,
      })
      setPendingSquareCostId(null)
      setOverviewCostMessage({ type: 'success', text: `${cost.name} now matches its breakdown total of ${currency.format(breakdownTotal)}. A new version was saved.` })
    } catch (error) {
      const details = error?.message || error?.details || error?.hint || String(error || 'Unknown error')
      setOverviewCostMessage({ type: 'error', text: `The parent total could not be updated: ${details}` })
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
    setOverviewPreviewAttachment(attachment)
  }

  const handlePrintPaidInvoice = (attachment, details) => {
    setPaidInvoicePreview({ attachment, details })
  }

  const handleSaveVendorAddress = async ({ name, mailingAddress }) => {
    const saved = await saveVendorAddress(activeProjectId, { name, mailingAddress })
    setVendors((current) => [
      ...current.filter((entry) => entry.name.trim().toLowerCase() !== saved.name.trim().toLowerCase()),
      saved,
    ].sort((a, b) => a.name.localeCompare(b.name)))
    return saved
  }

  const handleExtractVendorAddress = async (attachment, vendorName = '') => {
    const signedUrl = await createDocumentSignedUrl(attachment)
    const response = await fetch(signedUrl)
    if (!response.ok) throw new Error('The attached invoice could not be opened for address analysis')
    const blob = await response.blob()
    const file = new File([blob], attachment.name || 'invoice', { type: attachment.mimeType || blob.type || 'application/pdf' })
    const documentText = await extractPdfDocumentText(file).catch(() => '')
    const localAddress = extractVendorMailingAddressFromText(documentText)
    let address = localAddress
    let extractedVendorName = vendorName
    if (!address || !extractedVendorName) {
      const extracted = await extractTransactionFromImage(file, activeProject?.name || 'Project', activeProjectId, { knownLots: ['Lot 1', 'Lot 2', 'Lot 3', 'Lot 4'] })
      address ||= String(extracted.vendorMailingAddress || '').trim()
      extractedVendorName ||= String(extracted.vendor || '').trim()
    }
    if (address && extractedVendorName) await handleSaveVendorAddress({ name: extractedVendorName, mailingAddress: address })
    return address
  }

  const handleImportVendorAddresses = async () => {
    const targets = []
    projectInvoices.forEach((invoice) => (invoice.attachments || []).forEach((attachment) => targets.push({ attachment, vendorName: invoice.vendorName || '' })))
    activeCostRecords.forEach((cost) => (cost.attachments || []).filter((attachment) => attachment.storagePath).forEach((attachment) => targets.push({ attachment, vendorName: attachment.vendor || '' })))
    const uniqueTargets = [...new Map(targets.map((target) => [target.attachment.storagePath || target.attachment.id, target])).values()]
    let imported = 0
    for (const target of uniqueTargets) {
      // Sequential analysis avoids overwhelming document storage or the extraction service.
      // eslint-disable-next-line no-await-in-loop
      const address = await handleExtractVendorAddress(target.attachment, target.vendorName)
      if (address) imported += 1
    }
    return { imported, reviewed: uniqueTargets.length }
  }

  const handleCreateCheckFromCost = (draft) => {
    setPendingCheckDraft({
      ...draft,
      date: draft.date || new Date().toLocaleDateString('en-CA'),
    })
    setShowCostPage(false)
    setBreakdownParentCostId(null)
    setCostPageEditCostId(null)
    setProjectSection('checks')
    setWorkspaceView('project')
  }

  const handleDownloadCostDocument = async (attachment) => {
    const attachmentWindow = window.open('about:blank', '_blank')
    try {
      const signedUrl = await createDocumentSignedUrl(attachment, { download: true })
      if (!attachmentWindow) throw new Error('Allow pop-ups to download this attachment')
      attachmentWindow.opener = null
      attachmentWindow.location.href = signedUrl
    } catch (error) {
      attachmentWindow?.close()
      throw error
    }
  }

  const handleUploadMiscellaneousDocument = async (file) => {
    if (!persistenceEnabled) throw new Error('Sign in before uploading a project document')
    const saved = await uploadMiscellaneousDocument(activeProjectId, file)
    setMiscellaneousDocuments((current) => [saved, ...current])
    return saved
  }

  const handleDeleteMiscellaneousDocument = async (document) => {
    if (!persistenceEnabled) throw new Error('Sign in before removing a project document')
    await deleteMiscellaneousDocument(activeProjectId, document)
    const documentId = document.documentId || document.id
    setMiscellaneousDocuments((current) => current.filter((entry) => (entry.documentId || entry.id) !== documentId))
  }

  const handleUpdateMiscellaneousDocument = async (documentId, updates) => {
    if (!persistenceEnabled) throw new Error('Sign in before updating a project document')
    const saved = await updateMiscellaneousDocument(activeProjectId, documentId, updates)
    setMiscellaneousDocuments((current) => current.map((entry) => (
      (entry.documentId || entry.id) === documentId ? saved : entry
    )))
    return saved
  }

  const handleAnalyzeMiscellaneousDocument = async (document) => {
    if (!persistenceEnabled) throw new Error('Sign in before analyzing a project document')
    const signedUrl = await createDocumentSignedUrl(document)
    const response = await fetch(signedUrl)
    if (!response.ok) throw new Error('The document could not be opened for analysis')
    const blob = await response.blob()
    const originalName = document.originalName || document.name || 'project-document'
    const file = new File([blob], originalName, { type: document.mimeType || blob.type || 'application/pdf' })
    const analysis = await analyzeMiscellaneousDocument(file, activeProjectId)
    return handleUpdateMiscellaneousDocument(document.documentId || document.id, {
      name: String(analysis.suggestedName || document.name || originalName).trim(),
      documentDate: String(analysis.documentDate || document.documentDate || '').trim(),
      description: String(analysis.description || '').trim(),
    })
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
    return savedRows
  }

  const handleStoreBankStatement = async (file, bank) => {
    if (!persistenceEnabled) throw new Error('Sign in before storing a bank statement')
    const saved = await uploadBankStatementDocument(activeProjectId, file, bank)
    setBankStatementDocuments((current) => [
      saved,
      ...current.filter((document) => (document.documentId || document.id) !== (saved.documentId || saved.id)),
    ])
    return saved
  }

  const handleFetchBankConnections = () => fetchBankConnections(activeProjectId)

  const handleCreateBankLinkToken = () => createBankLinkToken(activeProjectId)

  const handleExchangeBankPublicToken = (publicToken, institutionName) => exchangeBankPublicToken(activeProjectId, publicToken, institutionName)

  const handleSyncBankConnection = async (connectionId) => {
    const result = await syncBankConnection(activeProjectId, connectionId)
    setBankTransactions(await fetchBankTransactions(activeProjectId))
    return result
  }

  const handleDisconnectBankConnection = (connectionId) => disconnectBankConnection(activeProjectId, connectionId)

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

  const handleProjectCheckUpdate = async (checkId, check) => {
    if (!persistenceEnabled) throw new Error('Sign in before updating a check')
    const saved = await updateProjectCheck(checkId, check)
    setProjectChecks((current) => current.map((entry) => entry.id === checkId ? saved : entry))
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

  const handleSaveFinancingTransaction = async (entry) => {
    if (!persistenceEnabled) throw new Error('Sign in before saving financing activity')
    const saved = await saveFinancingTransaction(entry)
    setFinancingTransactions((current) => [saved, ...current])
    return saved
  }

  const handleDeleteFinancingTransaction = async (entryId) => {
    if (!persistenceEnabled) throw new Error('Sign in before removing financing activity')
    await deleteFinancingTransaction(entryId)
    setFinancingTransactions((current) => current.filter((entry) => entry.id !== entryId))
  }

  const handleFinancingStatusChange = async (entryId, status) => {
    if (!persistenceEnabled) throw new Error('Sign in before updating financing activity')
    const saved = await updateFinancingTransactionStatus(entryId, status)
    setFinancingTransactions((current) => current.map((entry) => entry.id === entryId ? saved : entry))
    return saved
  }

  const handleUpdateFinancingTransaction = async (entryId, entry) => {
    if (!persistenceEnabled) throw new Error('Sign in before editing financing activity')
    const saved = await updateFinancingTransaction(entryId, entry)
    setFinancingTransactions((current) => current.map((item) => item.id === entryId ? saved : item))
    return saved
  }

  const handleFinancingTreatmentChange = async (entryId, treatment, profitOwnerId, notes) => {
    if (!persistenceEnabled) throw new Error('Sign in before updating financing treatment')
    const saved = await updateFinancingTransactionTreatment(entryId, treatment, profitOwnerId, notes)
    setFinancingTransactions((current) => current.map((entry) => entry.id === entryId ? saved : entry))
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

  const handlePostBankDebitCosts = async (selectedDebits) => {
    const classificationMap = {
      soft_cost: {
        label: 'Soft Cost', parentName: 'Soft Costs', phase: 'development', category: 'Soft costs',
        mainCategory: 'Soft / Development Costs', subcategory: 'Other Development Costs',
      },
      land_cost: {
        label: 'Land Cost', parentName: 'Land Cost', phase: 'development', category: 'Land cost',
        mainCategory: 'Land Acquisition', subcategory: 'Other land acquisition expenses',
      },
      ground_work: {
        label: 'Ground Work', parentName: 'Ground Work — Narron', phase: 'development', category: 'Site work',
        mainCategory: 'Soft / Development Costs', subcategory: 'Clearing / Preliminary Site Work',
      },
      land_financing: {
        label: 'Land Financing', parentName: 'Land Interest & Financing', phase: 'development', category: 'Loan interest',
        mainCategory: 'Land Interest & Financing', subcategory: 'Other Financing Costs', loanRelated: true,
      },
      construction_cost: {
        label: 'Construction Cost', phase: 'construction', category: 'Other construction costs',
        mainCategory: 'Construction Costs', subcategory: 'Other Construction Costs',
      },
      other_cost: {
        label: 'Other Project Cost', phase: 'development', category: 'Other',
        mainCategory: 'Other Costs', subcategory: 'Other Project Cost',
      },
    }
    const exclusionLabels = {
      internal_transfer: 'Internal Transfer / Not a Cost',
      personal_exclude: 'Personal / Exclude',
    }
    const parentAddedAmounts = new Map()
    let posted = 0
    let excluded = 0
    let existing = 0

    const updateReviewedDebit = async (transaction, category, classificationStatus) => {
      const updates = {
        category,
        isOwnerContribution: false,
        reviewReasons: [],
        classificationStatus,
        reviewedAt: new Date().toISOString(),
      }
      setBankTransactions((current) => current.map((item) => item.id === transaction.id ? { ...item, ...updates } : item))
      if (persistenceEnabled) await updateBankTransaction(transaction.id, updates)
    }

    for (const { transaction, classification } of selectedDebits) {
      if (exclusionLabels[classification]) {
        await updateReviewedDebit(transaction, exclusionLabels[classification], 'ledger_excluded')
        excluded += 1
        continue
      }

      const mapping = classificationMap[classification] || classificationMap.other_cost
      const permanentReference = `BOFA-TXN-${transaction.id}`
      const linkedCost = accountingCostRecords.find((cost) => cost.referenceNumber === permanentReference)
      if (linkedCost) {
        await updateReviewedDebit(transaction, mapping.label, 'ledger_posted')
        existing += 1
        continue
      }

      const parent = mapping.parentName
        ? accountingCostRecords.find((cost) => !cost.parentCostId && cost.name === mapping.parentName)
        : null
      const payerOwner = owners.find((owner) => owner.name === transaction.owner)
      const companyOwner = owners.find((owner) => /green\s*fort/i.test(owner.name || '')) || owners[0]
      const ownerId = payerOwner?.id ?? companyOwner?.id
      if (ownerId == null) throw new Error('Add at least one owner or company record before posting bank debits to the ledger.')

      const bankText = [transaction.description, transaction.memo, transaction.rawDescription]
        .map((value) => String(value || '').trim()).filter(Boolean)
      const details = [...new Set(bankText)].join(' · ')
      const transactionText = bankText.join(' ').toLowerCase()
      const paymentMethod = /check/.test(String(transaction.transactionType || '').toLowerCase()) ? 'bofa_check'
        : /checkcard|card|purchase/.test(transactionText) ? 'debit_card' : 'bofa_ach'
      const amount = Math.abs(Number(transaction.amount || 0))

      await handleCostPageAdd({
        name: transaction.vendor || transaction.description || 'Bank of America debit',
        vendorName: transaction.vendor || transaction.description || '',
        details,
        amount,
        invoiceAmount: amount,
        ownerId,
        phase: mapping.phase,
        category: mapping.category,
        mainCategory: mapping.mainCategory,
        subcategory: mapping.subcategory,
        payerType: payerOwner ? 'owner' : 'company',
        payerOwnerId: payerOwner?.id ?? null,
        payerName: payerOwner?.name || 'Green Fort LLC',
        paymentSource: 'Bank of America',
        paymentMethod,
        paymentDate: transaction.date,
        referenceNumber: permanentReference,
        reimbursable: Boolean(payerOwner),
        loanRelated: Boolean(mapping.loanRelated),
        notes: `Posted from ${transaction.sourceName || 'a Bank of America statement'}; source transaction ${transaction.id}.`,
        lotAllocations: [],
        date: transaction.date,
        attachments: [],
        parentCostId: parent?.costId || null,
      })
      if (parent) parentAddedAmounts.set(parent.costId, Number(parentAddedAmounts.get(parent.costId) || 0) + amount)
      await updateReviewedDebit(transaction, mapping.label, 'ledger_posted')
      posted += 1
    }

    for (const [parentCostId, addedAmount] of parentAddedAmounts) {
      const parent = accountingCostRecords.find((cost) => String(cost.costId) === String(parentCostId))
      if (!parent) continue
      const existingBreakdownTotal = accountingCostRecords
        .filter((cost) => String(cost.parentCostId) === String(parentCostId))
        .reduce((sum, cost) => sum + Number(cost.amount || 0), 0)
      const requiredParentTotal = Math.round((existingBreakdownTotal + addedAmount) * 100) / 100
      if (requiredParentTotal <= Number(parent.amount || 0) + 0.009) continue
      await handleCostPageEdit({
        ...parent,
        costId: parent.costId,
        amount: requiredParentTotal,
        invoiceAmount: parent.invoiceAmount == null ? null : requiredParentTotal,
        lotAllocations: splitExistingLotAllocationsEvenly(requiredParentTotal, parent.lotAllocations),
      })
    }

    return { posted, excluded, existing }
  }

  const handleOpenProject = (projectId) => {
    setActiveProjectId(projectId)
    setProjectSection('overview')
    setWorkspaceView('project')
  }

  const handleOpenCostBreakdown = (costId) => {
    setCostPageEditCostId(null)
    setBreakdownParentCostId(costId)
    setShowCostPage(true)
  }

  const handleOpenCostEdit = (costId) => {
    setBreakdownParentCostId(null)
    setCostPageEditCostId(costId)
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
      <>
        <CostPage
          owners={owners}
          developmentCosts={activeDevelopmentCosts}
          breakdownCosts={activeBreakdownCosts}
          costVersions={projectCostVersions}
          constructionDrafts={constructionDrafts}
          projectChecks={projectChecks.filter((check) => String(check.projectId) === String(activeProjectId))}
          lotCommitments={projectLotCommitments}
          activeProjectId={activeProjectId}
          projectName={activeProject?.name || 'Project'}
          initialParentCostId={breakdownParentCostId}
          initialEditCostId={costPageEditCostId}
          onBack={() => {
            setShowCostPage(false)
            setBreakdownParentCostId(null)
            setCostPageEditCostId(null)
          }}
          onAddDevelopmentCost={handleCostPageAdd}
          onEditDevelopmentCost={handleCostPageEdit}
          onDeleteDevelopmentCost={handleCostPageDelete}
          onUploadDocument={handleUploadCostDocument}
          onAttachDocument={handleAttachCostDocument}
          onOpenDocument={handleOpenCostDocument}
          onCreateCheck={handleCreateCheckFromCost}
          onMergeBreakdowns={handleMergeCostBreakdowns}
          onAddItemsToGroup={handleAddCostsToBreakdownGroup}
          onUnmergeGroup={handleUnmergeCostBreakdownGroup}
          onSaveConstructionDraft={handleSaveConstructionDraft}
          onConvertConstructionDraft={handleConvertConstructionDraft}
          sharedDevelopmentCostTotal={ownerCostTotal}
        />
        {overviewPreviewAttachment ? <AttachmentPreviewModal
          attachment={overviewPreviewAttachment}
          onClose={() => setOverviewPreviewAttachment(null)}
          onGetUrl={createDocumentSignedUrl}
          onDownload={handleDownloadCostDocument}
        /> : null}
      </>
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
          <div className={`access-badge${showAccountSecurity ? ' is-expanded' : ''}`}>
            <div className="access-identity">
              <span className="access-avatar" aria-hidden="true">{(authUser?.email || accessProfile.email || 'G').charAt(0).toUpperCase()}</span>
              <div>
                <strong>{accessProfile.is_global_admin ? 'Global administrator' : 'Project administrator'}</strong>
              </div>
              <button type="button" className="account-menu-toggle" aria-label="Account menu" aria-expanded={showAccountMenu} onClick={() => {
                setShowAccountMenu((current) => !current)
                if (showAccountMenu) setShowAccountSecurity(false)
              }}>{showAccountMenu ? '▴' : '▾'}</button>
            </div>
            {showAccountMenu ? <div className="access-menu-details">
              <span className="access-email">{authUser?.email || accessProfile.email}</span>
              {persistenceEnabled ? <div className="database-status" role="status">
                <span className="database-status-dot" aria-hidden="true" />
                <div><strong>Supabase connected</strong><small>Changes save automatically</small></div>
              </div> : null}
              <div className="access-actions">
                {onUpdatePassword ? <button type="button" className="secondary-button" aria-expanded={showAccountSecurity} onClick={() => {
                  setShowAccountSecurity((current) => !current)
                  setPasswordMessage(null)
                }}>{showAccountSecurity ? 'Close security' : 'Account security'}</button> : null}
                <button type="button" className="access-sign-out" onClick={onSignOut}>Sign out</button>
              </div>
              {showAccountSecurity ? <form className="account-security-form" noValidate onSubmit={handlePasswordUpdate}>
                <strong>Set or change password</strong>
                <small>Use at least 8 characters. This password is used for future sign-ins.</small>
                <input aria-label="New password" type="password" autoComplete="new-password" placeholder="At least 8 characters" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
                <input aria-label="Confirm new password" type="password" autoComplete="new-password" placeholder="Confirm password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
                {passwordMessage ? <small className={passwordMessage.type === 'error' ? 'validation-error' : 'password-success'} role={passwordMessage.type === 'error' ? 'alert' : 'status'}>{passwordMessage.text}</small> : null}
                <button type="submit" className="action-button" disabled={updatingPassword}>{updatingPassword ? 'Saving…' : 'Save password'}</button>
              </form> : null}
            </div> : null}
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
            ['reports', 'Reports'],
            ['lots', 'Lots'],
            ['jobs', 'Spending by Job'],
            ['income', 'Draws & Income'],
            ['partners', 'Partners'],
            ['financing', 'Loans & Owner Payouts'],
            ['bank', 'Bank'],
            ['checks', 'Checks'],
            ['documents', 'Documents'],
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

          <div className="overview-section-heading">
            <div>
              <p className="eyebrow">Lot costs</p>
              <h3>Allocated manual and saved costs</h3>
            </div>
            <button type="button" className="secondary-button" onClick={() => setProjectSection('lots')}>Open lot details</button>
          </div>
          <div className="overview-phase-grid overview-lot-cost-grid">
            {projectLotCommitments.filter((entry) => entry.lot).map((entry) => <div key={entry.lot} className="overview-phase-card">
              <span>{entry.lot}</span>
              <strong>{currency.format(lotCostSummary.totals[entry.lot] || 0)}</strong>
            </div>)}
            {lotCostSummary.unassigned > 0 ? <div className="overview-phase-card is-unassigned">
              <span>Unassigned project costs</span>
              <strong>{currency.format(lotCostSummary.unassigned)}</strong>
            </div> : null}
          </div>

          <div className="overview-section-heading overview-cost-heading">
            <div>
              <p className="eyebrow">Project costs</p>
              <h3>{overviewFilteredCosts.length} of {activeDevelopmentCosts.length} active cost{activeDevelopmentCosts.length === 1 ? '' : 's'}</h3>
              <strong>{overviewLotFilter === 'all' ? 'All-lot total' : `${overviewLotFilter === 'unassigned' ? 'Unassigned' : overviewLotFilter} portion`}: {currency.format(overviewFilteredTotal)}</strong>
              <div className="overview-filtered-phase-totals">
                {['development', 'construction', 'soft_cost', 'other'].map((phase) => <span key={phase}>
                  {costPhaseLabel(phase)} <strong>{currency.format(overviewFilteredPhaseTotals[phase] || 0)}</strong>
                </span>)}
              </div>
            </div>
            <div className="overview-cost-heading-actions">
              <div className="overview-view-toggle" role="group" aria-label="Cost display">
                <button type="button" className={overviewCostView === 'cards' ? 'active' : ''} aria-pressed={overviewCostView === 'cards'} onClick={() => setOverviewCostView('cards')}>Cards</button>
                <button type="button" className={overviewCostView === 'list' ? 'active' : ''} aria-pressed={overviewCostView === 'list'} onClick={() => setOverviewCostView('list')}>List</button>
              </div>
              <label>
                Filter costs by lot
                <select aria-label="Filter overview costs by lot" value={overviewLotFilter} onChange={(event) => setOverviewLotFilter(event.target.value)}>
                  <option value="all">All lots</option>
                  {projectLotCommitments.map((entry) => <option key={entry.lot} value={entry.lot}>{entry.lot}</option>)}
                  <option value="unassigned">Unassigned</option>
                </select>
              </label>
              <button type="button" className="action-button" onClick={() => {
                setBreakdownParentCostId(null)
                setCostPageEditCostId(null)
                setShowCostPage(true)
              }}>Search all costs</button>
            </div>
          </div>
          {overviewCostMessage ? <div className={`overview-cost-message ${overviewCostMessage.type}`} role={overviewCostMessage.type === 'error' ? 'alert' : 'status'}>
            <span>{overviewCostMessage.text}</span>
            <button type="button" aria-label="Dismiss cost message" onClick={() => setOverviewCostMessage(null)}>×</button>
          </div> : null}
          {overviewCostView === 'list' ? <div className="overview-cost-list" role="table" aria-label="Overview cost list">
            <div className="overview-cost-list-header" role="row">
              <span role="columnheader">Date</span>
              <span role="columnheader">Cost</span>
              <span role="columnheader">Owner / category</span>
              <span role="columnheader">Lot</span>
              <span role="columnheader">Breakdown</span>
              <span role="columnheader">Amount</span>
              <span role="columnheader">Actions</span>
            </div>
            {overviewFilteredCosts.map((cost) => {
              const owner = owners.find((entry) => entry.id === cost.ownerId)
              const breakdowns = activeBreakdownCosts.filter((entry) => entry.parentCostId === cost.costId)
              const allocated = Math.round(breakdowns.reduce((sum, entry) => sum + Number(entry.amount || 0), 0) * 100) / 100
              const remaining = Number(cost.amount || 0) - allocated
              const detailsExpanded = expandedOverviewCostIds.has(cost.costId)
              const displayedAmount = getCostAmountForLotFilter(cost, overviewLotFilter)
              const lots = (cost.lotAllocations || []).map((entry) => entry.lot).filter(Boolean)
              return <Fragment key={cost.id}>
                <div className={`overview-cost-list-row${remaining < 0 ? ' is-over-allocated' : ''}`} role="row">
                  <span role="cell">{cost.date || '—'}<small>Added {costAddedDate(cost)}</small></span>
                  <span role="cell"><strong>{cost.name}</strong><small>{costPhaseLabel(cost.phase)}</small></span>
                  <span role="cell">{owner?.name || 'Not assigned'}<small>{cost.category || 'Uncategorized'}</small></span>
                  <span role="cell">{overviewLotFilter !== 'all' ? (overviewLotFilter === 'unassigned' ? 'Unassigned' : overviewLotFilter) : (lots.join(', ') || 'Unassigned')}</span>
                  <span role="cell"><strong>{breakdowns.length ? `${breakdowns.length} item${breakdowns.length === 1 ? '' : 's'}` : 'Not started'}</strong><small className={remaining < 0 ? 'warning' : ''}>{remaining < 0 ? `Over ${currency.format(Math.abs(remaining))}` : `${currency.format(remaining)} remaining`}</small></span>
                  <strong role="cell" className="overview-cost-list-amount">{currency.format(displayedAmount)}</strong>
                  <span role="cell" className="overview-cost-list-actions">
                    {breakdowns.length ? <button type="button" className="text-button" aria-expanded={detailsExpanded} onClick={() => toggleOverviewCostDetails(cost.costId)}>{detailsExpanded ? 'Hide' : 'Details'}</button> : null}
                    <button type="button" className="text-button" onClick={() => handleOpenCostEdit(cost.costId)}>Edit</button>
                    <button type="button" className="text-button" onClick={() => handleOpenCostBreakdown(cost.costId)}>Break down</button>
                  </span>
                </div>
                {detailsExpanded ? <div className="overview-cost-list-details">
                  {breakdowns.map((breakdown) => <div key={breakdown.id}><span>↳ {breakdown.name}</span><small>{breakdown.date || 'No date'} · {breakdown.category || 'Uncategorized'}</small><strong>{currency.format(breakdown.amount)}</strong></div>)}
                </div> : null}
              </Fragment>
            })}
            {overviewFilteredCosts.length === 0 ? <div className="cost-empty-state">
              <strong>{activeDevelopmentCosts.length ? 'No costs match this lot filter' : 'No project costs yet'}</strong>
              <p>{activeDevelopmentCosts.length ? 'Choose another lot or All lots.' : 'Add the first cost from the Owners & Costs section or open the full cost page.'}</p>
            </div> : null}
          </div> : <div className="overview-cost-grid">
            {overviewFilteredCosts.map((cost) => {
              const owner = owners.find((entry) => entry.id === cost.ownerId)
              const breakdowns = activeBreakdownCosts.filter((entry) => entry.parentCostId === cost.costId)
              const allocated = Math.round(breakdowns.reduce((sum, entry) => sum + Number(entry.amount || 0), 0) * 100) / 100
              const unallocated = Number(cost.amount || 0) - allocated
              const isOverAllocated = unallocated < 0
              const allocationPercent = Number(cost.amount || 0) > 0 ? (allocated / Number(cost.amount)) * 100 : 0
              const displayedAmount = getCostAmountForLotFilter(cost, overviewLotFilter)
              const detailsExpanded = expandedOverviewCostIds.has(cost.costId)
              const attachedChecks = projectChecks.filter((check) => (
                check.costId === cost.costId
                && check.status !== 'voided'
                && check.checkType !== 'internal_transfer'
                && (overviewLotFilter === 'all' || (overviewLotFilter === 'unassigned' ? !check.lot : check.lot === overviewLotFilter))
              ))
              return <article key={cost.id} className={`dashboard-cost-row overview-cost-card${detailsExpanded ? ' is-expanded' : ''}${isOverAllocated ? ' is-over-allocated' : ''}`}>
                <div className="overview-cost-card-main">
                  <div className="overview-cost-title-row">
                    <div>
                      <strong>{cost.name}</strong>
                      <p>{owner?.name || 'Owner not assigned'} • {costPhaseLabel(cost.phase)} • {cost.category || 'Uncategorized'} • Invoice {cost.date || 'Not available'} • Added {costAddedDate(cost)}</p>
                      {overviewLotFilter !== 'all' ? <small className="overview-lot-portion">Showing {overviewLotFilter === 'unassigned' ? 'unassigned portion' : `${overviewLotFilter} allocation`} of {currency.format(cost.amount)} total</small> : null}
                    </div>
                    <strong className="overview-cost-amount">{currency.format(displayedAmount)}</strong>
                  </div>
                  <div className="overview-allocation-row">
                    <span>{breakdowns.length ? `${breakdowns.length} breakdown${breakdowns.length === 1 ? '' : 's'}` : 'No breakdowns yet'}</span>
                    <span>Allocated {currency.format(allocated)}</span>
                    <strong className={isOverAllocated ? 'warning' : ''}>
                      {isOverAllocated ? `Over allocated ${currency.format(Math.abs(unallocated))}` : `Remaining ${currency.format(unallocated)}`}
                    </strong>
                  </div>
                  {attachedChecks.length ? <div className="check-link-summary"><strong>Attached checks</strong>{attachedChecks.map((check) => <span key={check.id}>#{check.checkNumber} · {currency.format(check.amount)} · {check.status}</span>)}</div> : null}
                  {cost.attachments?.length ? <div className="overview-cost-attachments">
                    <strong>Attached documents ({cost.attachments.length})</strong>
                    {cost.attachments.map((attachment) => <div key={attachment.documentId || attachment.id || attachment.storagePath}>
                      <span>{attachment.name}</span>
                      <div className="button-row">
                        <button type="button" className="secondary-button" onClick={() => setOverviewPreviewAttachment(attachment)}>Preview</button>
                        <button type="button" className="secondary-button" onClick={() => handleDownloadCostDocument(attachment)}>Download</button>
                      </div>
                    </div>)}
                  </div> : null}
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
                    <button type="button" className="action-button" onClick={() => handleOpenCostEdit(cost.costId)}>Edit cost</button>
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
            {overviewFilteredCosts.length === 0 ? <div className="cost-empty-state">
              <strong>{activeDevelopmentCosts.length ? 'No costs match this lot filter' : 'No project costs yet'}</strong>
              <p>{activeDevelopmentCosts.length ? 'Choose another lot or All lots.' : 'Add the first cost from the Owners & Costs section or open the full cost page.'}</p>
            </div> : null}
          </div>}

          <div className="overview-section-heading overview-category-heading">
            <div>
              <p className="eyebrow">Budget tracking</p>
              <h3>Cost phase budgets</h3>
            </div>
          </div>
          <div className="category-list overview-category-list">
            {categoryBudgetMessage ? (
              <p className={categoryBudgetMessage.type === 'error' ? 'validation-error' : 'budget-save-status'} role={categoryBudgetMessage.type === 'error' ? 'alert' : 'status'}>
                {categoryBudgetMessage.text}
              </p>
            ) : null}
            {selectedProjectCategories.length === 0 ? (
              <div className="table-row">
                <div>
                  <strong>No cost categories</strong>
                  <p>Project categories will appear here when available.</p>
                </div>
              </div>
            ) : null}
            {selectedProjectCategories.map((category) => {
              const actual = Number(phaseCostTotals[category.phase] || 0)
              const variance = category.budgetedAmount - actual
              const budgetDraft = categoryBudgetDrafts[category.id] ?? String(category.budgetedAmount)
              const isSaving = savingCategoryBudgetId === category.id
              if (category.phase === 'construction') {
                const lotDrafts = categoryLotBudgetDrafts[category.id] || {}
                const draftTotal = CONSTRUCTION_BUDGET_LOTS.reduce((sum, lot) => (
                  sum + (Number(lotDrafts[lot] ?? category.lotBudgets?.[lot] ?? 0) || 0)
                ), 0)
                return (
                  <div key={category.id} className="category-row construction-budget-category">
                    <div className="construction-budget-header">
                      <div>
                        <strong>{category.name}</strong>
                        <p>construction · Actual {currency.format(actual)} · Budget {currency.format(category.budgetedAmount)}</p>
                      </div>
                      <div className="metric-stack">
                        <small className={variance < 0 ? 'warning' : ''}>Total variance {currency.format(variance)}</small>
                        {constructionLotCostTotals.unassigned > 0 ? <small className="warning">Unassigned actual {currency.format(constructionLotCostTotals.unassigned)}</small> : null}
                      </div>
                    </div>
                    <form className="construction-lot-budget-form" onSubmit={(event) => handleCategoryBudgetSave(event, category)}>
                      <div className="construction-lot-budget-grid">
                        {CONSTRUCTION_BUDGET_LOTS.map((lot) => {
                          const lotActual = Number(constructionLotCostTotals.byLot[lot] || 0)
                          const lotBudget = Number(category.lotBudgets?.[lot] || 0)
                          const lotVariance = lotBudget - lotActual
                          return <label key={lot} className="construction-lot-budget-row">
                            <span><strong>{lot}</strong><small>Actual {currency.format(lotActual)}</small></span>
                            <span className="construction-lot-budget-input">
                              Budget
                              <input
                                aria-label={`Construction ${lot} budget`}
                                type="number"
                                min="0"
                                step="0.01"
                                inputMode="decimal"
                                value={lotDrafts[lot] ?? String(lotBudget)}
                                onChange={(event) => setCategoryLotBudgetDrafts((current) => ({
                                  ...current,
                                  [category.id]: { ...(current[category.id] || {}), [lot]: event.target.value },
                                }))}
                              />
                            </span>
                            <small className={lotVariance < 0 ? 'warning' : ''}>Variance {currency.format(lotVariance)}</small>
                          </label>
                        })}
                      </div>
                      <div className="construction-budget-actions">
                        <span>Four-lot budget total: <strong>{currency.format(draftTotal)}</strong></span>
                        <button type="submit" className="secondary-button" disabled={isSaving}>{isSaving ? 'Saving…' : 'Save lot budgets'}</button>
                      </div>
                    </form>
                  </div>
                )
              }
              return (
                <div key={category.id} className="category-row">
                  <div>
                    <strong>{category.name}</strong>
                    <p>{category.phase} · Actual {currency.format(actual)}</p>
                  </div>
                  <form className="metric-stack category-budget-form" onSubmit={(event) => handleCategoryBudgetSave(event, category)}>
                    <label>
                      Budget
                      <input
                        aria-label={`${category.name} budget`}
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        value={budgetDraft}
                        onChange={(event) => setCategoryBudgetDrafts((current) => ({ ...current, [category.id]: event.target.value }))}
                      />
                    </label>
                    <small className={variance < 0 ? 'warning' : ''}>Variance {currency.format(variance)}</small>
                    <button type="submit" className="secondary-button" disabled={isSaving}>{isSaving ? 'Saving…' : 'Save budget'}</button>
                  </form>
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
            <label>
              Ownership percentage
              <input aria-label="Ownership percentage" type="number" min="0" max="100" step="0.01" required value={ownerOwnershipPercentage} onChange={(event) => setOwnerOwnershipPercentage(event.target.value)} />
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
                  <p>{Number(owner.ownershipPercentage ?? 50).toFixed(2)}% ownership · separately tracked contribution</p>
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
              }}>View and search costs</button>
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
              Invoice date
              <input aria-label="Invoice date" type="date" required value={developmentCostDate} onChange={(event) => setDevelopmentCostDate(event.target.value)} />
              <small>The added date is recorded automatically.</small>
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
                    <p>{owner?.name || 'Owner'} • {costPhaseLabel(cost.phase)} • Invoice {cost.date || 'Not available'} • Added {costAddedDate(cost)}</p>
                    <small>{breakdowns.length} breakdown{breakdowns.length === 1 ? '' : 's'} • Allocated {currency.format(allocated)} • Unallocated {currency.format(Number(cost.amount || 0) - allocated)}</small>
                  </div>
                  <div>{currency.format(cost.amount)}</div>
                  <div className="button-row">
                    <button type="button" className="action-button" onClick={() => handleOpenCostEdit(cost.costId)}>Edit cost</button>
                    <button type="button" className="secondary-button" onClick={() => handleOpenCostBreakdown(cost.costId)}>Add breakdown</button>
                  </div>
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
              const attachedChecks = projectChecks.filter((check) => check.invoiceId === invoice.id && check.status !== 'voided' && check.checkType !== 'internal_transfer')
              return (
                <div key={invoice.id} className="table-row">
                  <div>
                    <strong>{invoice.invoiceNumber}</strong>
                    <p>{vendor?.name}</p>
                    {attachedChecks.length ? <p className="check-link-summary"><strong>Checks:</strong> {attachedChecks.map((check) => `#${check.checkNumber} (${currency.format(check.amount)})`).join(', ')}</p> : null}
                  </div>
                  <div>{currency.format(invoice.amount)}</div>
                  <div>{invoice.status}<InvoicePaymentWarning invoiceDate={invoice.invoiceDate} paid={invoice.status === 'paid' || attachedChecks.filter((check) => check.status === 'printed').reduce((sum, check) => sum + Number(check.amount || 0), 0) >= Number(invoice.amount)} /></div>
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
        activeCosts={activeDevelopmentCosts}
        activeProjectId={activeProjectId}
        onSaveLotCommitment={handleSaveLotCommitment}
        onUploadDocument={handleUploadCostDocument}
        onOpenDocument={handleDownloadCostDocument}
        onGetDocumentUrl={createDocumentSignedUrl}
        sharedDevelopmentCostTotal={ownerCostTotal}
      /> : null}

      {showProjectSection('jobs') ? <SpendingByJob
        constructionDrafts={constructionDrafts}
        checks={projectChecks.filter((check) => String(check.projectId) === String(activeProjectId))}
        activeCosts={accountingCostRecords}
        sharedDevelopmentCostTotal={ownerCostTotal}
      /> : null}

      {showProjectSection('reports') ? <DevelopmentCostReport
        project={activeProject}
        costs={activeDevelopmentCosts}
        breakdowns={activeBreakdownCosts}
        owners={owners}
        incomes={projectIncomes}
        onUpdateCostCategory={(cost, category) => handleCostPageEdit({
          ...accountingCostRecords.find((entry) => String(entry.costId) === String(cost.costId)),
          costId: cost.costId,
          category,
        })}
        onEditCost={handleOpenCostEdit}
        onAddBreakdown={handleOpenCostBreakdown}
        onDeleteCost={handleCostPageDelete}
      /> : null}

      {showProjectSection('income') ? <IncomeSection
        incomes={projectIncomes}
        checks={projectChecks.filter((check) => String(check.projectId) === String(activeProjectId))}
        projects={activeProject ? [activeProject] : []}
        lotCommitments={projectLotCommitments}
        onAddIncome={handleAddIncome}
        onEditIncome={handleEditIncome}
        onDeleteIncome={handleDeleteIncome}
        onUploadDocument={handleUploadCostDocument}
        onOpenDocument={handleOpenCostDocument}
      /> : null}

      {showProjectSection('financing') && activeProject ? <FinancingLedger
        project={activeProject}
        owners={owners}
        entries={financingTransactions}
        onSave={handleSaveFinancingTransaction}
        onDelete={handleDeleteFinancingTransaction}
        onStatusChange={handleFinancingStatusChange}
        onUpdate={handleUpdateFinancingTransaction}
        onTreatmentChange={handleFinancingTreatmentChange}
        onPrepareCheck={handleCreateCheckFromCost}
      /> : null}

      {showProjectSection('partners') && activeProject ? <PartnersSection
        project={activeProject}
        owners={owners}
        entries={financingTransactions}
        onSave={handleSaveFinancingTransaction}
        onDelete={handleDeleteFinancingTransaction}
      /> : null}

      {overviewPreviewAttachment ? <AttachmentPreviewModal
        attachment={overviewPreviewAttachment}
        onClose={() => setOverviewPreviewAttachment(null)}
        onGetUrl={createDocumentSignedUrl}
        onDownload={handleDownloadCostDocument}
      /> : null}

      {showProjectSection('bank') ? <BankDashboard
        projectId={activeProjectId}
        transactions={bankTransactions}
        statements={bankStatementDocuments}
        onImport={handleBankImport}
        onStoreStatement={handleStoreBankStatement}
        onOpenStatement={handleOpenCostDocument}
        onDownloadStatement={handleDownloadCostDocument}
        onChangeOwner={handleBankOwnerChange}
        onApproveCategory={handleBankCategoryApproval}
        ledgerCosts={accountingCostRecords}
        onPostDebitCosts={handlePostBankDebitCosts}
        canConnect={persistenceEnabled}
        onFetchConnections={handleFetchBankConnections}
        onCreateLinkToken={handleCreateBankLinkToken}
        onExchangePublicToken={handleExchangeBankPublicToken}
        onLoadPlaidLink={loadPlaidLink}
        onSyncConnection={handleSyncBankConnection}
        onDisconnectConnection={handleDisconnectBankConnection}
      /> : null}

      {showProjectSection('checks') && activeProject ? <CheckPrinting
        project={activeProject}
        checks={projectChecks.filter((check) => String(check.projectId) === String(activeProjectId))}
        invoices={projectInvoices}
        costs={accountingCostRecords}
        loanDraws={projectIncomes.filter((income) => income.type === 'loan_draw')}
        initialDraft={pendingCheckDraft}
        onInitialDraftApplied={() => setPendingCheckDraft(null)}
        onSaveCheck={handleSaveProjectCheck}
        onUpdateCheck={handleProjectCheckUpdate}
        onUpdateStatus={handleProjectCheckStatus}
        onUpdateLink={handleProjectCheckLink}
        onUpdateTemplate={handleProjectCheckTemplate}
        onUpdateFunding={handleProjectCheckFunding}
        onUpdateLot={handleProjectCheckLot}
        onEditCost={handleOpenCostEdit}
        onAttachInvoice={handleAttachCostDocument}
        onOpenDocument={handleOpenCostDocument}
        onPrintPaidInvoice={handlePrintPaidInvoice}
        onExtractVendorAddress={handleExtractVendorAddress}
        onSaveVendorAddress={handleSaveVendorAddress}
        onImportVendorAddresses={handleImportVendorAddresses}
        vendorAddresses={vendors.filter((vendor) => vendor.mailingAddress)}
      /> : null}

      {paidInvoicePreview ? <AttachmentPreviewModal
        attachment={paidInvoicePreview.attachment}
        paidWatermark={paidInvoicePreview.details}
        onClose={() => setPaidInvoicePreview(null)}
        onGetUrl={createDocumentSignedUrl}
        onDownload={handleDownloadCostDocument}
      /> : null}

      {showProjectSection('documents') ? <ProjectDocuments
        documents={miscellaneousDocuments}
        onUpload={handleUploadMiscellaneousDocument}
        onOpen={handleOpenCostDocument}
        onDownload={handleDownloadCostDocument}
        onDelete={handleDeleteMiscellaneousDocument}
        onUpdate={handleUpdateMiscellaneousDocument}
        onAnalyze={handleAnalyzeMiscellaneousDocument}
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
