import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { extractTransactionFromImage } from './lib/gemini'
import { extractStatementFromText } from './lib/statementExtraction'
import InvoicePaymentWarning from './InvoicePaymentWarning'
import { extractPdfDocumentText } from './lib/pdfText'
import { extractVendorMailingAddressFromText } from './lib/vendorAddress'
import ConstructionDrafts from './ConstructionDrafts'
import AttachmentPreviewModal from './AttachmentPreviewModal'
import { identifyProvidenceLoan } from './lib/providenceLoanAccounts'
import { COST_SUBCATEGORIES, MAIN_COST_CATEGORIES, inferMainCostCategory, payerLabel } from './lib/accountingTaxonomy'
import { currency } from './lib/currency'

const phaseLabel = (phase) => ({
  development: 'Development',
  construction: 'Construction',
  soft_cost: 'Soft Cost',
  other: 'Other',
}[phase] || phase || 'Development')

const paymentMethodLabel = (method) => ({
  amex_business: 'Amex Business', check: 'Check (bank not specified)', bank_transfer: 'ACH / bank transfer (bank not specified)',
  providence_ach: 'Providence Bank ACH', bofa_ach: 'Bank of America ACH',
  kemal_personal_bank: 'Kemal Personal Bank Account', banu_personal_bank: 'Banu Personal Bank Account',
  providence_check: 'Providence Bank check', bofa_check: 'Bank of America check',
  other_credit_card: 'Other credit card', debit_card: 'Debit card', cash: 'Cash', other: 'Other',
}[method] || '')

const isCreditCardPayment = (method) => ['amex_business', 'other_credit_card'].includes(method)
const isCheckPayment = (method) => ['check', 'providence_check', 'bofa_check'].includes(method)
const checkBankDetails = (method) => method === 'providence_check'
  ? { templateKey: 'providence', accountLabel: 'Providence Bank' }
  : method === 'bofa_check' ? { templateKey: 'bofa', accountLabel: 'Bank of America' } : {}
const DEFAULT_CARD_FEE_PERCENTAGE = '3'
const displayDate = (value, fallback = 'Not available') => String(value || '').slice(0, 10) || fallback

const dateInputValue = (date) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0'),
].join('-')

const invoiceDateRangeForPreset = (preset, today = new Date()) => {
  const year = today.getFullYear()
  const month = today.getMonth()
  const calendarMonths = (count) => ({
    from: dateInputValue(new Date(year, month - count + 1, 1)),
    to: dateInputValue(new Date(year, month + 1, 0)),
  })
  const ranges = {
    this_month: calendarMonths(1),
    last_month: {
      from: dateInputValue(new Date(year, month - 1, 1)),
      to: dateInputValue(new Date(year, month, 0)),
    },
    last_3_months: calendarMonths(3),
    last_6_months: calendarMonths(6),
    last_12_months: calendarMonths(12),
    this_year: {
      from: dateInputValue(new Date(year, 0, 1)),
      to: dateInputValue(new Date(year, 11, 31)),
    },
    last_year: {
      from: dateInputValue(new Date(year - 1, 0, 1)),
      to: dateInputValue(new Date(year - 1, 11, 31)),
    },
  }
  return ranges[preset] || { from: '', to: '' }
}

const csvCell = (value) => {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const COST_CATEGORIES = [
  'Land cost', 'Permits & municipal fees', 'Site utilities', 'Site work', 'Foundation',
  'Framing', 'Roofing', 'Mechanical', 'Electrical', 'Plumbing',
  'Interior finishes', 'Professional fees', 'Legal / attorney fees', 'Engineering', 'Soft costs', 'Loan interest', 'Outsource Loan', 'Owner contribution',
  'Kemal Equity Interest', 'Banu Equity Interest', 'Financing costs', 'Other',
]

const DEFAULT_COST_LOTS = ['Lot 1', 'Lot 2', 'Lot 3', 'Lot 4']

const costAllocationLabel = (cost) => {
  const allocations = cost.lotAllocations || []
  if (!allocations.length) return 'Unassigned lot'
  if (allocations.length === 1 && Number(allocations[0].amount) === Number(cost.amount)) return allocations[0].lot
  if (DEFAULT_COST_LOTS.every((lot) => allocations.some((entry) => entry.lot === lot))) return 'All lots'
  return `Shared: ${allocations.map((entry) => entry.lot).join(', ')}`
}

const splitAmountEvenly = (amount, lots) => {
  if (!lots.length) return {}
  const totalCents = Math.round(Number(amount || 0) * 100)
  const baseCents = Math.floor(totalCents / lots.length)
  const remainder = totalCents - (baseCents * lots.length)
  return Object.fromEntries(lots.map((lot, index) => [lot, ((baseCents + (index < remainder ? 1 : 0)) / 100).toFixed(2)]))
}

const paymentAmounts = (invoiceAmount, method, feePercentage) => {
  const invoice = Number(invoiceAmount || 0)
  const percentage = Number(feePercentage)
  const fee = isCreditCardPayment(method) && feePercentage !== '' && Number.isFinite(percentage)
    ? Math.round(invoice * percentage) / 100
    : 0
  return { invoice, fee, total: Math.round((invoice + fee) * 100) / 100 }
}

const allocateInvoiceTotalByLot = (rawAllocations, total, validLots) => {
  const byLot = new Map()
  ;(Array.isArray(rawAllocations) ? rawAllocations : []).forEach((entry) => {
    const lot = validLots.find((option) => option.toLowerCase() === String(entry?.lot || '').trim().toLowerCase())
    const amount = Number(entry?.amount)
    if (!lot || !Number.isFinite(amount) || amount <= 0) return
    byLot.set(lot, Number(byLot.get(lot) || 0) + amount)
  })
  const lines = [...byLot].map(([lot, amount]) => ({ lot, amount }))
  if (lines.length < 2) return []
  const lineTotal = lines.reduce((sum, entry) => sum + entry.amount, 0)
  const totalCents = Math.round(Number(total || 0) * 100)
  if (!Number.isFinite(lineTotal) || lineTotal <= 0 || totalCents <= 0) return []

  let remainingCents = totalCents
  return lines.map((entry, index) => {
    const cents = index === lines.length - 1
      ? remainingCents
      : Math.round((totalCents * entry.amount) / lineTotal)
    remainingCents -= cents
    return { lot: entry.lot, amount: cents / 100 }
  })
}

const lotLinesFromDocumentText = (documentText, validLots) => {
  const lines = []
  const seen = new Set()
  const addLine = (lotNumber, amount) => {
    const lot = validLots.find((option) => option.toLowerCase() === `lot ${lotNumber}`.toLowerCase())
    const numericAmount = Number(String(amount || '').replace(/,/g, ''))
    if (!lot || seen.has(lot) || !Number.isFinite(numericAmount) || numericAmount <= 0) return
    seen.add(lot)
    lines.push({ lot, amount: numericAmount, description: `${lot} line item` })
  }

  const source = String(documentText || '')
  const priceAndAmountPattern = /\blot\s*(\d+)\s+(\d[\d,]*\.\d{2,4})\s+(\d[\d,]*\.\d{2})\*?/gi
  let match
  while ((match = priceAndAmountPattern.exec(source))) addLine(match[1], match[3])
  if (lines.length > 1) return lines

  const singleAmountPattern = /\blot\s*(\d+)\s+(\d[\d,]*\.\d{2})\b/gi
  while ((match = singleAmountPattern.exec(source))) addLine(match[1], match[2])
  return lines.length > 1 ? lines : []
}

const isUnderSlabPlumbing = (extracted, documentText = '') => {
  const sourceText = `${extracted.costName || ''} ${extracted.description || ''} ${extracted.details || ''} ${documentText}`.toLowerCase()
  return /under[ -]?slab plumbing|backwater valve/.test(sourceText)
}

const receiptCostName = (extracted, documentText = '') => {
  const category = String(extracted.category || '').trim()
  const sourceText = `${extracted.costName || ''} ${extracted.description || ''} ${extracted.details || ''} ${documentText}`.toLowerCase()
  if (category.toLowerCase() === 'plumbing' || isUnderSlabPlumbing(extracted, documentText)) {
    if (/under[ -]?slab|backwater valve/.test(sourceText)) return 'Under-slab plumbing'
    if (/foundation/.test(sourceText)) return 'Plumbing for Foundation'
    if (/rough[ -]?in|roughed in/.test(sourceText)) return 'Plumbing Rough-In'
    return 'Plumbing'
  }
  return String(extracted.costName || extracted.description || extracted.vendor || '').trim()
}

const receiptLot = (extracted, lotOptions, documentText = '') => {
  const directLot = String(extracted.lot || '').trim()
  const directMatch = lotOptions.find((lot) => lot.toLowerCase() === directLot.toLowerCase())
  if (directMatch) return directMatch

  const sourceText = [
    extracted.description,
    extracted.details,
    extracted.notes,
    extracted.address,
    extracted.costName,
    documentText,
  ].map((value) => String(value || '')).join(' ')

  return lotOptions.find((lot) => {
    const lotNumber = lot.match(/^Lot\s+(\d+)$/i)?.[1]
    if (lotNumber) return new RegExp(`\\blot\\s*(?:number|no\\.?|#)?\\s*[-:]?\\s*${lotNumber}\\b`, 'i').test(sourceText)
    return sourceText.toLowerCase().includes(lot.toLowerCase())
  }) || ''
}

const invoiceScopeDetails = (documentText) => {
  if (!documentText) return ''
  const details = []
  if (/under[ -]?slab plumbing/i.test(documentText)) {
    const hasBackwaterWork = /backwater valve/i.test(documentText)
    details.push(/5,?880\.00/.test(documentText) && hasBackwaterWork
      ? 'Under-slab plumbing: $5,880.00, including the invoice\'s additional $500.00 for backwater-valve rough-in.'
      : hasBackwaterWork
        ? 'Under-slab plumbing with backwater-valve rough-in noted on the invoice.'
        : 'Under-slab plumbing.')
  }
  if (/water and sewer|water\s*&\s*sewer/i.test(documentText)) {
    details.push(/2,?100\.00/.test(documentText)
      ? 'Water and sewer connections: $2,100.00.'
      : 'Water and sewer connections are also included.')
  }
  const address = documentText.match(/(\d{3,6}\s+[A-Za-z0-9 .'-]+(?:Rd|Road|St|Street|Ave|Avenue|Dr|Drive|Ln|Lane))\s+(Lot\s+\d+(?:\s*[-–]\s*Units?\s+[0-9 &]+)?)/i)
  if (address) details.push(`Job: ${address[1].trim()}, ${address[2].trim()}.`)
  return details.join('\n')
}

const checkMemoForCost = (name, details, attachment, lot) => {
  const reference = String(attachment?.reference || '').trim()
    || String(details || '').match(/(?:Reference|Invoice(?:\s+(?:number|no\.?|#))?)\s*:\s*([^\n]+)/i)?.[1]?.trim()
  return [reference ? `Inv ${reference}` : '', name, lot].filter(Boolean).join(' · ').slice(0, 100)
}

const validateCostDocument = (file) => {
  if (!file) return 'Choose a file before uploading.'
  const supportedType = file.type.startsWith('image/') || file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  if (!supportedType) return 'Upload an image or PDF invoice. Other file types are not supported.'
  if (file.size > 10 * 1024 * 1024) return 'The invoice file is too large. Choose a file smaller than 10 MB.'
  return ''
}

function CostPage({ owners, developmentCosts, breakdownCosts = [], costVersions, constructionDrafts = [], projectChecks = [], lotCommitments = [], activeProjectId = null, projectName = 'Project', initialParentCostId = null, initialEditCostId = null, onBack, onAddDevelopmentCost, onEditDevelopmentCost, onDeleteDevelopmentCost, onUploadDocument, onAttachDocument, onOpenDocument, onCreateCheck, onMergeBreakdowns, onAddItemsToGroup, onUnmergeGroup, onSaveConstructionDraft, onConvertConstructionDraft, sharedDevelopmentCostTotal = 0 }) {
  const getDefaultOwnerId = (ownerList) => {
    const normalized = (value) => value?.toLowerCase().replace(/\s+/g, '').trim()
    const greenfortOwner = (ownerList || []).find((owner) => {
      const name = normalized(owner.name)
      return name === 'greenfort' || name.includes('greenfort')
    })

    return greenfortOwner?.id ?? ownerList?.[0]?.id ?? null
  }

  const initialParentCost = developmentCosts.find((cost) => cost.costId === initialParentCostId)
  const [costName, setCostName] = useState('')
  const [costDetails, setCostDetails] = useState('')
  const [costAmount, setCostAmount] = useState('')
  const [costDate, setCostDate] = useState(() => initialParentCost?.date || '')
  const [selectedOwnerId, setSelectedOwnerId] = useState(() => initialParentCost?.ownerId ?? getDefaultOwnerId(owners))
  const [costPhase, setCostPhase] = useState(() => initialParentCost?.phase || 'development')
  const [costCategory, setCostCategory] = useState(() => initialParentCost?.category || '')
  const [vendorName, setVendorName] = useState(() => initialParentCost?.vendorName || '')
  const [mainCategory, setMainCategory] = useState(() => initialParentCost?.mainCategory || '')
  const [subcategory, setSubcategory] = useState(() => initialParentCost?.subcategory || '')
  const [payerType, setPayerType] = useState(() => initialParentCost?.payerType || 'owner')
  const [payerOwnerId, setPayerOwnerId] = useState(() => initialParentCost?.payerOwnerId || initialParentCost?.ownerId || getDefaultOwnerId(owners))
  const [payerName, setPayerName] = useState(() => initialParentCost?.payerName || '')
  const [paymentSource, setPaymentSource] = useState(() => initialParentCost?.paymentSource || '')
  const [referenceNumber, setReferenceNumber] = useState(() => initialParentCost?.referenceNumber || '')
  const [reimbursable, setReimbursable] = useState(() => Boolean(initialParentCost?.reimbursable))
  const [loanRelated, setLoanRelated] = useState(() => Boolean(initialParentCost?.loanRelated))
  const [costNotes, setCostNotes] = useState(() => initialParentCost?.notes || '')
  const [recurringFrequency, setRecurringFrequency] = useState(() => initialParentCost?.recurringFrequency || '')
  const [isSoftCostParent, setIsSoftCostParent] = useState(() => Boolean(initialParentCost?.isSoftCostParent))
  const [costLot, setCostLot] = useState('')
  const [sharedLotAmounts, setSharedLotAmounts] = useState({})
  const [attachments, setAttachments] = useState([])
  const [pendingReceipt, setPendingReceipt] = useState(null)
  const [uploadingReceipt, setUploadingReceipt] = useState(false)
  const [analyzingReceipt, setAnalyzingReceipt] = useState(false)
  const [receiptAnalysisMissing, setReceiptAnalysisMissing] = useState([])
  const [receiptAnalyzed, setReceiptAnalyzed] = useState(false)
  const [lastAnalyzedReceiptId, setLastAnalyzedReceiptId] = useState(null)
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState('')
  const [uploadStatus, setUploadStatus] = useState(() => initialParentCost ? `Adding a breakdown inside ${initialParentCost.name}` : '')
  const [formError, setFormError] = useState('')
  const [editingCostId, setEditingCostId] = useState(null)
  const [parentCostId, setParentCostId] = useState(() => initialParentCost?.costId || null)
  const [costEntryType, setCostEntryType] = useState(() => initialParentCost ? 'breakdown' : 'cost')
  const [pendingDeleteCostId, setPendingDeleteCostId] = useState(null)
  const [showVersionHistory, setShowVersionHistory] = useState(false)
  const [breakdownSort, setBreakdownSort] = useState('added_desc')
  const [expandedBreakdownIds, setExpandedBreakdownIds] = useState(() => new Set())
  const [expandedAttachmentIds, setExpandedAttachmentIds] = useState(() => new Set())
  const [attachingCostId, setAttachingCostId] = useState(null)
  const [selectedBreakdownIds, setSelectedBreakdownIds] = useState(() => new Set())
  const [selectedLedgerCostIds, setSelectedLedgerCostIds] = useState(() => new Set())
  const [ledgerMergeName, setLedgerMergeName] = useState('')
  const [mergingLedgerCosts, setMergingLedgerCosts] = useState(false)
  const [mergeName, setMergeName] = useState('')
  const [mergingBreakdowns, setMergingBreakdowns] = useState(false)
  const [addingToGroupId, setAddingToGroupId] = useState(null)
  const [groupItemIds, setGroupItemIds] = useState(() => new Set())
  const [pendingUnmergeGroupId, setPendingUnmergeGroupId] = useState(null)
  const [updatingGroup, setUpdatingGroup] = useState(false)
  const [savingCost, setSavingCost] = useState(false)
  const [sourceDraftId, setSourceDraftId] = useState(null)
  const [constructionDraftId, setConstructionDraftId] = useState(() => initialParentCost?.constructionDraftId || '')
  const [paymentMethod, setPaymentMethod] = useState('')
  const [paymentFeePercentage, setPaymentFeePercentage] = useState('')
  const [paymentDate, setPaymentDate] = useState('')
  const [costSearch, setCostSearch] = useState('')
  const [costPhaseFilter, setCostPhaseFilter] = useState('all')
  const [costOwnerFilter, setCostOwnerFilter] = useState('all')
  const [costCategoryFilter, setCostCategoryFilter] = useState('all')
  const [costMainCategoryFilter, setCostMainCategoryFilter] = useState('all')
  const [costPayerFilter, setCostPayerFilter] = useState('all')
  const [costReimbursableFilter, setCostReimbursableFilter] = useState('all')
  const [costLoanFilter, setCostLoanFilter] = useState('all')
  const [costJobFilter, setCostJobFilter] = useState('all')
  const [costLotFilter, setCostLotFilter] = useState('all')
  const [costPaymentFilter, setCostPaymentFilter] = useState('all')
  const [costPaymentStatusFilter, setCostPaymentStatusFilter] = useState('all')
  const [costDatePreset, setCostDatePreset] = useState('all')
  const [costDateFrom, setCostDateFrom] = useState('')
  const [costDateTo, setCostDateTo] = useState('')
  const [costAnalysisView, setCostAnalysisView] = useState('lot')
  const [costAnalysisSort, setCostAnalysisSort] = useState('amount_desc')
  const [costListView, setCostListView] = useState('detailed')
  const [costCardOrder, setCostCardOrder] = useState('added_desc')
  const [costDateOrder, setCostDateOrder] = useState('desc')
  const [showFilteredReport, setShowFilteredReport] = useState(false)
  const [editorExpanded, setEditorExpanded] = useState(() => Boolean(initialParentCost || initialEditCostId || developmentCosts.length === 0))
  const costEditorRef = useRef(null)
  const costNameInputRef = useRef(null)
  const costListRef = useRef(null)
  const historyRef = useRef(null)
  const filteredReportRef = useRef(null)
  const initialEditAppliedRef = useRef(false)

  useEffect(() => {
    const closeOpenMenus = (event) => {
      let closedMenu = false
      document.querySelectorAll('.cost-overflow-menu[open]').forEach((menu) => {
        if (!event || !menu.contains(event.target)) {
          menu.removeAttribute('open')
          closedMenu = true
        }
      })
      if (closedMenu) setPendingDeleteCostId(null)
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') closeOpenMenus()
    }
    document.addEventListener('pointerdown', closeOpenMenus)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', closeOpenMenus)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const ownerOptions = useMemo(() => owners || [], [owners])
  const lotOptions = useMemo(() => [...new Set([
    ...DEFAULT_COST_LOTS,
    ...(lotCommitments || []).map((entry) => entry.lot).filter(Boolean),
  ])], [lotCommitments])
  const allocationLotOptions = useMemo(() => lotOptions.filter((lot) => /^Lot\s+\d+$/i.test(lot)), [lotOptions])
  const currentPaymentAmounts = paymentAmounts(costAmount, paymentMethod, paymentFeePercentage)
  const rebalanceSharedAllocations = (nextTotal) => {
    if (costLot !== 'Shared') return
    const selectedLots = allocationLotOptions.filter((lot) => Number(sharedLotAmounts[lot] || 0) > 0)
    const lotsToSplit = selectedLots.length ? selectedLots : allocationLotOptions
    setSharedLotAmounts(splitAmountEvenly(nextTotal, lotsToSplit))
  }
  const changeCostAmount = (nextAmount) => {
    rebalanceSharedAllocations(paymentAmounts(nextAmount, paymentMethod, paymentFeePercentage).total)
    setCostAmount(nextAmount)
  }
  const changePaymentMethod = (nextMethod) => {
    const nextFeePercentage = isCreditCardPayment(nextMethod)
      ? (paymentFeePercentage === '' ? DEFAULT_CARD_FEE_PERCENTAGE : paymentFeePercentage)
      : ''
    rebalanceSharedAllocations(paymentAmounts(costAmount, nextMethod, nextFeePercentage).total)
    setPaymentMethod(nextMethod)
    setPaymentFeePercentage(nextFeePercentage)
  }
  const changePaymentFeePercentage = (nextPercentage) => {
    rebalanceSharedAllocations(paymentAmounts(costAmount, paymentMethod, nextPercentage).total)
    setPaymentFeePercentage(nextPercentage)
  }
  const availableParentCosts = useMemo(
    () => developmentCosts.filter((cost) => cost.costId !== editingCostId),
    [developmentCosts, editingCostId],
  )
  const categoryFilterOptions = useMemo(() => [...new Set([
    ...COST_CATEGORIES,
    ...developmentCosts.map((cost) => cost.category).filter(Boolean),
    ...breakdownCosts.map((cost) => cost.category).filter(Boolean),
  ])].sort(), [breakdownCosts, developmentCosts])

  const originalAddedDates = useMemo(() => {
    const dates = new Map()
    ;(costVersions || []).forEach((cost) => {
      if (!cost.createdAt) return
      const key = String(cost.costId ?? cost.id)
      const current = dates.get(key)
      if (!current || String(cost.createdAt) < current) dates.set(key, String(cost.createdAt))
    })
    return dates
  }, [costVersions])

  const addedDateFor = useCallback((cost) => (
    originalAddedDates.get(String(cost.costId ?? cost.id)) || cost.createdAt || ''
  ), [originalAddedDates])

  const checksForCost = useCallback((costId) => projectChecks.filter((check) => check.costId === costId && check.checkType !== 'internal_transfer'), [projectChecks])
  const paymentStateForCost = useCallback((cost) => {
    const stateFor = (currentCost, visited = new Set()) => {
      const costId = String(currentCost.costId ?? currentCost.id)
      const linkedChecks = checksForCost(currentCost.costId)
      const activeChecks = linkedChecks.filter((check) => check.status !== 'voided')
      const printedChecks = activeChecks.filter((check) => check.status === 'printed')
      const voidedChecks = linkedChecks.filter((check) => check.status === 'voided')
      const directlyPaid = printedChecks.length > 0
        || (Boolean(currentCost.paymentDate) && (!isCheckPayment(currentCost.paymentMethod) || linkedChecks.length === 0))
      if (directlyPaid || visited.has(costId)) {
        return { paid: directlyPaid, paidByBreakdowns: false, activeChecks, printedChecks, voidedChecks }
      }

      const children = breakdownCosts.filter((entry) => String(entry.parentCostId) === costId)
      const childTotalCents = children.reduce((sum, entry) => sum + Math.round(Number(entry.amount || 0) * 100), 0)
      const fullyBrokenDown = children.length > 0 && childTotalCents === Math.round(Number(currentCost.amount || 0) * 100)
      const nextVisited = new Set(visited).add(costId)
      const paidByBreakdowns = fullyBrokenDown && children.every((child) => stateFor(child, nextVisited).paid)
      return { paid: paidByBreakdowns, paidByBreakdowns, activeChecks, printedChecks, voidedChecks }
    }
    return stateFor(cost)
  }, [breakdownCosts, checksForCost])

  const matchesAdditionalCostFilters = useCallback((cost) => {
    const allocations = cost.lotAllocations || []
    const allocatedAmount = allocations.reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
    const matchesCategory = costCategoryFilter === 'all'
      || (costCategoryFilter === 'uncategorized' ? !cost.category : cost.category === costCategoryFilter)
    const matchesMainCategory = costMainCategoryFilter === 'all' || inferMainCostCategory(cost) === costMainCategoryFilter
    const matchesPayer = costPayerFilter === 'all'
      || (costPayerFilter.startsWith('owner:')
        ? (cost.payerType === 'owner' || !cost.payerType) && String(cost.payerOwnerId || cost.ownerId) === costPayerFilter.slice(6)
        : cost.payerType === costPayerFilter)
    const matchesReimbursable = costReimbursableFilter === 'all' || Boolean(cost.reimbursable) === (costReimbursableFilter === 'yes')
    const matchesLoan = costLoanFilter === 'all' || Boolean(cost.loanRelated || cost.payerType === 'construction_loan') === (costLoanFilter === 'yes')
    const matchesJob = costJobFilter === 'all'
      || (costJobFilter === 'unmapped' ? !cost.constructionDraftId : String(cost.constructionDraftId || '') === costJobFilter)
    const matchesLot = costLotFilter === 'all'
      || (costLotFilter === 'unassigned'
        ? !allocations.length || allocatedAmount < Number(cost.amount || 0) - 0.009
        : allocations.some((entry) => entry.lot === costLotFilter))
    const matchesPayment = costPaymentFilter === 'all'
      || (costPaymentFilter === 'unspecified' ? !cost.paymentMethod : cost.paymentMethod === costPaymentFilter)
    const costIsPaid = paymentStateForCost(cost).paid
    const matchesPaymentStatus = costPaymentStatusFilter === 'all'
      || (costPaymentStatusFilter === 'paid' ? costIsPaid : !costIsPaid)
    return matchesCategory && matchesMainCategory && matchesPayer && matchesReimbursable && matchesLoan && matchesJob && matchesLot && matchesPayment && matchesPaymentStatus
  }, [costCategoryFilter, costJobFilter, costLoanFilter, costLotFilter, costMainCategoryFilter, costPayerFilter, costPaymentFilter, costPaymentStatusFilter, costReimbursableFilter, paymentStateForCost])

  const filteredDevelopmentCosts = useMemo(() => {
    const search = costSearch.trim().toLowerCase()
    return developmentCosts.filter((cost) => {
      const owner = ownerOptions.find((entry) => entry.id === cost.ownerId)
      const childText = breakdownCosts.filter((entry) => entry.parentCostId === cost.costId).map((entry) => (
        `${entry.name} ${entry.details || ''} ${entry.category || ''} ${phaseLabel(entry.phase)} ${entry.date || ''} ${costAllocationLabel(entry)}`
      )).join(' ')
      const job = constructionDrafts.find((draft) => String(draft.id) === String(cost.constructionDraftId || ''))
      const matchesSearch = !search || `${cost.name} ${cost.vendorName || ''} ${cost.details || ''} ${cost.notes || ''} ${owner?.name || ''} ${cost.mainCategory || ''} ${cost.subcategory || ''} ${cost.category || ''} ${payerLabel(cost, ownerOptions)} ${cost.referenceNumber || ''} ${phaseLabel(cost.phase)} ${paymentMethodLabel(cost.paymentMethod)} ${job?.name || ''} ${cost.date || ''} ${addedDateFor(cost)} ${costAllocationLabel(cost)} ${cost.amount || ''} ${childText}`.toLowerCase().includes(search)
      const matchesPhase = costPhaseFilter === 'all' || cost.phase === costPhaseFilter
      const matchesOwner = costOwnerFilter === 'all' || String(cost.ownerId) === costOwnerFilter
      const matchesDate = (!costDateFrom || String(cost.date || '') >= costDateFrom)
        && (!costDateTo || String(cost.date || '') <= costDateTo)
      return matchesSearch && matchesPhase && matchesOwner && matchesDate && matchesAdditionalCostFilters(cost)
    }).sort((a, b) => {
      const invoiceOrder = costCardOrder.startsWith('invoice_')
      const dateFor = (cost) => String(invoiceOrder ? cost.date || addedDateFor(cost) || '' : addedDateFor(cost) || cost.date || '')
      const comparison = dateFor(a).localeCompare(dateFor(b))
      if (comparison !== 0) return costCardOrder.endsWith('_asc') ? comparison : -comparison
      return String(a.name || '').localeCompare(String(b.name || ''))
    })
  }, [addedDateFor, breakdownCosts, constructionDrafts, costCardOrder, costDateFrom, costDateTo, costOwnerFilter, costPhaseFilter, costSearch, developmentCosts, matchesAdditionalCostFilters, ownerOptions])

  const dateOrderedCosts = useMemo(() => {
    const search = costSearch.trim().toLowerCase()
    return [...developmentCosts, ...breakdownCosts]
      .filter((cost) => {
        const owner = ownerOptions.find((entry) => entry.id === cost.ownerId)
        const parent = developmentCosts.find((entry) => entry.costId === cost.parentCostId)
        const searchable = `${cost.name} ${cost.vendorName || ''} ${cost.details || ''} ${cost.notes || ''} ${owner?.name || ''} ${cost.mainCategory || ''} ${cost.subcategory || ''} ${cost.category || ''} ${payerLabel(cost, ownerOptions)} ${cost.referenceNumber || ''} ${phaseLabel(cost.phase)} ${cost.date || ''} ${addedDateFor(cost)} ${costAllocationLabel(cost)} ${cost.amount || ''} ${parent?.name || ''}`.toLowerCase()
        return (!search || searchable.includes(search))
          && (costPhaseFilter === 'all' || cost.phase === costPhaseFilter)
          && (costOwnerFilter === 'all' || String(cost.ownerId) === costOwnerFilter)
          && (!costDateFrom || String(cost.date || '') >= costDateFrom)
          && (!costDateTo || String(cost.date || '') <= costDateTo)
          && matchesAdditionalCostFilters(cost)
      })
      .sort((a, b) => {
        if (!a.date && b.date) return 1
        if (a.date && !b.date) return -1
        const comparison = String(a.date || '').localeCompare(String(b.date || ''))
        if (comparison !== 0) return costDateOrder === 'asc' ? comparison : -comparison
        return String(a.name || '').localeCompare(String(b.name || ''))
      })
  }, [addedDateFor, breakdownCosts, costDateFrom, costDateOrder, costDateTo, costOwnerFilter, costPhaseFilter, costSearch, developmentCosts, matchesAdditionalCostFilters, ownerOptions])

  const ledgerVisibleDateCosts = useMemo(() => {
    const breakdownIds = new Set(breakdownCosts.map((cost) => cost.costId))
    return dateOrderedCosts.filter((cost) => !cost.parentCostId || !breakdownIds.has(cost.parentCostId))
  }, [breakdownCosts, dateOrderedCosts])

  const filteredPhaseSummary = useMemo(() => {
    const parentTotal = filteredDevelopmentCosts.reduce((sum, cost) => sum + Number(cost.amount || 0), 0)
    const detailRows = ledgerVisibleDateCosts.filter((cost) => cost.parentCostId)
    const leafDetailTotal = detailRows.reduce((sum, cost) => sum + Number(cost.amount || 0), 0)
    const byOwner = filteredDevelopmentCosts.reduce((totals, cost) => {
      const owner = ownerOptions.find((entry) => entry.id === cost.ownerId)
      const key = owner?.name || 'Owner not assigned'
      totals[key] = Number(totals[key] || 0) + Number(cost.amount || 0)
      return totals
    }, {})
    return {
      parentTotal,
      parentCount: filteredDevelopmentCosts.length,
      detailCount: detailRows.length,
      leafDetailTotal,
      byOwner: Object.entries(byOwner).sort((a, b) => b[1] - a[1]),
    }
  }, [filteredDevelopmentCosts, ledgerVisibleDateCosts, ownerOptions])

  const filteredReportFilters = useMemo(() => {
    const labelFor = (items, value, fallback) => items.find((item) => String(item.value) === String(value))?.label || fallback
    return [
      costSearch ? ['Search', costSearch] : null,
      ['Phase', costPhaseFilter === 'all' ? 'All phases' : phaseLabel(costPhaseFilter)],
      ['Owner', costOwnerFilter === 'all' ? 'All owners' : ownerOptions.find((owner) => String(owner.id) === costOwnerFilter)?.name || 'Selected owner'],
      ['Category', costCategoryFilter === 'all' ? 'All categories' : costCategoryFilter === 'uncategorized' ? 'Uncategorized' : costCategoryFilter],
      ['Main category', costMainCategoryFilter === 'all' ? 'All main categories' : costMainCategoryFilter],
      ['Payer', costPayerFilter === 'all' ? 'All payers' : costPayerFilter.startsWith('owner:') ? ownerOptions.find((owner) => String(owner.id) === costPayerFilter.slice(6))?.name || 'Selected owner' : ({ company: 'Green Fort LLC', construction_loan: 'Construction Loan', other_company: 'Other Company', third_party: 'Other / Third Party' }[costPayerFilter] || costPayerFilter)],
      ['Reimbursable', costReimbursableFilter === 'all' ? 'All' : costReimbursableFilter === 'yes' ? 'Yes' : 'No'],
      ['Loan related', costLoanFilter === 'all' ? 'All' : costLoanFilter === 'yes' ? 'Yes' : 'No'],
      ['Job', costJobFilter === 'all' ? 'All jobs' : costJobFilter === 'unmapped' ? 'Unmapped job' : constructionDrafts.find((draft) => String(draft.id) === costJobFilter)?.name || 'Selected job'],
      ['Lot', costLotFilter === 'all' ? 'All lots' : costLotFilter === 'unassigned' ? 'Unassigned lot' : costLotFilter],
      ['Payment', costPaymentFilter === 'all' ? 'All payment methods' : costPaymentFilter === 'unspecified' ? 'Not specified' : paymentMethodLabel(costPaymentFilter)],
      ['Payment status', labelFor([{ value: 'all', label: 'All statuses' }, { value: 'paid', label: 'Paid' }, { value: 'unpaid', label: 'Unpaid' }], costPaymentStatusFilter, 'All statuses')],
      costDateFrom ? ['From invoice date', costDateFrom] : null,
      costDateTo ? ['Through invoice date', costDateTo] : null,
    ].filter(Boolean)
  }, [constructionDrafts, costCategoryFilter, costDateFrom, costDateTo, costJobFilter, costLoanFilter, costLotFilter, costMainCategoryFilter, costOwnerFilter, costPayerFilter, costPaymentFilter, costPaymentStatusFilter, costPhaseFilter, costReimbursableFilter, costSearch, ownerOptions])

  const filteredReportRows = useMemo(() => {
    const childrenByParent = new Map()
    breakdownCosts.forEach((cost) => {
      const key = String(cost.parentCostId || '')
      if (!childrenByParent.has(key)) childrenByParent.set(key, [])
      childrenByParent.get(key).push(cost)
    })
    const leavesFor = (costId, seen = new Set()) => {
      if (seen.has(String(costId))) return []
      const nextSeen = new Set(seen).add(String(costId))
      return (childrenByParent.get(String(costId)) || []).flatMap((cost) => (
        childrenByParent.has(String(cost.costId)) ? leavesFor(cost.costId, nextSeen) : [cost]
      ))
    }
    return filteredDevelopmentCosts.flatMap((parent) => [
      { ...parent, reportLevel: 'parent', parentName: '' },
      ...leavesFor(parent.costId).map((cost) => ({ ...cost, reportLevel: 'detail', parentName: parent.name })),
    ])
  }, [breakdownCosts, filteredDevelopmentCosts])

  const exportFilteredReport = () => {
    const rows = [
      ['Filtered cost ledger', projectName],
      ['Created', new Date().toLocaleDateString('en-US')],
      ...filteredReportFilters.map(([name, value]) => [`Filter: ${name}`, value]),
      ['Accounting total', filteredPhaseSummary.parentTotal.toFixed(2)],
      [],
      ['Row type', 'Invoice date', 'Added date', 'Vendor / Payee', 'Cost / detail', 'Parent cost', 'Attribution', 'Payer / funding source', 'Phase', 'Main category', 'Subcategory', 'Detailed category', 'Lot allocation', 'Payment source', 'Payment method', 'Reference', 'Reimbursable', 'Loan related', 'Payment status', 'Amount'],
      ...filteredReportRows.map((cost) => [
        cost.reportLevel === 'parent' ? 'Accounting cost' : 'Supporting breakdown', cost.date || '', displayDate(addedDateFor(cost), ''), cost.vendorName || '', cost.name, cost.parentName,
        ownerOptions.find((owner) => String(owner.id) === String(cost.ownerId))?.name || '', payerLabel(cost, ownerOptions), phaseLabel(cost.phase), inferMainCostCategory(cost), cost.subcategory || '', cost.category || 'Uncategorized',
        (cost.lotAllocations || []).map((entry) => `${entry.lot}: ${Number(entry.amount || 0).toFixed(2)}`).join('; ') || 'Unassigned',
        cost.paymentSource || '', paymentMethodLabel(cost.paymentMethod) || 'Not specified', cost.referenceNumber || '', cost.reimbursable ? 'Yes' : 'No', cost.loanRelated ? 'Yes' : 'No', paymentStateForCost(cost).paid ? 'Paid' : 'Unpaid', Number(cost.amount || 0).toFixed(2),
      ]),
    ]
    const blob = new Blob([rows.map((row) => row.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${String(projectName || 'project').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-filtered-cost-ledger.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const printFilteredReport = () => {
    const node = filteredReportRef.current
    const printWindow = window.open('', '_blank')
    if (!node || !printWindow) return
    printWindow.opener = null
    printWindow.document.title = `${projectName} – Filtered Cost Ledger`
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((sheet) => printWindow.document.head.appendChild(sheet.cloneNode(true)))
    const root = printWindow.document.createElement('div')
    root.className = 'print-filtered-cost-report'
    root.appendChild(node.cloneNode(true))
    printWindow.document.body.appendChild(root)
    printWindow.setTimeout(() => { printWindow.focus(); printWindow.print() }, 250)
  }

  const selectedLedgerCosts = useMemo(() => breakdownCosts.filter((cost) => selectedLedgerCostIds.has(cost.costId)), [breakdownCosts, selectedLedgerCostIds])
  const selectedLedgerTotal = selectedLedgerCosts.reduce((sum, cost) => sum + Number(cost.amount || 0), 0)

  const toggleLedgerCostSelection = (costId) => setSelectedLedgerCostIds((current) => {
    const next = new Set(current)
    if (next.has(costId)) next.delete(costId)
    else next.add(costId)
    return next
  })

  const handleMergeLedgerCosts = async () => {
    if (!ledgerMergeName.trim()) {
      setFormError('Enter a ledger group name before merging.')
      return
    }
    if (!onMergeBreakdowns) {
      setFormError('Ledger merging is unavailable. Sign in and try again.')
      return
    }
    const groups = Object.entries(selectedLedgerCosts.reduce((byParent, cost) => {
      if (!byParent[cost.parentCostId]) byParent[cost.parentCostId] = []
      byParent[cost.parentCostId].push(cost.costId)
      return byParent
    }, {}))
    if (selectedLedgerCosts.some((cost) => cost.phase !== 'development')) {
      setFormError('Only Development-phase breakdowns can be merged in the Development ledger.')
      return
    }
    if (!groups.length || groups.some(([, costIds]) => costIds.length < 2)) {
      setFormError('Select at least two ungrouped breakdowns under each Kemal, Banu, or Green Fort parent you include.')
      return
    }
    setMergingLedgerCosts(true)
    setFormError('')
    try {
      for (const [parentCostId, costIds] of groups) {
        await onMergeBreakdowns(parentCostId, costIds, ledgerMergeName.trim())
      }
      setSelectedLedgerCostIds(new Set())
      setLedgerMergeName('')
      setUploadStatus(`${selectedLedgerCosts.length} development costs merged into ${groups.length} non-duplicating ledger group${groups.length === 1 ? '' : 's'}.`)
    } catch (error) {
      setFormError(`The ledger costs could not be merged: ${error?.message || error?.details || 'Unknown error'}`)
    } finally {
      setMergingLedgerCosts(false)
    }
  }

  useEffect(() => {
    if (!ownerOptions.length) {
      return
    }

    setSelectedOwnerId((current) => {
      const currentOwnerExists = ownerOptions.some((owner) => owner.id === current)
      return currentOwnerExists ? current : getDefaultOwnerId(ownerOptions)
    })
  }, [ownerOptions])

  const costAnalysis = useMemo(() => {
    const byLot = new Map(lotOptions.map((lot) => [lot, 0]))
    const byLotCount = new Map(lotOptions.map((lot) => [lot, 0]))
    const byLotLatestDate = new Map(lotOptions.map((lot) => [lot, '']))
    const byCategory = new Map()
    const byCategoryCount = new Map()
    const byCategoryLatestDate = new Map()
    const categoryMatrix = new Map()
    let unassigned = 0
    let unassignedCount = 0

    developmentCosts.forEach((cost) => {
      const amount = Number(cost.amount || 0)
      const category = cost.category || 'Uncategorized'
      byCategory.set(category, Number(byCategory.get(category) || 0) + amount)
      byCategoryCount.set(category, Number(byCategoryCount.get(category) || 0) + 1)
      if (String(cost.date || '') > String(byCategoryLatestDate.get(category) || '')) byCategoryLatestDate.set(category, cost.date)
      if (!categoryMatrix.has(category)) {
        categoryMatrix.set(category, {
          name: category,
          byLot: Object.fromEntries(lotOptions.map((lot) => [lot, 0])),
          unassigned: 0,
          total: 0,
        })
      }
      const matrixRow = categoryMatrix.get(category)
      matrixRow.total += amount
      const allocations = cost.lotAllocations || []
      const allocated = allocations.reduce((sum, entry) => {
        const allocationAmount = Number(entry.amount || 0)
        byLot.set(entry.lot, Number(byLot.get(entry.lot) || 0) + allocationAmount)
        byLotCount.set(entry.lot, Number(byLotCount.get(entry.lot) || 0) + 1)
        if (String(cost.date || '') > String(byLotLatestDate.get(entry.lot) || '')) byLotLatestDate.set(entry.lot, cost.date)
        matrixRow.byLot[entry.lot] = Number(matrixRow.byLot[entry.lot] || 0) + allocationAmount
        return sum + allocationAmount
      }, 0)
      const unassignedAmount = Math.max(0, amount - allocated)
      matrixRow.unassigned += unassignedAmount
      unassigned += unassignedAmount
      if (unassignedAmount > 0) unassignedCount += 1
    })

    const total = developmentCosts.reduce((sum, cost) => sum + Number(cost.amount || 0), 0)
    return {
      total,
      assigned: Math.max(0, total - unassigned),
      count: developmentCosts.length,
      byLot: [...byLot.entries()].map(([name, amount]) => ({ name, amount, count: byLotCount.get(name) || 0, latestDate: byLotLatestDate.get(name) || '' })).filter((entry) => entry.amount > 0),
      byCategory: [...byCategory.entries()].map(([name, amount]) => ({ name, amount, count: byCategoryCount.get(name) || 0, latestDate: byCategoryLatestDate.get(name) || '' })),
      matrix: [...categoryMatrix.values()].sort((a, b) => b.total - a.total),
      unassigned,
      unassignedCount,
    }
  }, [developmentCosts, lotOptions])

  const sortedCostAnalysisEntries = useMemo(() => {
    const entries = [...(costAnalysisView === 'lot' ? costAnalysis.byLot : costAnalysis.byCategory)]
    return entries.sort((a, b) => {
      if (costAnalysisSort === 'amount_asc') return a.amount - b.amount
      if (costAnalysisSort === 'name_asc') return a.name.localeCompare(b.name)
      if (costAnalysisSort === 'name_desc') return b.name.localeCompare(a.name)
      if (costAnalysisSort === 'date_desc') return String(b.latestDate || '').localeCompare(String(a.latestDate || '')) || b.amount - a.amount
      if (costAnalysisSort === 'date_asc') return String(a.latestDate || '9999').localeCompare(String(b.latestDate || '9999')) || b.amount - a.amount
      return b.amount - a.amount
    })
  }, [costAnalysis.byCategory, costAnalysis.byLot, costAnalysisSort, costAnalysisView])

  const sortedVersions = useMemo(() => {
    return [...(costVersions || [])].sort((a, b) => {
      const costComparison = String(a.costId ?? a.id).localeCompare(String(b.costId ?? b.id))
      return costComparison === 0 ? Number(b.version || 1) - Number(a.version || 1) : costComparison
    })
  }, [costVersions])

  const sortBreakdowns = (items) => [...items].sort((a, b) => {
    const nameComparison = String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' })
    if (breakdownSort === 'added_desc' || breakdownSort === 'added_asc') {
      const addedComparison = String(addedDateFor(a) || a.date || '').localeCompare(String(addedDateFor(b) || b.date || ''))
      return (breakdownSort === 'added_asc' ? addedComparison : -addedComparison) || nameComparison
    }
    if (breakdownSort === 'amount_desc') return Number(b.amount || 0) - Number(a.amount || 0) || nameComparison
    if (breakdownSort === 'amount_asc') return Number(a.amount || 0) - Number(b.amount || 0) || nameComparison
    if (breakdownSort === 'date_desc' || breakdownSort === 'date_asc') {
      if (!a.date && b.date) return 1
      if (a.date && !b.date) return -1
      const dateComparison = String(a.date || '').localeCompare(String(b.date || ''))
      return (breakdownSort === 'date_asc' ? dateComparison : -dateComparison) || nameComparison
    }
    return breakdownSort === 'name_desc' ? -nameComparison : nameComparison
  })

  const handleBreakdownSortChange = (nextSort) => {
    setBreakdownSort(nextSort)
    setExpandedBreakdownIds((current) => {
      const next = new Set(current)
      developmentCosts.forEach((cost) => {
        if (breakdownCosts.some((entry) => entry.parentCostId === cost.costId)) next.add(cost.costId)
      })
      return next
    })
  }

  const toggleBreakdowns = (costId) => {
    setExpandedBreakdownIds((current) => {
      const next = new Set(current)
      if (next.has(costId)) next.delete(costId)
      else next.add(costId)
      return next
    })
  }

  const toggleAttachments = (costId) => setExpandedAttachmentIds((current) => {
    const next = new Set(current)
    if (next.has(costId)) next.delete(costId)
    else next.add(costId)
    return next
  })

  const selectedBreakdownParentId = useMemo(() => {
    const [selectedId] = selectedBreakdownIds
    return breakdownCosts.find((cost) => cost.costId === selectedId)?.parentCostId || null
  }, [breakdownCosts, selectedBreakdownIds])

  const toggleBreakdownSelection = (breakdown, parent) => {
    const removing = selectedBreakdownIds.has(breakdown.costId)
    if (removing && selectedBreakdownIds.size === 1) setMergeName('')
    if (!removing && selectedBreakdownParentId !== parent.costId) {
      setMergeName(`${parent.name} merged breakdown`)
    }
    setSelectedBreakdownIds((current) => {
      const next = new Set(current)
      if (next.has(breakdown.costId)) {
        next.delete(breakdown.costId)
      } else {
        next.add(breakdown.costId)
      }
      return next
    })
  }

  const handleMergeSelected = async (parent) => {
    const selectedIds = [...selectedBreakdownIds].filter((costId) => breakdownCosts.some((cost) => (
      cost.costId === costId && cost.parentCostId === parent.costId
    )))
    if (selectedIds.length < 2) {
      setFormError('Select at least two breakdowns under the same parent.')
      return
    }
    if (!mergeName.trim()) {
      setFormError('Enter a name for the merged breakdown.')
      return
    }
    if (!onMergeBreakdowns) {
      setFormError('Breakdown merging is not available. Sign in and try again.')
      return
    }
    setMergingBreakdowns(true)
    setFormError('')
    try {
      await onMergeBreakdowns(parent.costId, selectedIds, mergeName.trim())
      setSelectedBreakdownIds(new Set())
      setMergeName('')
      setUploadStatus(`${selectedIds.length} breakdowns merged into ${mergeName.trim()}`)
    } catch (error) {
      setFormError(`The breakdowns could not be merged: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setMergingBreakdowns(false)
    }
  }

  const toggleGroupItemSelection = (costId) => {
    setGroupItemIds((current) => {
      const next = new Set(current)
      if (next.has(costId)) next.delete(costId)
      else next.add(costId)
      return next
    })
  }

  const handleAddSelectedToGroup = async (group) => {
    const selectedIds = [...groupItemIds]
    if (!selectedIds.length) {
      setFormError('Select at least one breakdown to add to this group.')
      return
    }
    if (!onAddItemsToGroup) {
      setFormError('Changing breakdown groups is not available. Sign in and try again.')
      return
    }
    setUpdatingGroup(true)
    setFormError('')
    try {
      await onAddItemsToGroup(group.costId, selectedIds)
      setAddingToGroupId(null)
      setGroupItemIds(new Set())
      setUploadStatus(`${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'} added to ${group.name}`)
    } catch (error) {
      setFormError(`The items could not be added: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setUpdatingGroup(false)
    }
  }

  const handleUnmergeGroup = async (group) => {
    if (!onUnmergeGroup) {
      setFormError('Unmerging breakdown groups is not available. Sign in and try again.')
      return
    }
    setUpdatingGroup(true)
    setFormError('')
    try {
      await onUnmergeGroup(group.costId)
      setPendingUnmergeGroupId(null)
      setAddingToGroupId(null)
      setGroupItemIds(new Set())
      setUploadStatus(`${group.name} was unmerged. Its individual items are still available.`)
    } catch (error) {
      setFormError(`The group could not be unmerged: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setUpdatingGroup(false)
    }
  }

  const revealEditor = () => {
    setEditorExpanded(true)
    costEditorRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    costNameInputRef.current?.focus({ preventScroll: true })
    window.setTimeout(() => {
      costEditorRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
      costNameInputRef.current?.focus({ preventScroll: true })
    }, 0)
  }

  const resetReceiptWorkflow = () => {
    setPendingReceipt(null)
    setUploadingReceipt(false)
    setAnalyzingReceipt(false)
    setReceiptAnalysisMissing([])
    setReceiptAnalyzed(false)
    setLastAnalyzedReceiptId(null)
    setReceiptPreviewUrl('')
  }

  useEffect(() => () => {
    if (receiptPreviewUrl) URL.revokeObjectURL(receiptPreviewUrl)
  }, [receiptPreviewUrl])

  const handlePreviewAnalyzedReceipt = () => {
    if (!pendingReceipt?.file) return
    setReceiptPreviewUrl(URL.createObjectURL(pendingReceipt.file))
  }

  const handlePreviewFormAttachment = (attachment) => {
    if (pendingReceipt?.file && String(attachment.id || attachment.documentId) === String(pendingReceipt.attachmentId)) {
      setReceiptPreviewUrl(URL.createObjectURL(pendingReceipt.file))
      return
    }
    handleOpenAttachment(attachment)
  }

  const handleAddCost = async (event) => {
    event?.preventDefault()
    if (savingCost) return
    const createCheckAfterSave = event?.nativeEvent?.submitter?.value === 'save_and_create_check'
    if (!costName.trim()) {
      setFormError('Enter a cost name before saving.')
      return
    }
    const amount = Number(costAmount)
    if (costAmount === '' || !Number.isFinite(amount) || amount <= 0) {
      setFormError('Enter a valid cost amount greater than 0.')
      return
    }
    if (!costDate) {
      setFormError('Select the date when the cost occurred.')
      return
    }
    if (selectedOwnerId == null) {
      setFormError('Add and select an owner before saving the cost.')
      return
    }
    if (costEntryType === 'breakdown' && !parentCostId) {
      setFormError('Select the parent cost that this breakdown belongs to.')
      return
    }
    const cardFeePercentage = paymentFeePercentage === '' ? null : Number(paymentFeePercentage)
    if (isCreditCardPayment(paymentMethod) && cardFeePercentage != null && (!Number.isFinite(cardFeePercentage) || cardFeePercentage < 0 || cardFeePercentage > 100)) {
      setFormError('Enter a valid card fee percentage from 0 to 100.')
      return
    }
    const paymentFeeAmount = isCreditCardPayment(paymentMethod) && cardFeePercentage != null
      ? Math.round(amount * cardFeePercentage) / 100
      : 0
    const totalCostAmount = Math.round((amount + paymentFeeAmount) * 100) / 100

    let lotAllocations = []
    if (costLot === 'Shared') {
      lotAllocations = allocationLotOptions.map((lot) => ({ lot, amount: Number(sharedLotAmounts[lot] || 0) })).filter((entry) => entry.amount > 0)
      const allocated = lotAllocations.reduce((sum, entry) => sum + entry.amount, 0)
      if (!lotAllocations.length || Math.abs(allocated - totalCostAmount) > 0.009) {
        const selectedLots = lotAllocations.map((entry) => entry.lot)
        const lotsToSplit = selectedLots.length ? selectedLots : allocationLotOptions
        const evenAmounts = splitAmountEvenly(totalCostAmount, lotsToSplit)
        lotAllocations = lotsToSplit.map((lot) => ({ lot, amount: Number(evenAmounts[lot]) }))
        setSharedLotAmounts(evenAmounts)
      }
    } else if (costLot) {
      lotAllocations = [{ lot: costLot, amount: totalCostAmount }]
    }

    const payload = {
      name: costName.trim(),
      details: costDetails.trim(),
      constructionDraftId: costPhase === 'construction' ? (constructionDraftId || null) : null,
      paymentMethod: paymentMethod || null,
      paymentFeePercentage: isCreditCardPayment(paymentMethod) ? cardFeePercentage : null,
      paymentFeeAmount: paymentFeeAmount || null,
      paymentDate: paymentDate || null,
      invoiceAmount: amount,
      amount: totalCostAmount,
      ownerId: selectedOwnerId,
      phase: isSoftCostParent && costEntryType === 'cost' ? 'soft_cost' : costPhase,
      category: costCategory,
      vendorName: vendorName.trim(),
      mainCategory: isSoftCostParent && costEntryType === 'cost' ? 'Soft / Development Costs' : mainCategory,
      subcategory: isSoftCostParent && costEntryType === 'cost' ? '' : subcategory,
      payerType,
      payerOwnerId: payerType === 'owner' ? payerOwnerId : null,
      payerName: ['other_company', 'third_party'].includes(payerType) ? payerName.trim() : '',
      paymentSource: paymentSource.trim(),
      referenceNumber: referenceNumber.trim(),
      reimbursable,
      loanRelated,
      notes: costNotes.trim(),
      recurringFrequency,
      isSoftCostParent: costEntryType === 'cost' && isSoftCostParent,
      lotAllocations,
      date: costDate,
      attachments,
      parentCostId: costEntryType === 'breakdown' ? parentCostId : null,
    }

    const wasEditing = Boolean(editingCostId)
    setSavingCost(true)
    try {
      let savedCost
      if (editingCostId) {
        savedCost = await onEditDevelopmentCost({ costId: editingCostId, ...payload })
      } else {
        savedCost = await onAddDevelopmentCost(payload)
      }
      if (sourceDraftId && savedCost?.costId && onConvertConstructionDraft) {
        await onConvertConstructionDraft(sourceDraftId, savedCost.costId)
      }
      if (createCheckAfterSave && onCreateCheck) {
        const analyzedAttachment = attachments.find((attachment) => attachment.vendor || attachment.reference || attachment.vendorMailingAddress)
        const checkLot = costLot && costLot !== 'Shared' ? costLot : null
        onCreateCheck({
          costId: savedCost?.costId || editingCostId || null,
          payee: analyzedAttachment?.vendor || costName.trim(),
          amount: savedCost?.amount ?? totalCostAmount,
          memo: checkMemoForCost(costName.trim(), costDetails, analyzedAttachment, checkLot),
          mailingAddress: analyzedAttachment?.vendorMailingAddress || '',
          lot: checkLot,
          ...checkBankDetails(paymentMethod),
        })
      }
    } catch (error) {
      setFormError(`The cost could not be saved: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return
    } finally {
      setSavingCost(false)
    }

    setCostName('')
    setCostDetails('')
    setCostAmount('')
    setCostDate('')
    setCostCategory('')
    setVendorName('')
    setMainCategory('')
    setSubcategory('')
    setPayerType('owner')
    setPayerOwnerId(getDefaultOwnerId(owners))
    setPayerName('')
    setPaymentSource('')
    setReferenceNumber('')
    setReimbursable(false)
    setLoanRelated(false)
    setCostNotes('')
    setRecurringFrequency('')
    setIsSoftCostParent(false)
    setConstructionDraftId('')
    setPaymentMethod('')
    setPaymentFeePercentage('')
    setPaymentDate('')
    setCostLot('')
    setSharedLotAmounts({})
    setAttachments([])
    resetReceiptWorkflow()
    setEditingCostId(null)
    setParentCostId(null)
    setCostEntryType('cost')
    setSourceDraftId(null)
    setFormError('')
    setUploadStatus(wasEditing ? 'New cost version saved to Supabase' : 'Cost saved to Supabase')
    setEditorExpanded(false)
  }

  const handleStartEdit = (cost) => {
    setEditingCostId(cost.costId)
    setCostName(cost.name)
    setCostDetails(cost.details || '')
    setCostAmount(String(cost.invoiceAmount ?? (cost.paymentFeePercentage != null
      ? Math.round((Number(cost.amount) / (1 + Number(cost.paymentFeePercentage) / 100)) * 100) / 100
      : cost.amount)))
    setCostDate(cost.date || '')
    setSelectedOwnerId(cost.ownerId)
    setCostPhase(cost.phase || 'development')
    setCostCategory(cost.category || '')
    setVendorName(cost.vendorName || '')
    setMainCategory(cost.mainCategory || inferMainCostCategory(cost))
    setSubcategory(cost.subcategory || '')
    setPayerType(cost.payerType || 'owner')
    setPayerOwnerId(cost.payerOwnerId || cost.ownerId || getDefaultOwnerId(owners))
    setPayerName(cost.payerName || '')
    setPaymentSource(cost.paymentSource || '')
    setReferenceNumber(cost.referenceNumber || '')
    setReimbursable(Boolean(cost.reimbursable))
    setLoanRelated(Boolean(cost.loanRelated))
    setCostNotes(cost.notes || '')
    setRecurringFrequency(cost.recurringFrequency || '')
    setIsSoftCostParent(Boolean(cost.isSoftCostParent))
    setConstructionDraftId(cost.constructionDraftId || '')
    setPaymentMethod(cost.paymentMethod || '')
    setPaymentFeePercentage(cost.paymentFeePercentage == null
      ? (isCreditCardPayment(cost.paymentMethod) ? DEFAULT_CARD_FEE_PERCENTAGE : '')
      : String(cost.paymentFeePercentage))
    setPaymentDate(cost.paymentDate || '')
    const existingAllocations = cost.lotAllocations || []
    const isSingleLot = existingAllocations.length === 1 && Number(existingAllocations[0].amount) === Number(cost.amount)
    setCostLot(isSingleLot ? existingAllocations[0].lot : (existingAllocations.length ? 'Shared' : ''))
    setSharedLotAmounts(Object.fromEntries(existingAllocations.map((entry) => [entry.lot, entry.amount])))
    setAttachments(cost.attachments || [])
    resetReceiptWorkflow()
    setParentCostId(cost.parentCostId || null)
    setCostEntryType(cost.parentCostId ? 'breakdown' : 'cost')
    setSourceDraftId(null)
    setFormError('')
    setUploadStatus(`Editing ${cost.name} · version ${cost.version}`)
    revealEditor()
  }

  useEffect(() => {
    if (!initialEditCostId || initialEditAppliedRef.current) return
    const cost = [...developmentCosts, ...breakdownCosts].find((entry) => entry.costId === initialEditCostId)
    if (!cost) return
    initialEditAppliedRef.current = true
    handleStartEdit(cost)
  }, [initialEditCostId, developmentCosts, breakdownCosts])

  const handleStartBreakdown = (parentCost) => {
    setEditingCostId(null)
    setParentCostId(parentCost.costId)
    setCostEntryType('breakdown')
    setSourceDraftId(null)
    setCostName('')
    setCostDetails('')
    setCostAmount('')
    setCostDate(parentCost.date || '')
    setSelectedOwnerId(parentCost.ownerId)
    setCostPhase(parentCost.phase || 'development')
    setCostCategory(parentCost.category || '')
    setVendorName('')
    setMainCategory(parentCost.mainCategory || inferMainCostCategory(parentCost))
    setSubcategory(parentCost.subcategory || '')
    setPayerType(parentCost.payerType || 'owner')
    setPayerOwnerId(parentCost.payerOwnerId || parentCost.ownerId || getDefaultOwnerId(owners))
    setPayerName(parentCost.payerName || '')
    setPaymentSource('')
    setReferenceNumber('')
    setReimbursable(Boolean(parentCost.reimbursable))
    setLoanRelated(Boolean(parentCost.loanRelated))
    setCostNotes('')
    setRecurringFrequency('')
    setIsSoftCostParent(false)
    setConstructionDraftId(parentCost.constructionDraftId || '')
    setPaymentMethod('')
    setPaymentFeePercentage('')
    setPaymentDate('')
    const parentAllocations = parentCost.lotAllocations || []
    const parentSingleLot = parentAllocations.length === 1 && Number(parentAllocations[0].amount) === Number(parentCost.amount)
    setCostLot(parentSingleLot ? parentAllocations[0].lot : '')
    setSharedLotAmounts({})
    setAttachments([])
    resetReceiptWorkflow()
    setFormError('')
    setUploadStatus(`Adding a breakdown inside ${parentCost.name}`)
    revealEditor()
  }

  const handleCancelEdit = () => {
    setEditingCostId(null)
    setCostName('')
    setCostDetails('')
    setCostAmount('')
    setCostDate('')
    setCostCategory('')
    setVendorName('')
    setMainCategory('')
    setSubcategory('')
    setPayerType('owner')
    setPayerOwnerId(getDefaultOwnerId(owners))
    setPayerName('')
    setPaymentSource('')
    setReferenceNumber('')
    setReimbursable(false)
    setLoanRelated(false)
    setCostNotes('')
    setRecurringFrequency('')
    setIsSoftCostParent(false)
    setConstructionDraftId('')
    setPaymentMethod('')
    setPaymentFeePercentage('')
    setPaymentDate('')
    setCostLot('')
    setSharedLotAmounts({})
    setAttachments([])
    resetReceiptWorkflow()
    setParentCostId(null)
    setCostEntryType('cost')
    setSourceDraftId(null)
    setUploadStatus('Edit cancelled')
    setFormError('')
    setEditorExpanded(false)
  }

  const handleStartNewCost = () => {
    handleCancelEdit()
    setUploadStatus('Ready to add a new top-level cost')
    revealEditor()
  }

  const handleShowHistory = () => {
    setShowVersionHistory(true)
    historyRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }

  const handleUseConstructionDraft = (draft) => {
    setEditingCostId(null)
    setSourceDraftId(draft.id)
    setParentCostId(null)
    setCostEntryType('cost')
    setCostName(draft.name)
    setCostDetails(draft.details || '')
    setCostAmount(draft.plannedAmount == null ? '' : String(draft.plannedAmount))
    setCostDate(draft.plannedDate || '')
    setCostPhase('construction')
    setMainCategory('Construction Costs')
    setIsSoftCostParent(false)
    setSubcategory(COST_SUBCATEGORIES['Construction Costs'].find((option) => option.toLowerCase() === String(draft.name || '').toLowerCase()) || '')
    setConstructionDraftId(draft.id)
    setPaymentMethod('')
    setPaymentFeePercentage('')
    setPaymentDate('')
    setAttachments(draft.attachments || [])
    resetReceiptWorkflow()
    setFormError('')
    setUploadStatus(`Creating a construction cost from the ${draft.name} draft. Enter the actual amount and date before saving.`)
    revealEditor()
  }

  const applyParentCost = (nextParentId) => {
    const parent = developmentCosts.find((cost) => cost.costId === nextParentId)
    setParentCostId(nextParentId || null)
    if (!parent) return
    setSelectedOwnerId(parent.ownerId)
    setCostPhase(parent.phase || 'development')
    setCostCategory(parent.category || '')
    setMainCategory(parent.mainCategory || inferMainCostCategory(parent))
    setSubcategory(parent.subcategory || '')
    setIsSoftCostParent(false)
    setCostDate(parent.date || '')
  }

  const handleEntryTypeChange = (nextType) => {
    setCostEntryType(nextType)
    setFormError('')
    if (nextType === 'cost') {
      setParentCostId(null)
      return
    }
    if (!availableParentCosts.length) {
      setParentCostId(null)
      setFormError('Add a parent cost before creating a breakdown.')
      return
    }
    applyParentCost(parentCostId && availableParentCosts.some((cost) => cost.costId === parentCostId)
      ? parentCostId
      : availableParentCosts[0].costId)
  }

  const handleConfirmDelete = async (costId) => {
    try {
      await onDeleteDevelopmentCost(costId)
      setPendingDeleteCostId(null)
      setUploadStatus('Cost soft deleted in Supabase; its version history was preserved')
    } catch (error) {
      setFormError(`The cost could not be deleted: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const processFormDocument = async (file) => {
    const fileError = validateCostDocument(file)
    if (fileError) {
      setFormError(fileError)
      return
    }

    setFormError('')
    setUploadingReceipt(true)
    setReceiptAnalyzed(false)
    setReceiptAnalysisMissing([])
    let storedDocument = null
    try {
      storedDocument = onUploadDocument ? await onUploadDocument(file) : null
    } catch (error) {
      setFormError(`The document could not be uploaded: ${error instanceof Error ? error.message : 'Unknown error'}`)
      setUploadingReceipt(false)
      return
    }

    try {
      const attachmentId = storedDocument?.documentId || `pending-${Date.now()}`
      const newAttachment = {
        id: attachmentId,
        name: file.name,
        vendor: '',
        amount: 0,
        date: '',
        description: 'Receipt uploaded; analysis pending',
        ...(storedDocument || {}),
      }

      setAttachments((current) => [newAttachment, ...current])
      setPendingReceipt({ file, attachmentId })
      setUploadStatus(`${file.name} uploaded. Choose Analyze receipt to fill the cost fields.`)
    } catch (error) {
      setFormError(`The attachment could not be prepared: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setUploadingReceipt(false)
    }
  }

  const handleAnalyzeReceipt = async () => {
    if (!pendingReceipt?.file || analyzingReceipt) return
    setAnalyzingReceipt(true)
    setFormError('')
    try {
      const documentText = await extractPdfDocumentText(pendingReceipt.file).catch(() => '')
      const localStatement = extractStatementFromText(documentText)
      const extracted = localStatement || await extractTransactionFromImage(
        pendingReceipt.file,
        projectName,
        activeProjectId,
        { knownLots: lotOptions },
      )
      const extractedAmount = Number(extracted.amount)
      const extractedDate = typeof extracted.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(extracted.date)
        ? extracted.date
        : ''
      const providenceLoan = identifyProvidenceLoan(documentText, extracted)
      const extractedName = receiptCostName(extracted, documentText)
      const extractedVendorMailingAddress = String(extracted.vendorMailingAddress || '').trim() || extractVendorMailingAddressFromText(documentText)
      const originalExtractedName = String(extracted.costName || '').trim()
      const extractedLotLines = Array.isArray(extracted.lotAllocations) && extracted.lotAllocations.length > 1
        ? extracted.lotAllocations
        : lotLinesFromDocumentText(documentText, allocationLotOptions)
      const extractedDetails = [
        extracted.details,
        extractedLotLines.length > 1
          ? `Lot line amounts before shared tax/fees: ${extractedLotLines.map((entry) => `${entry.lot} ${currency.format(Number(entry.amount) || 0)}`).join(' · ')}.`
          : '',
        invoiceScopeDetails(documentText),
        originalExtractedName && originalExtractedName !== extractedName ? originalExtractedName : '',
        extracted.description && extracted.description !== extractedName ? extracted.description : '',
        extracted.reference ? `Reference: ${extracted.reference}` : '',
        providenceLoan ? `${providenceLoan.reference} / Note ID ${providenceLoan.noteId} mapped to ${providenceLoan.lot}.` : '',
        extracted.notes,
      ].map((value) => String(value || '').trim()).filter((value, index, values) => value && values.indexOf(value) === index).join('\n')
      const underSlabPlumbing = isUnderSlabPlumbing(extracted, documentText)
      const extractedPhase = providenceLoan
        ? 'soft_cost'
        : underSlabPlumbing
        ? 'construction'
        : ['development', 'construction', 'soft_cost', 'other'].includes(extracted.phase) ? extracted.phase
        : ''
      const extractedCategory = providenceLoan
        ? 'Financing costs'
        : underSlabPlumbing
        ? 'Plumbing'
        : COST_CATEGORIES.find((category) => category.toLowerCase() === String(extracted.category || '').toLowerCase()) || ''
      const extractedLot = providenceLoan?.lot || receiptLot(extracted, lotOptions, documentText)
      const extractedPayment = String(extracted.paymentMethod || '').toLowerCase()
      const paymentEvidence = `${extractedPayment} ${documentText} ${JSON.stringify(extracted)}`
      const detectedPaymentBank = providenceLoan || /providence\s*bank/i.test(paymentEvidence)
        ? 'providence'
        : /bank\s*of\s*america|\bbofa\b/i.test(paymentEvidence) ? 'bofa' : ''
      const nextPaymentMethod = /amex|american express/.test(extractedPayment) ? 'amex_business'
        : /kemal.*personal|personal.*kemal/.test(extractedPayment) ? 'kemal_personal_bank'
          : /banu.*personal|personal.*banu/.test(extractedPayment) ? 'banu_personal_bank'
        : /check/.test(extractedPayment) ? (detectedPaymentBank ? `${detectedPaymentBank}_check` : 'check')
          : /ach|bank|wire|transfer/.test(extractedPayment) ? (detectedPaymentBank ? `${detectedPaymentBank}_ach` : 'bank_transfer')
            : /debit/.test(extractedPayment) ? 'debit_card'
              : /cash/.test(extractedPayment) ? 'cash'
                : /credit|card/.test(extractedPayment) ? 'other_credit_card'
                  : providenceLoan ? 'providence_ach' : ''
      const jobSearchText = `${extractedName} ${extractedCategory} ${extracted.description || ''}`.toLowerCase()
      const matchedJob = constructionDrafts.find((draft) => {
        const jobName = String(draft.name || '').toLowerCase().replace(/\s+job$/, '')
        return jobName.length > 2 && jobSearchText.includes(jobName)
      })
      const replacesPriorAnalysis = lastAnalyzedReceiptId != null && lastAnalyzedReceiptId !== pendingReceipt.attachmentId
      const readableAmount = Number.isFinite(extractedAmount) && extractedAmount > 0 ? String(extractedAmount) : ''
      const nextName = replacesPriorAnalysis ? extractedName : costName.trim() || extractedName
      const nextAmount = replacesPriorAnalysis ? readableAmount : costAmount !== '' ? costAmount : readableAmount
      const nextDate = replacesPriorAnalysis ? extractedDate : costDate || extractedDate
      const analyzedAllocations = allocateInvoiceTotalByLot(extractedLotLines, Number(nextAmount), allocationLotOptions)

      if (replacesPriorAnalysis) {
        setVendorName(extracted.vendor || '')
        setCostName(extractedName)
        setCostDetails(extractedDetails)
        setCostAmount(readableAmount)
        setCostDate(extractedDate)
        setCostPhase(extractedPhase || 'development')
        setCostCategory(extractedCategory)
        setConstructionDraftId(matchedJob?.id || '')
        setPaymentMethod(nextPaymentMethod)
        setPaymentDate(/^\d{4}-\d{2}-\d{2}$/.test(String(extracted.paymentDate || '')) ? extracted.paymentDate : '')
        setPaymentFeePercentage(isCreditCardPayment(nextPaymentMethod)
          ? String(extracted.paymentFeePercentage ?? DEFAULT_CARD_FEE_PERCENTAGE)
          : (extracted.paymentFeePercentage != null && Number.isFinite(Number(extracted.paymentFeePercentage)) ? String(extracted.paymentFeePercentage) : ''))
      } else {
        if (!vendorName.trim() && extracted.vendor) setVendorName(extracted.vendor)
        if (!costName.trim() && extractedName) setCostName(extractedName)
        if (!costDetails.trim() && extractedDetails) setCostDetails(extractedDetails)
        if (costAmount === '' && nextAmount) setCostAmount(nextAmount)
        if (!costDate && extractedDate) setCostDate(extractedDate)
        if (extractedPhase) setCostPhase(extractedPhase)
        if (!costCategory && extractedCategory) setCostCategory(extractedCategory)
        if (!constructionDraftId && matchedJob) setConstructionDraftId(matchedJob.id)
        if (!paymentMethod && nextPaymentMethod) {
          setPaymentMethod(nextPaymentMethod)
          if (isCreditCardPayment(nextPaymentMethod) && paymentFeePercentage === '') {
            setPaymentFeePercentage(extracted.paymentFeePercentage == null ? DEFAULT_CARD_FEE_PERCENTAGE : String(extracted.paymentFeePercentage))
          }
        }
        if (!paymentDate && /^\d{4}-\d{2}-\d{2}$/.test(String(extracted.paymentDate || ''))) setPaymentDate(extracted.paymentDate)
        if (paymentFeePercentage === '' && extracted.paymentFeePercentage != null && Number.isFinite(Number(extracted.paymentFeePercentage))) setPaymentFeePercentage(String(extracted.paymentFeePercentage))
      }
      if (extractedCategory === 'Legal / attorney fees' && (replacesPriorAnalysis || !costCategory)) {
        setMainCategory('Legal & Professional Fees')
        setSubcategory('Attorney Fees')
      }
      if (analyzedAllocations.length > 1) {
        setCostLot('Shared')
        setSharedLotAmounts(Object.fromEntries(analyzedAllocations.map((entry) => [entry.lot, entry.amount.toFixed(2)])))
      } else if (replacesPriorAnalysis) {
        setCostLot(extractedLot || '')
        setSharedLotAmounts({})
      } else if (!costLot && extractedLot) {
        setCostLot(extractedLot)
      }

      const missing = []
      if (!nextName) missing.push('cost name')
      if (!nextAmount) missing.push('amount')
      if (!nextDate) missing.push('invoice date')
      if (selectedOwnerId == null) missing.push('owner')
      setReceiptAnalysisMissing(missing)
      setReceiptAnalyzed(true)
      setLastAnalyzedReceiptId(pendingReceipt.attachmentId)
      setAttachments((current) => current.map((attachment) => attachment.id === pendingReceipt.attachmentId ? {
        ...attachment,
        vendor: extracted.vendor || '',
        amount: Number.isFinite(extractedAmount) ? extractedAmount : 0,
        date: extractedDate,
        description: extracted.description || 'Analyzed receipt',
        reference: extracted.reference || '',
        vendorMailingAddress: extractedVendorMailingAddress,
        notes: extracted.notes || '',
        details: extracted.details || '',
        paymentMethod: extracted.paymentMethod || '',
        lotAllocations: analyzedAllocations,
      } : attachment))
      setUploadStatus(missing.length
        ? `Receipt analyzed. Add the missing required fields: ${missing.join(', ')}.`
        : analyzedAllocations.length > 1
          ? `Receipt analyzed and split across ${analyzedAllocations.length} lots. Review the proportional tax/fee allocation before saving.`
          : 'Receipt analyzed. All required cost fields are ready for review.')
    } catch (error) {
      setReceiptAnalyzed(true)
      setReceiptAnalysisMissing([
        ...(!costName.trim() ? ['cost name'] : []),
        ...(costAmount === '' ? ['amount'] : []),
        ...(!costDate ? ['invoice date'] : []),
        ...(selectedOwnerId == null ? ['owner'] : []),
      ])
      setFormError(`The receipt could not be analyzed: ${error instanceof Error ? error.message : 'Enter the fields manually.'}`)
    } finally {
      setAnalyzingReceipt(false)
    }
  }

  const handleImageUpload = async (event) => {
    const [file] = Array.from(event.target.files || [])
    await processFormDocument(file)
    event.target.value = ''
  }

  const handleFormDrop = async (event) => {
    event.preventDefault()
    const [file] = Array.from(event.dataTransfer.files || [])
    await processFormDocument(file)
  }

  const handleDirectDocument = async (cost, file) => {
    const fileError = validateCostDocument(file)
    if (fileError) {
      setFormError(fileError)
      return
    }
    if (!onAttachDocument) {
      setFormError('Document storage is not available. Sign in and try again.')
      return
    }
    setAttachingCostId(cost.costId)
    setFormError('')
    try {
      await onAttachDocument(cost, file)
      setUploadStatus(`${file.name} attached to ${cost.name} and saved as a new version`)
    } catch (error) {
      setFormError(`The document could not be attached: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setAttachingCostId(null)
    }
  }

  const handleOpenAttachment = async (attachment) => {
    if (!onOpenDocument) return
    try {
      await onOpenDocument(attachment)
    } catch (error) {
      setFormError(`The attachment could not be opened: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  const renderAttachmentArea = (cost) => {
    const expanded = expandedAttachmentIds.has(cost.costId)
    const count = cost.attachments?.length || 0
    return <div className={`cost-attachments-control${expanded ? ' expanded' : ''}`}>
      <button
        type="button"
        className="cost-attachments-summary"
        aria-expanded={expanded}
        aria-controls={`cost-attachments-${cost.costId}`}
        onClick={() => toggleAttachments(cost.costId)}
      >
        Attachments ({count})
        <span className="cost-control-chevron" aria-hidden="true">{expanded ? '▴' : '▾'}</span>
      </button>
      {expanded ? <div
        id={`cost-attachments-${cost.costId}`}
        className="cost-attachment-area"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          const [file] = Array.from(event.dataTransfer.files || [])
          handleDirectDocument(cost, file)
        }}
      >
        <span className={attachingCostId === cost.costId ? 'loading-indicator' : undefined}>{attachingCostId === cost.costId ? <><span className="spinner" aria-hidden="true" />Uploading…</> : 'Drop PDF or image here'}</span>
        <label className="attachment-picker">
          Choose file
          <input
            className="file-input-hidden"
            type="file"
            aria-label={`Attach file to ${cost.name}`}
            accept="image/*,.pdf"
            disabled={attachingCostId === cost.costId}
            onChange={(event) => {
              const [file] = Array.from(event.target.files || [])
              handleDirectDocument(cost, file)
              event.target.value = ''
            }}
          />
        </label>
        {cost.attachments?.length ? <div className="attachment-list">
          {cost.attachments.map((attachment) => <button key={attachment.documentId || attachment.id || attachment.storagePath || attachment.name} type="button" onClick={() => handleOpenAttachment(attachment)}>
            Preview: {attachment.name || 'attachment'}
          </button>)}
        </div> : <small>No attachments yet</small>}
      </div> : null}
    </div>
  }

  const renderAttachedChecks = (costId) => {
    const attached = checksForCost(costId)
    return attached.length ? <div className="check-link-summary"><strong>Checks</strong>{attached.map((check) => <span className={check.status === 'voided' ? 'voided-check-link' : ''} key={check.id}>
      <span>#{check.checkNumber} · {currency.format(check.amount)} · {check.status}{check.status === 'voided' ? ' · does not count as paid' : ''}</span>
      {(check.payee || check.date || check.accountLabel || check.memo || check.lot) ? <small>{[check.payee, check.date, check.accountLabel, check.lot, check.memo].filter(Boolean).join(' · ')}</small> : null}
    </span>)}</div> : null
  }

  const renderPaymentRecords = (documents, checks, { showEmpty = false } = {}) => {
    const savedDocuments = (documents || []).filter((attachment) => attachment?.storagePath || attachment?.documentId || attachment?.id)
    if (!showEmpty && !savedDocuments.length && !checks.length) return null
    return <details className="cost-payment-records" aria-label="Invoices and check details">
      <summary className="cost-payment-records-heading">
        <div><strong>Invoices and payment records</strong><small>Documents and checks linked to this cost</small></div>
        <span>{savedDocuments.length} invoice{savedDocuments.length === 1 ? '' : 's'} · {checks.length} check{checks.length === 1 ? '' : 's'} <span className="cost-payment-chevron" aria-hidden="true">▾</span></span>
      </summary>
      <div className="cost-payment-records-grid">
        <div className="cost-payment-document-list">
          <strong>Invoices / receipts</strong>
          {savedDocuments.length ? savedDocuments.map((attachment) => <button
            key={attachment.documentId || attachment.id || attachment.storagePath || attachment.name}
            type="button"
            className="cost-payment-document"
            onClick={() => handleOpenAttachment(attachment)}
          >
            <span><strong>{attachment.name || attachment.originalName || 'Invoice document'}</strong><small>{[attachment.vendor, attachment.reference ? `Invoice ${attachment.reference}` : '', attachment.documentDate].filter(Boolean).join(' · ') || 'Stored document'}</small></span>
            <span>Preview</span>
          </button>) : <small>No invoice or receipt is attached to this cost.</small>}
        </div>
        <div className="cost-payment-check-list">
          <strong>Check details</strong>
          {checks.length ? checks.map((check) => <article className={check.status === 'voided' ? 'voided' : ''} key={check.id}>
            <div><strong>Check #{check.checkNumber}</strong><span>{check.payee || 'Payee not recorded'}{check.accountLabel ? ` · ${check.accountLabel}` : ''}</span></div>
            <strong>{currency.format(check.amount)}</strong>
            <div className="cost-payment-check-meta"><time dateTime={check.date || undefined}>{check.date || 'No check date'}</time><span className={`check-status ${check.status}`}>{check.status}</span>{check.lot ? <span>{check.lot}</span> : null}</div>
            {check.memo ? <p>{check.memo}</p> : null}
            {check.status === 'voided' ? <small>Voided check — excluded from paid totals.</small> : null}
          </article>) : <small>No check is linked to this cost.</small>}
        </div>
      </div>
    </details>
  }

  const handleCreateCheckForCost = (cost) => {
    if (!onCreateCheck) return
    const state = paymentStateForCost(cost)
    if (state.activeChecks.length) {
      setFormError(`This cost already has active check ${state.activeChecks.map((check) => `#${check.checkNumber}`).join(', ')}. Open Checks if you need to record an intentional partial payment.`)
      return
    }
    const analyzedAttachment = (cost.attachments || []).find((attachment) => attachment.vendor || attachment.reference || attachment.vendorMailingAddress)
    const allocations = cost.lotAllocations || []
    const checkLot = allocations.length === 1 ? allocations[0].lot : null
    onCreateCheck({
      costId: cost.costId,
      payee: analyzedAttachment?.vendor || cost.name,
      amount: cost.amount,
      memo: checkMemoForCost(cost.name, cost.details, analyzedAttachment, checkLot),
      mailingAddress: analyzedAttachment?.vendorMailingAddress || '',
      lot: checkLot,
      ...checkBankDetails(cost.paymentMethod),
    })
  }

  return (
    <div className="app-shell">
      <header className="hero-card">
        <div>
          <p className="eyebrow">Cost tracking</p>
          <h1>Project costs by phase</h1>
          <p className="hero-copy">Track development, construction, soft costs, and other spending separately with a clear audit history.</p>
        </div>
        <button type="button" className="action-button" onClick={onBack}>Back to dashboard</button>
      </header>

      <nav className="cost-page-nav" aria-label="Cost page sections">
        <button type="button" className="action-button" onClick={handleStartNewCost}>Add a cost</button>
        <button type="button" className="secondary-button" onClick={() => costListRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })}>View cost list</button>
        <button type="button" className="secondary-button" onClick={handleShowHistory}>View version history</button>
      </nav>

      {uploadStatus || formError ? (
        <div className={`cost-feedback${formError ? ' error' : ''}`} role={formError ? 'alert' : 'status'} aria-live="polite">
          <span>{formError || uploadStatus}</span>
          <button type="button" aria-label="Dismiss message" onClick={() => {
            setFormError('')
            setUploadStatus('')
          }}>×</button>
        </div>
      ) : null}

      <section className="section-grid">
        <div
          id="cost-editor"
          ref={costEditorRef}
          className={`panel cost-editor-panel${editingCostId ? ' is-editing' : ''}${editorExpanded ? ' is-expanded' : ' is-collapsed'}`}
        >
          <div className="panel-header">
            <div>
              <p className="eyebrow">{editingCostId ? 'Editing selected cost' : 'Add cost'}</p>
              <h2>{!editorExpanded ? 'Add a cost, invoice, or breakdown' : editingCostId
                ? (costEntryType === 'breakdown' ? 'Edit cost breakdown' : 'Edit project cost')
                : (costEntryType === 'breakdown' ? `New breakdown for ${developmentCosts.find((cost) => cost.costId === parentCostId)?.name || 'cost'}` : 'New project cost')}</h2>
              {!editorExpanded ? <p>Open the form only when you need to enter or upload a cost. Your ledger remains visible below.</p> : null}
            </div>
            <button type="button" className={editorExpanded ? 'secondary-button' : 'action-button'} aria-expanded={editorExpanded} aria-controls="cost-editor-form" onClick={() => {
              if (editorExpanded) setEditorExpanded(false)
              else handleStartNewCost()
            }}>{editorExpanded ? 'Collapse cost form' : 'Expand cost form'}</button>
          </div>
          <form id="cost-editor-form" className="owner-form" hidden={!editorExpanded} noValidate onSubmit={handleAddCost}>
            {editingCostId ? <p className="edit-context">Update the fields below, then choose <strong>Save new version</strong>.</p> : null}
            <section className="receipt-workflow" aria-labelledby="receipt-workflow-title">
              <div className="receipt-workflow-heading">
                <div>
                  <span className="receipt-step">Step 1</span>
                  <strong id="receipt-workflow-title">Upload a receipt or invoice</strong>
                  <small>PDF, photo, or scanned receipt up to 10 MB.</small>
                </div>
                <button type="button" className="action-button receipt-analyze-button" disabled={!pendingReceipt || uploadingReceipt || analyzingReceipt} onClick={handleAnalyzeReceipt}>
                  {analyzingReceipt ? 'Analyzing…' : 'Analyze receipt'}
                </button>
              </div>
              <div className="form-file-drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={handleFormDrop}>
                <strong>{uploadingReceipt ? 'Uploading receipt…' : 'Drop receipt, cost image, or PDF here'}</strong>
                <span>or choose a file, then select Analyze receipt</span>
                <input aria-label="Upload receipt, cost image, or PDF" type="file" accept="image/*,.pdf" disabled={uploadingReceipt || analyzingReceipt} onChange={handleImageUpload} />
                {pendingReceipt ? <small>Ready to analyze: {pendingReceipt.file.name}</small> : null}
                {attachments.length ? <small>Attached: {attachments.map((attachment) => attachment.name).join(', ')}</small> : null}
              </div>
              {attachments.length ? <div className="receipt-editor-attachments" aria-label="Attached receipts">
                <strong>{editingCostId ? 'Receipts attached to this cost' : 'Attached receipts'}</strong>
                <div className="attachment-list">
                  {attachments.map((attachment) => <button
                    key={attachment.documentId || attachment.id || attachment.storagePath || attachment.name}
                    type="button"
                    onClick={() => handlePreviewFormAttachment(attachment)}
                  >
                    Preview receipt: {attachment.name || 'attachment'}
                  </button>)}
                </div>
              </div> : null}
              {receiptAnalyzed ? (
                <div className={`receipt-analysis-result${receiptAnalysisMissing.length ? ' missing' : ' complete'}`} role="status">
                  <div>
                    <strong>{receiptAnalysisMissing.length ? 'Complete the highlighted information' : 'Receipt fields completed'}</strong>
                    <span>{receiptAnalysisMissing.length
                      ? `Please add: ${receiptAnalysisMissing.join(', ')}. Everything readable from the receipt is already filled below.`
                      : 'Review the populated fields below before saving the cost.'}</span>
                  </div>
                  <button type="button" className="secondary-button" onClick={handlePreviewAnalyzedReceipt}>Preview receipt</button>
                </div>
              ) : null}
            </section>
            <div className="cost-details-heading">
              <span className="receipt-step">Step 2</span>
              <div><strong>Review and complete cost details</strong><small>Fields the receipt could not provide stay editable.</small></div>
            </div>
            <label>
              Cost type
              <select aria-label="Cost type" value={costEntryType} onChange={(event) => handleEntryTypeChange(event.target.value)}>
                <option value="cost">Top-level cost</option>
                <option value="breakdown">Cost breakdown</option>
              </select>
            </label>
            {costEntryType === 'cost' ? <label className="soft-cost-parent-toggle">
              <input type="checkbox" aria-label="Use as Soft Cost parent" checked={isSoftCostParent} onChange={(event) => {
                const checked = event.target.checked
                setIsSoftCostParent(checked)
                if (checked) {
                  setCostPhase('soft_cost')
                  setMainCategory('Soft / Development Costs')
                  setSubcategory('')
                }
              }} />
              <span><strong>Use as Soft Cost parent</strong><small>Engineering, survey, permits, legal, and other soft costs can be added underneath as child breakdowns. The parent total is counted once.</small></span>
            </label> : null}
            {costEntryType === 'breakdown' ? (
              <label>
                Parent cost
                <select aria-label="Parent cost" value={parentCostId || ''} onChange={(event) => applyParentCost(event.target.value)}>
                  {availableParentCosts.length === 0 ? <option value="">No parent costs available</option> : null}
                  {availableParentCosts.map((parent) => {
                    const parentOwner = ownerOptions.find((owner) => owner.id === parent.ownerId)
                    return <option key={parent.costId} value={parent.costId}>{parent.name} — {parentOwner?.name || 'Owner'} — {currency.format(parent.amount)}</option>
                  })}
                </select>
              </label>
            ) : null}
            <label className={receiptAnalysisMissing.includes('cost name') ? 'receipt-missing-field' : undefined}>
              Description
              <input ref={costNameInputRef} aria-label="Cost name" required value={costName} onChange={(event) => setCostName(event.target.value)} />
            </label>
            <label>
              Vendor / payee
              <input aria-label="Vendor or payee" value={vendorName} onChange={(event) => setVendorName(event.target.value)} placeholder="Company or person paid" />
            </label>
            <label className="cost-details-field">
              Comments / receipt details
              <textarea aria-label="Cost comments or receipt details" rows="3" value={costDetails} onChange={(event) => setCostDetails(event.target.value)} placeholder="Line items, invoice number, payment notes, or other useful context" />
              <small>Receipt analysis adds useful document details here. Review or edit them before saving.</small>
            </label>
            <label className={receiptAnalysisMissing.includes('amount') ? 'receipt-missing-field' : undefined}>
              Invoice total
              <span className="currency-input">
                <span aria-hidden="true">$</span>
                <input aria-label="Cost amount" type="number" min="0.01" step="0.01" required value={costAmount} onChange={(event) => changeCostAmount(event.target.value)} />
              </span>
              <small>This always matches the invoice. Card fees are added separately below.</small>
            </label>
            <label className={receiptAnalysisMissing.includes('invoice date') ? 'receipt-missing-field' : undefined}>
              Invoice date
              <input aria-label="Invoice date" type="date" required value={costDate} onChange={(event) => setCostDate(event.target.value)} />
              <small>Historical dates are allowed, including costs from before the project was added. The added date is recorded separately when you save.</small>
            </label>
            <label>
              Phase
              <select aria-label="Cost phase" value={costPhase} onChange={(event) => {
                const nextPhase = event.target.value
                setCostPhase(nextPhase)
                if (costCategory === 'Legal / attorney fees') {
                  setMainCategory('Legal & Professional Fees')
                  setSubcategory('Attorney Fees')
                }
              }}>
                <option value="development">Development</option>
                <option value="construction">Construction</option>
                <option value="soft_cost">Soft Cost</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Main cost category
              <select aria-label="Main cost category" value={mainCategory} onChange={(event) => {
                setMainCategory(event.target.value)
                setSubcategory('')
              }}>
                <option value="">Choose main category…</option>
                {MAIN_COST_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
              <small>What the expense was for. This remains separate from who paid it.</small>
            </label>
            <label>
              Subcategory
              <select aria-label="Cost subcategory" value={subcategory} onChange={(event) => setSubcategory(event.target.value)} disabled={!mainCategory}>
                <option value="">Choose subcategory…</option>
                {(COST_SUBCATEGORIES[mainCategory] || []).map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label>
              Detailed / legacy category
              <select aria-label="Cost category" value={costCategory} onChange={(event) => {
                const nextCategory = event.target.value
                setCostCategory(nextCategory)
                if (nextCategory === 'Legal / attorney fees') {
                  setMainCategory('Legal & Professional Fees')
                  setSubcategory('Attorney Fees')
                }
                if (!constructionDraftId && costPhase === 'construction') {
                  const categoryKey = nextCategory.toLowerCase()
                  const matchedJob = constructionDrafts.find((draft) => String(draft.name || '').toLowerCase().replace(/\s+job$/, '') === categoryKey)
                  if (matchedJob) setConstructionDraftId(matchedJob.id)
                }
              }}>
                <option value="">Uncategorized</option>
                {COST_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </label>
            {costPhase === 'construction' ? <label>
              Construction job
              <select aria-label="Construction job" value={constructionDraftId} onChange={(event) => setConstructionDraftId(event.target.value)}>
                <option value="">Not mapped to a job</option>
                {constructionDrafts.map((draft) => <option key={draft.id} value={draft.id}>{draft.name}</option>)}
              </select>
              <small>Mapped receipts appear in Spending by Job.</small>
            </label> : null}
            <fieldset className="ledger-funding-fields">
              <legend>Payer assignment and funding details</legend>
              <label>
                Payer / funding source
                <select aria-label="Paid by" value={payerType} onChange={(event) => setPayerType(event.target.value)}>
                  <option value="owner">Owner</option>
                  <option value="company">Green Fort LLC</option>
                  <option value="construction_loan">Construction Loan</option>
                  <option value="other_company">Other Company</option>
                  <option value="third_party">Other / Third Party</option>
                </select>
              </label>
              {payerType === 'owner' ? <label>
                Paying owner
                <select aria-label="Paying owner" value={payerOwnerId ?? ''} onChange={(event) => setPayerOwnerId(event.target.value ? Number(event.target.value) : null)}>
                  <option value="">Choose owner…</option>
                  {ownerOptions.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
                </select>
              </label> : null}
              {['other_company', 'third_party'].includes(payerType) ? <label>
                Payer name
                <input aria-label="Payer name" value={payerName} onChange={(event) => setPayerName(event.target.value)} />
              </label> : null}
              <label>
                Payment source / account
                <input aria-label="Payment source" value={paymentSource} onChange={(event) => setPaymentSource(event.target.value)} placeholder="Bank/account, card, loan, or cash source" />
              </label>
              <label>
                Check / ACH / card / wire reference
                <input aria-label="Payment reference" value={referenceNumber} onChange={(event) => setReferenceNumber(event.target.value)} />
              </label>
              <label>
                Recurring expense
                <select aria-label="Recurring frequency" value={recurringFrequency} onChange={(event) => setRecurringFrequency(event.target.value)}>
                  <option value="">Not recurring</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option>
                </select>
              </label>
              <label className="ledger-boolean-field"><input type="checkbox" checked={reimbursable} onChange={(event) => setReimbursable(event.target.checked)} /><span>Reimbursable</span></label>
              <label className="ledger-boolean-field"><input type="checkbox" checked={loanRelated} onChange={(event) => setLoanRelated(event.target.checked)} /><span>Loan related / loan funded</span></label>
            </fieldset>
            <label>
              Payment method
              <select aria-label="Payment method" value={paymentMethod} onChange={(event) => changePaymentMethod(event.target.value)}>
                <option value="">Not specified</option>
                <option value="amex_business">Amex Business</option>
                <option value="providence_ach">Providence Bank ACH</option>
                <option value="bofa_ach">Bank of America ACH</option>
                <option value="kemal_personal_bank">Kemal Personal Bank Account</option>
                <option value="banu_personal_bank">Banu Personal Bank Account</option>
                <option value="providence_check">Providence Bank check</option>
                <option value="bofa_check">Bank of America check</option>
                <option value="bank_transfer">ACH / bank transfer — bank not specified</option>
                <option value="check">Check — bank not specified</option>
                <option value="other_credit_card">Other credit card</option>
                <option value="debit_card">Debit card</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
              </select>
            </label>
            {isCreditCardPayment(paymentMethod) ? <label>
              Card fee percentage
              <span className="percentage-input">
                <input aria-label="Card fee percentage" type="number" min="0" max="100" step="0.01" value={paymentFeePercentage} onChange={(event) => changePaymentFeePercentage(event.target.value)} />
                <span aria-hidden="true">%</span>
              </span>
              <small>{paymentFeePercentage !== '' && Number.isFinite(Number(paymentFeePercentage))
                ? `${Number(paymentFeePercentage).toFixed(2)}% of the invoice total.`
                : 'Enter the processing fee charged for this card payment.'}</small>
            </label> : null}
            {isCreditCardPayment(paymentMethod) && paymentFeePercentage !== '' ? <label>
              Card processing fee
              <output className="calculated-total-output" aria-label="Card processing fee">{currency.format(currentPaymentAmounts.fee)}</output>
              <small>Separate from the invoice total.</small>
            </label> : null}
            <label>
              Payment date (optional)
              <input aria-label="Payment date" type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
              <small>Leave blank until the invoice is paid.</small>
            </label>
            {(editingCostId || attachments.length) ? renderPaymentRecords(attachments, editingCostId ? checksForCost(editingCostId) : [], { showEmpty: true }) : null}
            {isCreditCardPayment(paymentMethod) && paymentFeePercentage !== '' ? <label>
              Total cost after card fee
              <output className="calculated-total-output" aria-label="Total cost after card fee">
                {currency.format(currentPaymentAmounts.total)}
              </output>
              <small>Invoice total plus one card fee. Switching to check removes this fee without changing the invoice total.</small>
            </label> : null}
            <label>
              Lot
              <select aria-label="Cost lot" value={costLot} onChange={(event) => {
                setCostLot(event.target.value)
                if (event.target.value !== 'Shared') setSharedLotAmounts({})
              }}>
                <option value="">Unassigned</option>
                {lotOptions.map((lot) => <option key={lot} value={lot}>{lot}</option>)}
                {allocationLotOptions.length > 1 ? <option value="Shared">Shared across lots</option> : null}
              </select>
            </label>
            {costLot === 'Shared' ? <fieldset className="lot-allocation-editor">
              <legend>Allocate {currency.format(Number(costAmount || 0) + (isCreditCardPayment(paymentMethod) && paymentFeePercentage !== '' ? Math.round(Number(costAmount || 0) * Number(paymentFeePercentage)) / 100 : 0))} across lots</legend>
              <button type="button" className="secondary-button lot-even-split-button" onClick={() => setSharedLotAmounts(splitAmountEvenly(Number(costAmount || 0) + (isCreditCardPayment(paymentMethod) && paymentFeePercentage !== '' ? Math.round(Number(costAmount || 0) * Number(paymentFeePercentage)) / 100 : 0), allocationLotOptions))}>Split evenly across {allocationLotOptions.length} lots</button>
              {allocationLotOptions.map((lot) => <label key={lot}>
                {lot}
                <input aria-label={`${lot} allocation`} type="number" min="0" step="0.01" value={sharedLotAmounts[lot] ?? ''} onChange={(event) => setSharedLotAmounts((current) => ({ ...current, [lot]: event.target.value }))} />
              </label>)}
            </fieldset> : null}
            <label className={receiptAnalysisMissing.includes('owner') ? 'receipt-missing-field' : undefined}>
              Owner / company attribution
              <select aria-label="Owner" value={selectedOwnerId ?? ''} onChange={(event) => setSelectedOwnerId(event.target.value ? Number(event.target.value) : null)}>
                {ownerOptions.length === 0 ? <option value="">Add an owner first</option> : null}
                {ownerOptions.map((owner) => (
                  <option key={owner.id} value={owner.id}>{owner.name}</option>
                ))}
              </select>
              <small>Who this cost belongs to. This can be different from who paid it.</small>
            </label>
            <label className="cost-details-field">
              Internal notes
              <textarea aria-label="Internal cost notes" rows="3" value={costNotes} onChange={(event) => setCostNotes(event.target.value)} placeholder="Reimbursement, loan, allocation, or follow-up notes" />
            </label>
            <div className="button-row">
              <button type="submit" className="action-button" disabled={savingCost}>{savingCost ? 'Saving…' : (editingCostId ? 'Save new version' : (costEntryType === 'breakdown' ? 'Add breakdown' : 'Add cost'))}</button>
              {isCheckPayment(paymentMethod) && onCreateCheck ? <button type="submit" name="cost-save-action" value="save_and_create_check" className="secondary-button" disabled={savingCost}>Save &amp; create check</button> : null}
              {editingCostId || costEntryType === 'breakdown' ? <button type="button" className="secondary-button" disabled={savingCost} onClick={handleCancelEdit}>Cancel</button> : null}
            </div>
          </form>
        </div>

        <div className="panel cost-analysis-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Cost analysis</p>
              <h2>All costs by lot and category</h2>
              <p>Top-level costs only; breakdowns are details and are not counted twice.</p>
            </div>
            <strong className="cost-analysis-grand-total">{currency.format(costAnalysis.total)}</strong>
          </div>

          <div className="cost-analysis-summary-grid">
            <div><span>Total costs</span><strong>{currency.format(costAnalysis.total)}</strong></div>
            <div><span>Assigned to lots</span><strong>{currency.format(costAnalysis.assigned)}</strong></div>
            <div className={costAnalysis.unassigned > 0 ? 'needs-attention' : ''}><span>Needs lot assignment</span><strong>{currency.format(costAnalysis.unassigned)}</strong></div>
            <div><span>Cost records</span><strong>{costAnalysis.count}</strong></div>
          </div>

          <div className="cost-analysis-controls">
            <div className="cost-analysis-view-toggle" role="group" aria-label="Cost analysis view">
              <button type="button" className={costAnalysisView === 'lot' ? 'active' : ''} aria-pressed={costAnalysisView === 'lot'} onClick={() => setCostAnalysisView('lot')}>By lot</button>
              <button type="button" className={costAnalysisView === 'category' ? 'active' : ''} aria-pressed={costAnalysisView === 'category'} onClick={() => setCostAnalysisView('category')}>By category</button>
            </div>
            <label>
              Sort
              <select aria-label="Sort cost analysis" value={costAnalysisSort} onChange={(event) => setCostAnalysisSort(event.target.value)}>
                <option value="amount_desc">Amount: highest first</option>
                <option value="amount_asc">Amount: lowest first</option>
                <option value="date_desc">Latest invoice date: newest</option>
                <option value="date_asc">Latest invoice date: oldest</option>
                <option value="name_asc">Name: A–Z</option>
                <option value="name_desc">Name: Z–A</option>
              </select>
            </label>
          </div>

          <div className="cost-analysis-breakdown" aria-label={costAnalysisView === 'lot' ? 'Costs grouped by lot' : 'Costs grouped by category'}>
            {sortedCostAnalysisEntries.map((entry) => {
              const percentage = costAnalysis.total ? Math.round((entry.amount / costAnalysis.total) * 100) : 0
              return <button type="button" className="cost-analysis-breakdown-row" key={entry.name} onClick={() => {
                if (costAnalysisView === 'lot') setCostLotFilter(entry.name)
                else setCostCategoryFilter(entry.name === 'Uncategorized' ? 'uncategorized' : entry.name)
                setCostListView('detailed')
                costListRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
              }}>
                <span className="cost-analysis-breakdown-heading"><strong>{entry.name}</strong><small>{entry.count} cost record{entry.count === 1 ? '' : 's'} · {percentage}% of total{entry.latestDate ? ` · Latest ${entry.latestDate}` : ''}</small></span>
                <span className="cost-analysis-breakdown-amount">{currency.format(entry.amount)}</span>
                <span className="cost-analysis-progress" aria-hidden="true"><span style={{ width: `${Math.min(100, percentage)}%` }} /></span>
                <span className="cost-analysis-drilldown">View costs →</span>
              </button>
            })}
            {costAnalysisView === 'lot' && costAnalysis.unassigned > 0 ? <button type="button" className="cost-analysis-breakdown-row needs-attention" onClick={() => {
              setCostLotFilter('unassigned')
              setCostListView('detailed')
              costListRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
            }}>
              <span className="cost-analysis-breakdown-heading"><strong>Needs lot assignment</strong><small>{costAnalysis.unassignedCount} cost record{costAnalysis.unassignedCount === 1 ? '' : 's'} to review</small></span>
              <span className="cost-analysis-breakdown-amount">{currency.format(costAnalysis.unassigned)}</span>
              <span className="cost-analysis-progress" aria-hidden="true"><span style={{ width: `${costAnalysis.total ? Math.min(100, Math.round(costAnalysis.unassigned / costAnalysis.total * 100)) : 0}%` }} /></span>
              <span className="cost-analysis-drilldown">Assign lots →</span>
            </button> : null}
            {!costAnalysis.count ? <div className="cost-analysis-empty"><strong>No costs recorded yet</strong><span>Add a cost to see the analysis.</span></div> : null}
          </div>

          <details className="cost-analysis-details">
            <summary><strong>View detailed cost ledger</strong><span>{developmentCosts.length} records</span></summary>
            <div className="cost-analysis-ledger">
              {developmentCosts.map((cost) => {
              const owner = ownerOptions.find((entry) => entry.id === cost.ownerId)
              const allocations = cost.lotAllocations || []
              const allocated = allocations.reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
                return <article className="cost-analysis-entry" key={cost.costId}>
                <div>
                  <strong>{cost.name}</strong>
                  <p>{owner?.name || 'Owner not assigned'} • {phaseLabel(cost.phase)} • {cost.category || 'Uncategorized'} • Invoice {displayDate(cost.date)} • Added {displayDate(addedDateFor(cost))}</p>
                  <div className="cost-allocation-chips">
                    {allocations.map((entry) => <span key={`${cost.costId}-${entry.lot}`}>{entry.lot}: {currency.format(entry.amount)}</span>)}
                    {allocated < Number(cost.amount || 0) ? <span className="unassigned">Unassigned: {currency.format(Number(cost.amount || 0) - allocated)}</span> : null}
                  </div>
                </div>
                <strong>{currency.format(cost.amount)}</strong>
                </article>
              })}
            </div>
          </details>
        </div>
      </section>

      <ConstructionDrafts
        drafts={constructionDrafts}
        onSaveDraft={onSaveConstructionDraft}
        onUseDraft={handleUseConstructionDraft}
        onUploadDocument={onUploadDocument}
        onOpenDocument={onOpenDocument}
        sharedDevelopmentCostTotal={sharedDevelopmentCostTotal}
      />

      <section ref={costListRef} className="panel cost-list-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Cost list</p>
            <h2>All tracked costs</h2>
          </div>
          <div className="cost-view-toggle" role="group" aria-label="Cost list view">
            <button type="button" className={costListView === 'detailed' ? 'active' : ''} aria-pressed={costListView === 'detailed'} onClick={() => setCostListView('detailed')}>Detailed view</button>
            <button type="button" className={costListView === 'list' ? 'active' : ''} aria-pressed={costListView === 'list'} onClick={() => setCostListView('list')}>Date list</button>
          </div>
        </div>
        <div className="cost-list-toolbar">
          <label>
            Free search
            <input type="search" aria-label="Search costs" placeholder="Name, owner, category, lot, phase, invoice or added date…" value={costSearch} onChange={(event) => setCostSearch(event.target.value)} />
          </label>
          <label>
            Filter by phase
            <select aria-label="Filter costs by phase" value={costPhaseFilter} onChange={(event) => setCostPhaseFilter(event.target.value)}>
              <option value="all">All phases</option>
              <option value="development">Development</option>
              <option value="construction">Construction</option>
              <option value="soft_cost">Soft Cost</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            Filter by owner
            <select aria-label="Filter costs by owner" value={costOwnerFilter} onChange={(event) => setCostOwnerFilter(event.target.value)}>
              <option value="all">All owners</option>
              {ownerOptions.map((owner) => <option key={owner.id} value={String(owner.id)}>{owner.name}</option>)}
            </select>
          </label>
          <label>
            Filter by category
            <select aria-label="Filter costs by category" value={costCategoryFilter} onChange={(event) => setCostCategoryFilter(event.target.value)}>
              <option value="all">All categories</option>
              <option value="uncategorized">Uncategorized</option>
              {categoryFilterOptions.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </label>
          <label>
            Filter by main category
            <select aria-label="Filter costs by main category" value={costMainCategoryFilter} onChange={(event) => setCostMainCategoryFilter(event.target.value)}>
              <option value="all">All main categories</option>
              {MAIN_COST_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </label>
          <label>
            Filter by payer
            <select aria-label="Filter costs by payer" value={costPayerFilter} onChange={(event) => setCostPayerFilter(event.target.value)}>
              <option value="all">All payers</option>
              {ownerOptions.map((owner) => <option key={owner.id} value={`owner:${owner.id}`}>{owner.name}</option>)}
              <option value="company">Green Fort LLC</option><option value="construction_loan">Construction Loan</option><option value="other_company">Other Company</option><option value="third_party">Other / Third Party</option>
            </select>
          </label>
          <label>
            Filter reimbursable
            <select aria-label="Filter costs by reimbursable status" value={costReimbursableFilter} onChange={(event) => setCostReimbursableFilter(event.target.value)}>
              <option value="all">All reimbursement statuses</option><option value="yes">Reimbursable</option><option value="no">Not reimbursable</option>
            </select>
          </label>
          <label>
            Filter loan related
            <select aria-label="Filter costs by loan status" value={costLoanFilter} onChange={(event) => setCostLoanFilter(event.target.value)}>
              <option value="all">All funding statuses</option><option value="yes">Loan related / funded</option><option value="no">Not loan related</option>
            </select>
          </label>
          <label>
            Filter by job
            <select aria-label="Filter costs by job" value={costJobFilter} onChange={(event) => setCostJobFilter(event.target.value)}>
              <option value="all">All construction jobs</option>
              <option value="unmapped">Unmapped job</option>
              {constructionDrafts.map((draft) => <option key={draft.id} value={String(draft.id)}>{draft.name}</option>)}
            </select>
          </label>
          <label>
            Filter by lot
            <select aria-label="Filter costs by lot" value={costLotFilter} onChange={(event) => setCostLotFilter(event.target.value)}>
              <option value="all">All lots</option>
              <option value="unassigned">Unassigned lot</option>
              {lotOptions.map((lot) => <option key={lot} value={lot}>{lot}</option>)}
            </select>
          </label>
          <label>
            Filter by payment
            <select aria-label="Filter costs by payment method" value={costPaymentFilter} onChange={(event) => setCostPaymentFilter(event.target.value)}>
              <option value="all">All payment methods</option>
              <option value="unspecified">Not specified</option>
              <option value="amex_business">Amex Business</option>
              <option value="other_credit_card">Other credit card</option>
              <option value="providence_ach">Providence Bank ACH</option>
              <option value="bofa_ach">Bank of America ACH</option>
              <option value="kemal_personal_bank">Kemal Personal Bank Account</option>
              <option value="banu_personal_bank">Banu Personal Bank Account</option>
              <option value="providence_check">Providence Bank check</option>
              <option value="bofa_check">Bank of America check</option>
              <option value="check">Check — bank not specified</option>
              <option value="bank_transfer">ACH / bank transfer — bank not specified</option>
              <option value="debit_card">Debit card</option>
              <option value="cash">Cash</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            Filter by payment status
            <select aria-label="Filter costs by payment status" value={costPaymentStatusFilter} onChange={(event) => setCostPaymentStatusFilter(event.target.value)}>
              <option value="all">All payment statuses</option>
              <option value="unpaid">Unpaid</option>
              <option value="paid">Paid</option>
            </select>
          </label>
          <label>
            Invoice date range
            <select aria-label="Filter costs by invoice date range" value={costDatePreset} onChange={(event) => {
              const preset = event.target.value
              setCostDatePreset(preset)
              if (preset === 'custom') return
              const range = invoiceDateRangeForPreset(preset)
              setCostDateFrom(range.from)
              setCostDateTo(range.to)
            }}>
              <option value="all">All dates</option>
              <option value="this_month">This month</option>
              <option value="last_month">Last month</option>
              <option value="last_3_months">Last 3 months</option>
              <option value="last_6_months">Last 6 months</option>
              <option value="last_12_months">Last 12 months</option>
              <option value="this_year">This year</option>
              <option value="last_year">Last year</option>
              <option value="custom">Custom dates</option>
            </select>
          </label>
          <label>
            From invoice date
            <input aria-label="Filter costs from invoice date" type="date" value={costDateFrom} onChange={(event) => {
              setCostDatePreset('custom')
              setCostDateFrom(event.target.value)
            }} />
            <small>No earliest limit—2022 and older dates are allowed.</small>
          </label>
          <label>
            To invoice date
            <input aria-label="Filter costs through invoice date" type="date" value={costDateTo} onChange={(event) => {
              setCostDatePreset('custom')
              setCostDateTo(event.target.value)
            }} />
          </label>
          {costListView === 'detailed' ? (
            <>
              <label className="cost-list-toolbar-secondary">
                Cost order
                <select aria-label="Order costs" value={costCardOrder} onChange={(event) => setCostCardOrder(event.target.value)}>
                  <option value="added_desc">Newest added first</option>
                  <option value="added_asc">Oldest added first</option>
                  <option value="invoice_desc">Newest invoice first</option>
                  <option value="invoice_asc">Oldest invoice first</option>
                </select>
              </label>
              <label className="cost-list-toolbar-secondary">
                Sort breakdowns within each cost
                <select aria-label="Sort breakdowns" value={breakdownSort} onChange={(event) => handleBreakdownSortChange(event.target.value)}>
                  <option value="added_desc">Newest added first</option>
                  <option value="added_asc">Oldest added first</option>
                  <option value="amount_desc">Amount: highest first</option>
                  <option value="amount_asc">Amount: lowest first</option>
                  <option value="date_desc">Invoice date: newest first</option>
                  <option value="date_asc">Invoice date: oldest first</option>
                  <option value="name_asc">Description: A–Z</option>
                  <option value="name_desc">Description: Z–A</option>
                </select>
                <small>Changing the order opens breakdown groups so you can see the result.</small>
              </label>
            </>
          ) : (
            <label className="cost-list-toolbar-secondary">
              Invoice date order
              <select aria-label="Order costs by invoice date" value={costDateOrder} onChange={(event) => setCostDateOrder(event.target.value)}>
                <option value="desc">Newest first</option>
                <option value="asc">Oldest first</option>
              </select>
            </label>
          )}
          <div className="cost-filter-summary">
            <span>Showing {costListView === 'list' ? ledgerVisibleDateCosts.length : filteredDevelopmentCosts.length} of {costListView === 'list' ? developmentCosts.length + breakdownCosts.filter((cost) => !breakdownCosts.some((candidate) => candidate.costId === cost.parentCostId)).length : developmentCosts.length}</span>
            <button type="button" className="action-button" onClick={() => setShowFilteredReport((current) => !current)}>{showFilteredReport ? 'Hide report' : 'Create detailed report'}</button>
            <button type="button" className="secondary-button" onClick={exportFilteredReport}>Export filtered CSV</button>
            {(costSearch || costPhaseFilter !== 'all' || costOwnerFilter !== 'all' || costCategoryFilter !== 'all' || costMainCategoryFilter !== 'all' || costPayerFilter !== 'all' || costReimbursableFilter !== 'all' || costLoanFilter !== 'all' || costJobFilter !== 'all' || costLotFilter !== 'all' || costPaymentFilter !== 'all' || costPaymentStatusFilter !== 'all' || costDateFrom || costDateTo) ? (
              <button type="button" className="secondary-button" onClick={() => {
                setCostSearch('')
                setCostPhaseFilter('all')
                setCostOwnerFilter('all')
                setCostCategoryFilter('all')
                setCostMainCategoryFilter('all')
                setCostPayerFilter('all')
                setCostReimbursableFilter('all')
                setCostLoanFilter('all')
                setCostJobFilter('all')
                setCostLotFilter('all')
                setCostPaymentFilter('all')
                setCostPaymentStatusFilter('all')
                setCostDatePreset('all')
                setCostDateFrom('')
                setCostDateTo('')
              }}>Clear filters</button>
            ) : null}
          </div>
        </div>
        <section className="filtered-phase-summary" aria-label={`${costPhaseFilter === 'all' ? 'Filtered costs' : `${phaseLabel(costPhaseFilter)} phase`} totals`}>
          <div className="filtered-phase-summary-heading">
            <div>
              <p className="eyebrow">Filtered accounting total</p>
              <h3>{costPhaseFilter === 'all' ? 'All selected phases' : `${phaseLabel(costPhaseFilter)} phase total`}</h3>
            </div>
            <strong>{currency.format(filteredPhaseSummary.parentTotal)}</strong>
          </div>
          <p className="filtered-phase-summary-note">Counts {filteredPhaseSummary.parentCount} top-level cost{filteredPhaseSummary.parentCount === 1 ? '' : 's'} once. The {filteredPhaseSummary.detailCount} breakdown row{filteredPhaseSummary.detailCount === 1 ? '' : 's'} below are supporting details already included in their parent totals—not additional costs.</p>
          <div className="filtered-phase-summary-grid">
            {filteredPhaseSummary.byOwner.map(([owner, total]) => <div key={owner}><span>{owner}</span><strong>{currency.format(total)}</strong><small>Top-level total</small></div>)}
            <div className="breakdown-detail-total"><span>Breakdown details shown</span><strong>{currency.format(filteredPhaseSummary.leafDetailTotal)}</strong><small>Included in parent totals</small></div>
          </div>
        </section>
        {showFilteredReport ? <section ref={filteredReportRef} className="filtered-cost-report" aria-label="Filtered cost report">
          <header className="filtered-cost-report-header">
            <div><p className="eyebrow">Ledger report</p><h3>{projectName} · Filtered cost detail</h3><p>Created {new Date().toLocaleDateString('en-US')}</p></div>
            <div><span>Accounting total</span><strong>{currency.format(filteredPhaseSummary.parentTotal)}</strong><small>{filteredPhaseSummary.parentCount} top-level cost{filteredPhaseSummary.parentCount === 1 ? '' : 's'} counted once</small></div>
          </header>
          <div className="filtered-cost-report-filters" aria-label="Applied report filters">
            {filteredReportFilters.map(([name, value]) => <span key={name}><strong>{name}:</strong> {value}</span>)}
          </div>
          <div className="filtered-cost-report-table">
            <table>
              <thead><tr><th>Invoice date</th><th>Cost / detail</th><th>Attribution</th><th>Payer / funding source</th><th>Main category / subcategory</th><th>Lot</th><th>Payment</th><th>Amount</th></tr></thead>
              <tbody>{filteredReportRows.map((cost) => {
                const owner = ownerOptions.find((entry) => String(entry.id) === String(cost.ownerId))
                return <tr key={`${cost.reportLevel}-${cost.costId}`} className={cost.reportLevel === 'detail' ? 'filtered-report-detail-row' : ''}>
                  <td>{displayDate(cost.date)}</td>
                  <td><strong>{cost.reportLevel === 'detail' ? `↳ ${cost.name}` : cost.name}</strong>{cost.details ? <small>{cost.details}</small> : null}{cost.reportLevel === 'detail' ? <small>Supporting breakdown of {cost.parentName}; included in parent total</small> : <small>Added {displayDate(addedDateFor(cost))}</small>}</td>
                  <td>{owner?.name || 'Not assigned'}</td><td>{payerLabel(cost, ownerOptions)}</td><td>{inferMainCostCategory(cost)}{cost.subcategory ? <small>{cost.subcategory}</small> : null}</td><td>{costAllocationLabel(cost)}</td>
                  <td>{cost.paymentSource || paymentMethodLabel(cost.paymentMethod) || 'Not specified'} · {paymentStateForCost(cost).paid ? 'Paid' : 'Unpaid'}{cost.referenceNumber ? <small>Ref: {cost.referenceNumber}</small> : null}<InvoicePaymentWarning invoiceDate={cost.date} paid={paymentStateForCost(cost).paid} /></td><td>{currency.format(cost.amount)}</td>
                </tr>
              })}</tbody>
              <tfoot><tr><th colSpan="7">Accounting total (supporting breakdowns excluded)</th><th>{currency.format(filteredPhaseSummary.parentTotal)}</th></tr></tfoot>
            </table>
          </div>
          {!filteredReportRows.length ? <p>No costs match the selected filters.</p> : null}
          <div className="button-row filtered-report-actions"><button type="button" className="secondary-button" onClick={exportFilteredReport}>Export CSV</button><button type="button" className="action-button" onClick={printFilteredReport}>Print / Save PDF</button></div>
        </section> : null}
        {costListView === 'list' && (costPhaseFilter === 'development' || selectedLedgerCostIds.size > 0) ? <section className="development-ledger-merge" aria-label="Development ledger merge">
          <div>
            <strong>Merge Development costs for the ledger</strong>
            <span>Mark two or more breakdowns under each owner’s parent. Originals remain as expandable audit detail; the ledger counts only the merged group.</span>
          </div>
          <div className="development-ledger-merge-controls">
            <label>Ledger group name<input aria-label="Development ledger group name" value={ledgerMergeName} onChange={(event) => setLedgerMergeName(event.target.value)} placeholder="Initial land cost" /></label>
            <div><span>{selectedLedgerCosts.length} selected</span><strong>{currency.format(selectedLedgerTotal)}</strong></div>
            <button type="button" className="action-button" disabled={mergingLedgerCosts || selectedLedgerCosts.length < 2} onClick={handleMergeLedgerCosts}>{mergingLedgerCosts ? 'Merging…' : 'Merge marked costs'}</button>
            {selectedLedgerCosts.length ? <button type="button" className="secondary-button" disabled={mergingLedgerCosts} onClick={() => setSelectedLedgerCostIds(new Set())}>Clear marks</button> : null}
          </div>
        </section> : null}
        <div className="table-card">
          {costListView === 'list' ? (
            <div className="cost-date-list" role="table" aria-label="Costs ordered by invoice date">
              <div className="cost-date-list-header" role="row">
                <span role="columnheader">Mark</span>
                <span role="columnheader">Invoice date</span>
                <span role="columnheader">Added date</span>
                <span role="columnheader">Cost</span>
                <span role="columnheader">Owner / classification</span>
                <span role="columnheader">Lot</span>
                <span role="columnheader">Amount</span>
                <span role="columnheader">Action</span>
              </div>
              {ledgerVisibleDateCosts.map((cost) => {
                const owner = ownerOptions.find((entry) => entry.id === cost.ownerId)
                const parent = developmentCosts.find((entry) => entry.costId === cost.parentCostId)
                const job = constructionDrafts.find((draft) => String(draft.id) === String(cost.constructionDraftId || ''))
                const paymentState = paymentStateForCost(cost)
                const isMergedGroup = breakdownCosts.some((entry) => entry.parentCostId === cost.costId)
                const canMergeInLedger = Boolean(parent && !isMergedGroup && cost.phase === 'development')
                return <div className="cost-date-list-row" role="row" data-testid="cost-date-list-row" key={cost.id || cost.costId}>
                  <span role="cell">{canMergeInLedger ? <input type="checkbox" aria-label={`Mark ${cost.name} for Development ledger merge`} checked={selectedLedgerCostIds.has(cost.costId)} onChange={() => toggleLedgerCostSelection(cost.costId)} /> : <span className="ledger-merge-unavailable" aria-label={isMergedGroup ? 'Already merged group' : 'Not an eligible Development breakdown'}>—</span>}</span>
                  <time role="cell" dateTime={cost.date || undefined}>{displayDate(cost.date)}</time>
                  <time role="cell" dateTime={addedDateFor(cost) || undefined}>{displayDate(addedDateFor(cost))}</time>
                  <span role="cell"><strong>{cost.name}</strong><small>{cost.details || (parent ? `Breakdown of ${parent.name}` : 'Top-level cost')}</small><em className={parent ? 'cost-row-kind detail' : 'cost-row-kind parent'}>{isMergedGroup ? 'Merged ledger group · counted once' : parent ? 'Breakdown detail · already included' : 'Parent total · counted once'}</em></span>
                  <span role="cell"><strong>{owner?.name || 'Owner'}</strong><small>{phaseLabel(cost.phase)} · {cost.category || 'Uncategorized'}{job ? ` · ${job.name}` : ''} · {paymentState.paid ? (cost.paymentDate ? `Paid ${cost.paymentDate}` : paymentState.paidByBreakdowns ? 'Paid through breakdowns' : 'Paid by printed check') : 'Unpaid'}{paymentState.voidedChecks.length ? ' · Voided check excluded' : ''}</small><InvoicePaymentWarning invoiceDate={cost.date} paid={paymentState.paid} /></span>
                  <span role="cell">{costAllocationLabel(cost)}</span>
                  <strong role="cell">{currency.format(cost.amount)}</strong>
                  <span role="cell"><button type="button" className="secondary-button" onClick={() => handleStartEdit(cost)}>Edit</button></span>
                </div>
              })}
            </div>
          ) : filteredDevelopmentCosts.map((cost) => {
            const owner = ownerOptions.find((entry) => entry.id === cost.ownerId)
            const children = sortBreakdowns(breakdownCosts.filter((entry) => entry.parentCostId === cost.costId))
            const allocatedCents = children.reduce((sum, entry) => sum + Math.round(Number(entry.amount || 0) * 100), 0)
            const costCents = Math.round(Number(cost.amount || 0) * 100)
            const allocated = allocatedCents / 100
            const remaining = (costCents - allocatedCents) / 100
            const matchingChild = costSearch.trim() && children.some((child) => (
              `${child.name} ${child.details || ''} ${child.category || ''}`.toLowerCase().includes(costSearch.trim().toLowerCase())
            ))
            const breakdownsExpanded = expandedBreakdownIds.has(cost.costId) || Boolean(matchingChild)
            const paymentState = paymentStateForCost(cost)
            const isReimbursement = /reimburse/i.test(cost.name) && Boolean(cost.vendorName)
            const plannedZelle = /\bzelle\b/i.test(`${cost.notes || ''} ${cost.details || ''}`)
            const equalLotAmount = cost.lotAllocations?.length > 1
              && cost.lotAllocations.every((entry) => Math.round(Number(entry.amount || 0) * 100) === Math.round(Number(cost.lotAllocations[0].amount || 0) * 100))
            const breakdownStatus = !children.length
              ? { key: 'none', label: 'Not broken down' }
              : remaining < 0
              ? { key: 'over', label: 'Breakdowns exceed cost' }
              : remaining === 0
                ? { key: 'full', label: 'Fully broken down' }
                : { key: 'partial', label: 'Partially broken down' }
            return (
              <Fragment key={cost.id}>
                <article className={`cost-parent-row cost-record-card${editingCostId === cost.costId ? ' is-being-edited' : ''}`}>
                  <header className="cost-record-header">
                    <div className="cost-record-identity">
                      <strong className="cost-record-title">{cost.name}</strong>
                      {isReimbursement ? <div className="cost-reimbursement-summary" aria-label="Reimbursement summary">
                        <strong>{paymentState.paid ? 'Reimbursed' : 'To reimburse'}: {cost.vendorName}</strong>
                        <span>{paymentState.paid ? `Paid${plannedZelle ? ' by Zelle' : ''}${cost.paymentDate ? ` · ${cost.paymentDate}` : ''}` : plannedZelle ? 'Zelle planned · payment not recorded' : 'Payment not recorded'}</span>
                        <span>{children.length} expense item{children.length === 1 ? '' : 's'} included in this total</span>
                        {equalLotAmount ? <span>{cost.lotAllocations.length} lots · {currency.format(cost.lotAllocations[0].amount)} per lot</span> : null}
                      </div> : null}
                      {cost.details ? isReimbursement
                        ? <details className="cost-source-notes"><summary>View source notes</summary><p>{cost.details}</p></details>
                        : <p className="cost-record-description">{cost.details}</p> : null}
                      {cost.paymentFeePercentage != null ? <p className="cost-record-description">Card fee: {Number(cost.paymentFeePercentage).toFixed(2)}% of {currency.format(cost.invoiceAmount ?? (Number(cost.amount) - Number(cost.paymentFeeAmount || 0)))} = {currency.format(cost.paymentFeeAmount ?? (Number(cost.amount) - Number(cost.amount) / (1 + Number(cost.paymentFeePercentage) / 100)))} · Total {currency.format(cost.amount)}</p> : null}
                      <div className="cost-record-badges" aria-label="Cost metadata">
                        <span>{owner?.name || 'Owner'}</span>
                        <span>{cost.category || 'Uncategorized'}</span>
                        <span>{cost.mainCategory || inferMainCostCategory(cost)}</span>
                        {cost.isSoftCostParent ? <span>Soft Cost parent</span> : null}
                        {cost.subcategory ? <span>{cost.subcategory}</span> : null}
                        {!isReimbursement ? <span>{paymentState.paid ? 'Paid by' : 'Payment assigned to'} {payerLabel(cost, ownerOptions)}</span> : null}
                        {cost.reimbursable ? <span>Reimbursable</span> : null}
                        {cost.loanRelated ? <span>Loan related</span> : null}
                        <span>{phaseLabel(cost.phase)}</span>
                        <time dateTime={cost.date || undefined}>Invoice {displayDate(cost.date)}</time>
                        <time dateTime={addedDateFor(cost) || undefined}>Added {displayDate(addedDateFor(cost))}</time>
                        <span>{costAllocationLabel(cost)}</span>
                        {cost.constructionDraftId ? <span>{constructionDrafts.find((draft) => String(draft.id) === String(cost.constructionDraftId))?.name || 'Mapped job'}</span> : null}
                        {cost.paymentMethod ? <span>{paymentMethodLabel(cost.paymentMethod)}</span> : null}
                        {cost.paymentFeePercentage != null ? <span>{Number(cost.paymentFeePercentage).toFixed(2)}% card fee</span> : null}
                        {paymentState.paid ? <span>{cost.paymentDate ? `Paid ${cost.paymentDate}` : paymentState.paidByBreakdowns ? 'Paid through breakdowns' : 'Paid by printed check'}</span> : null}
                        {!paymentState.paid ? <span className="payment-status-unpaid">Unpaid</span> : null}
                        <InvoicePaymentWarning invoiceDate={cost.date} paid={paymentState.paid} />
                      </div>
                    </div>
                    <div className="cost-record-amount">
                      <small>Cost amount</small>
                      <strong>{currency.format(cost.amount)}</strong>
                    </div>
                  </header>

                  {paymentState.voidedChecks.length && !paymentState.paid ? <div className="voided-cost-payment-warning" role="alert">
                    <div><strong>This cost is unpaid</strong><span>{paymentState.voidedChecks.map((check) => `Check #${check.checkNumber}`).join(', ')} {paymentState.voidedChecks.length === 1 ? 'was' : 'were'} voided and no longer count as payment.</span></div>
                    <div className="button-row">
                      {onCreateCheck ? <button type="button" className="action-button" onClick={() => handleCreateCheckForCost(cost)}>Create replacement check</button> : null}
                      <button type="button" className="secondary-button" onClick={() => handleStartEdit(cost)}>Use another payment method</button>
                    </div>
                  </div> : null}

                  {renderPaymentRecords(cost.attachments, checksForCost(cost.costId))}

                  {children.length ? <div className="cost-allocation-summary" aria-label="Breakdown summary">
                    <div><small>Broken down</small><strong>{currency.format(allocated)}</strong></div>
                    <div><small>{remaining < 0 ? 'Breakdowns exceed cost by' : 'Not broken down'}</small><strong className={remaining < 0 ? 'negative' : ''}>{currency.format(Math.abs(remaining))}</strong></div>
                    <div><small>Breakdown items</small><strong>{children.length}</strong></div>
                    <span className={`allocation-status ${breakdownStatus.key}`}>{breakdownStatus.label}</span>
                  </div> : <div className="cost-allocation-summary no-breakdowns" aria-label="Breakdown summary">
                    <div><small>Breakdown details</small><strong>No breakdowns added (optional)</strong></div>
                  </div>}

                  <footer className="cost-record-footer">
                    <div className="cost-record-main-actions">
                      <button type="button" className="action-button" onClick={() => handleStartEdit(cost)}>Edit cost</button>
                      {onCreateCheck && !paymentState.activeChecks.length ? <button type="button" className="secondary-button" onClick={() => handleCreateCheckForCost(cost)}>{paymentState.voidedChecks.length ? 'Replacement check' : 'Create check'}</button> : null}
                      <button type="button" className="secondary-button" aria-label={`Add breakdown to ${cost.name}`} onClick={() => handleStartBreakdown(cost)}>Add breakdown</button>
                      {children.length && matchingChild ? <span className="cost-matching-breakdowns">Matching expense items shown below</span> : null}
                      {children.length && !matchingChild ? <button
                        type="button"
                        className="cost-accordion-button"
                        aria-expanded={breakdownsExpanded}
                        aria-controls={`cost-breakdowns-${cost.costId}`}
                        onClick={() => toggleBreakdowns(cost.costId)}
                      >
                        <span>{isReimbursement ? (breakdownsExpanded ? 'Hide expense items' : `View ${children.length} expense items`) : (breakdownsExpanded ? 'Hide breakdowns' : `Show breakdowns (${children.length})`)}</span>
                        <span className="cost-control-chevron" aria-hidden="true">{breakdownsExpanded ? '▴' : '▾'}</span>
                      </button> : null}
                      {renderAttachmentArea(cost)}
                    </div>
                    <details className="cost-overflow-menu">
                      <summary aria-label={`More actions for ${cost.name}`}>•••</summary>
                      <div className="cost-overflow-popover" role="menu">
                        {pendingDeleteCostId === cost.costId ? <>
                          <button type="button" role="menuitem" className="destructive" onClick={(event) => {
                            event.currentTarget.closest('details')?.removeAttribute('open')
                            handleConfirmDelete(cost.costId)
                          }}>Confirm delete</button>
                          <button type="button" role="menuitem" onClick={(event) => {
                            event.currentTarget.closest('details')?.removeAttribute('open')
                            setPendingDeleteCostId(null)
                          }}>Cancel</button>
                        </> : <button type="button" role="menuitem" className="destructive" onClick={() => setPendingDeleteCostId(cost.costId)}>Delete cost</button>}
                      </div>
                    </details>
                  </footer>
                  {renderAttachedChecks(cost.costId)}
                </article>
                {breakdownsExpanded ? <div id={`cost-breakdowns-${cost.costId}`} className="cost-breakdown-group cost-breakdown-accordion">
                  {children.length >= 2 ? (
                    <div className="breakdown-merge-bar">
                      <span>{children.filter((child) => selectedBreakdownIds.has(child.costId)).length} selected</span>
                      <input
                        aria-label={`Merged breakdown name for ${cost.name}`}
                        placeholder="Merged breakdown name"
                        value={selectedBreakdownParentId === cost.costId ? mergeName : ''}
                        disabled={selectedBreakdownParentId != null && selectedBreakdownParentId !== cost.costId}
                        onChange={(event) => setMergeName(event.target.value)}
                      />
                      <button
                        type="button"
                        className="action-button"
                        disabled={mergingBreakdowns || children.filter((child) => selectedBreakdownIds.has(child.costId)).length < 2}
                        onClick={() => handleMergeSelected(cost)}
                      >
                        {mergingBreakdowns ? 'Merging…' : 'Merge selected'}
                      </button>
                    </div>
                  ) : null}
                  {children.map((child) => {
                    const mergedItems = sortBreakdowns(breakdownCosts.filter((entry) => entry.parentCostId === child.costId))
                    const mergedItemsExpanded = expandedBreakdownIds.has(child.costId)
                    const eligibleGroupItems = children.filter((candidate) => (
                      candidate.costId !== child.costId
                      && !breakdownCosts.some((entry) => entry.parentCostId === candidate.costId)
                    ))
                    const addItemsExpanded = addingToGroupId === child.costId
                    return <Fragment key={child.id}>
                      <div className={`table-row cost-breakdown-row${editingCostId === child.costId ? ' is-being-edited' : ''}`}>
                        <div className="cost-row-summary">
                          {mergedItems.length ? (
                            <strong>↳ {child.name}</strong>
                          ) : (
                            <label className="breakdown-select-control">
                              <input
                                type="checkbox"
                                aria-label={`Select ${child.name} for merge`}
                                checked={selectedBreakdownIds.has(child.costId)}
                                disabled={selectedBreakdownParentId != null && selectedBreakdownParentId !== cost.costId}
                                onChange={() => toggleBreakdownSelection(child, cost)}
                              />
                              <strong>↳ {child.name}</strong>
                            </label>
                          )}
                          <p>{mergedItems.length ? 'Merged breakdown total' : `Breakdown of ${cost.name}`} • {phaseLabel(child.phase)} • {child.category || 'Uncategorized'} • {costAllocationLabel(child)} • Invoice {child.date || 'not dated'}{addedDateFor(child) ? ` • Added ${displayDate(addedDateFor(child))}` : ''}</p>
                        </div>
                        <div className="cost-row-amount">{currency.format(child.amount)}</div>
                        <div className="button-row cost-row-actions">
                          {mergedItems.length ? (
                            <>
                              <button type="button" className="secondary-button" aria-expanded={mergedItemsExpanded} onClick={() => toggleBreakdowns(child.costId)}>
                                {mergedItemsExpanded ? 'Hide merged items' : `Show merged items (${mergedItems.length})`}
                              </button>
                              <button
                                type="button"
                                className="secondary-button"
                                aria-expanded={addItemsExpanded}
                                aria-label={`Add items to ${child.name}`}
                                onClick={() => {
                                  setAddingToGroupId(addItemsExpanded ? null : child.costId)
                                  setGroupItemIds(new Set())
                                }}
                              >
                                Add items
                              </button>
                              {pendingUnmergeGroupId === child.costId ? (
                                <>
                                  <button type="button" className="danger-button" disabled={updatingGroup} onClick={() => handleUnmergeGroup(child)}>
                                    {updatingGroup ? 'Unmerging…' : 'Confirm unmerge'}
                                  </button>
                                  <button type="button" className="secondary-button" disabled={updatingGroup} onClick={() => setPendingUnmergeGroupId(null)}>Cancel</button>
                                </>
                              ) : (
                                <button type="button" className="secondary-button" onClick={() => setPendingUnmergeGroupId(child.costId)}>Unmerge</button>
                              )}
                            </>
                          ) : null}
                          <button type="button" className="action-button" onClick={() => handleStartEdit(child)}>{mergedItems.length ? 'Edit group' : 'Edit breakdown'}</button>
                          {pendingDeleteCostId === child.costId ? (
                            <>
                              <button type="button" className="danger-button" onClick={() => handleConfirmDelete(child.costId)}>Confirm delete</button>
                              <button type="button" className="secondary-button" onClick={() => setPendingDeleteCostId(null)}>Cancel</button>
                            </>
                          ) : (
                            <button type="button" className="danger-button" onClick={() => setPendingDeleteCostId(child.costId)}>{mergedItems.length ? 'Delete group' : 'Delete breakdown'}</button>
                          )}
                        </div>
                        <div className="cost-row-details">
                          {renderAttachedChecks(child.costId)}
                          {renderAttachmentArea(child)}
                        </div>
                      </div>
                      {addItemsExpanded ? <div className="breakdown-group-editor">
                        <strong>Add existing breakdowns to {child.name}</strong>
                        {eligibleGroupItems.length ? (
                          <>
                            <div className="breakdown-group-options">
                              {eligibleGroupItems.map((item) => (
                                <label key={item.costId} className="breakdown-group-option">
                                  <input
                                    type="checkbox"
                                    aria-label={`Add ${item.name} to ${child.name}`}
                                    checked={groupItemIds.has(item.costId)}
                                    onChange={() => toggleGroupItemSelection(item.costId)}
                                  />
                                  <span><strong>{item.name}</strong><small>{item.date} · {currency.format(item.amount)}</small></span>
                                </label>
                              ))}
                            </div>
                            <div className="button-row">
                              <button type="button" className="action-button" disabled={updatingGroup || groupItemIds.size === 0} onClick={() => handleAddSelectedToGroup(child)}>
                                {updatingGroup ? 'Adding…' : `Add selected to group (${groupItemIds.size})`}
                              </button>
                              <button type="button" className="secondary-button" disabled={updatingGroup} onClick={() => {
                                setAddingToGroupId(null)
                                setGroupItemIds(new Set())
                              }}>Cancel</button>
                            </div>
                          </>
                        ) : <p>No ungrouped breakdowns are available under this parent cost.</p>}
                      </div> : null}
                      {mergedItemsExpanded ? <div className="merged-breakdown-items">
                        {mergedItems.map((item) => (
                          <div key={item.id} className={`table-row cost-breakdown-row merged-breakdown-item-row${editingCostId === item.costId ? ' is-being-edited' : ''}`}>
                            <div className="cost-row-summary">
                              <strong>↳↳ {item.name}</strong>
                              <p>Individual item • {phaseLabel(item.phase)} • {item.date}</p>
                            </div>
                            <div className="cost-row-amount">{currency.format(item.amount)}</div>
                            <div className="button-row cost-row-actions">
                              <button type="button" className="action-button" onClick={() => handleStartEdit(item)}>Edit item</button>
                            </div>
                            <div className="cost-row-details">
                              {renderAttachedChecks(item.costId)}
                              {renderAttachmentArea(item)}
                            </div>
                          </div>
                        ))}
                      </div> : null}
                    </Fragment>
                  })}
                </div> : null}
              </Fragment>
            )
          })}
          {developmentCosts.length === 0 ? (
            <div className="cost-empty-state">
              <strong>No costs have been added yet</strong>
              <p>Add the first project cost, then create detailed breakdowns under it.</p>
              <button type="button" className="action-button" onClick={handleStartNewCost}>Add the first cost</button>
            </div>
          ) : (costListView === 'list' ? ledgerVisibleDateCosts.length === 0 : filteredDevelopmentCosts.length === 0) ? (
            <div className="cost-empty-state">
              <strong>No costs match these filters</strong>
              <p>Adjust the filters above or choose Clear filters to see all saved project costs.</p>
            </div>
          ) : null}
        </div>
      </section>

      <section ref={historyRef} className="panel cost-history-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Audit history</p>
            <h2>Cost versions</h2>
          </div>
          <button
            type="button"
            className="secondary-button"
            aria-expanded={showVersionHistory}
            aria-controls="cost-version-history"
            onClick={() => setShowVersionHistory((current) => !current)}
          >
            {showVersionHistory ? 'Hide version history' : `Show version history (${sortedVersions.length})`}
          </button>
        </div>
        {showVersionHistory ? (
          <div id="cost-version-history" className="table-card">
            {sortedVersions.map((cost) => (
              <div key={cost.id} className={`table-row ${cost.deletedAt ? 'deleted-row' : ''}`}>
                <div>
                  <strong>{cost.name} · v{cost.version || 1}</strong>
                  <p>Invoice {displayDate(cost.date)} • Version saved {displayDate(cost.createdAt)} • {phaseLabel(cost.phase)}{cost.paymentDate ? ` • Paid ${cost.paymentDate}` : ''}{cost.paymentFeePercentage != null ? ` • ${Number(cost.paymentFeePercentage).toFixed(2)}% card fee` : ''}{cost.deletedAt ? ` • Deleted ${cost.deletedAt.slice(0, 10)}` : ''}</p>
                </div>
                <div>{currency.format(cost.amount)}</div>
              </div>
            ))}
          </div>
        ) : null}
      </section>
      {receiptPreviewUrl && pendingReceipt?.file ? <AttachmentPreviewModal
        attachment={{
          name: pendingReceipt.file.name,
          mimeType: pendingReceipt.file.type,
        }}
        onClose={() => setReceiptPreviewUrl('')}
        onGetUrl={() => Promise.resolve(receiptPreviewUrl)}
      /> : null}
    </div>
  )
}

export default CostPage
