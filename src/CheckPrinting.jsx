import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { amountToCheckWords } from './lib/checks'

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
})

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

function CheckPrinting({ project, checks = [], invoices = [], costs = [], loanDraws = [], onSaveCheck, onUpdateStatus, onUpdateLink, onUpdateTemplate, onUpdateFunding, onUpdateLot }) {
  const [checkNumber, setCheckNumber] = useState('')
  const [payee, setPayee] = useState('')
  const [amount, setAmount] = useState('')
  const [checkDate, setCheckDate] = useState(today)
  const [memo, setMemo] = useState('')
  const [accountLabel, setAccountLabel] = useState('Bank of America')
  const [templateKey, setTemplateKey] = useState('bofa')
  const [message, setMessage] = useState(null)
  const [saving, setSaving] = useState(false)
  const [printingCheck, setPrintingCheck] = useState(null)
  const [printingTemplateSheet, setPrintingTemplateSheet] = useState(false)
  const [printingCarrierGuide, setPrintingCarrierGuide] = useState(false)
  const [horizontalOffset, setHorizontalOffset] = useState('0')
  const [verticalOffset, setVerticalOffset] = useState('0')
  const [fieldOffsets, setFieldOffsets] = useState(loadSavedFieldOffsets)
  const [fieldOffsetsExpanded, setFieldOffsetsExpanded] = useState(false)
  const [fieldOffsetsSavedMessage, setFieldOffsetsSavedMessage] = useState('')
  const [printerPreset, setPrinterPreset] = useState('letter_voucher')
  const [attachmentTarget, setAttachmentTarget] = useState('')
  const [fundingTarget, setFundingTarget] = useState('')
  const [lotTarget, setLotTarget] = useState('')
  const [linkingCheckId, setLinkingCheckId] = useState(null)
  const [fundingCheckId, setFundingCheckId] = useState(null)
  const [lotCheckId, setLotCheckId] = useState(null)
  const [viewingCheck, setViewingCheck] = useState(null)
  const [updatingTemplate, setUpdatingTemplate] = useState(false)
  const previewPanelRef = useRef(null)

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
      if (check.status === 'voided' || check.fundedByIncomeId == null) return
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

  const checkTargetValue = (check) => check.invoiceId ? `invoice:${check.invoiceId}` : (check.costId ? `cost:${check.costId}` : '')
  const previewData = viewingCheck || { checkNumber, payee, amount, date: checkDate, memo, accountLabel, templateKey, status: 'draft', ...parseAccountingTarget(attachmentTarget) }
  const previewTarget = accountingTargets.find((target) => target.value === checkTargetValue(previewData))
  const previewTemplate = checkTemplates[previewData.templateKey] || checkTemplates.bofa

  const resetForm = () => {
    setCheckNumber('')
    setPayee('')
    setAmount('')
    setCheckDate(today())
    setMemo('')
    setAttachmentTarget('')
    setFundingTarget('')
    setLotTarget('')
    setTemplateKey('bofa')
    setAccountLabel(checkTemplates.bofa.accountLabel)
  }

  const saveCheck = async (event) => {
    event.preventDefault()
    setMessage(null)
    const numericAmount = Number(amount)
    const normalizedCheckNumber = checkNumber.trim()
    if (!normalizedCheckNumber) return setMessage({ type: 'error', text: 'Enter the number printed on the check.' })
    if (sortedChecks.some((check) => String(check.checkNumber).trim().toLowerCase() === normalizedCheckNumber.toLowerCase())) {
      return setMessage({ type: 'error', text: `Check #${normalizedCheckNumber} is already saved for ${project.name}. Open it in the check register to view or reprint it, or enter a different preprinted check number.` })
    }
    if (!payee.trim()) return setMessage({ type: 'error', text: 'Enter the person or company being paid.' })
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return setMessage({ type: 'error', text: 'Enter a check amount greater than $0.' })
    if (!checkDate) return setMessage({ type: 'error', text: 'Select the check date.' })
    if (!accountLabel.trim()) return setMessage({ type: 'error', text: 'Enter a safe account label, such as Bank of America Operating.' })
    if (!onSaveCheck) return setMessage({ type: 'error', text: 'Check saving is unavailable. Sign in and select a project.' })
    setSaving(true)
    try {
      const saved = await onSaveCheck({
        projectId: project.id,
        checkNumber: normalizedCheckNumber,
        payee: payee.trim(),
        amount: numericAmount,
        date: checkDate,
        memo: memo.trim(),
        accountLabel: accountLabel.trim(),
        templateKey,
        ...parseAccountingTarget(attachmentTarget),
        fundedByIncomeId: fundingTarget ? Number(fundingTarget) : null,
        lot: lotTarget || null,
      })
      if (saved) setViewingCheck(saved)
      setMessage({ type: 'success', text: `Check ${normalizedCheckNumber} saved. Review it in the register before printing.` })
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
    setPrintingTemplateSheet(true)
    window.setTimeout(() => window.print(), 0)
  }

  const printCarrierGuide = () => {
    setMessage(null)
    setPrintingCheck(null)
    setPrintingTemplateSheet(false)
    setPrintingCarrierGuide(true)
    window.setTimeout(() => window.print(), 0)
  }

  const voidCheck = async (check) => {
    setMessage(null)
    try {
      const saved = await onUpdateStatus(check.id, 'voided')
      if (viewingCheck?.id === check.id && saved) setViewingCheck(saved)
      setMessage({ type: 'success', text: `Check ${check.checkNumber} was voided and remains in the register.` })
    } catch (error) {
      setMessage({ type: 'error', text: `The check could not be voided: ${errorMessage(error)}` })
    }
  }

  const selectPayee = (savedPayee) => {
    setPayee(savedPayee.name)
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

  const viewSavedCheck = (check) => {
    setViewingCheck(check)
    previewPanelRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  }

  const carrierLeftMarginIn = 1.25 + (Number(horizontalOffset) || 0)
  const carrierTopMarginIn = 1 + (Number(verticalOffset) || 0)

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
          <label className="wide-field">Preprinted check template
            <select aria-label="Check template" value={templateKey} onChange={(event) => changeTemplate(event.target.value)}>
              <option value="bofa">Bank of America — default</option>
              <option value="providence">Providence Bank</option>
            </select>
          </label>
          <label>Check number<input aria-label="Check number" value={checkNumber} onChange={(event) => setCheckNumber(event.target.value)} /></label>
          <label>Check date<input aria-label="Check date" type="date" value={checkDate} onChange={(event) => setCheckDate(event.target.value)} /></label>
          <label className="wide-field">Pay to the order of<input aria-label="Check payee" list="learned-check-payees" value={payee} onChange={(event) => setPayee(event.target.value)} /></label>
          <datalist id="learned-check-payees">{frequentPayees.map((savedPayee) => <option key={savedPayee.name} value={savedPayee.name}>{savedPayee.count} previous check{savedPayee.count === 1 ? '' : 's'}</option>)}</datalist>
          {frequentPayees.length ? <div className="frequent-payees wide-field"><span>Frequent payees</span><div className="button-row">{frequentPayees.slice(0, 5).map((savedPayee) => <button key={savedPayee.name} type="button" className="secondary-button" onClick={() => selectPayee(savedPayee)}>{savedPayee.name} <small>{savedPayee.count}×</small></button>)}</div></div> : null}
          <label>Amount<input aria-label="Check amount" type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
          <label>Account label<input aria-label="Check account label" value={accountLabel} onChange={(event) => setAccountLabel(event.target.value)} /></label>
          <label className="wide-field">Memo<input aria-label="Check memo" value={memo} onChange={(event) => setMemo(event.target.value)} /></label>
          <label className="wide-field">Attach this check to
            <select aria-label="Check accounting attachment" value={attachmentTarget} onChange={(event) => setAttachmentTarget(event.target.value)}>
              <option value="">Not attached yet</option>
              {invoices.length ? <optgroup label="Invoices">{accountingTargets.filter((target) => target.value.startsWith('invoice:')).map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}</optgroup> : null}
              {costs.length ? <optgroup label="Costs and breakdowns">{accountingTargets.filter((target) => target.value.startsWith('cost:')).map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}</optgroup> : null}
            </select>
          </label>
          {drawTargets.length ? <label className="wide-field">Funded by draw
            <select aria-label="Check draw funding" value={fundingTarget} onChange={(event) => setFundingTarget(event.target.value)}>
              <option value="">Not funded by a draw</option>
              {drawTargets.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}
            </select>
          </label> : null}
          <label className="wide-field">Which lot is this for
            <select aria-label="Check job lot" value={lotTarget} onChange={(event) => setLotTarget(event.target.value)}>
              <option value="">Not lot-specific</option>
              {jobLots.map((lot) => <option key={lot} value={lot}>{lot}</option>)}
            </select>
          </label>
          {amount && Number(amount) > 0 ? <div className="check-words-preview wide-field"><span>Amount in words</span><strong>{amountToCheckWords(amount)}</strong></div> : null}
          {message ? <p className={message.type === 'error' ? 'validation-error wide-field' : 'wide-field'} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</p> : null}
          <button type="submit" className="action-button wide-field" disabled={saving}>{saving ? 'Saving…' : 'Save check to register'}</button>
        </form>
      </div>

      <div ref={previewPanelRef} className="panel check-preview-panel">
        <div className="panel-header">
          <div><p className="eyebrow">{viewingCheck ? 'Saved check' : 'Live preview'}</p><h2>{viewingCheck ? `Check #${viewingCheck.checkNumber}` : `${previewTemplate.label} · 6 × 2.7`}</h2></div>
          {viewingCheck ? <button type="button" className="secondary-button" onClick={() => setViewingCheck(null)}>Back to current draft</button> : null}
        </div>
        <p className="hero-copy">{viewingCheck ? `Saved ${viewingCheck.date} · ${viewingCheck.status}${previewTarget ? ` · ${previewTarget.label}` : ' · Not attached'}` : 'The preview updates while you type. Shaded text represents information already printed on the check stock.'}</p>
        {viewingCheck ? <label className="saved-check-template-control">Template for this saved check
          <select aria-label={`Template for saved check ${viewingCheck.checkNumber}`} value={viewingCheck.templateKey || 'bofa'} disabled={updatingTemplate} onChange={(event) => changeSavedTemplate(event.target.value)}>
            <option value="bofa">Bank of America</option>
            <option value="providence">Providence Bank</option>
          </select>
        </label> : null}
        <div className={`live-check-preview ${previewData.templateKey || 'bofa'}`} aria-label={viewingCheck ? `Saved check preview ${viewingCheck.checkNumber}` : 'Live check preview'}>
          <div className="preview-company"><strong>Green Fort LLC</strong><span>200 Ross Bluff Ct</span><span>Holly Springs, NC 27540-6040</span></div>
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
      </div>

      <div className="panel check-register-panel">
        <div className="panel-header"><div><p className="eyebrow">Audit trail</p><h2>Check register</h2></div><strong>{sortedChecks.length}</strong></div>
        <div className="check-register">
          {sortedChecks.map((check) => <article key={check.id} className={`check-register-row ${check.status}`}>
            <div><strong>#{check.checkNumber} · {check.payee}</strong><p>{check.date} · {check.accountLabel}{check.memo ? ` · ${check.memo}` : ''}</p></div>
            <strong>{currency.format(check.amount)}</strong>
            <span className={`check-status ${check.status}`}>{check.status}</span>
            <label className="check-register-attachment">Attached to
              <select aria-label={`Attachment for check ${check.checkNumber}`} value={checkTargetValue(check)} disabled={linkingCheckId === check.id} onChange={(event) => changeCheckLink(check, event.target.value)}>
                <option value="">Not attached</option>
                {accountingTargets.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}
              </select>
            </label>
            {drawTargets.length ? <label className="check-register-attachment">Funded by draw
              <select aria-label={`Draw funding for check ${check.checkNumber}`} value={check.fundedByIncomeId ? String(check.fundedByIncomeId) : ''} disabled={fundingCheckId === check.id} onChange={(event) => changeCheckFunding(check, event.target.value)}>
                <option value="">Not funded by a draw</option>
                {drawTargets.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}
              </select>
            </label> : null}
            <label className="check-register-attachment">Lot
              <select aria-label={`Lot for check ${check.checkNumber}`} value={check.lot || ''} disabled={lotCheckId === check.id} onChange={(event) => changeCheckLot(check, event.target.value)}>
                <option value="">Not lot-specific</option>
                {jobLots.map((lot) => <option key={lot} value={lot}>{lot}</option>)}
              </select>
            </label>
            <div className="button-row">
              <button type="button" className="secondary-button" onClick={() => viewSavedCheck(check)}>View check</button>
              {check.status !== 'voided' ? <button type="button" className="action-button" onClick={() => printCheck(check)}>{check.status === 'printed' ? 'Reprint' : 'Print'}</button> : null}
              {check.status !== 'voided' ? <button type="button" className="danger-button" onClick={() => voidCheck(check)}>Void</button> : null}
            </div>
          </article>)}
          {!sortedChecks.length ? <div className="cost-empty-state"><strong>No checks saved for this project.</strong><p>Prepare the first check using the form.</p></div> : null}
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
