import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { amountToCheckWords } from './lib/checks'
import { currency } from './lib/currency'

const today = () => new Date().toLocaleDateString('en-CA')
const numericAmount = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const checkTemplates = {
  bofa: { label: 'Bank of America', accountLabel: 'Bank of America' },
  providence: { label: 'Providence Bank', accountLabel: 'Providence Bank' },
}
const calibrationTemplates = [
  { key: 'bofa-1', bank: 'Bank of America', className: 'bofa' },
  { key: 'bofa-2', bank: 'Bank of America', className: 'bofa' },
  { key: 'flagstar-1', bank: 'Flagstar Bank', className: 'flagstar' },
  { key: 'flagstar-2', bank: 'Flagstar Bank', className: 'flagstar' },
]

// Calibrated per bank on real HP LaserJet test prints — the two preprinted templates don't line
// up identically, so top/left are both split by bank. This is the base position, so the "Move
// individual fields" inputs correctly start at 0 — they represent further adjustment on top of
// this calibration, not the calibration itself.
const checkFieldCoordinates = {
  datePrefix: { top: { bofa: 0.6, providence: 0.72 }, left: { bofa: 3.19, providence: 3.3 } },
  dateYear: { top: { bofa: 0.6, providence: 0.72 }, left: { bofa: 4.44, providence: 4.55 } },
  payee: { top: { bofa: 1.04, providence: 1.11 }, left: { bofa: 1.05, providence: 0.82 } },
  amount: { top: { bofa: 1.04, providence: 1.12 }, left: { bofa: 4.26, providence: 4.33 } },
  words: { top: { bofa: 1.38, providence: 1.42 }, left: { bofa: 0.5, providence: 0.18 } },
  memo: { top: { bofa: 2.15, providence: 2.21 }, left: { bofa: 0.48, providence: 0.46 } },
}

const fieldCoordinateLabel = (field, templateKey, offsetIn = { x: 0, y: 0 }) => {
  const entry = checkFieldCoordinates[field]
  const left = (entry.left[templateKey] ?? entry.left.bofa) + offsetIn.x
  const top = (entry.top[templateKey] ?? entry.top.bofa) + offsetIn.y
  return `top ${top.toFixed(2)}in · left ${left.toFixed(2)}in`
}

const CHECK_WIDTH_IN = 6
const CHECK_HEIGHT_IN = 2.7
const editableFields = ['date', 'payee', 'amount', 'words', 'memo']
const editableFieldLabels = { date: 'Date', payee: 'Payee', amount: 'Amount', words: 'Amount in words', memo: 'Memo' }

const zeroFieldOffsets = { date: { x: '0', y: '0' }, payee: { x: '0', y: '0' }, amount: { x: '0', y: '0' }, words: { x: '0', y: '0' }, memo: { x: '0', y: '0' } }

// Field offsets are per-bank: the two preprinted templates don't line up identically, so a
// correction that's right for Providence (found by testing) can be wrong for Bank of America.
// Only Amount has a confirmed non-zero default so far — everything else starts at 0 until
// verified against a real test print for that bank.
const defaultFieldOffsets = {
  bofa: zeroFieldOffsets,
  providence: { ...zeroFieldOffsets, amount: { x: '0.06', y: '-0.01' } },
}

const FIELD_OFFSETS_STORAGE_KEY = 'greenfort-check-field-offsets'

const loadSavedFieldOffsets = () => {
  try {
    const raw = window.localStorage?.getItem(FIELD_OFFSETS_STORAGE_KEY)
    if (!raw) return defaultFieldOffsets
    const parsed = JSON.parse(raw)
    return {
      bofa: { ...defaultFieldOffsets.bofa, ...parsed.bofa },
      providence: { ...defaultFieldOffsets.providence, ...parsed.providence },
    }
  } catch {
    return defaultFieldOffsets
  }
}

const fieldOffsetIn = (offsets, templateKey, field) => ({
  x: Number(offsets?.[templateKey]?.[field]?.x) || 0,
  y: Number(offsets?.[templateKey]?.[field]?.y) || 0,
})

// Applies a field's inch offset directly to its print coordinates (both are already in inches,
// so no unit conversion is needed here — see previewFieldStyle for the responsive preview, which
// needs percent).
const printFieldStyle = (coordKey, offsets, field, templateKey) => {
  const entry = checkFieldCoordinates[coordKey]
  const top = entry.top[templateKey] ?? entry.top.bofa
  const left = entry.left[templateKey] ?? entry.left.bofa
  const offset = fieldOffsetIn(offsets, templateKey, field)
  return { top: `${top + offset.y}in`, left: `${left + offset.x}in` }
}

// Percent equivalent of the checkFieldCoordinates calibration above, expressed relative to the
// live preview's own box (which always represents a 6 x 2.7in check regardless of how large the
// box is rendered on screen). Inches are converted to percent of that fixed conceptual size so
// the nudge amount looks right at any zoom.
const previewFieldBase = {
  date: { top: { bofa: 15.445, providence: 19.889 }, left: { bofa: 50.834, providence: 52.667 } },
  payee: { top: { bofa: 34.296, providence: 36.889 }, left: { bofa: 19.333, providence: 14 } },
  amount: { top: { bofa: 34.296, providence: 37.259 }, right: { bofa: 13.334, providence: 12.167 } },
  words: { top: { bofa: 48.038, providence: 49.519 }, left: { bofa: 5, providence: 3 } },
  memo: { top: { bofa: 76.297, providence: 78.519 }, left: { bofa: 8.667, providence: 7.667 } },
}

const previewFieldStyle = (field, offsets, templateKey) => {
  const base = previewFieldBase[field]
  const offset = fieldOffsetIn(offsets, templateKey, field)
  const offsetXPct = (offset.x / CHECK_WIDTH_IN) * 100
  const offsetYPct = (offset.y / CHECK_HEIGHT_IN) * 100
  const top = base.top[templateKey] ?? base.top.bofa
  const style = { top: `${top + offsetYPct}%` }
  if (base.right) style.right = `${(base.right[templateKey] ?? base.right.bofa) - offsetXPct}%`
  else style.left = `${(base.left[templateKey] ?? base.left.bofa) + offsetXPct}%`
  return style
}

const checkDateParts = (date) => {
  const [year, month, day] = String(date || '').split('-')
  return year && month && day ? { prefix: `${month}/${day}/`, year: year.slice(-2) } : { prefix: date, year: '' }
}

const displayCheckNumber = (checkNumber, fallback = '') => {
  const value = String(checkNumber ?? '').trim()
  return value && value !== '0' ? value : fallback
}

const invoiceMemo = (invoice) => [
  invoice?.invoiceNumber ? `Inv ${invoice.invoiceNumber}` : '',
  invoice?.description || invoice?.classification || '',
].filter(Boolean).join(' · ').slice(0, 100)

const costMemo = (cost) => {
  const attachment = (cost?.attachments || []).find((entry) => entry.reference)
  const reference = attachment?.reference || String(cost?.details || '').match(/(?:Reference|Invoice(?:\s+(?:number|no\.?|#))?)\s*:\s*([^\n]+)/i)?.[1]?.trim()
  const lot = (cost?.lotAllocations || []).length === 1 ? cost.lotAllocations[0].lot : ''
  return [reference ? `Inv ${reference}` : '', cost?.name || '', lot].filter(Boolean).join(' · ').slice(0, 100)
}

const costMailingAddress = (cost) => (cost?.attachments || []).find((entry) => entry.vendorMailingAddress)?.vendorMailingAddress || ''

const errorMessage = (error, fallback = 'Unknown error') => {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object') {
    return error.message || error.details || error.hint || fallback
  }
  return typeof error === 'string' && error.trim() ? error : fallback
}

const isDuplicateCheckError = (error) => {
  const details = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  return error?.code === '23505' || details.includes('duplicate key') || details.includes('project_checks_project_id_check_number_key')
}

const jobLots = ['Lot 1', 'Lot 2', 'Lot 3', 'Lot 4']
const emptyList = []

function CheckPrinting({ project, checks = emptyList, invoices = emptyList, costs = emptyList, loanDraws = emptyList, vendorAddresses = emptyList, initialDraft = null, onInitialDraftApplied, onSaveCheck, onUpdateCheck, onUpdateStatus, onUpdateLink, onUpdateTemplate, onUpdateFunding, onUpdateLot, onEditCost, onAttachInvoice, onOpenDocument, onPrintPaidInvoice, onExtractVendorAddress, onSaveVendorAddress, onImportVendorAddresses }) {
  const [checkNumber, setCheckNumber] = useState('')
  const [payee, setPayee] = useState('')
  const [amount, setAmount] = useState('')
  const [checkDate, setCheckDate] = useState(today)
  const [memo, setMemo] = useState('')
  const [mailingAddress, setMailingAddress] = useState('')
  const [editingCheckId, setEditingCheckId] = useState(null)
  const [originalCheckNumber, setOriginalCheckNumber] = useState('')
  const [accountLabel, setAccountLabel] = useState('Bank of America')
  const [checkType, setCheckType] = useState('payment')
  const [destinationAccount, setDestinationAccount] = useState('')
  const [templateKey, setTemplateKey] = useState('bofa')
  const [message, setMessage] = useState(null)
  const [saving, setSaving] = useState(false)
  const [printingCheck, setPrintingCheck] = useState(null)
  const [printingTemplateSheet, setPrintingTemplateSheet] = useState(false)
  const [printingCarrierGuide, setPrintingCarrierGuide] = useState(false)
  const [printingEnvelope, setPrintingEnvelope] = useState(null)
  const [horizontalOffset, setHorizontalOffset] = useState('0')
  const [verticalOffset, setVerticalOffset] = useState('0')
  const [fieldOffsets, setFieldOffsets] = useState(loadSavedFieldOffsets)
  const [fieldOffsetsExpanded, setFieldOffsetsExpanded] = useState(false)
  const [fieldOffsetsSavedMessage, setFieldOffsetsSavedMessage] = useState('')
  const [printerPreset, setPrinterPreset] = useState('letter_voucher')
  const [envelopeRotation, setEnvelopeRotation] = useState('180')
  const [attachmentTarget, setAttachmentTarget] = useState('')
  const [fundingTarget, setFundingTarget] = useState('')
  const [lotTarget, setLotTarget] = useState('')
  const [linkingCheckId, setLinkingCheckId] = useState(null)
  const [fundingCheckId, setFundingCheckId] = useState(null)
  const [lotCheckId, setLotCheckId] = useState(null)
  const [viewingCheck, setViewingCheck] = useState(null)
  const [updatingTemplate, setUpdatingTemplate] = useState(false)
  const [pendingVoidedReprintId, setPendingVoidedReprintId] = useState(null)
  const [pendingVoidCheckId, setPendingVoidCheckId] = useState(null)
  const [extractingVendorAddress, setExtractingVendorAddress] = useState(false)
  const [importingVendorAddresses, setImportingVendorAddresses] = useState(false)
  const [envelopeSetupNeeded, setEnvelopeSetupNeeded] = useState(false)
  const [preparingEnvelope, setPreparingEnvelope] = useState(false)
  const [allowAdditionalCheck, setAllowAdditionalCheck] = useState(false)
  const [registerSearch, setRegisterSearch] = useState('')
  const [registerStatus, setRegisterStatus] = useState('all')
  const [registerLot, setRegisterLot] = useState('all')
  const [registerLink, setRegisterLink] = useState('all')
  const [registerDraw, setRegisterDraw] = useState('all')
  const [registerDateFrom, setRegisterDateFrom] = useState('')
  const [registerDateTo, setRegisterDateTo] = useState('')
  const [invoiceUpload, setInvoiceUpload] = useState(null)
  const [invoiceUploadMessage, setInvoiceUploadMessage] = useState('')
  const attachInvoice = async (cost, event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !onAttachInvoice) return
    setInvoiceUpload(cost.costId || cost.id)
    setInvoiceUploadMessage('')
    try {
      await onAttachInvoice(cost, file)
      setInvoiceUploadMessage(`Invoice attached to ${cost.name}.`)
    } catch (error) {
      setInvoiceUploadMessage(`Invoice upload failed: ${error.message || 'Please retry.'}`)
    } finally { setInvoiceUpload(null) }
  }
  const [constructionCoverageFilter, setConstructionCoverageFilter] = useState('all')
  const previewPanelRef = useRef(null)
  const attachmentSelectRef = useRef(null)
  const mailingAddressRef = useRef(null)

  useEffect(() => {
    if (!initialDraft) return
    const linkedCost = initialDraft.costId ? costs.find((cost) => String(cost.costId) === String(initialDraft.costId)) : null
    const linkedInvoice = initialDraft.invoiceId ? invoices.find((invoice) => Number(invoice.id) === Number(initialDraft.invoiceId)) : null
    setPayee(initialDraft.payee || '')
    setAmount(initialDraft.amount == null ? '' : String(initialDraft.amount))
    setCheckDate(initialDraft.date || today())
    setMemo(initialDraft.memo || '')
    setCheckType(initialDraft.checkType || 'payment')
    setDestinationAccount(initialDraft.destinationAccount || '')
    setMailingAddress(initialDraft.mailingAddress || costMailingAddress(linkedCost) || linkedInvoice?.vendorMailingAddress || linkedInvoice?.mailingAddress || '')
    setAttachmentTarget(initialDraft.costId ? `cost:${initialDraft.costId}` : '')
    setLotTarget(initialDraft.lot || '')
    if (initialDraft.templateKey && checkTemplates[initialDraft.templateKey]) {
      setTemplateKey(initialDraft.templateKey)
      setAccountLabel(initialDraft.accountLabel || checkTemplates[initialDraft.templateKey].accountLabel)
    }
    const source = initialDraft.costId ? 'saved cost' : initialDraft.invoiceId ? 'invoice' : 'payment request'
    setMessage({ type: 'success', text: `Check details were filled from the ${source}. Enter the preprinted check number and review before saving.` })
    onInitialDraftApplied?.()
  }, [costs, initialDraft, invoices, onInitialDraftApplied])

  const sortedChecks = useMemo(() => [...checks].sort((a, b) => (
    String(b.date).localeCompare(String(a.date)) || Number(b.id) - Number(a.id)
  )), [checks])

  const frequentPayees = useMemo(() => {
    const payees = new Map()
    sortedChecks.forEach((check) => {
      const key = check.payee.trim().toLowerCase()
      const existing = payees.get(key)
      payees.set(key, {
        name: existing?.name || check.payee,
        count: (existing?.count || 0) + 1,
        accountLabel: existing?.accountLabel || check.accountLabel,
        templateKey: existing?.templateKey || check.templateKey || 'bofa',
      })
    })
    return [...payees.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }, [sortedChecks])

  const accountingTargets = useMemo(() => [
    ...invoices.map((invoice) => ({
      value: `invoice:${invoice.id}`,
      label: `Invoice ${invoice.invoiceNumber || invoice.id} · ${invoice.vendorName || invoice.description || 'Vendor not set'} · ${currency.format(invoice.amount)}`,
    })),
    ...costs.map((cost) => ({
      value: `cost:${cost.costId}`,
      label: `Cost ${cost.name} · ${currency.format(cost.amount)}`,
    })),
  ], [costs, invoices])

  const drawRemaining = useMemo(() => {
    const totals = {}
    loanDraws.forEach((draw) => { totals[draw.id] = draw.amount })
    checks.forEach((check) => {
      if (check.status === 'voided' || check.checkType === 'internal_transfer' || check.fundedByIncomeId == null) return
      if (totals[check.fundedByIncomeId] != null) totals[check.fundedByIncomeId] -= check.amount
    })
    return totals
  }, [loanDraws, checks])

  const drawTargets = useMemo(() => loanDraws.map((draw) => ({
    value: String(draw.id),
    label: `${draw.description || 'Loan draw'} · ${draw.date} · ${currency.format(drawRemaining[draw.id] ?? draw.amount)} left of ${currency.format(draw.amount)}`,
  })), [loanDraws, drawRemaining])

  const parseAccountingTarget = (value) => {
    const [type, id] = String(value || '').split(':')
    if (type === 'invoice' && id) return { invoiceId: Number(id), costId: null }
    if (type === 'cost' && id) return { invoiceId: null, costId: id }
    return { invoiceId: null, costId: null }
  }

  const checkTargetValue = (check) => check.checkType === 'internal_transfer' ? '' : (check.invoiceId ? `invoice:${check.invoiceId}` : (check.costId ? `cost:${check.costId}` : ''))
  const documentsForTarget = (value) => {
    const { invoiceId, costId } = parseAccountingTarget(value)
    if (invoiceId) return invoices.find((entry) => Number(entry.id) === Number(invoiceId))?.attachments || []
    if (costId) return costs.find((entry) => String(entry.costId) === String(costId))?.attachments?.filter((entry) => entry?.storagePath) || []
    return []
  }
  const filteredChecks = useMemo(() => sortedChecks.filter((check) => {
    const target = checkTargetValue(check)
    const targetText = accountingTargets.find((entry) => entry.value === target)?.label || ''
    const searchText = `${check.checkNumber || ''} ${check.payee || ''} ${check.memo || ''} ${check.accountLabel || ''} ${check.destinationAccount || ''} ${targetText}`.toLowerCase()
    const normalizedSearch = registerSearch.trim().toLowerCase()
    const hasLink = Boolean(check.invoiceId || check.costId)
    const hasDocument = documentsForTarget(target).length > 0
    return (!normalizedSearch || searchText.includes(normalizedSearch))
      && (registerStatus === 'all' || check.status === registerStatus)
      && (registerLot === 'all' || (registerLot === 'unassigned' ? !check.lot : check.lot === registerLot))
      && (registerLink === 'all'
        || (registerLink === 'linked' && hasLink)
        || (registerLink === 'unlinked' && !hasLink && check.checkType !== 'internal_transfer')
        || (registerLink === 'invoice' && Boolean(check.invoiceId))
        || (registerLink === 'cost' && Boolean(check.costId))
        || (registerLink === 'missing_document' && check.checkType !== 'internal_transfer' && !hasDocument))
      && (registerDraw === 'all'
        || (registerDraw === 'unfunded' ? check.fundedByIncomeId == null : String(check.fundedByIncomeId) === registerDraw))
      && (!registerDateFrom || String(check.date || '') >= registerDateFrom)
      && (!registerDateTo || String(check.date || '') <= registerDateTo)
  }), [accountingTargets, costs, invoices, registerDateFrom, registerDateTo, registerDraw, registerLink, registerLot, registerSearch, registerStatus, sortedChecks])

  const registerTotal = useMemo(() => filteredChecks
    .filter((check) => check.status !== 'voided' && check.checkType !== 'internal_transfer')
    .reduce((sum, check) => sum + Number(check.amount || 0), 0), [filteredChecks])

  const constructionCoverage = useMemo(() => {
    const parentIds = new Set(costs.map((cost) => String(cost.parentCostId || '')).filter(Boolean))
    return costs
      .filter((cost) => cost.phase === 'construction' && !parentIds.has(String(cost.costId)))
      .map((cost) => {
        const relatedInvoices = invoices.filter((invoice) => String(invoice.costId || '') === String(cost.costId))
        const documents = [
          ...(cost.attachments || []).filter((attachment) => attachment?.storagePath),
          ...relatedInvoices.flatMap((invoice) => invoice.attachments || []),
        ]
        const invoiceIds = new Set(relatedInvoices.map((invoice) => String(invoice.id)))
        const activeChecks = checks.filter((check) => check.status !== 'voided' && check.checkType !== 'internal_transfer' && (
          String(check.costId || '') === String(cost.costId) || invoiceIds.has(String(check.invoiceId || ''))
        ))
        const paid = activeChecks.reduce((sum, check) => sum + Number(check.amount || 0), 0)
        return { cost, relatedInvoices, documents, activeChecks, paid, hasInvoice: documents.length > 0 }
      })
      .sort((left, right) => String(right.cost.date || '').localeCompare(String(left.cost.date || '')) || left.cost.name.localeCompare(right.cost.name))
  }, [checks, costs, invoices])

  const visibleConstructionCoverage = useMemo(() => constructionCoverage.filter((entry) => (
    constructionCoverageFilter === 'all'
      || (constructionCoverageFilter === 'missing_invoice' && !entry.hasInvoice)
      || (constructionCoverageFilter === 'with_invoice' && entry.hasInvoice)
      || (constructionCoverageFilter === 'unpaid' && entry.paid + 0.009 < Number(entry.cost.amount || 0))
      || (constructionCoverageFilter === 'paid' && entry.paid + 0.009 >= Number(entry.cost.amount || 0))
  )), [constructionCoverage, constructionCoverageFilter])

  const constructionCoverageTotals = useMemo(() => ({
    total: constructionCoverage.reduce((sum, entry) => sum + Number(entry.cost.amount || 0), 0),
    invoiceDocumented: constructionCoverage.filter((entry) => entry.hasInvoice).reduce((sum, entry) => sum + Number(entry.cost.amount || 0), 0),
    paid: constructionCoverage.reduce((sum, entry) => sum + Math.min(Number(entry.cost.amount || 0), entry.paid), 0),
    missingInvoice: constructionCoverage.filter((entry) => !entry.hasInvoice).length,
  }), [constructionCoverage])

  const clearRegisterFilters = () => {
    setRegisterSearch('')
    setRegisterStatus('all')
    setRegisterLot('all')
    setRegisterLink('all')
    setRegisterDraw('all')
    setRegisterDateFrom('')
    setRegisterDateTo('')
  }
  const vendorNameForTarget = (value) => {
    const { invoiceId, costId } = parseAccountingTarget(value)
    if (invoiceId) return invoices.find((entry) => Number(entry.id) === Number(invoiceId))?.vendorName || payee.trim()
    if (costId) {
      const cost = costs.find((entry) => String(entry.costId) === String(costId))
      return (cost?.attachments || []).find((entry) => entry.vendor)?.vendor || payee.trim()
    }
    return payee.trim()
  }
  const previewTargetDocument = (value) => {
    const [document] = documentsForTarget(value)
    if (!document || !onOpenDocument) return
    onOpenDocument(document)
  }
  const selectedDocuments = documentsForTarget(attachmentTarget)
  const activeTargetChecks = attachmentTarget ? sortedChecks.filter((savedCheck) => (
    savedCheck.id !== editingCheckId
    && savedCheck.status !== 'voided'
    && checkTargetValue(savedCheck) === attachmentTarget
  )) : []
  const previewData = viewingCheck || { checkNumber, payee, amount, date: checkDate, memo, accountLabel, templateKey, checkType, destinationAccount, status: 'draft', ...parseAccountingTarget(attachmentTarget) }
  const checkNumberWasChanged = Boolean(editingCheckId && originalCheckNumber && checkNumber.trim() !== originalCheckNumber.trim())
  const editingCheckWasVoided = sortedChecks.some((check) => check.id === editingCheckId && check.status === 'voided')
  const previewTarget = accountingTargets.find((target) => target.value === checkTargetValue(previewData))
  const previewTemplate = checkTemplates[previewData.templateKey] || checkTemplates.bofa

  const resetForm = () => {
    setCheckNumber('')
    setPayee('')
    setAmount('')
    setCheckDate(today())
    setMemo('')
    setMailingAddress('')
    setCheckType('payment')
    setDestinationAccount('')
    setEditingCheckId(null)
    setOriginalCheckNumber('')
    setAttachmentTarget('')
    setFundingTarget('')
    setLotTarget('')
    setTemplateKey('bofa')
    setAccountLabel(checkTemplates.bofa.accountLabel)
    setAllowAdditionalCheck(false)
  }

  const saveCheck = async (event) => {
    event.preventDefault()
    setMessage(null)
    const numericAmount = Number(amount)
    const normalizedCheckNumber = checkNumber.trim()
    if (!normalizedCheckNumber) return setMessage({ type: 'error', text: 'Enter the number printed on the check.' })
    if (sortedChecks.some((check) => check.id !== editingCheckId && String(check.checkNumber).trim().toLowerCase() === normalizedCheckNumber.toLowerCase())) {
      return setMessage({ type: 'error', text: `Check #${normalizedCheckNumber} is already saved for ${project.name}. Open it in the check register to view or reprint it, or enter a different preprinted check number.` })
    }
    if (!payee.trim()) return setMessage({ type: 'error', text: 'Enter the person or company being paid.' })
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return setMessage({ type: 'error', text: 'Enter a check amount greater than $0.00.' })
    if (!checkDate) return setMessage({ type: 'error', text: 'Select the check date.' })
    if (!accountLabel.trim()) return setMessage({ type: 'error', text: 'Enter a safe account label, such as Bank of America Operating.' })
    if (checkType === 'internal_transfer' && !destinationAccount.trim()) return setMessage({ type: 'error', text: 'Enter the Green Fort account receiving this transfer.' })
    if (checkType === 'internal_transfer' && destinationAccount.trim().toLowerCase() === accountLabel.trim().toLowerCase()) return setMessage({ type: 'error', text: 'The source and destination accounts must be different.' })
    if (checkType !== 'internal_transfer' && activeTargetChecks.length && !allowAdditionalCheck) {
      return setMessage({ type: 'error', text: `${activeTargetChecks.length} active check${activeTargetChecks.length === 1 ? ' is' : 's are'} already attached to this cost or invoice. Confirm that this is an intentional additional or partial payment before saving another check.` })
    }
    if (editingCheckId ? !onUpdateCheck : !onSaveCheck) return setMessage({ type: 'error', text: 'Check saving is unavailable. Sign in and select a project.' })
    setSaving(true)
    try {
      const payload = {
        projectId: project.id,
        checkNumber: normalizedCheckNumber,
        payee: payee.trim(),
        amount: numericAmount,
        date: checkDate,
        memo: memo.trim(),
        mailingAddress: checkType === 'internal_transfer' ? '' : mailingAddress.trim(),
        accountLabel: accountLabel.trim(),
        templateKey,
        checkType,
        destinationAccount: checkType === 'internal_transfer' ? destinationAccount.trim() : '',
        ...(checkType === 'internal_transfer' ? { invoiceId: null, costId: null } : parseAccountingTarget(attachmentTarget)),
        fundedByIncomeId: checkType === 'internal_transfer' ? null : (fundingTarget ? Number(fundingTarget) : null),
        lot: checkType === 'internal_transfer' ? null : (lotTarget || null),
      }
      const saved = editingCheckId
        ? await onUpdateCheck(editingCheckId, payload)
        : await onSaveCheck(payload)
      if (saved) setViewingCheck(saved)
      setMessage({ type: 'success', text: editingCheckId
        ? `Check ${normalizedCheckNumber} updated. Review it, then print or reprint.`
        : `Check ${normalizedCheckNumber} saved. Review it in the register before printing.` })
      resetForm()
    } catch (error) {
      setMessage({
        type: 'error',
        text: isDuplicateCheckError(error)
          ? `Check #${normalizedCheckNumber} is already saved for ${project.name}. Open it in the check register to view or reprint it, or enter a different preprinted check number.`
          : `The check could not be saved: ${errorMessage(error)}`,
      })
    } finally {
      setSaving(false)
    }
  }

  const validatePrintOffset = (preset = printerPreset) => {
    const xOffset = Number(horizontalOffset) || 0
    if (preset === 'direct' && (xOffset < -0.15 || xOffset > 0.4)) {
      setMessage({ type: 'error', text: 'This offset would cut fields off the 6-inch check. Center the check in the HP priority feed slot, move both side guides snug to its edges, and keep the software adjustment between -0.15 and +0.40 inches.' })
      return false
    }
    return true
  }

  const printCheck = async (check) => {
    setMessage(null)
    if (!validatePrintOffset()) return
    try {
      setPrintingTemplateSheet(false)
      setPrintingCarrierGuide(false)
      setPrintingEnvelope(null)
      const printable = check.status === 'printed' ? check : await onUpdateStatus(check.id, 'printed')
      setPrintingCheck(printable)
      if (viewingCheck?.id === check.id) setViewingCheck(printable)
      window.setTimeout(() => window.print(), 0)
    } catch (error) {
      setMessage({ type: 'error', text: `The check could not be prepared for printing: ${errorMessage(error)}` })
    }
  }

  const printMockCheck = () => {
    setMessage(null)
    setPrintingTemplateSheet(false)
    setPrintingCarrierGuide(false)
    setPrintingEnvelope(null)
    setPrintingCheck({
      id: 'mock-alignment-check',
      checkNumber: checkNumber.trim() || 'TEST',
      payee: payee.trim() || 'Alignment Test Payee',
      amount: Number(amount) > 0 ? Number(amount) : 123.45,
      date: checkDate || today(),
      memo: memo.trim() || 'Alignment test',
      accountLabel: accountLabel.trim() || checkTemplates[templateKey].accountLabel,
      templateKey,
      status: 'mock',
    })
    window.setTimeout(() => window.print(), 0)
  }

  const printCalibrationSheet = () => {
    setMessage(null)
    setPrintingCheck(null)
    setPrintingCarrierGuide(false)
    setPrintingEnvelope(null)
    setPrintingTemplateSheet(true)
    window.setTimeout(() => window.print(), 0)
  }

  const printCarrierGuide = () => {
    setMessage(null)
    setPrintingCheck(null)
    setPrintingTemplateSheet(false)
    setPrintingEnvelope(null)
    setPrintingCarrierGuide(true)
    window.setTimeout(() => window.print(), 0)
  }

  const voidCheck = async (check) => {
    setPendingVoidCheckId(null)
    setMessage(null)
    try {
      const saved = await onUpdateStatus(check.id, 'voided')
      if (viewingCheck?.id === check.id && saved) setViewingCheck(saved)
      setMessage({ type: 'success', text: `Check ${check.checkNumber} was voided and remains in the register. Its linked cost is now treated as unpaid.` })
    } catch (error) {
      setMessage({ type: 'error', text: `The check could not be voided: ${errorMessage(error)}` })
    }
  }

  const confirmVoidedReprint = async (check) => {
    setPendingVoidedReprintId(null)
    await printCheck(check)
  }

  const changePayee = (nextPayee) => {
    setPayee(nextPayee)
    if (nextPayee.trim().toLowerCase().replace(/[^a-z0-9]/g, '') === 'greenfortllc') {
      setCheckType('internal_transfer')
      setAttachmentTarget('')
      setFundingTarget('')
      setLotTarget('')
      setMailingAddress('')
      setEnvelopeSetupNeeded(false)
    }
  }

  const selectPayee = (savedPayee) => {
    changePayee(savedPayee.name)
    if (savedPayee.accountLabel) setAccountLabel(savedPayee.accountLabel)
    if (savedPayee.templateKey && checkTemplates[savedPayee.templateKey]) setTemplateKey(savedPayee.templateKey)
  }

  const changeTemplate = (nextTemplateKey) => {
    const template = checkTemplates[nextTemplateKey] || checkTemplates.bofa
    setTemplateKey(nextTemplateKey)
    setAccountLabel(template.accountLabel)
  }

  const changePrinterPreset = (preset) => {
    setPrinterPreset(preset)
    setHorizontalOffset('0')
    setVerticalOffset('0')
  }

  const changeFieldOffset = (bankKey, field, axis, value) => {
    setFieldOffsets((current) => ({ ...current, [bankKey]: { ...current[bankKey], [field]: { ...current[bankKey][field], [axis]: value } } }))
    setFieldOffsetsSavedMessage('')
  }

  const saveFieldOffsets = () => {
    try {
      window.localStorage?.setItem(FIELD_OFFSETS_STORAGE_KEY, JSON.stringify(fieldOffsets))
      setFieldOffsetsSavedMessage('Saved — these positions will load automatically next time.')
    } catch {
      setFieldOffsetsSavedMessage('Could not save to this browser. Positions will reset next time you open the app.')
    }
  }

  const changeSavedTemplate = async (nextTemplateKey) => {
    if (!viewingCheck || !onUpdateTemplate) {
      setMessage({ type: 'error', text: 'Changing the saved check template is unavailable. Sign in and retry.' })
      return
    }
    const template = checkTemplates[nextTemplateKey] || checkTemplates.bofa
    setUpdatingTemplate(true)
    setMessage(null)
    try {
      const saved = await onUpdateTemplate(viewingCheck.id, nextTemplateKey, template.accountLabel)
      setViewingCheck(saved)
      setMessage({ type: 'success', text: `Check ${viewingCheck.checkNumber} now uses the ${template.label} layout.` })
    } catch (error) {
      setMessage({ type: 'error', text: `The saved template could not be changed: ${errorMessage(error)}` })
    } finally {
      setUpdatingTemplate(false)
    }
  }

  const changeCheckLink = async (check, value) => {
    if (!onUpdateLink) {
      setMessage({ type: 'error', text: 'Check attachment changes are unavailable. Sign in and retry.' })
      return
    }
    setLinkingCheckId(check.id)
    setMessage(null)
    try {
      const saved = await onUpdateLink(check.id, parseAccountingTarget(value))
      if (viewingCheck?.id === check.id && saved) setViewingCheck(saved)
      const target = accountingTargets.find((entry) => entry.value === value)
      setMessage({ type: 'success', text: value ? `Check ${check.checkNumber} attached to ${target?.label || 'the selected record'}.` : `Check ${check.checkNumber} is now unassigned.` })
    } catch (error) {
      setMessage({ type: 'error', text: `The check attachment could not be changed: ${errorMessage(error)}` })
    } finally {
      setLinkingCheckId(null)
    }
  }

  const changeCheckFunding = async (check, value) => {
    if (!onUpdateFunding) {
      setMessage({ type: 'error', text: 'Draw funding changes are unavailable. Sign in and retry.' })
      return
    }
    setFundingCheckId(check.id)
    setMessage(null)
    try {
      const fundedByIncomeId = value ? Number(value) : null
      const saved = await onUpdateFunding(check.id, fundedByIncomeId)
      if (viewingCheck?.id === check.id && saved) setViewingCheck(saved)
      const target = drawTargets.find((entry) => entry.value === value)
      setMessage({ type: 'success', text: value ? `Check ${check.checkNumber} marked as funded by ${target?.label || 'the selected draw'}.` : `Check ${check.checkNumber} is no longer linked to a draw.` })
    } catch (error) {
      setMessage({ type: 'error', text: `The draw funding could not be changed: ${errorMessage(error)}` })
    } finally {
      setFundingCheckId(null)
    }
  }

  const changeCheckLot = async (check, value) => {
    if (!onUpdateLot) {
      setMessage({ type: 'error', text: 'Lot changes are unavailable. Sign in and retry.' })
      return
    }
    setLotCheckId(check.id)
    setMessage(null)
    try {
      const saved = await onUpdateLot(check.id, value || null)
      if (viewingCheck?.id === check.id && saved) setViewingCheck(saved)
      setMessage({ type: 'success', text: value ? `Check ${check.checkNumber} marked as spending for ${value}.` : `Check ${check.checkNumber} is no longer tagged to a lot.` })
    } catch (error) {
      setMessage({ type: 'error', text: `The lot could not be changed: ${errorMessage(error)}` })
    } finally {
      setLotCheckId(null)
    }
  }

  const changeAccountingTarget = (value) => {
    setAttachmentTarget(value)
    const { invoiceId, costId } = parseAccountingTarget(value)
    if (invoiceId) {
      const invoice = invoices.find((entry) => Number(entry.id) === invoiceId)
      if (!payee.trim() && invoice?.vendorName) setPayee(invoice.vendorName)
      if (!memo.trim()) setMemo(invoiceMemo(invoice))
      if (!mailingAddress.trim() && (invoice?.vendorMailingAddress || invoice?.mailingAddress)) setMailingAddress(invoice.vendorMailingAddress || invoice.mailingAddress)
    } else if (costId) {
      const cost = costs.find((entry) => String(entry.costId) === String(costId))
      const attachment = (cost?.attachments || []).find((entry) => entry.vendor)
      if (!payee.trim() && attachment?.vendor) setPayee(attachment.vendor)
      if (!memo.trim()) setMemo(costMemo(cost))
      if (!mailingAddress.trim()) setMailingAddress(costMailingAddress(cost))
    }
  }

  const addAddressFromInvoice = async () => {
    const { invoiceId, costId } = parseAccountingTarget(attachmentTarget)
    let address = ''
    if (invoiceId) {
      const invoice = invoices.find((entry) => Number(entry.id) === invoiceId)
      address = invoice?.vendorMailingAddress || invoice?.mailingAddress || ''
    } else if (costId) {
      address = costMailingAddress(costs.find((entry) => String(entry.costId) === String(costId)))
    }
    if (!invoiceId && !costId) {
      setMessage({ type: 'error', text: 'Attach this check to an invoice or invoice cost first.' })
      return
    }
    if (!address && onExtractVendorAddress) {
      const [document] = documentsForTarget(attachmentTarget)
      if (document) {
        setExtractingVendorAddress(true)
        setMessage({ type: 'success', text: 'Reading the vendor mailing address from the attached invoice…' })
        try {
          address = await onExtractVendorAddress(document, vendorNameForTarget(attachmentTarget))
        } catch (error) {
          setMessage({ type: 'error', text: `The invoice address could not be analyzed: ${errorMessage(error)}` })
          return
        } finally {
          setExtractingVendorAddress(false)
        }
      }
    }
    if (!address) {
      setMessage({ type: 'error', text: 'No vendor/remittance mailing address was found on the attached invoice. Enter the To address manually and review it before printing.' })
      return
    }
    setMailingAddress(address)
    const vendorName = vendorNameForTarget(attachmentTarget)
    if (onSaveVendorAddress && vendorName) {
      try {
        await onSaveVendorAddress({ name: vendorName, mailingAddress: address })
        setMessage({ type: 'success', text: 'The vendor mailing address was added from the invoice and saved for future envelopes. Review it before printing.' })
        return
      } catch (error) {
        setMessage({ type: 'error', text: `The address was added to this check but could not be saved to the vendor address book: ${errorMessage(error)}` })
        return
      }
    }
    setMessage({ type: 'success', text: 'The vendor mailing address was added from the invoice. Review it before printing.' })
  }

  const saveCurrentVendorAddress = async () => {
    if (!payee.trim() || !mailingAddress.trim()) {
      setMessage({ type: 'error', text: 'Enter both the payee and mailing address before saving it to the address book.' })
      return
    }
    if (!onSaveVendorAddress) {
      setMessage({ type: 'error', text: 'The vendor address book is unavailable. Sign in and retry.' })
      return
    }
    try {
      await onSaveVendorAddress({ name: payee.trim(), mailingAddress: mailingAddress.trim() })
      setMessage({ type: 'success', text: `${payee.trim()} was saved to the vendor address book for future envelopes.` })
    } catch (error) {
      setMessage({ type: 'error', text: `The vendor address could not be saved: ${errorMessage(error)}` })
    }
  }

  const selectSavedVendorAddress = (vendorId) => {
    const vendor = vendorAddresses.find((entry) => String(entry.id) === String(vendorId))
    if (!vendor) return
    setPayee(vendor.name)
    setMailingAddress(vendor.mailingAddress)
    setMessage({ type: 'success', text: `${vendor.name}'s saved mailing address is ready for the envelope.` })
  }

  const importVendorAddresses = async () => {
    if (!onImportVendorAddresses) return
    setImportingVendorAddresses(true)
    setMessage({ type: 'success', text: 'Reading vendor addresses from the project invoices…' })
    try {
      const result = await onImportVendorAddresses()
      setMessage({ type: 'success', text: `Address import complete: ${result.imported} address${result.imported === 1 ? '' : 'es'} found across ${result.reviewed} attached invoice${result.reviewed === 1 ? '' : 's'} and saved for future envelopes.` })
    } catch (error) {
      setMessage({ type: 'error', text: `Vendor addresses could not be imported: ${errorMessage(error)}` })
    } finally {
      setImportingVendorAddresses(false)
    }
  }

  const mailingAddressForCheck = (check) => {
    if (check?.mailingAddress) return check.mailingAddress
    if (check?.invoiceId) {
      const invoice = invoices.find((entry) => Number(entry.id) === Number(check.invoiceId))
      if (invoice?.vendorMailingAddress || invoice?.mailingAddress) return invoice.vendorMailingAddress || invoice.mailingAddress
    }
    if (check?.costId) return costMailingAddress(costs.find((entry) => String(entry.costId) === String(check.costId)))
    return ''
  }

  const editSavedCheck = (check) => {
    setEditingCheckId(check.id)
    setOriginalCheckNumber(String(check.checkNumber || ''))
    setCheckNumber(String(check.checkNumber || ''))
    setPayee(check.payee || '')
    setAmount(check.amount == null ? '' : String(check.amount))
    setCheckDate(check.date || today())
    setMemo(check.memo || '')
    setCheckType(check.checkType || 'payment')
    setDestinationAccount(check.destinationAccount || '')
    setMailingAddress(check.checkType === 'internal_transfer' ? '' : mailingAddressForCheck(check))
    setAccountLabel(check.accountLabel || checkTemplates[check.templateKey || 'bofa']?.accountLabel || '')
    setTemplateKey(check.templateKey || 'bofa')
    setAttachmentTarget(check.checkType === 'internal_transfer' ? '' : checkTargetValue(check))
    setFundingTarget(check.checkType === 'internal_transfer' ? '' : (check.fundedByIncomeId ? String(check.fundedByIncomeId) : ''))
    setLotTarget(check.checkType === 'internal_transfer' ? '' : (check.lot || ''))
    setViewingCheck(null)
    setMessage({ type: 'success', text: `Editing saved check ${check.checkNumber}. Save changes before reprinting.` })
  }

  const openEnvelopeSetup = (check = null, reason = 'missing') => {
    if (check) editSavedCheck(check)
    setEnvelopeSetupNeeded(true)
    setMessage({
      type: 'error',
      text: reason === 'unattached'
        ? 'No invoice is attached to this check. Attach one now so its vendor address can be read, or enter the payee address manually.'
        : 'The attached invoice does not contain a readable vendor mailing address. Enter it manually, or attach a different invoice.',
    })
    window.setTimeout(() => mailingAddressRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }), 0)
  }

  const printEnvelope = async (check = null) => {
    if ((check?.checkType || checkType) === 'internal_transfer') {
      setMessage({ type: 'error', text: 'Internal account transfers do not use vendor envelopes.' })
      return
    }
    const targetValue = check ? checkTargetValue(check) : attachmentTarget
    const envelope = check
      ? { ...check, mailingAddress: mailingAddressForCheck(check) }
      : { payee, mailingAddress }
    if (!String(envelope.payee || '').trim()) {
      setMessage({ type: 'error', text: 'Enter the payee before printing an envelope.' })
      return
    }

    let resolvedAddress = String(envelope.mailingAddress || '').trim()
    if (targetValue) {
      const { invoiceId, costId } = parseAccountingTarget(targetValue)
      if (invoiceId) {
        const invoice = invoices.find((entry) => Number(entry.id) === Number(invoiceId))
        resolvedAddress = String(invoice?.vendorMailingAddress || invoice?.mailingAddress || resolvedAddress).trim()
      } else if (costId) {
        resolvedAddress = String(costMailingAddress(costs.find((entry) => String(entry.costId) === String(costId))) || resolvedAddress).trim()
      }

      if (!resolvedAddress && onExtractVendorAddress) {
        const [document] = documentsForTarget(targetValue)
        if (document) {
          setPreparingEnvelope(true)
          setMessage({ type: 'success', text: 'Reading the vendor mailing address from the attached invoice…' })
          try {
            resolvedAddress = String(await onExtractVendorAddress(document, vendorNameForTarget(targetValue)) || '').trim()
          } catch (error) {
            setMessage({ type: 'error', text: `The invoice address could not be analyzed: ${errorMessage(error)}` })
          } finally {
            setPreparingEnvelope(false)
          }
        }
      }
    }

    if (!resolvedAddress) {
      openEnvelopeSetup(check, targetValue ? 'missing' : 'unattached')
      return
    }
    if (!check) setMailingAddress(resolvedAddress)
    setEnvelopeSetupNeeded(false)
    setMessage(null)
    setPrintingCheck(null)
    setPrintingTemplateSheet(false)
    setPrintingCarrierGuide(false)
    setPrintingEnvelope({ payee: envelope.payee.trim(), mailingAddress: resolvedAddress })
    window.setTimeout(() => window.print(), 0)
  }

  const printPaidInvoice = (check = null) => {
    if ((check?.checkType || checkType) === 'internal_transfer') {
      setMessage({ type: 'error', text: 'Internal account transfers are not vendor costs and do not have paid invoices.' })
      return
    }
    const targetValue = check ? checkTargetValue(check) : attachmentTarget
    const [document] = documentsForTarget(targetValue)
    if (!targetValue) {
      openEnvelopeSetup(check, 'unattached')
      setMessage({ type: 'error', text: 'Attach an invoice before printing a paid copy to include with the envelope.' })
      window.setTimeout(() => attachmentSelectRef.current?.focus(), 0)
      return
    }
    if (!document) {
      setMessage({ type: 'error', text: 'The selected invoice does not have a printable attachment. Attach the invoice file, then try again.' })
      return
    }
    if (!onPrintPaidInvoice) {
      setMessage({ type: 'error', text: 'Paid invoice printing is unavailable. Sign in and retry.' })
      return
    }
    setPrintingCheck(null)
    setPrintingTemplateSheet(false)
    setPrintingCarrierGuide(false)
    setPrintingEnvelope(null)
    const source = check || { checkNumber, date: checkDate, payee, amount }
    onPrintPaidInvoice(document, {
      checkNumber: String(source.checkNumber || '').trim(),
      date: source.date || '',
      payee: String(source.payee || '').trim(),
      amount: Number(source.amount) > 0 ? currency.format(Number(source.amount)) : '',
    })
  }

  const viewSavedCheck = (check) => {
    setViewingCheck(check)
    previewPanelRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  }

  const carrierLeftMarginIn = 1.25 + (Number(horizontalOffset) || 0)
  const carrierTopMarginIn = 1 + (Number(verticalOffset) || 0)
  const envelopePreview = viewingCheck
    ? { payee: viewingCheck.payee || '', mailingAddress: mailingAddressForCheck(viewingCheck) }
    : { payee, mailingAddress }
  const envelopeAddressLines = String(envelopePreview.mailingAddress || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)

  return <>
    <section className="section-grid check-printing-layout">
      <div className="panel">
        <div className="panel-header">
          <div><p className="eyebrow">Payment checks</p><h2>Prepare a check</h2></div>
        </div>
        <p className="hero-copy">For preprinted check stock. Store only a safe account label—never enter a routing or full account number.</p>
        <div className="check-print-instructions">
          <strong>Printer setup for this check</strong>
          <span>{printerPreset === 'letter_voucher' ? 'Paper: Letter-size voucher check stock (8.5 × 11 in) — the check prints as a tall 2.7 × 6 in panel, centered horizontally near the top of the sheet, feed it like ordinary Letter paper' : printerPreset === 'hp1102_carrier' ? 'Paper: Letter carrier with the 6 × 2.7 check mounted at the guide position' : printerPreset === 'direct_rotated' ? 'Paper: custom 2.7 × 6 inches · Feed: narrow 2.7-inch edge entering first (as fed into the P1102 priority slot), printed face up · Content is pre-rotated 90° to read correctly' : 'Paper: custom 6 × 3 inches · Tape a 0.3-inch blank tab below the check’s bottom edge so the fed sheet totals 6 × 3 inches · Horizontal feed: 6-inch side across the tray, 3-inch edge entering first, printed face up'} · Scale: 100% · Margins: none · Headers and footers: off</span>
          <label className="printer-preset-control">Printer feed preset
            <select aria-label="Printer feed preset" value={printerPreset} onChange={(event) => changePrinterPreset(event.target.value)}>
              <option value="letter_voucher">Letter-size voucher check — direct print (recommended)</option>
              <option value="hp1102_carrier">HP LaserJet P1102 — carrier sheet</option>
              <option value="direct">6 × 3-inch page layout — needs a 0.3in tab on the P1102</option>
              <option value="direct_rotated">P1102 narrow-edge feed, rotated 90° — not supported on the P1102</option>
            </select>
          </label>
          <div className="check-alignment-controls">
            <label>Move right / left (inches)<input aria-label="Horizontal check print adjustment" type="number" min={printerPreset === 'hp1102_carrier' || printerPreset === 'letter_voucher' ? '-0.75' : '-2'} max={printerPreset === 'hp1102_carrier' || printerPreset === 'letter_voucher' ? '0.75' : '2'} step="0.01" value={horizontalOffset} onChange={(event) => setHorizontalOffset(event.target.value)} /></label>
            <label>Move down / up (inches)<input aria-label="Vertical check print adjustment" type="number" min="-1" max="1" step="0.01" value={verticalOffset} onChange={(event) => setVerticalOffset(event.target.value)} /></label>
          </div>
          <div className="check-field-offset-controls">
            <div className="check-field-offset-toggle-row">
              <button type="button" className="check-field-offset-toggle" aria-expanded={fieldOffsetsExpanded} onClick={() => setFieldOffsetsExpanded((current) => !current)}>
                <strong>Move individual fields (inches)</strong>
                <span className="check-field-offset-toggle-icon" aria-hidden="true">{fieldOffsetsExpanded ? '▾' : '▸'}</span>
              </button>
              <span className="check-field-offset-bank">Editing: {previewTemplate.label}</span>
            </div>
            {fieldOffsetsExpanded ? <>
              <span>Nudges this field only, on top of the position above — shows live in the preview to the right. Saved separately per bank, since the two templates don’t line up identically.</span>
              {editableFields.map((field) => <div key={field} className="check-field-offset-row">
                <span>{editableFieldLabels[field]}</span>
                <label>Right / left<input aria-label={`${editableFieldLabels[field]} horizontal adjustment`} type="number" min="-1" max="1" step="0.01" value={fieldOffsets[previewData.templateKey || 'bofa'][field].x} onChange={(event) => changeFieldOffset(previewData.templateKey || 'bofa', field, 'x', event.target.value)} /></label>
                <label>Down / up<input aria-label={`${editableFieldLabels[field]} vertical adjustment`} type="number" min="-1" max="1" step="0.01" value={fieldOffsets[previewData.templateKey || 'bofa'][field].y} onChange={(event) => changeFieldOffset(previewData.templateKey || 'bofa', field, 'y', event.target.value)} /></label>
              </div>)}
              <div className="button-row">
                <button type="button" className="secondary-button" onClick={saveFieldOffsets}>Save field positions</button>
              </div>
              {fieldOffsetsSavedMessage ? <span className="check-field-offset-saved" role="status">{fieldOffsetsSavedMessage}</span> : null}
            </> : null}
          </div>
          <small>{printerPreset === 'letter_voucher' ? 'Tall 2.7 × 6 in check, centered horizontally with a small 0.25 in top margin — rotated internally so the printed text still reads normally.' : printerPreset === 'hp1102_carrier' ? 'Use a laser-printer-safe carrier. Mount the check centered horizontally — 1.25 inches from each of the Letter sheet’s left and right edges — and 1 inch from the top, matching the printable guide — these offsets also shift the guide’s placement box, so print it again after adjusting to confirm the new mounting spot.' : printerPreset === 'direct_rotated' ? 'HP lists the P1102’s minimum custom paper size as 3 × 5 in. This page is only 2.7 in wide, below that floor — expect blank output. Use the 6 × 3-inch direct mode or carrier-sheet mode instead.' : 'HP lists the P1102’s minimum custom paper size as 3 × 5 in. The check alone (2.7 in) is below that floor, so this mode assumes a 0.3-inch blank paper tab taped to the check’s bottom edge to reach 3 in — untested against a real 3 × 5 in floor, verify before trusting it with a real check.'} Positive values fine-tune printing right or down.</small>
          {printerPreset === 'hp1102_carrier' ? <div className="button-row"><button type="button" className="secondary-button" onClick={printCarrierGuide}>Print carrier placement guide</button></div> : printerPreset === 'direct_rotated' ? <p className="printer-compatibility-warning"><strong>Not supported on the HP P1102:</strong> its minimum custom paper size is 3 × 5 in, and this page is 2.7 in on its short edge — below that floor. Switch to carrier-sheet mode for reliable placement.</p> : printerPreset === 'direct' ? <p className="printer-compatibility-warning"><strong>Experimental:</strong> pads the check to 6 × 3 in with a blank tab to try to clear the P1102’s 3 × 5 in minimum. Confirm with the alignment test before risking a real check.</p> : null}
        </div>
        <div className="check-template-test-card">
          <div><strong>Alignment test—nothing is saved</strong><span>{printerPreset === 'letter_voucher' ? 'Prints the current printer preset’s Letter-size voucher page' : printerPreset === 'hp1102_carrier' ? 'Prints the current printer preset’s Letter carrier page' : printerPreset === 'direct_rotated' ? 'Prints the current printer preset’s 2.7 × 6-inch rotated page' : 'Prints the current printer preset’s 6 × 3-inch page'} using the form values or automatic mock data.</span></div>
          <button type="button" className="action-button" onClick={printMockCheck}>{printerPreset === 'letter_voucher' ? 'Print Letter voucher mock alignment check' : printerPreset === 'hp1102_carrier' ? 'Print Letter carrier mock alignment check' : printerPreset === 'direct_rotated' ? 'Print 2.7 × 6 rotated mock alignment check' : 'Print 6 × 3 mock alignment check'}</button>
        </div>
        <div className="check-template-test-card">
          <div><strong>Full-size template test sheet</strong><span>Four checks fit on one Letter page: two Bank of America and two Flagstar.</span></div>
          <button type="button" className="secondary-button" onClick={printCalibrationSheet}>Print BOFA + Flagstar templates</button>
        </div>
        <form className="owner-form check-form" noValidate onSubmit={saveCheck}>
          {editingCheckWasVoided ? <p className="voided-check-edit-warning wide-field"><strong>This check is voided.</strong> You may edit and save it, but it stays voided until you explicitly confirm reprinting. Reprinting changes its register status to Printed.</p> : null}
          <label className="wide-field">Preprinted check template
            <select aria-label="Check template" value={templateKey} onChange={(event) => changeTemplate(event.target.value)}>
              <option value="bofa">Bank of America — default</option>
              <option value="providence">Providence Bank</option>
            </select>
          </label>
          <label>Check number
            <input aria-label="Check number" value={checkNumber} onChange={(event) => setCheckNumber(event.target.value)} />
            {checkNumberWasChanged ? <small className="check-number-change-warning" aria-live="polite"><strong>Check number changed:</strong> originally #{originalCheckNumber}. Confirm the new number matches the physical preprinted check before saving or reprinting.</small> : null}
          </label>
          <label>Check date<input aria-label="Check date" type="date" value={checkDate} onChange={(event) => setCheckDate(event.target.value)} /><small>Defaults to the check creation date. You can change it before saving.</small></label>
          <label className="wide-field">Pay to the order of<input aria-label="Check payee" list="learned-check-payees" value={payee} onChange={(event) => changePayee(event.target.value)} /></label>
          <datalist id="learned-check-payees">{frequentPayees.map((savedPayee) => <option key={savedPayee.name} value={savedPayee.name}>{savedPayee.count} previous check{savedPayee.count === 1 ? '' : 's'}</option>)}</datalist>
          {frequentPayees.length ? <div className="frequent-payees wide-field"><span>Frequent payees</span><div className="button-row">{frequentPayees.slice(0, 5).map((savedPayee) => <button key={savedPayee.name} type="button" className="secondary-button" onClick={() => selectPayee(savedPayee)}>{savedPayee.name} <small>{savedPayee.count}×</small></button>)}</div></div> : null}
          <label>Amount<input aria-label="Check amount" type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
          <label>Account label<input aria-label="Check account label" value={accountLabel} onChange={(event) => setAccountLabel(event.target.value)} /></label>
          <label className="wide-field">Check purpose
            <select aria-label="Check purpose" value={checkType} onChange={(event) => {
              const nextType = event.target.value
              setCheckType(nextType)
              if (nextType === 'internal_transfer') {
                setAttachmentTarget('')
                setFundingTarget('')
                setLotTarget('')
                setMailingAddress('')
                setEnvelopeSetupNeeded(false)
              }
            }}>
              <option value="payment">Vendor or outside payment — counts as a cost/payment</option>
              <option value="internal_transfer">Transfer between Green Fort bank accounts — not a cost</option>
            </select>
          </label>
          {checkType === 'internal_transfer' ? <>
            <label className="wide-field">Transfer to account
              <input aria-label="Transfer destination account" list="greenfort-bank-accounts" value={destinationAccount} onChange={(event) => setDestinationAccount(event.target.value)} placeholder="Bank of America" />
              <small>Use a safe bank/account label only—never enter a full account or routing number.</small>
            </label>
            <datalist id="greenfort-bank-accounts"><option value="Bank of America" /><option value="Providence Bank" /><option value="Flagstar Bank" /></datalist>
            <div className="internal-transfer-notice wide-field" role="status"><strong>Internal transfer · not a project cost</strong><span>This check stays in the audit register but cannot be attached to an invoice, cost, draw, lot, vendor envelope, or paid-invoice copy.</span></div>
          </> : null}
          <label className="wide-field">Memo<input aria-label="Check memo" value={memo} onChange={(event) => setMemo(event.target.value)} /><small>Use the invoice number, work description, and lot when available.</small></label>
          {checkType !== 'internal_transfer' && envelopeSetupNeeded ? <div className="envelope-address-choice wide-field" role="group" aria-label="Envelope address options">
            <div><strong>Envelope address needed</strong><span>Attach an invoice to read its vendor address automatically, or type the address yourself.</span></div>
            <div className="button-row">
              <button type="button" className="secondary-button" onClick={() => attachmentSelectRef.current?.focus()}>Attach invoice now</button>
              <button type="button" className="secondary-button" onClick={() => mailingAddressRef.current?.focus()}>Enter address manually</button>
            </div>
          </div> : null}
          {checkType !== 'internal_transfer' ? <label className="wide-field">To: vendor address from invoice<textarea ref={mailingAddressRef} aria-label="Payee mailing address" rows="3" value={mailingAddress} onChange={(event) => setMailingAddress(event.target.value)} placeholder={'Street address\nCity, State ZIP'} /><small>Filled from the invoice’s vendor/remittance address when available. Review it before printing; never use the project or job-site address.</small></label> : null}
          {checkType !== 'internal_transfer' && vendorAddresses.length ? <label className="wide-field">Saved vendor address
            <select aria-label="Saved vendor address" value="" onChange={(event) => selectSavedVendorAddress(event.target.value)}>
              <option value="">Choose a vendor for this envelope</option>
              {vendorAddresses.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name} · {vendor.mailingAddress.replace(/\r?\n/g, ', ')}</option>)}
            </select>
            <small>Company-wide address book—available for future checks and envelopes.</small>
          </label> : null}
          {checkType !== 'internal_transfer' ? <div className="button-row wide-field invoice-address-actions">
            <button type="button" className="secondary-button" disabled={extractingVendorAddress} onClick={addAddressFromInvoice}>{extractingVendorAddress ? 'Reading address…' : 'Add address from invoice'}</button>
            <button type="button" className="secondary-button" onClick={saveCurrentVendorAddress}>Save vendor address</button>
            {onImportVendorAddresses ? <button type="button" className="secondary-button" disabled={importingVendorAddresses} onClick={importVendorAddresses}>{importingVendorAddresses ? 'Importing addresses…' : 'Import addresses from invoices'}</button> : null}
          </div> : null}
          {checkType !== 'internal_transfer' ? <label className="wide-field">Envelope feed orientation
            <select aria-label="Envelope feed orientation" value={envelopeRotation} onChange={(event) => setEnvelopeRotation(event.target.value)}>
              <option value="180">Rotate 180° — fixes upside-down output (recommended)</option>
              <option value="0">Normal orientation</option>
            </select>
            <small>Based on the test envelope, use Rotate 180°. Keep feeding the envelope the same way.</small>
          </label> : null}
          {checkType !== 'internal_transfer' ? <label className="wide-field">Attach this check to
            <select ref={attachmentSelectRef} aria-label="Check accounting attachment" value={attachmentTarget} onChange={(event) => {
              setAllowAdditionalCheck(false)
              changeAccountingTarget(event.target.value)
            }}>
              <option value="">Not attached yet</option>
              {invoices.length ? <optgroup label="Invoices">{accountingTargets.filter((target) => target.value.startsWith('invoice:')).map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}</optgroup> : null}
              {costs.length ? <optgroup label="Costs and breakdowns">{accountingTargets.filter((target) => target.value.startsWith('cost:')).map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}</optgroup> : null}
            </select>
          </label> : null}
          {checkType !== 'internal_transfer' && activeTargetChecks.length ? <div className="duplicate-check-warning wide-field" role="alert">
            <div><strong>Possible duplicate payment</strong><span>{activeTargetChecks.map((savedCheck) => `Check #${savedCheck.checkNumber} (${currency.format(savedCheck.amount)}, ${savedCheck.status})`).join(' · ')} is already attached.</span></div>
            <label><input type="checkbox" checked={allowAdditionalCheck} onChange={(event) => setAllowAdditionalCheck(event.target.checked)} /> Allow another check for a partial or additional payment</label>
          </div> : null}
          {checkType !== 'internal_transfer' && selectedDocuments.length && onOpenDocument ? <div className="button-row wide-field check-invoice-preview-action">
            <button type="button" className="secondary-button" onClick={() => previewTargetDocument(attachmentTarget)}>Preview attached invoice{selectedDocuments.length > 1 ? ` (${selectedDocuments.length})` : ''}</button>
            <small>Opens inside the app without downloading.</small>
          </div> : null}
          {checkType !== 'internal_transfer' && drawTargets.length ? <label className="wide-field">Funded by draw
            <select aria-label="Check draw funding" value={fundingTarget} onChange={(event) => setFundingTarget(event.target.value)}>
              <option value="">Not funded by a draw</option>
              {drawTargets.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}
            </select>
          </label> : null}
          {checkType !== 'internal_transfer' ? <label className="wide-field">Which lot is this for
            <select aria-label="Check job lot" value={lotTarget} onChange={(event) => setLotTarget(event.target.value)}>
              <option value="">Not lot-specific</option>
              {jobLots.map((lot) => <option key={lot} value={lot}>{lot}</option>)}
            </select>
          </label> : null}
          {amount && Number(amount) > 0 ? <div className="check-words-preview wide-field"><span>Amount in words</span><strong>{amountToCheckWords(amount)}</strong></div> : null}
          {message ? <p className={message.type === 'error' ? 'validation-error wide-field' : 'wide-field'} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</p> : null}
          <div className="button-row wide-field">
            <button type="submit" className="action-button" disabled={saving}>{saving ? 'Saving…' : (editingCheckId ? 'Update saved check' : 'Save check to register')}</button>
            {checkType !== 'internal_transfer' ? <button type="button" className="secondary-button" disabled={preparingEnvelope} onClick={() => printEnvelope()}>{preparingEnvelope ? 'Reading invoice address…' : 'Print 9 × 4 envelope'}</button> : null}
            {editingCheckId ? <button type="button" className="secondary-button" onClick={resetForm}>Cancel editing</button> : null}
          </div>
        </form>
      </div>

      <div ref={previewPanelRef} className="panel check-preview-panel">
        <div className="panel-header">
          <div><p className="eyebrow">{viewingCheck ? 'Saved check' : 'Live preview'}</p><h2>{viewingCheck ? `Check #${viewingCheck.checkNumber}` : `${previewTemplate.label} · 6 × 2.7`}</h2></div>
          {viewingCheck ? <button type="button" className="secondary-button" onClick={() => setViewingCheck(null)}>Back to current draft</button> : null}
        </div>
        <p className="hero-copy">{viewingCheck ? `Saved ${viewingCheck.date} · ${viewingCheck.status}${viewingCheck.checkType === 'internal_transfer' ? ' · Internal transfer, not a cost' : (previewTarget ? ` · ${previewTarget.label}` : ' · Not attached')}` : 'The preview updates while you type. Shaded text represents information already printed on the check stock.'}</p>
        {viewingCheck ? <label className="saved-check-template-control">Template for this saved check
          <select aria-label={`Template for saved check ${viewingCheck.checkNumber}`} value={viewingCheck.templateKey || 'bofa'} disabled={updatingTemplate} onChange={(event) => changeSavedTemplate(event.target.value)}>
            <option value="bofa">Bank of America</option>
            <option value="providence">Providence Bank</option>
          </select>
        </label> : null}
        {viewingCheck ? <div className="button-row saved-check-actions">
          <button type="button" className="secondary-button" onClick={() => editSavedCheck(viewingCheck)}>Edit saved check</button>
          {viewingCheck.checkType !== 'internal_transfer' ? <button type="button" className="secondary-button" onClick={() => printEnvelope(viewingCheck)}>Print 9 × 4 envelope</button> : null}
          {viewingCheck.status === 'voided' && pendingVoidedReprintId !== viewingCheck.id ? <button type="button" className="secondary-button" onClick={() => setPendingVoidedReprintId(viewingCheck.id)}>Reprint voided check</button> : null}
        </div> : null}
        {viewingCheck?.status === 'voided' && pendingVoidedReprintId === viewingCheck.id ? <div className="voided-reprint-warning">
          <strong>Reprint voided check #{viewingCheck.checkNumber}?</strong>
          <span>This will reactivate it and change its register status from Voided to Printed.</span>
          <div className="button-row"><button type="button" className="danger-button" onClick={() => confirmVoidedReprint(viewingCheck)}>Confirm reprint</button><button type="button" className="secondary-button" onClick={() => setPendingVoidedReprintId(null)}>Cancel</button></div>
        </div> : null}
        <div className={`live-check-preview ${previewData.templateKey || 'bofa'}`} aria-label={viewingCheck ? `Saved check preview ${viewingCheck.checkNumber}` : 'Live check preview'}>
          <div className="preview-company"><strong>Green Fort LLC</strong><span>200 Rosa Bluff Ct</span><span>Holly Springs, NC 27540</span></div>
          <strong className="preview-check-number">{displayCheckNumber(previewData.checkNumber, viewingCheck ? '' : '###')}</strong>
          <div className="preview-date-line" style={previewFieldStyle('date', fieldOffsets, previewData.templateKey || 'bofa')}><span className="entered">{checkDateParts(previewData.date).prefix}</span><span>20</span><span className="entered year">{checkDateParts(previewData.date).year}</span></div>
          <span className="preview-pay-label">{previewData.templateKey === 'providence' ? <>PAY TO THE<br />ORDER OF</> : <>Pay to the<br />Order of</>}</span>
          <span className="preview-payee entered" style={previewFieldStyle('payee', fieldOffsets, previewData.templateKey || 'bofa')}>{previewData.payee || 'Payee name appears here'}</span>
          <span className="preview-amount entered" style={previewFieldStyle('amount', fieldOffsets, previewData.templateKey || 'bofa')}><span className="preview-dollar">$</span>{Number(previewData.amount) > 0 ? numericAmount.format(Number(previewData.amount)) : '0.00'}</span>
          <span className="preview-words entered" style={previewFieldStyle('words', fieldOffsets, previewData.templateKey || 'bofa')}>{Number(previewData.amount) > 0 ? amountToCheckWords(previewData.amount).replace(/ Dollars$/, '') : 'Amount in words'}</span>
          <span className="preview-dollars">Dollars</span>
          <strong className="preview-bank">{previewTemplate.label}</strong>
          <span className="preview-for">For</span>
          <span className="preview-memo entered" style={previewFieldStyle('memo', fieldOffsets, previewData.templateKey || 'bofa')}>{previewData.memo || 'Memo'}</span>
          <span className="preview-signature">Authorized signature</span>
          <span className="preview-micr">⑆ ROUTING MASKED ⑆ ACCOUNT MASKED ⑈</span>
        </div>
        <div className="check-preview-key"><span><i /> Preprinted</span><span><i className="entered" /> Added by Greenfort Accountant</span></div>
        {previewData.checkType !== 'internal_transfer' ? <section className="envelope-screen-preview-section" aria-label={`Envelope preview for ${envelopePreview.payee || 'current check'}`}>
          <div className="envelope-screen-preview-header">
            <div>
              <p className="eyebrow">Envelope preview</p>
              <h3>9 × 4 envelope</h3>
            </div>
            <div className="button-row">
              <button type="button" className="secondary-button" onClick={() => printPaidInvoice(viewingCheck)}>Print invoice marked PAID</button>
              <button type="button" className="action-button" disabled={!envelopePreview.payee.trim() || preparingEnvelope} onClick={() => printEnvelope(viewingCheck)}>
                {preparingEnvelope ? 'Reading invoice address…' : (envelopeAddressLines.length ? 'Print this envelope' : 'Prepare envelope')}
              </button>
            </div>
          </div>
          <div className="envelope-screen-preview">
            <address className="envelope-screen-return-address">
              <strong>Green Fort LLC</strong>
              <span>200 Rosa Bluff Ct</span>
              <span>Holly Springs, NC 27540</span>
            </address>
            <address className={`envelope-screen-recipient-address ${!envelopeAddressLines.length ? 'missing-address' : ''}`}>
              <strong>{envelopePreview.payee || 'Payee name'}</strong>
              {envelopeAddressLines.length
                ? envelopeAddressLines.map((line, index) => <span key={`${line}-${index}`}>{line}</span>)
                : <span>Payee mailing address appears here</span>}
            </address>
          </div>
          {!envelopeAddressLines.length ? <p className="envelope-preview-warning">Add or retrieve the payee mailing address before printing.</p> : null}
          <small>Preview shows address placement. Print at 100% scale on a 9 × 4-inch envelope.</small>
        </section> : <div className="internal-transfer-notice"><strong>Internal bank transfer</strong><span>{previewData.accountLabel || 'Source account'} → {previewData.destinationAccount || 'Destination account'} · excluded from project costs and draw spending.</span></div>}
      </div>

      <details className="panel construction-cost-coverage" open>
        <summary>
          <div><p className="eyebrow">Construction documentation</p><h2>Construction costs, invoices &amp; payments</h2></div>
          <strong>{currency.format(constructionCoverageTotals.total)}</strong>
        </summary>
        <div className="construction-coverage-content">
          <div className="construction-coverage-summary">
            <div><span>Leaf construction costs</span><strong>{constructionCoverage.length}</strong></div>
            <div><span>Invoice documented</span><strong>{currency.format(constructionCoverageTotals.invoiceDocumented)}</strong></div>
            <div><span>Active checks applied</span><strong>{currency.format(constructionCoverageTotals.paid)}</strong></div>
            <div className={constructionCoverageTotals.missingInvoice ? 'needs-attention' : ''}><span>Missing invoice file</span><strong>{constructionCoverageTotals.missingInvoice}</strong></div>
          </div>
          <label className="construction-coverage-filter">Show
            <select aria-label="Filter construction invoice coverage" value={constructionCoverageFilter} onChange={(event) => setConstructionCoverageFilter(event.target.value)}>
              <option value="all">All construction costs</option>
              <option value="missing_invoice">Missing invoice file</option>
              <option value="with_invoice">Invoice documented</option>
              <option value="unpaid">Unpaid / partially paid</option>
              <option value="paid">Fully paid</option>
            </select>
          </label>
          {invoiceUploadMessage ? <p role="status">{invoiceUploadMessage}</p> : null}
          <div className="construction-coverage-list">
            {visibleConstructionCoverage.map(({ cost, relatedInvoices, documents, activeChecks, paid, hasInvoice }) => {
              const costAmount = Number(cost.amount || 0)
              const remaining = Math.max(0, costAmount - paid)
              return <article key={cost.costId || cost.id} className={!hasInvoice ? 'missing-invoice' : ''}>
                <div className="construction-coverage-title"><strong>{cost.name}</strong><strong>{currency.format(costAmount)}</strong></div>
                <p>{cost.date || 'No date'} · {cost.vendorName || cost.category || 'Vendor/category not set'}{cost.lotAllocations?.length ? ` · ${cost.lotAllocations.map((allocation) => allocation.lot).join(', ')}` : ''}</p>
                <div className="construction-coverage-badges">
                  <span className={hasInvoice ? 'complete' : 'warning'}>{hasInvoice ? `${documents.length} invoice file${documents.length === 1 ? '' : 's'}` : 'Invoice file missing'}</span>
                  <span>{relatedInvoices.length} invoice record{relatedInvoices.length === 1 ? '' : 's'}</span>
                  <span>{activeChecks.length} active check{activeChecks.length === 1 ? '' : 's'} · {currency.format(paid)} paid</span>
                  {remaining > 0.009 ? <span className="warning">{currency.format(remaining)} unpaid</span> : <span className="complete">Fully paid</span>}
                </div>
                <div className="button-row">
                  {onAttachInvoice ? <label className="secondary-button">{invoiceUpload === (cost.costId || cost.id) ? 'Uploading…' : 'Add invoice'}<input aria-label={`Add invoice for ${cost.name}`} type="file" accept="application/pdf,image/*" disabled={invoiceUpload != null} onChange={(event) => attachInvoice(cost, event)} /></label> : null}
                  {onEditCost ? <button type="button" className="secondary-button" onClick={() => onEditCost(cost.costId || cost.id)}>Edit cost</button> : null}
                </div>
                {documents.length && onOpenDocument ? <button type="button" className="secondary-button" onClick={() => onOpenDocument(documents[0])}>Preview invoice</button> : null}
              </article>
            })}
            {!visibleConstructionCoverage.length ? <div className="cost-empty-state"><strong>No construction costs match this coverage filter.</strong></div> : null}
          </div>
        </div>
      </details>

      <div className="panel check-register-panel">
        <div className="panel-header"><div><p className="eyebrow">Audit trail</p><h2>Check register</h2><p>{filteredChecks.length} of {sortedChecks.length} checks · {currency.format(registerTotal)} active vendor payments shown</p></div><strong>{filteredChecks.length}</strong></div>
        <div className="check-register-filters">
          <label>Search checks<input aria-label="Search check register" type="search" value={registerSearch} onChange={(event) => setRegisterSearch(event.target.value)} placeholder="Check #, payee, memo, invoice…" /></label>
          <label>Status<select aria-label="Filter check status" value={registerStatus} onChange={(event) => setRegisterStatus(event.target.value)}><option value="all">All statuses</option><option value="draft">Draft</option><option value="printed">Printed</option><option value="voided">Voided</option></select></label>
          <label>Lot<select aria-label="Filter check lot" value={registerLot} onChange={(event) => setRegisterLot(event.target.value)}><option value="all">All lots</option><option value="unassigned">Not lot-specific</option>{jobLots.map((lot) => <option key={lot} value={lot}>{lot}</option>)}</select></label>
          <label>Invoice / cost link<select aria-label="Filter check accounting link" value={registerLink} onChange={(event) => setRegisterLink(event.target.value)}><option value="all">All links</option><option value="invoice">Linked to invoice</option><option value="cost">Linked to cost</option><option value="linked">Any linked record</option><option value="unlinked">Not attached</option><option value="missing_document">Missing invoice file</option></select></label>
          <label>Funding draw<select aria-label="Filter check funding draw" value={registerDraw} onChange={(event) => setRegisterDraw(event.target.value)}><option value="all">All draw funding</option><option value="unfunded">Not funded by draw</option>{loanDraws.map((draw) => <option key={draw.id} value={String(draw.id)}>{draw.description || `Draw ${draw.id}`}</option>)}</select></label>
          <label>From<input aria-label="Filter checks from date" type="date" value={registerDateFrom} onChange={(event) => setRegisterDateFrom(event.target.value)} /></label>
          <label>To<input aria-label="Filter checks to date" type="date" value={registerDateTo} onChange={(event) => setRegisterDateTo(event.target.value)} /></label>
          <button type="button" className="secondary-button" onClick={clearRegisterFilters}>Clear filters</button>
        </div>
        <div className="check-register">
          {filteredChecks.map((check) => <article key={check.id} className={`check-register-row ${check.status}${check.checkType === 'internal_transfer' ? ' internal-transfer' : ''}`}>
            <div><strong>#{check.checkNumber} · {check.payee}</strong><p>{check.date} · {check.accountLabel}{check.checkType === 'internal_transfer' ? ` → ${check.destinationAccount || 'Destination not recorded'}` : ''}{check.memo ? ` · ${check.memo}` : ''}</p>{check.checkType === 'internal_transfer' ? <span className="check-transfer-badge">Internal transfer · Not a cost</span> : null}</div>
            <strong>{currency.format(check.amount)}</strong>
            <span className={`check-status ${check.status}`}>{check.status}</span>
            {check.checkType !== 'internal_transfer' ? <label className="check-register-attachment">Attached to
              <select aria-label={`Attachment for check ${check.checkNumber}`} value={checkTargetValue(check)} disabled={linkingCheckId === check.id} onChange={(event) => changeCheckLink(check, event.target.value)}>
                <option value="">Not attached</option>
                {accountingTargets.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}
              </select>
            </label> : null}
            {check.checkType !== 'internal_transfer' && drawTargets.length ? <label className="check-register-attachment">Funded by draw
              <select aria-label={`Draw funding for check ${check.checkNumber}`} value={check.fundedByIncomeId ? String(check.fundedByIncomeId) : ''} disabled={fundingCheckId === check.id} onChange={(event) => changeCheckFunding(check, event.target.value)}>
                <option value="">Not funded by a draw</option>
                {drawTargets.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}
              </select>
            </label> : null}
            {check.checkType !== 'internal_transfer' ? <label className="check-register-attachment">Lot
              <select aria-label={`Lot for check ${check.checkNumber}`} value={check.lot || ''} disabled={lotCheckId === check.id} onChange={(event) => changeCheckLot(check, event.target.value)}>
                <option value="">Not lot-specific</option>
                {jobLots.map((lot) => <option key={lot} value={lot}>{lot}</option>)}
              </select>
            </label> : null}
            <div className="button-row">
              {check.checkType !== 'internal_transfer' && documentsForTarget(checkTargetValue(check)).length && onOpenDocument ? <button type="button" className="secondary-button" onClick={() => previewTargetDocument(checkTargetValue(check))}>Preview invoice</button> : null}
              <button type="button" className="secondary-button" onClick={() => viewSavedCheck(check)}>View check</button>
              <button type="button" className="secondary-button" onClick={() => editSavedCheck(check)}>Edit</button>
              {check.checkType !== 'internal_transfer' ? <button type="button" className="secondary-button" disabled={preparingEnvelope} onClick={() => printEnvelope(check)}>{preparingEnvelope ? 'Reading address…' : 'Envelope'}</button> : null}
              {check.checkType !== 'internal_transfer' ? <button type="button" className="secondary-button" onClick={() => printPaidInvoice(check)}>Paid invoice</button> : null}
              {check.status !== 'voided' ? <button type="button" className="action-button" onClick={() => printCheck(check)}>{check.status === 'printed' ? 'Reprint' : 'Print'}</button> : null}
              {check.status === 'voided' && viewingCheck?.id !== check.id && pendingVoidedReprintId !== check.id ? <button type="button" className="secondary-button" onClick={() => setPendingVoidedReprintId(check.id)}>Reprint voided check</button> : null}
              {check.status !== 'voided' && pendingVoidCheckId !== check.id ? <button type="button" className="danger-button" onClick={() => setPendingVoidCheckId(check.id)}>Void</button> : null}
            </div>
            {check.status !== 'voided' && pendingVoidCheckId === check.id ? <div className="voided-reprint-warning" role="alert">
              <strong>Void check #{check.checkNumber}?</strong>
              <span>The check will remain in the audit register, but it will no longer count as payment. Any linked cost will be shown as unpaid so you can create a replacement check or choose another payment method.</span>
              <div className="button-row"><button type="button" className="danger-button" onClick={() => voidCheck(check)}>Confirm void</button><button type="button" className="secondary-button" onClick={() => setPendingVoidCheckId(null)}>Cancel</button></div>
            </div> : null}
            {check.status === 'voided' && viewingCheck?.id !== check.id && pendingVoidedReprintId === check.id ? <div className="voided-reprint-warning">
              <strong>Reprint voided check #{check.checkNumber}?</strong>
              <span>This will reactivate it and change its register status from Voided to Printed.</span>
              <div className="button-row"><button type="button" className="danger-button" onClick={() => confirmVoidedReprint(check)}>Confirm reprint</button><button type="button" className="secondary-button" onClick={() => setPendingVoidedReprintId(null)}>Cancel</button></div>
            </div> : null}
          </article>)}
          {!filteredChecks.length ? <div className="cost-empty-state"><strong>{sortedChecks.length ? 'No checks match these filters.' : 'No checks saved for this project.'}</strong><p>{sortedChecks.length ? 'Clear or change the register filters.' : 'Prepare the first check using the form.'}</p></div> : null}
        </div>
      </div>
    </section>

    {printingCheck ? createPortal(<section
      className={`print-check-sheet ${printingCheck.templateKey || 'bofa'} print-page-${printerPreset}`}
      aria-label={`Printable check ${printingCheck.checkNumber}`}
      style={{
        '--check-offset-x': `${(printerPreset === 'hp1102_carrier' ? 1.25 : 0) + (Number(horizontalOffset) || 0)}in`,
        '--check-offset-y': `${(printerPreset === 'hp1102_carrier' ? 1 : 0) + (Number(verticalOffset) || 0)}in`,
      }}
    >
      <style>{printerPreset === 'letter_voucher' || printerPreset === 'hp1102_carrier' ? '@page { size: 8.5in 11in; margin: 0; }' : printerPreset === 'direct_rotated' ? '@page { size: 2.7in 6in; margin: 0; }' : '@page { size: 6in 3in; margin: 0; }'}</style>
      <div className="print-check-fields">
        {printerPreset === 'letter_voucher' && printingCheck.status === 'mock' ? <div className="print-check-mock-outline" aria-label="Check outline for alignment reference">6 × 2.7in check area</div> : null}
        <span className="print-check-field print-check-date-prefix" style={printFieldStyle('datePrefix', fieldOffsets, 'date', printingCheck.templateKey)}>{checkDateParts(printingCheck.date).prefix}</span>
        <span className="print-check-field print-check-date-year" style={printFieldStyle('dateYear', fieldOffsets, 'date', printingCheck.templateKey)}>{checkDateParts(printingCheck.date).year}</span>
        <span className="print-check-field print-check-payee-value" style={printFieldStyle('payee', fieldOffsets, 'payee', printingCheck.templateKey)}>{printingCheck.payee}</span>
        <span className="print-check-field print-check-amount-value" style={printFieldStyle('amount', fieldOffsets, 'amount', printingCheck.templateKey)}>{numericAmount.format(printingCheck.amount)}</span>
        <span className="print-check-field print-check-words-value" style={printFieldStyle('words', fieldOffsets, 'words', printingCheck.templateKey)}>{amountToCheckWords(printingCheck.amount).replace(/ Dollars$/, '')}</span>
        <span className="print-check-field print-check-memo-value" style={printFieldStyle('memo', fieldOffsets, 'memo', printingCheck.templateKey)}>{printingCheck.memo}</span>
        {printingCheck.status === 'mock' ? <>
          <span className="print-check-field print-check-coord-label print-check-date-prefix" style={printFieldStyle('datePrefix', fieldOffsets, 'date', printingCheck.templateKey)} aria-label="Date field coordinates">{fieldCoordinateLabel('datePrefix', printingCheck.templateKey, fieldOffsetIn(fieldOffsets, printingCheck.templateKey, 'date'))}</span>
          <span className="print-check-field print-check-coord-label print-check-date-year" style={printFieldStyle('dateYear', fieldOffsets, 'date', printingCheck.templateKey)} aria-label="Date year field coordinates">{fieldCoordinateLabel('dateYear', printingCheck.templateKey, fieldOffsetIn(fieldOffsets, printingCheck.templateKey, 'date'))}</span>
          <span className="print-check-field print-check-coord-label print-check-payee-value" style={printFieldStyle('payee', fieldOffsets, 'payee', printingCheck.templateKey)} aria-label="Payee field coordinates">{fieldCoordinateLabel('payee', printingCheck.templateKey, fieldOffsetIn(fieldOffsets, printingCheck.templateKey, 'payee'))}</span>
          <span className="print-check-field print-check-coord-label print-check-amount-value" style={printFieldStyle('amount', fieldOffsets, 'amount', printingCheck.templateKey)} aria-label="Amount field coordinates">{fieldCoordinateLabel('amount', printingCheck.templateKey, fieldOffsetIn(fieldOffsets, printingCheck.templateKey, 'amount'))}</span>
          <span className="print-check-field print-check-coord-label print-check-words-value" style={printFieldStyle('words', fieldOffsets, 'words', printingCheck.templateKey)} aria-label="Amount in words field coordinates">{fieldCoordinateLabel('words', printingCheck.templateKey, fieldOffsetIn(fieldOffsets, printingCheck.templateKey, 'words'))}</span>
          <span className="print-check-field print-check-coord-label print-check-memo-value" style={printFieldStyle('memo', fieldOffsets, 'memo', printingCheck.templateKey)} aria-label="Memo field coordinates">{fieldCoordinateLabel('memo', printingCheck.templateKey, fieldOffsetIn(fieldOffsets, printingCheck.templateKey, 'memo'))}</span>
        </> : null}
      </div>
    </section>, document.body) : null}
    {printingEnvelope ? createPortal(<section className="print-envelope-sheet" aria-label={`Printable envelope for ${printingEnvelope.payee}`} style={{ '--envelope-rotation': `${envelopeRotation}deg`, '--envelope-return-top': '0.8in', '--envelope-return-left': '1.65in' }}>
      <style>{'@page { size: 9in 4in; margin: 0; }'}</style>
      <address className="print-envelope-return-address">
        <strong>Green Fort LLC</strong>
        <span>200 Rosa Bluff Ct</span>
        <span>Holly Springs, NC 27540</span>
      </address>
      <address className="print-envelope-recipient-address">
        <strong>{printingEnvelope.payee}</strong>
        {printingEnvelope.mailingAddress.split(/\r?\n/).filter(Boolean).map((line, index) => <span key={`${line}-${index}`}>{line}</span>)}
      </address>
    </section>, document.body) : null}
    {printingTemplateSheet ? createPortal(<section className="print-template-sheet" aria-label="Printable BOFA and Flagstar template sheet">
      <style>{'@page { size: 8.5in 11in; margin: 0; }'}</style>
      {calibrationTemplates.map((template) => <article key={template.key} className={`calibration-check ${template.className}`}>
        <div className="calibration-company"><strong>Green Fort LLC</strong><span>Company address</span></div>
        <strong className="calibration-number" aria-label="Blank check number field" />
        <span className="calibration-date" aria-label="Blank check date field" />
        <span className="calibration-pay-label">PAY TO THE<br />ORDER OF</span>
        <span className="calibration-pay-line" aria-label="Blank payee field" />
        <span className="calibration-dollar">$</span>
        <span className="calibration-amount" aria-label="Blank numeric amount field" />
        <span className="calibration-words" aria-label="Blank written amount field" />
        <em className="calibration-dollars">Dollars</em>
        <strong className="calibration-bank">{template.bank}</strong>
        <span className="calibration-memo" aria-label="Blank memo field" />
        <span className="calibration-signature">Authorized signature</span>
        <strong className="calibration-void">VOID · CALIBRATION ONLY</strong>
        <small className="calibration-size">6 × 2.7 inches · no routing/account data</small>
      </article>)}
    </section>, document.body) : null}
    {printingCarrierGuide ? createPortal(<section
      className="print-carrier-guide"
      aria-label="Printable HP P1102 carrier placement guide"
      style={{
        '--guide-offset-x': `${Number(horizontalOffset) || 0}in`,
        '--guide-offset-y': `${Number(verticalOffset) || 0}in`,
      }}
    >
      <style>{'@page { size: 8.5in 11in; margin: 0; }'}</style>
      <div className="carrier-check-position">
        <span className="carrier-margin-label">{carrierLeftMarginIn.toFixed(2)}in left · {carrierTopMarginIn.toFixed(2)}in top</span>
        <strong>PLACE 6 × 2.7 CHECK HERE</strong>
        <span>Align all four edges with this box</span>
      </div>
      <div className="carrier-guide-notes"><strong>HP P1102 carrier sheet</strong><span>Letter paper · print at 100% · no scaling</span><span>Use a laser-printer-safe carrier; do not feed loose tape or exposed adhesive.</span></div>
    </section>, document.body) : null}
  </>
}

export default CheckPrinting
