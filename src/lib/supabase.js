import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null

export const buildProjectCostTotals = (activeCosts = []) => activeCosts
  .filter((cost) => cost.parent_cost_id == null)
  .reduce((totals, cost) => ({
    ...totals,
    [cost.project_id]: Number(totals[cost.project_id] || 0) + Number(cost.amount || 0),
  }), {})

export async function fetchProjectData() {
  if (!supabase) {
    return null
  }

  try {
    const [{ data: projects, error: projectsError }, { data: owners, error: ownersError }, { data: activeCosts, error: costsError }, { data: vendors, error: vendorsError }] = await Promise.all([
      supabase.from('projects').select('*').order('created_at', { ascending: true }),
      supabase.from('owners').select('*').order('created_at', { ascending: true }),
      supabase.from('active_costs').select('project_id,parent_cost_id,name,phase,amount'),
      supabase.from('vendors').select('*').order('name'),
    ])

    if (projectsError || ownersError || costsError || vendorsError) {
      throw new Error(projectsError?.message || ownersError?.message || costsError?.message || vendorsError?.message || 'Failed to load data')
    }

    const projectCostTotals = buildProjectCostTotals(activeCosts)
    return { projects: projects ?? [], owners: owners ?? [], vendors: (vendors ?? []).map(normalizeVendor), projectCostTotals }
  } catch {
    return null
  }
}

const vendorAddressMarker = /\[\[greenfort-vendor-mailing-address:([^\]]+)\]\]/
const normalizeVendorName = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
const addressFromVendorNotes = (notes) => {
  const encoded = String(notes || '').match(vendorAddressMarker)?.[1]
  if (!encoded) return ''
  try { return decodeURIComponent(encoded) } catch { return '' }
}
const notesWithVendorAddress = (notes, address) => {
  const clean = String(notes || '').replace(vendorAddressMarker, '').trim()
  return [clean, `[[greenfort-vendor-mailing-address:${encodeURIComponent(address)}]]`].filter(Boolean).join('\n')
}
const normalizeVendor = (row) => ({
  id: row.id,
  companyId: row.company_id,
  name: row.name,
  trade: row.trade || '',
  contactEmail: row.contact_email || '',
  contactPhone: row.contact_phone || '',
  mailingAddress: row.mailing_address || addressFromVendorNotes(row.notes),
  notes: String(row.notes || '').replace(vendorAddressMarker, '').trim(),
})

export async function saveVendorAddress(projectId, { name, mailingAddress }) {
  if (!supabase) throw new Error('Supabase is not configured')
  const vendorName = String(name || '').trim().replace(/\s+/g, ' ')
  const address = String(mailingAddress || '').trim()
  if (!vendorName || !address) throw new Error('Vendor name and mailing address are required')

  const { data: project, error: projectError } = await supabase.from('projects').select('company_id').eq('id', projectId).single()
  if (projectError) throw projectError
  const { data: existingRows, error: vendorError } = await supabase.from('vendors').select('*').eq('company_id', project.company_id)
  if (vendorError) throw vendorError
  const existing = (existingRows || []).find((row) => normalizeVendorName(row.name) === normalizeVendorName(vendorName))

  if (existing) {
    let result = await supabase.from('vendors').update({ mailing_address: address, updated_at: new Date().toISOString() }).eq('id', existing.id).select('*').single()
    if (result.error?.code === 'PGRST204' || /mailing_address|updated_at/i.test(result.error?.message || '')) {
      result = await supabase.from('vendors').update({ notes: notesWithVendorAddress(existing.notes, address) }).eq('id', existing.id).select('*').single()
    }
    if (result.error) throw result.error
    return normalizeVendor(result.data)
  }

  let result = await supabase.from('vendors').insert({ company_id: project.company_id, name: vendorName, mailing_address: address }).select('*').single()
  if (result.error?.code === 'PGRST204' || /mailing_address/i.test(result.error?.message || '')) {
    result = await supabase.from('vendors').insert({ company_id: project.company_id, name: vendorName, notes: notesWithVendorAddress('', address) }).select('*').single()
  }
  if (result.error) throw result.error
  return normalizeVendor(result.data)
}

const normalizeCategory = (row) => ({
  id: row.id,
  projectId: row.project_id,
  phase: row.phase,
  name: row.name,
  budgetedAmount: Number(row.budgeted_amount || 0),
  lotBudgets: row.lot_budgets && typeof row.lot_budgets === 'object' && !Array.isArray(row.lot_budgets) ? row.lot_budgets : {},
})

const normalizeStoredDocument = (row) => ({
  documentId: row.id,
  id: row.id,
  storageBucket: row.storage_bucket,
  storagePath: row.storage_path,
  name: row.display_name || row.original_name,
  originalName: row.original_name,
  documentDate: row.document_date || '',
  description: row.description || '',
  mimeType: row.mime_type,
  size: row.size_bytes,
  ...(String(row.storage_path || '').match(/\/bank-statements\/(boa|providence|amex|flagstar)\//)?.[1]
    ? { bank: String(row.storage_path).match(/\/bank-statements\/(boa|providence|amex|flagstar)\//)[1] }
    : {}),
  ...(row.created_at ? { createdAt: row.created_at } : {}),
})

const normalizeInvoice = (row) => ({
  id: row.id,
  projectId: row.project_id,
  vendorId: row.vendor_id,
  categoryId: row.category_id,
  invoiceNumber: row.invoice_number,
  vendorName: row.vendor_name || '',
  amount: Number(row.amount || 0),
  invoiceDate: row.invoice_date || '',
  dueDate: row.due_date || '',
  status: row.status,
  invoiceId: row.invoice_id,
  costId: row.cost_id,
  description: row.description || '',
  classification: row.classification || '',
  sourceName: row.source_name || '',
  notes: row.notes || '',
  attachments: Array.isArray(row.documents) ? row.documents.map(normalizeStoredDocument) : [],
})

const normalizeTransaction = (row) => ({
  id: row.id,
  projectId: row.project_id,
  categoryId: row.category_id,
  date: row.date,
  description: row.description,
  amount: Number(row.amount || 0),
  source: row.source,
  matchedInvoiceId: row.matched_invoice_id,
  rawImportRow: row.raw_import_row,
})

const getLegacyCostDimensions = (row) => (Array.isArray(row.attachments)
  ? row.attachments.find((attachment) => attachment?._type === 'cost_dimensions')
  : null)

const getLegacyCostDetails = (row) => (Array.isArray(row.attachments)
  ? row.attachments.find((attachment) => attachment?._type === 'cost_details')
  : null)

const getLegacyCostAccounting = (row) => (Array.isArray(row.attachments)
  ? row.attachments.find((attachment) => attachment?._type === 'cost_accounting')
  : null)

const normalizeCostVersion = (row) => ({
  id: row.id,
  costId: row.cost_id,
  parentCostId: row.parent_cost_id,
  projectId: row.project_id,
  ownerId: row.owner_id,
  version: row.version,
  name: row.name,
  details: row.details || getLegacyCostDetails(row)?.details || '',
  constructionDraftId: row.construction_draft_id || getLegacyCostAccounting(row)?.constructionDraftId || null,
  paymentMethod: row.payment_method || getLegacyCostAccounting(row)?.paymentMethod || '',
  paymentFeePercentage: row.payment_fee_percentage == null ? (getLegacyCostAccounting(row)?.paymentFeePercentage ?? null) : Number(row.payment_fee_percentage),
  paymentFeeAmount: row.payment_fee_amount == null ? (getLegacyCostAccounting(row)?.paymentFeeAmount ?? null) : Number(row.payment_fee_amount),
  paymentDate: row.payment_date || getLegacyCostAccounting(row)?.paymentDate || '',
  invoiceAmount: row.invoice_amount == null ? (getLegacyCostAccounting(row)?.invoiceAmount ?? null) : Number(row.invoice_amount),
  amount: Number(row.amount || 0),
  phase: row.phase,
  category: row.category || getLegacyCostDimensions(row)?.category || '',
  vendorName: row.vendor_name || getLegacyCostAccounting(row)?.vendorName || '',
  mainCategory: row.main_category || getLegacyCostAccounting(row)?.mainCategory || '',
  subcategory: row.subcategory || getLegacyCostAccounting(row)?.subcategory || '',
  payerType: row.payer_type || getLegacyCostAccounting(row)?.payerType || '',
  payerOwnerId: row.payer_owner_id || getLegacyCostAccounting(row)?.payerOwnerId || null,
  payerName: row.payer_name || getLegacyCostAccounting(row)?.payerName || '',
  paymentSource: row.payment_source || getLegacyCostAccounting(row)?.paymentSource || '',
  referenceNumber: row.reference_number || getLegacyCostAccounting(row)?.referenceNumber || '',
  reimbursable: row.reimbursable ?? getLegacyCostAccounting(row)?.reimbursable ?? false,
  loanRelated: row.loan_related ?? getLegacyCostAccounting(row)?.loanRelated ?? false,
  notes: row.notes || getLegacyCostAccounting(row)?.notes || '',
  recurringFrequency: row.recurring_frequency || getLegacyCostAccounting(row)?.recurringFrequency || '',
  isSoftCostParent: row.is_soft_cost_parent ?? getLegacyCostAccounting(row)?.isSoftCostParent ?? false,
  lotAllocations: Array.isArray(row.lot_allocations) && row.lot_allocations.length ? row.lot_allocations : (getLegacyCostDimensions(row)?.lotAllocations || []),
  date: row.cost_date,
  attachments: Array.isArray(row.attachments) ? row.attachments.filter((attachment) => !['cost_dimensions', 'cost_details', 'cost_accounting'].includes(attachment?._type)) : [],
  deletedAt: row.deleted_at,
  createdAt: row.created_at,
})

const normalizeIncome = (row) => {
  const rawAttachments = Array.isArray(row.attachments) ? row.attachments : []
  const legacyActivities = rawAttachments
    .filter((attachment) => attachment?._type === 'income_activity' && attachment.activity)
    .map((attachment) => attachment.activity)
  const isLegacyPreSaleDeposit = row.income_type === 'project_income'
    && /pre[\s-]*sale\s*deposits?/i.test(row.description || '')
    && /utilized/i.test(row.description || '')
  return {
    id: row.id,
    projectId: row.project_id,
    description: row.description,
    source: row.source,
    amount: Number(row.amount || 0),
    date: row.income_date,
    type: isLegacyPreSaleDeposit ? 'pre_sale_deposit' : row.income_type,
    lotBreakdown: Array.isArray(row.lot_breakdown) ? row.lot_breakdown : [],
    activities: Array.isArray(row.activity_breakdown) && row.activity_breakdown.length ? row.activity_breakdown : legacyActivities,
    attachments: rawAttachments.filter((attachment) => attachment?._type !== 'income_activity'),
  }
}

const normalizeReviewItem = (row) => ({
  id: row.id,
  projectId: row.project_id,
  ownerId: row.owner_id,
  categoryId: row.category_id,
  sourceName: row.source_name || '',
  vendor: row.vendor || '',
  amount: Number(row.amount || 0),
  date: row.transaction_date || '',
  description: row.description || '',
  entryType: row.entry_type,
  notes: row.notes || '',
  status: row.status,
  rawData: row.raw_data || {},
  createdAt: row.created_at,
})

const normalizeConstructionDraft = (row) => ({
  id: row.id,
  projectId: row.project_id,
  name: row.name,
  details: row.details || '',
  plannedAmount: row.planned_amount == null ? null : Number(row.planned_amount),
  plannedDate: row.planned_date || '',
  status: row.status,
  attachments: Array.isArray(row.attachments) ? row.attachments : [],
  sourceEstimates: row.source_estimates && typeof row.source_estimates === 'object' ? row.source_estimates : {},
  sourceLabel: row.source_label || '',
  sortOrder: Number(row.sort_order || 0),
  convertedCostId: row.converted_cost_id,
  updatedAt: row.updated_at,
})

const CHECK_MAILING_ADDRESS_MARKER = /\n?\[\[greenfort-mailing-address:([^\]]*)\]\]/
const CHECK_TYPE_MARKER = /\n?\[\[greenfort-check-type:([a-z_]+)\]\]/
const CHECK_DESTINATION_MARKER = /\n?\[\[greenfort-transfer-destination:([^\]]*)\]\]/

const unpackCheckMemo = (value) => {
  const storedMemo = String(value || '')
  const addressMatch = storedMemo.match(CHECK_MAILING_ADDRESS_MARKER)
  const typeMatch = storedMemo.match(CHECK_TYPE_MARKER)
  const destinationMatch = storedMemo.match(CHECK_DESTINATION_MARKER)
  const memo = storedMemo
    .replace(CHECK_MAILING_ADDRESS_MARKER, '')
    .replace(CHECK_TYPE_MARKER, '')
    .replace(CHECK_DESTINATION_MARKER, '')
    .trim()
  try {
    return {
      memo,
      mailingAddress: addressMatch ? decodeURIComponent(addressMatch[1]) : '',
      checkType: typeMatch?.[1] || 'payment',
      destinationAccount: destinationMatch ? decodeURIComponent(destinationMatch[1]) : '',
    }
  } catch {
    return { memo, mailingAddress: '', checkType: typeMatch?.[1] || 'payment', destinationAccount: '' }
  }
}

const packLegacyCheckMemo = (memo, mailingAddress, checkType = 'payment', destinationAccount = '') => [
  String(memo || ''),
  mailingAddress ? `[[greenfort-mailing-address:${encodeURIComponent(mailingAddress)}]]` : '',
  checkType !== 'payment' ? `[[greenfort-check-type:${checkType}]]` : '',
  destinationAccount ? `[[greenfort-transfer-destination:${encodeURIComponent(destinationAccount)}]]` : '',
].filter(Boolean).join('\n')

const missingCheckMetadataColumn = (error) => (
  error?.code === 'PGRST204' && /'(mailing_address|check_type|destination_account)'/.test(String(error?.message || ''))
)

const normalizeProjectCheck = (row) => {
  const memoMetadata = unpackCheckMemo(row.memo)
  return ({
  id: row.id,
  projectId: row.project_id,
  checkNumber: row.check_number,
  payee: row.payee,
  amount: Number(row.amount || 0),
  date: row.check_date,
  memo: memoMetadata.memo,
  mailingAddress: row.mailing_address || memoMetadata.mailingAddress,
  checkType: row.check_type || memoMetadata.checkType || 'payment',
  destinationAccount: row.destination_account || memoMetadata.destinationAccount || '',
  accountLabel: row.account_label || '',
  templateKey: row.template_key || 'bofa',
  status: row.status,
  printedAt: row.printed_at,
  voidedAt: row.voided_at,
  fundedByIncomeId: row.funded_by_income_id,
  invoiceId: row.invoice_id,
  costId: row.cost_id,
  lot: row.lot || '',
  createdAt: row.created_at,
  })
}

const normalizeLotCommitment = (row) => ({
  id: row.id,
  projectId: row.project_id,
  lot: row.lot,
  address: row.address || '',
  commitmentAmount: Number(row.commitment_amount || 0),
  permitNumber: row.permit_number || '',
  attachments: Array.isArray(row.attachments) ? row.attachments : [],
})

const unpackFinancingNotes = (value = '') => {
  const notes = String(value)
  const treatment = notes.match(/\n?\[\[greenfort-financing-treatment:(project_cost|partner_profit)\]\]/)?.[1] || ''
  const profitOwnerId = notes.match(/\n?\[\[greenfort-profit-owner:(\d+)\]\]/)?.[1] || null
  return {
    notes: notes
      .replace(/\n?\[\[greenfort-financing-treatment:(?:project_cost|partner_profit)\]\]/g, '')
      .replace(/\n?\[\[greenfort-profit-owner:\d+\]\]/g, '')
      .trim(),
    treatment,
    profitOwnerId: profitOwnerId ? Number(profitOwnerId) : null,
  }
}

const packFinancingNotes = (notes = '', treatment = '', profitOwnerId = null) => [
  String(notes || '').trim(),
  treatment ? `[[greenfort-financing-treatment:${treatment}]]` : '',
  treatment === 'partner_profit' && profitOwnerId ? `[[greenfort-profit-owner:${profitOwnerId}]]` : '',
].filter(Boolean).join('\n')

const normalizeFinancingTransaction = (row) => {
  const noteMetadata = unpackFinancingNotes(row.notes)
  return ({
  id: row.id,
  projectId: row.project_id,
  type: row.entry_type,
  status: row.entry_status,
  counterparty: row.counterparty,
  ownerId: row.owner_id,
  amount: Number(row.amount || 0),
  date: row.entry_date,
  paymentMethod: row.payment_method || '',
  reference: row.reference || '',
  notes: noteMetadata.notes,
  accountingTreatment: noteMetadata.treatment,
  profitOwnerId: noteMetadata.profitOwnerId,
  createdAt: row.created_at,
  })
}

export const buildProjectWorkspace = ({ categoriesResult, invoicesResult, transactionsResult, costsResult, costDocumentsResult = { data: [], error: null }, incomesResult, reviewResult, draftsResult, checksResult, lotCommitmentsResult, financingResult }) => {
  // Costs are the core project ledger. Auxiliary sections must never make a
  // successful cost load look empty when one of their tables is unavailable.
  if (costsResult.error) throw costsResult.error
  const warnings = [categoriesResult, invoicesResult, transactionsResult, costDocumentsResult, incomesResult, reviewResult, draftsResult, checksResult, lotCommitmentsResult, financingResult]
    .filter((result) => result?.error)
    .map((result) => result.error.message)

  const documentsByCost = new Map()
  ;(costDocumentsResult.data ?? []).forEach((row) => {
    if (!row.cost_id) return
    const key = String(row.cost_id)
    if (!documentsByCost.has(key)) documentsByCost.set(key, [])
    documentsByCost.get(key).push(normalizeStoredDocument(row))
  })
  const costVersions = (costsResult.data ?? []).map(normalizeCostVersion).map((cost) => {
    const linkedDocuments = documentsByCost.get(String(cost.costId)) || []
    if (!linkedDocuments.length) return cost
    const seen = new Set()
    const attachments = [...(cost.attachments || []), ...linkedDocuments].filter((attachment) => {
      const key = String(attachment.documentId || attachment.id || attachment.storagePath || attachment.name || '')
      if (key && seen.has(key)) return false
      if (key) seen.add(key)
      return true
    })
    return { ...cost, attachments }
  })

  return {
    categories: (categoriesResult.data ?? []).map(normalizeCategory),
    invoices: (invoicesResult.data ?? []).map(normalizeInvoice),
    transactions: (transactionsResult.data ?? []).map(normalizeTransaction),
    costVersions,
    incomes: (incomesResult.data ?? []).map(normalizeIncome),
    reviewItems: (reviewResult.data ?? []).map(normalizeReviewItem),
    constructionDrafts: (draftsResult.data ?? []).map(normalizeConstructionDraft),
    projectChecks: (checksResult.data ?? []).map(normalizeProjectCheck),
    lotCommitments: (lotCommitmentsResult?.data ?? []).map(normalizeLotCommitment),
    financingTransactions: (financingResult?.data ?? []).map(normalizeFinancingTransaction),
    warnings,
  }
}

export async function fetchProjectWorkspace(projectId) {
  if (!supabase || projectId == null) {
    return { categories: [], invoices: [], transactions: [], costVersions: [], incomes: [], reviewItems: [], constructionDrafts: [], projectChecks: [], lotCommitments: [], financingTransactions: [] }
  }

  const [categoriesResult, invoicesResult, transactionsResult, costsResult, costDocumentsResult, incomesResult, reviewResult, draftsResult, checksResult, lotCommitmentsResult, financingResult] = await Promise.all([
    supabase.from('cost_categories').select('*').eq('project_id', projectId).order('created_at'),
    supabase.from('invoices').select('*, documents(*)').eq('project_id', projectId).order('created_at', { ascending: false }),
    supabase.from('transactions').select('*').eq('project_id', projectId).order('date'),
    supabase.from('cost_versions').select('*').eq('project_id', projectId).order('created_at'),
    supabase.from('documents').select('*').eq('project_id', projectId).not('cost_id', 'is', null).order('created_at'),
    supabase.from('incomes').select('*').eq('project_id', projectId).is('deleted_at', null).order('income_date', { ascending: false }),
    supabase.from('review_items').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
    supabase.from('construction_cost_drafts').select('*').eq('project_id', projectId).order('sort_order'),
    supabase.from('project_checks').select('*').eq('project_id', projectId).order('check_date', { ascending: false }),
    supabase.from('project_lot_commitments').select('*').eq('project_id', projectId).order('lot'),
    supabase.from('project_financing_transactions').select('*').eq('project_id', projectId).order('entry_date', { ascending: false }),
  ])
  return buildProjectWorkspace({ categoriesResult, invoicesResult, transactionsResult, costsResult, costDocumentsResult, incomesResult, reviewResult, draftsResult, checksResult, lotCommitmentsResult, financingResult })
}

export async function saveFinancingTransaction(entry) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.from('project_financing_transactions').insert({
    project_id: entry.projectId,
    entry_type: entry.type,
    entry_status: entry.status,
    counterparty: entry.counterparty,
    owner_id: entry.ownerId || null,
    amount: entry.amount,
    entry_date: entry.date,
    payment_method: entry.paymentMethod || '',
    reference: entry.reference || '',
    notes: packFinancingNotes(
      entry.notes,
      entry.accountingTreatment || (entry.type === 'owner_distribution' ? 'partner_profit' : ''),
      entry.profitOwnerId || entry.ownerId || null,
    ),
  }).select('*').single()
  if (error) throw error
  return normalizeFinancingTransaction(data)
}

export async function deleteFinancingTransaction(entryId) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase.from('project_financing_transactions').delete().eq('id', entryId)
  if (error) throw error
}

export async function updateFinancingTransactionStatus(entryId, status) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.from('project_financing_transactions').update({
    entry_status: status,
    updated_at: new Date().toISOString(),
  }).eq('id', entryId).select('*').single()
  if (error) throw error
  return normalizeFinancingTransaction(data)
}

export async function updateFinancingTransaction(entryId, entry) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.from('project_financing_transactions').update({
    entry_type: entry.type,
    entry_status: entry.status,
    counterparty: entry.counterparty,
    owner_id: entry.type === 'owner_distribution' ? entry.ownerId || null : null,
    amount: entry.amount,
    entry_date: entry.date,
    payment_method: entry.paymentMethod || '',
    reference: entry.reference || '',
    notes: packFinancingNotes(entry.notes, entry.accountingTreatment, entry.profitOwnerId),
    updated_at: new Date().toISOString(),
  }).eq('id', entryId).select('*').single()
  if (error) throw error
  return normalizeFinancingTransaction(data)
}

export async function updateFinancingTransactionTreatment(entryId, treatment = '', profitOwnerId = null, notes = '') {
  if (!supabase) throw new Error('Supabase is not configured')
  if (treatment && !['project_cost', 'partner_profit'].includes(treatment)) throw new Error('Select a valid accounting treatment')
  const { data, error } = await supabase.from('project_financing_transactions').update({
    notes: packFinancingNotes(notes, treatment, profitOwnerId),
    updated_at: new Date().toISOString(),
  }).eq('id', entryId).select('*').single()
  if (error) throw error
  return normalizeFinancingTransaction(data)
}

export async function updateCostCategoryBudget(projectId, categoryId, budgetedAmount, lotBudgets = undefined) {
  if (!supabase) throw new Error('Supabase is not configured')
  const amount = Number(budgetedAmount)
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Enter a budget of 0 or greater')
  const payload = { budgeted_amount: amount }
  if (lotBudgets !== undefined) {
    if (!lotBudgets || typeof lotBudgets !== 'object' || Array.isArray(lotBudgets)) throw new Error('Lot budgets must be an object')
    payload.lot_budgets = Object.fromEntries(Object.entries(lotBudgets).map(([lot, value]) => {
      const lotAmount = Number(value)
      if (!Number.isFinite(lotAmount) || lotAmount < 0) throw new Error(`Enter a budget of 0 or greater for ${lot}`)
      return [lot, lotAmount]
    }))
  }
  const { data, error } = await supabase
    .from('cost_categories')
    .update(payload)
    .eq('id', categoryId)
    .eq('project_id', projectId)
    .select('*')
    .single()
  if (error) throw error
  return normalizeCategory(data)
}

export async function saveLotCommitment(commitment) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.from('project_lot_commitments').upsert({
    project_id: commitment.projectId,
    lot: commitment.lot,
    address: commitment.address || '',
    commitment_amount: commitment.commitmentAmount || 0,
    permit_number: commitment.permitNumber || '',
    attachments: commitment.attachments || [],
    updated_at: new Date().toISOString(),
  }, { onConflict: 'project_id,lot' }).select('*').single()
  if (error) throw error
  return normalizeLotCommitment(data)
}

export async function saveProjectCheck(check) {
  if (!supabase) throw new Error('Supabase is not configured')
  const payload = {
    project_id: check.projectId,
    check_number: check.checkNumber,
    payee: check.payee,
    amount: check.amount,
    check_date: check.date,
    memo: check.memo || '',
    mailing_address: check.mailingAddress || '',
    check_type: check.checkType || 'payment',
    destination_account: check.destinationAccount || '',
    account_label: check.accountLabel,
    template_key: check.templateKey || 'bofa',
    invoice_id: check.invoiceId || null,
    cost_id: check.costId || null,
    funded_by_income_id: check.fundedByIncomeId || null,
    lot: check.lot || null,
  }
  let { data, error } = await supabase.from('project_checks').insert(payload).select('*').single()
  if (missingCheckMetadataColumn(error)) {
    const { mailing_address: _mailingAddress, check_type: _checkType, destination_account: _destinationAccount, ...legacyPayload } = payload
    const legacyResult = await supabase.from('project_checks').insert({
      ...legacyPayload,
      memo: packLegacyCheckMemo(check.memo, check.mailingAddress, check.checkType, check.destinationAccount),
    }).select('*').single()
    data = legacyResult.data
    error = legacyResult.error
  }
  if (error) throw error
  return normalizeProjectCheck(data)
}

export async function updateProjectCheckStatus(checkId, status) {
  if (!supabase) throw new Error('Supabase is not configured')
  const now = new Date().toISOString()
  const { data, error } = await supabase.from('project_checks').update({
    status,
    printed_at: status === 'printed' ? now : undefined,
    voided_at: status === 'voided' ? now : undefined,
    updated_at: now,
  }).eq('id', checkId).select('*').single()
  if (error) throw error
  return normalizeProjectCheck(data)
}

export async function updateProjectCheck(checkId, check) {
  if (!supabase) throw new Error('Supabase is not configured')
  const payload = {
    check_number: check.checkNumber,
    payee: check.payee,
    amount: check.amount,
    check_date: check.date,
    memo: check.memo || '',
    mailing_address: check.mailingAddress || '',
    check_type: check.checkType || 'payment',
    destination_account: check.destinationAccount || '',
    account_label: check.accountLabel,
    template_key: check.templateKey || 'bofa',
    invoice_id: check.invoiceId || null,
    cost_id: check.costId || null,
    funded_by_income_id: check.fundedByIncomeId || null,
    lot: check.lot || null,
    updated_at: new Date().toISOString(),
  }
  let { data, error } = await supabase.from('project_checks').update(payload).eq('id', checkId).select('*').single()
  if (missingCheckMetadataColumn(error)) {
    const { mailing_address: _mailingAddress, check_type: _checkType, destination_account: _destinationAccount, ...legacyPayload } = payload
    const legacyResult = await supabase.from('project_checks').update({
      ...legacyPayload,
      memo: packLegacyCheckMemo(check.memo, check.mailingAddress, check.checkType, check.destinationAccount),
    }).eq('id', checkId).select('*').single()
    data = legacyResult.data
    error = legacyResult.error
  }
  if (error) throw error
  return normalizeProjectCheck(data)
}

export async function updateProjectCheckLink(checkId, link) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.from('project_checks').update({
    invoice_id: link.invoiceId || null,
    cost_id: link.costId || null,
    updated_at: new Date().toISOString(),
  }).eq('id', checkId).select('*').single()
  if (error) throw error
  return normalizeProjectCheck(data)
}

export async function updateProjectCheckFunding(checkId, fundedByIncomeId) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.from('project_checks').update({
    funded_by_income_id: fundedByIncomeId || null,
    updated_at: new Date().toISOString(),
  }).eq('id', checkId).select('*').single()
  if (error) throw error
  return normalizeProjectCheck(data)
}

export async function updateProjectCheckLot(checkId, lot) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.from('project_checks').update({
    lot: lot || null,
    updated_at: new Date().toISOString(),
  }).eq('id', checkId).select('*').single()
  if (error) throw error
  return normalizeProjectCheck(data)
}

export async function updateProjectCheckTemplate(checkId, templateKey, accountLabel) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.from('project_checks').update({
    template_key: templateKey,
    account_label: accountLabel,
    updated_at: new Date().toISOString(),
  }).eq('id', checkId).select('*').single()
  if (error) throw error
  return normalizeProjectCheck(data)
}

export async function updateConstructionDraft(projectId, draftId, updates) {
  if (!supabase) throw new Error('Supabase is not configured')
  const payload = {
    details: updates.details ?? '',
    planned_amount: updates.plannedAmount === '' || updates.plannedAmount == null ? null : Number(updates.plannedAmount),
    planned_date: updates.plannedDate || null,
    attachments: updates.attachments || [],
    status: updates.status || 'draft',
    converted_cost_id: updates.convertedCostId || null,
    updated_at: new Date().toISOString(),
    updated_by: (await supabase.auth.getUser()).data.user?.id || null,
  }
  const { data, error } = await supabase
    .from('construction_cost_drafts')
    .update(payload)
    .eq('project_id', projectId)
    .eq('id', draftId)
    .select('*')
    .single()
  if (error) throw error
  return normalizeConstructionDraft(data)
}

export async function saveProject(project) {
  if (!supabase) {
    return null
  }

  try {
    let companyId = project.company_id
    if (!companyId) {
      const { data: company } = await supabase.from('companies').select('id').order('created_at').limit(1).maybeSingle()
      companyId = company?.id
    }

    if (!companyId) {
      throw new Error('No accessible company is available for this project')
    }

    const { data, error } = await supabase.from('projects').insert({ ...project, company_id: companyId }).select().single()

    if (error) {
      throw new Error(error.message)
    }

    return data
  } catch {
    return null
  }
}

export async function sendMagicLink(email) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: {
      shouldCreateUser: false,
      emailRedirectTo: window.location.origin,
    },
  })
  if (error) throw error
}

export async function signInWithPassword(email, password) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  })
  if (error) throw error
}

export async function updateAccountPassword(password) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw error
}

export async function fetchAccessProfile(userId) {
  if (!supabase || !userId) return null
  const { error: ensureError } = await supabase.rpc('ensure_my_access_profile')
  if (ensureError) throw new Error(ensureError.message)
  const [{ data, error }, { data: memberships, error: membershipsError }] = await Promise.all([
    supabase.from('profiles').select('id,email,full_name,is_global_admin').eq('id', userId).maybeSingle(),
    supabase.from('project_members').select('project_id,role').eq('user_id', userId),
  ])
  if (error || membershipsError) throw new Error(error?.message || membershipsError?.message)
  return data ? { ...data, projectMemberships: memberships ?? [] } : null
}

export async function fetchProjectAccess(projectId) {
  if (!supabase || projectId == null) return { members: [], invitations: [] }
  const [{ data: members, error: membersError }, { data: invitations, error: invitationsError }] = await Promise.all([
    supabase
      .from('project_members')
      .select('project_id,user_id,role,created_at,profiles(email,full_name,is_global_admin)')
      .eq('project_id', projectId)
      .order('created_at'),
    supabase
      .from('project_invitations')
      .select('id,project_id,email,role,accepted_at,created_at')
      .eq('project_id', projectId)
      .is('accepted_at', null)
      .order('created_at'),
  ])
  if (membersError || invitationsError) throw new Error(membersError?.message || invitationsError?.message)
  return { members: members ?? [], invitations: invitations ?? [] }
}

export async function assignProjectAdmin(projectId, email) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.rpc('assign_project_admin', { p_project_id: projectId, p_email: email })
  if (error) throw error
  return data
}

export async function removeProjectAdmin(projectId, userId) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase
    .from('project_members')
    .delete()
    .eq('project_id', projectId)
    .eq('user_id', userId)
  if (error) throw error
}

export async function sendProjectAdminInvite(projectId, email, { sendCopy = false } = {}) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.functions.invoke('send-project-invite', {
    body: {
      projectId: Number(projectId),
      email: email.trim().toLowerCase(),
      redirectTo: window.location.origin,
      sendCopy,
    },
  })
  if (error) throw new Error(error.message || 'The invitation email could not be sent.')
  if (data?.error) throw new Error(data.error)
  return data
}

const normalizeBankTransaction = (row) => ({
  id: row.id,
  sourceRowId: row.source_row_id,
  bank: row.bank,
  owner: row.owner,
  isOwnerContribution: row.is_owner_contribution,
  date: row.date || '',
  description: row.description,
  amount: Number(row.amount || 0),
  balance: row.balance == null ? null : Number(row.balance),
  account: row.account || '',
  sourceName: row.source_name || '',
  category: row.category || '',
  phase: row.phase || '',
  vendor: row.vendor || '',
  memo: row.memo || '',
  confidence: row.confidence || '',
  transactionType: row.transaction_type || '',
  rawDescription: row.raw_description || '',
  reviewReasons: Array.isArray(row.review_reasons) ? row.review_reasons : [],
  classificationStatus: row.classification_status,
  reviewedAt: row.reviewed_at,
})

export async function fetchBankTransactions(projectId) {
  if (!supabase || projectId == null) return []
  const { data, error } = await supabase
    .from('bank_transactions')
    .select('*')
    .eq('project_id', projectId)
    .order('date', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw error
  return (data ?? []).map(normalizeBankTransaction)
}

export async function saveBankTransactions(projectId, transactions) {
  if (!supabase || projectId == null) throw new Error('Select a project before importing bank transactions')
  const payload = transactions.map((item) => ({
    project_id: projectId,
    source_row_id: item.sourceRowId || item.id,
    bank: item.bank,
    owner: item.owner,
    is_owner_contribution: item.isOwnerContribution,
    date: item.date || null,
    description: item.description,
    amount: item.amount,
    balance: item.balance,
    account: item.account || null,
    source_name: item.sourceName || null,
    category: item.category || null,
    phase: item.phase || null,
    vendor: item.vendor || null,
    memo: item.memo || null,
    confidence: item.confidence || null,
    transaction_type: item.transactionType || null,
    raw_description: item.rawDescription || null,
    review_reasons: item.reviewReasons,
    classification_status: item.classificationStatus || (item.reviewReasons.length ? 'needs_review' : 'auto_classified'),
  }))
  const { data, error } = await supabase
    .from('bank_transactions')
    .upsert(payload, { onConflict: 'project_id,source_row_id', ignoreDuplicates: true })
    .select('*')
  if (error) throw error
  return (data ?? []).map(normalizeBankTransaction)
}

export async function updateBankTransaction(transactionId, updates) {
  if (!supabase) throw new Error('Supabase is not configured')
  const payload = {}
  if (updates.owner !== undefined) payload.owner = updates.owner
  if (updates.category !== undefined) payload.category = updates.category
  if (updates.isOwnerContribution !== undefined) payload.is_owner_contribution = updates.isOwnerContribution
  if (updates.reviewReasons !== undefined) payload.review_reasons = updates.reviewReasons
  if (updates.classificationStatus !== undefined) payload.classification_status = updates.classificationStatus
  if (updates.reviewedAt !== undefined) payload.reviewed_at = updates.reviewedAt
  const { data, error } = await supabase.from('bank_transactions').update(payload).eq('id', transactionId).select('*').single()
  if (error) throw error
  return normalizeBankTransaction(data)
}

export async function saveOwner(owner) {
  if (!supabase) {
    return null
  }

  try {
    let { data, error } = await supabase.from('owners').insert(owner).select().single()
    if (error && Object.hasOwn(owner, 'ownership_percentage') && /ownership_percentage|schema cache/i.test(error.message || '')) {
      const { ownership_percentage: _ownershipPercentage, ...legacyOwner } = owner
      const legacyResult = await supabase.from('owners').insert(legacyOwner).select().single()
      data = legacyResult.data
      error = legacyResult.error
    }

    if (error) {
      throw new Error(error.message)
    }

    return data
  } catch {
    return null
  }
}

export async function updateOwner(ownerId, updates) {
  if (!supabase) {
    return null
  }

  try {
    let { data, error } = await supabase
      .from('owners')
      .update(updates)
      .eq('id', ownerId)
      .select()
      .single()

    if (error && Object.hasOwn(updates, 'ownership_percentage') && /ownership_percentage|schema cache/i.test(error.message || '')) {
      const { ownership_percentage: _ownershipPercentage, ...legacyUpdates } = updates
      const legacyResult = await supabase.from('owners').update(legacyUpdates).eq('id', ownerId).select().single()
      data = legacyResult.data
      error = legacyResult.error
    }

    if (error) {
      throw new Error(error.message)
    }

    return data
  } catch {
    return null
  }
}

export async function fetchOwners(projectId) {
  if (!supabase) {
    return []
  }

  try {
    const { data, error } = await supabase
      .from('owners')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })

    if (error) {
      throw new Error(error.message)
    }

    return data ?? []
  } catch {
    return []
  }
}

export async function createCostVersion(projectId, cost) {
  if (!supabase) throw new Error('Supabase is not configured')
  const costId = cost.costId || crypto.randomUUID()
  const detailsAttachment = cost.details ? [{ _type: 'cost_details', details: cost.details }] : []
  const accountingAttachment = cost.constructionDraftId || cost.paymentMethod || cost.paymentFeePercentage != null || cost.paymentFeeAmount != null || cost.paymentDate || cost.invoiceAmount != null || cost.vendorName || cost.mainCategory || cost.subcategory || cost.payerType || cost.paymentSource || cost.referenceNumber || cost.reimbursable || cost.loanRelated || cost.notes || cost.recurringFrequency || cost.isSoftCostParent ? [{
    _type: 'cost_accounting',
    constructionDraftId: cost.constructionDraftId || null,
    paymentMethod: cost.paymentMethod || '',
    paymentFeePercentage: cost.paymentFeePercentage ?? null,
    paymentFeeAmount: cost.paymentFeeAmount ?? null,
    paymentDate: cost.paymentDate || null,
    invoiceAmount: cost.invoiceAmount ?? null,
    vendorName: cost.vendorName || '',
    mainCategory: cost.mainCategory || '',
    subcategory: cost.subcategory || '',
    payerType: cost.payerType || '',
    payerOwnerId: cost.payerOwnerId || null,
    payerName: cost.payerName || '',
    paymentSource: cost.paymentSource || '',
    referenceNumber: cost.referenceNumber || '',
    reimbursable: Boolean(cost.reimbursable),
    loanRelated: Boolean(cost.loanRelated),
    notes: cost.notes || '',
    recurringFrequency: cost.recurringFrequency || '',
    isSoftCostParent: Boolean(cost.isSoftCostParent),
  }] : []
  const v3Payload = {
    p_project_id: projectId,
    p_cost_id: costId,
    p_parent_cost_id: cost.parentCostId || null,
    p_owner_id: cost.ownerId,
    p_name: cost.name,
    p_amount: cost.amount,
    p_phase: cost.phase,
    p_category: cost.category || null,
    p_lot_allocations: cost.lotAllocations || [],
    p_cost_date: cost.date,
    p_attachments: [...(cost.attachments || []), ...detailsAttachment, ...accountingAttachment],
    p_deleted: Boolean(cost.deleted),
  }
  let { data, error } = await supabase.rpc('create_cost_version_v8', {
    ...v3Payload,
    p_details: cost.details || null,
    p_construction_draft_id: cost.constructionDraftId || null,
    p_payment_method: cost.paymentMethod || null,
    p_payment_fee_percentage: cost.paymentFeePercentage ?? null,
    p_payment_fee_amount: cost.paymentFeeAmount ?? null,
    p_payment_date: cost.paymentDate || null,
    p_invoice_amount: cost.invoiceAmount ?? null,
    p_attachments: cost.attachments || [],
    p_vendor_name: cost.vendorName || null,
    p_main_category: cost.mainCategory || null,
    p_subcategory: cost.subcategory || null,
    p_payer_type: cost.payerType || null,
    p_payer_owner_id: cost.payerOwnerId || null,
    p_payer_name: cost.payerName || null,
    p_payment_source: cost.paymentSource || null,
    p_reference_number: cost.referenceNumber || null,
    p_reimbursable: Boolean(cost.reimbursable),
    p_loan_related: Boolean(cost.loanRelated),
    p_notes: cost.notes || null,
    p_recurring_frequency: cost.recurringFrequency || null,
    p_is_soft_cost_parent: Boolean(cost.isSoftCostParent),
  })
  if (error?.code === 'PGRST202') {
    const v7Result = await supabase.rpc('create_cost_version_v7', {
      ...v3Payload,
      p_details: cost.details || null,
      p_construction_draft_id: cost.constructionDraftId || null,
      p_payment_method: cost.paymentMethod || null,
      p_payment_fee_percentage: cost.paymentFeePercentage ?? null,
      p_payment_fee_amount: cost.paymentFeeAmount ?? null,
      p_payment_date: cost.paymentDate || null,
      p_invoice_amount: cost.invoiceAmount ?? null,
      p_attachments: [...(cost.attachments || []), ...accountingAttachment],
    })
    data = v7Result.data
    error = v7Result.error
  }
  if (error?.code === 'PGRST202') {
    const v6Result = await supabase.rpc('create_cost_version_v6', {
      ...v3Payload,
      p_details: cost.details || null,
      p_construction_draft_id: cost.constructionDraftId || null,
      p_payment_method: cost.paymentMethod || null,
      p_payment_fee_percentage: cost.paymentFeePercentage ?? null,
      p_payment_date: cost.paymentDate || null,
      p_attachments: [...(cost.attachments || []), ...accountingAttachment],
    })
    data = v6Result.data
    error = v6Result.error
  }
  if (error?.code === 'PGRST202') {
    const v5Result = await supabase.rpc('create_cost_version_v5', {
      ...v3Payload,
      p_details: cost.details || null,
      p_construction_draft_id: cost.constructionDraftId || null,
      p_payment_method: cost.paymentMethod || null,
      p_attachments: [...(cost.attachments || []), ...accountingAttachment],
    })
    data = v5Result.data
    error = v5Result.error
  }
  if (error?.code === 'PGRST202') {
    const v4Result = await supabase.rpc('create_cost_version_v4', {
      ...v3Payload,
      p_details: cost.details || null,
      p_attachments: [...(cost.attachments || []), ...accountingAttachment],
    })
    data = v4Result.data
    error = v4Result.error
  }
  if (error?.code === 'PGRST202') {
    const v3Result = await supabase.rpc('create_cost_version_v3', v3Payload)
    data = v3Result.data
    error = v3Result.error
  }
  if (error?.code === 'PGRST202') {
    const legacyAttachments = [...(cost.attachments || [])]
    if (cost.category || (cost.lotAllocations || []).length) {
      legacyAttachments.push({
        _type: 'cost_dimensions',
        category: cost.category || '',
        lotAllocations: cost.lotAllocations || [],
      })
    }
    legacyAttachments.push(...detailsAttachment)
    legacyAttachments.push(...accountingAttachment)
    const legacyResult = await supabase.rpc('create_cost_version_v2', {
      p_project_id: projectId,
      p_cost_id: costId,
      p_parent_cost_id: cost.parentCostId || null,
      p_owner_id: cost.ownerId,
      p_name: cost.name,
      p_amount: cost.amount,
      p_phase: cost.phase,
      p_cost_date: cost.date,
      p_attachments: legacyAttachments,
      p_deleted: Boolean(cost.deleted),
    })
    data = legacyResult.data
    error = legacyResult.error
  }
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('The cost version was not returned by Supabase')

  const documentIds = (cost.attachments || []).map((attachment) => attachment.documentId).filter(Boolean)
  if (documentIds.length) {
    const { error: documentError } = await supabase
      .from('documents')
      .update({ cost_id: costId })
      .in('id', documentIds)
    if (documentError) throw documentError
  }
  return normalizeCostVersion(row)
}

export async function mergeCostBreakdowns(projectId, parentCostId, costIds, name, date = null) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.rpc('merge_cost_breakdowns', {
    p_project_id: projectId,
    p_parent_cost_id: parentCostId,
    p_cost_ids: costIds,
    p_name: name,
    p_cost_date: date,
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('The merged breakdown was not returned by Supabase')
  return normalizeCostVersion(row)
}

export async function addCostsToBreakdownGroup(projectId, groupCostId, costIds) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.rpc('add_costs_to_breakdown_group', {
    p_project_id: projectId,
    p_group_cost_id: groupCostId,
    p_cost_ids: costIds,
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('The updated breakdown group was not returned by Supabase')
  return normalizeCostVersion(row)
}

export async function unmergeCostBreakdownGroup(projectId, groupCostId) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.rpc('unmerge_cost_breakdown_group', {
    p_project_id: projectId,
    p_group_cost_id: groupCostId,
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('The unmerged group was not returned by Supabase')
  return normalizeCostVersion(row)
}

export const buildLegacyIncomeAttachments = (income = {}) => [
  ...(income.attachments || []),
  ...(income.activities || []).map((activity) => ({ _type: 'income_activity', activity })),
]

export async function saveIncome(income) {
  if (!supabase) throw new Error('Supabase is not configured')
  const attachments = income.attachments || []
  const legacyAttachments = buildLegacyIncomeAttachments(income)
  const payload = {
    project_id: income.projectId,
    description: income.description,
    source: income.source,
    amount: income.amount,
    income_date: income.date,
    income_type: income.type,
    lot_breakdown: income.lotBreakdown || [],
    activity_breakdown: income.activities || [],
    attachments,
  }
  let { data, error } = await supabase.from('incomes').insert(payload).select('*').single()
  if (error && /activity_breakdown|schema cache/i.test(error.message || '')) {
    const { activity_breakdown: _activityBreakdown, ...legacyPayload } = payload
    ;({ data, error } = await supabase.from('incomes').insert({ ...legacyPayload, attachments: legacyAttachments }).select('*').single())
  }
  if (error && income.type === 'pre_sale_deposit' && /income_type_check|schema cache/i.test(error.message || '')) {
    const { activity_breakdown: _activityBreakdown, ...legacyPayload } = payload
    ;({ data, error } = await supabase.from('incomes').insert({ ...legacyPayload, income_type: 'project_income', attachments: legacyAttachments }).select('*').single())
  }
  if (error) throw error
  return normalizeIncome(data)
}

export async function updateIncome(incomeId, updates) {
  if (!supabase) throw new Error('Supabase is not configured')
  const attachments = updates.attachments || []
  const legacyAttachments = buildLegacyIncomeAttachments(updates)
  const payload = {
    project_id: updates.projectId,
    description: updates.description,
    source: updates.source,
    amount: updates.amount,
    income_date: updates.date,
    income_type: updates.type,
    lot_breakdown: updates.lotBreakdown || [],
    activity_breakdown: updates.activities || [],
    attachments,
    updated_at: new Date().toISOString(),
  }
  let { data, error } = await supabase.from('incomes').update(payload).eq('id', incomeId).select('*').single()
  if (error && /activity_breakdown|schema cache/i.test(error.message || '')) {
    const { activity_breakdown: _activityBreakdown, ...legacyPayload } = payload
    ;({ data, error } = await supabase.from('incomes').update({ ...legacyPayload, attachments: legacyAttachments }).eq('id', incomeId).select('*').single())
  }
  if (error && updates.type === 'pre_sale_deposit' && /income_type_check|schema cache/i.test(error.message || '')) {
    const { activity_breakdown: _activityBreakdown, ...legacyPayload } = payload
    ;({ data, error } = await supabase.from('incomes').update({ ...legacyPayload, income_type: 'project_income', attachments: legacyAttachments }).eq('id', incomeId).select('*').single())
  }
  if (error) throw error
  return normalizeIncome(data)
}

export async function deleteIncome(incomeId) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase.from('incomes').update({
    deleted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', incomeId)
  if (error) throw error
}

const safeFileName = (name) => String(name || 'document')
  .normalize('NFKD')
  .replace(/[^a-zA-Z0-9._-]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'document'

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

const MISCELLANEOUS_DOCUMENT_TYPES = new Set([
  ...ALLOWED_DOCUMENT_MIME_TYPES,
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
])

const miscellaneousContentType = (file) => {
  if (file.type) return file.type.toLowerCase()
  const extension = String(file.name || '').toLowerCase().split('.').pop()
  return ({
    pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    csv: 'text/csv', txt: 'text/plain',
  })[extension] || ''
}

export async function uploadProjectDocument(projectId, file) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (projectId == null) throw new Error('Select a project before uploading a document')
  if (!file || file.size <= 0) throw new Error('Choose a non-empty document to upload')
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error('Choose a document smaller than 10 MB')
  const inferredType = file.name?.toLowerCase().endsWith('.pdf') ? 'application/pdf' : ''
  const contentType = (file.type || inferredType).toLowerCase()
  if (!ALLOWED_DOCUMENT_MIME_TYPES.has(contentType)) {
    throw new Error('Only PDF, JPEG, PNG, WebP, HEIC, and HEIF documents are supported')
  }
  const storagePath = `${projectId}/${crypto.randomUUID()}-${safeFileName(file.name)}`
  const { error: uploadError } = await supabase.storage
    .from('accounting-documents')
    .upload(storagePath, file, { contentType, upsert: false })
  if (uploadError) throw uploadError

  const { data, error } = await supabase.from('documents').insert({
    project_id: projectId,
    storage_bucket: 'accounting-documents',
    storage_path: storagePath,
    original_name: file.name,
    mime_type: contentType || null,
    size_bytes: file.size,
  }).select('*').single()
  if (error) {
    await supabase.storage.from('accounting-documents').remove([storagePath])
    throw error
  }
  return {
    documentId: data.id,
    storageBucket: data.storage_bucket,
    storagePath: data.storage_path,
    name: data.original_name,
    mimeType: data.mime_type,
    size: data.size_bytes,
  }
}

export async function fetchMiscellaneousDocuments(projectId) {
  if (!supabase || projectId == null) return []
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('project_id', projectId)
    .like('storage_path', `${projectId}/miscellaneous/%`)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map(normalizeStoredDocument)
}

export async function fetchBankStatementDocuments(projectId) {
  if (!supabase || projectId == null) return []
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('project_id', projectId)
    .like('storage_path', `${projectId}/bank-statements/%`)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map(normalizeStoredDocument)
}

export async function uploadBankStatementDocument(projectId, file, bank = '') {
  if (!supabase) throw new Error('Supabase is not configured')
  if (projectId == null) throw new Error('Select a project before uploading a bank statement')
  if (!file || file.size <= 0) throw new Error('Choose a non-empty bank statement')
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error('Choose a bank statement smaller than 10 MB')
  const contentType = miscellaneousContentType(file)
  const allowedTypes = new Set([
    'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
  ])
  if (!allowedTypes.has(contentType)) throw new Error('Use a PDF, Excel, or CSV bank statement')
  if (!['boa', 'providence', 'amex', 'flagstar'].includes(bank)) throw new Error('Choose the bank for this statement')

  const { data: existing, error: existingError } = await supabase
    .from('documents')
    .select('*')
    .eq('project_id', projectId)
    .eq('original_name', file.name)
    .eq('size_bytes', file.size)
    .like('storage_path', `${projectId}/bank-statements/%`)
    .limit(1)
  if (existingError) throw existingError
  const existingForBank = existing?.find((document) => {
    const path = String(document.storage_path || '')
    return path.includes(`/bank-statements/${bank}/`)
      || (bank === 'boa' && /^\d+\/bank-statements\/[^/]+$/.test(path))
  })
  if (existingForBank) return normalizeStoredDocument(existingForBank)

  const storagePath = `${projectId}/bank-statements/${bank}/${crypto.randomUUID()}-${safeFileName(file.name)}`
  const { error: uploadError } = await supabase.storage
    .from('accounting-documents')
    .upload(storagePath, file, { contentType, upsert: false })
  if (uploadError) throw uploadError
  const { data, error } = await supabase.from('documents').insert({
    project_id: projectId,
    storage_bucket: 'accounting-documents',
    storage_path: storagePath,
    original_name: file.name,
    mime_type: contentType,
    size_bytes: file.size,
  }).select('*').single()
  if (error) {
    await supabase.storage.from('accounting-documents').remove([storagePath])
    throw error
  }
  return normalizeStoredDocument(data)
}

export async function uploadMiscellaneousDocument(projectId, file) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (projectId == null) throw new Error('Select a project before uploading a document')
  if (!file || file.size <= 0) throw new Error('Choose a non-empty document')
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error('Choose a document smaller than 10 MB')
  const contentType = miscellaneousContentType(file)
  if (!MISCELLANEOUS_DOCUMENT_TYPES.has(contentType)) throw new Error('Use a PDF, image, Word, Excel, CSV, or text document')
  const storagePath = `${projectId}/miscellaneous/${crypto.randomUUID()}-${safeFileName(file.name)}`
  const { error: uploadError } = await supabase.storage
    .from('accounting-documents')
    .upload(storagePath, file, { contentType, upsert: false })
  if (uploadError) throw uploadError
  const { data, error } = await supabase.from('documents').insert({
    project_id: projectId,
    storage_bucket: 'accounting-documents',
    storage_path: storagePath,
    original_name: file.name,
    mime_type: contentType,
    size_bytes: file.size,
  }).select('*').single()
  if (error) {
    await supabase.storage.from('accounting-documents').remove([storagePath])
    throw error
  }
  return normalizeStoredDocument(data)
}

export async function deleteMiscellaneousDocument(projectId, document) {
  if (!supabase) throw new Error('Supabase is not configured')
  const documentId = document?.documentId || document?.id
  const expectedPrefix = `${projectId}/miscellaneous/`
  if (!documentId || !String(document.storagePath || '').startsWith(expectedPrefix)) throw new Error('This is not a miscellaneous project document')
  const { error: deleteError } = await supabase.from('documents').delete().eq('id', documentId).eq('project_id', projectId)
  if (deleteError) throw deleteError
  const { error: storageError } = await supabase.storage.from(document.storageBucket || 'accounting-documents').remove([document.storagePath])
  if (storageError) throw storageError
}

export async function updateMiscellaneousDocument(projectId, documentId, updates) {
  if (!supabase) throw new Error('Supabase is not configured')
  const displayName = String(updates.name || '').trim()
  const documentDate = String(updates.documentDate || '').trim()
  const description = String(updates.description || '').trim()
  if (!displayName) throw new Error('Enter a document name')
  const { data, error } = await supabase.from('documents').update({
    display_name: displayName,
    document_date: documentDate || null,
    description,
  }).eq('id', documentId).eq('project_id', projectId).select('*').single()
  if (error) throw error
  return normalizeStoredDocument(data)
}

export async function createDocumentSignedUrl(attachment, { download = false } = {}) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!attachment?.storagePath) throw new Error('This attachment does not have a stored file path')
  const { data, error } = await supabase.storage
    .from(attachment.storageBucket || 'accounting-documents')
    .createSignedUrl(attachment.storagePath, 60, { download: download ? (attachment.name || true) : false })
  if (error) throw error
  return data.signedUrl
}

export async function saveIntakeItem(projectId, item, file = null) {
  if (!supabase) throw new Error('Supabase is not configured')
  let document = null
  let invoice = null

  if (file) document = await uploadProjectDocument(projectId, file)

  if (item.type === 'invoice') {
    const { data, error } = await supabase.from('invoices').insert({
      project_id: projectId,
      invoice_number: item.invoiceNumber,
      vendor_name: item.vendor || null,
      amount: item.amount,
      invoice_date: item.date || null,
      status: 'pending',
      description: item.description || null,
      classification: item.classification || null,
      source_name: item.sourceName || null,
      notes: item.notes || null,
    }).select('*').single()
    if (error) throw error
    invoice = normalizeInvoice(data)
    if (document) invoice.attachments = [{ ...document, id: document.documentId }]
  }

  const { data, error } = await supabase.from('review_items').insert({
    project_id: projectId,
    owner_id: item.ownerId || null,
    source_name: item.sourceName || document?.name || null,
    vendor: item.vendor || null,
    amount: item.amount || 0,
    transaction_date: item.date || null,
    description: item.description || null,
    entry_type: ['deposit', 'debit'].includes(item.entryType) ? item.entryType : 'unknown',
    notes: item.notes || null,
    raw_data: { ...item, documentId: document?.documentId || null, invoiceId: invoice?.id || null },
  }).select('*').single()
  if (error) throw error

  if (document) {
    const { error: linkError } = await supabase.from('documents').update({
      review_item_id: data.id,
      invoice_id: invoice?.id || null,
    }).eq('id', document.documentId)
    if (linkError) throw linkError
  }

  return { reviewItem: normalizeReviewItem(data), invoice, document }
}

export async function approveReviewItem(itemId, categoryId, notes = '') {
  if (!supabase) throw new Error('Supabase is not configured')
  if (notes) {
    const { error: notesError } = await supabase.from('review_items').update({ notes }).eq('id', itemId)
    if (notesError) throw notesError
  }
  const { data, error } = await supabase.rpc('approve_review_item', {
    p_item_id: itemId,
    p_category_id: categoryId,
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return normalizeTransaction(row)
}

export async function removeReviewItem(itemId) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.from('review_items').update({
    status: 'removed',
    reviewed_at: new Date().toISOString(),
  }).eq('id', itemId).select('*').single()
  if (error) throw error
  return normalizeReviewItem(data)
}

export async function saveManualTransaction(projectId, row, categoryId = null) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data: project, error: projectError } = await supabase
    .from('projects').select('company_id').eq('id', projectId).single()
  if (projectError) throw projectError
  const { data, error } = await supabase.from('transactions').insert({
    company_id: project.company_id,
    project_id: projectId,
    category_id: categoryId,
    date: row.date,
    description: row.description,
    amount: row.amount,
    source: 'manual',
    raw_import_row: row.rawImportRow || row,
  }).select('*').single()
  if (error) throw error
  return normalizeTransaction(data)
}
