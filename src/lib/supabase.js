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
    const [{ data: projects, error: projectsError }, { data: owners, error: ownersError }, { data: activeCosts, error: costsError }] = await Promise.all([
      supabase.from('projects').select('*').order('created_at', { ascending: true }),
      supabase.from('owners').select('*').order('created_at', { ascending: true }),
      supabase.from('active_costs').select('project_id,parent_cost_id,amount'),
    ])

    if (projectsError || ownersError || costsError) {
      throw new Error(projectsError?.message || ownersError?.message || costsError?.message || 'Failed to load data')
    }

    const projectCostTotals = buildProjectCostTotals(activeCosts)
    return { projects: projects ?? [], owners: owners ?? [], projectCostTotals }
  } catch {
    return null
  }
}

const normalizeCategory = (row) => ({
  id: row.id,
  projectId: row.project_id,
  phase: row.phase,
  name: row.name,
  budgetedAmount: Number(row.budgeted_amount || 0),
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

const normalizeCostVersion = (row) => ({
  id: row.id,
  costId: row.cost_id,
  parentCostId: row.parent_cost_id,
  projectId: row.project_id,
  ownerId: row.owner_id,
  version: row.version,
  name: row.name,
  amount: Number(row.amount || 0),
  phase: row.phase,
  date: row.cost_date,
  attachments: Array.isArray(row.attachments) ? row.attachments : [],
  deletedAt: row.deleted_at,
  createdAt: row.created_at,
})

const normalizeIncome = (row) => ({
  id: row.id,
  projectId: row.project_id,
  description: row.description,
  source: row.source,
  amount: Number(row.amount || 0),
  date: row.income_date,
  type: row.income_type,
  lotBreakdown: Array.isArray(row.lot_breakdown) ? row.lot_breakdown : [],
  attachments: Array.isArray(row.attachments) ? row.attachments : [],
})

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

const normalizeProjectCheck = (row) => ({
  id: row.id,
  projectId: row.project_id,
  checkNumber: row.check_number,
  payee: row.payee,
  amount: Number(row.amount || 0),
  date: row.check_date,
  memo: row.memo || '',
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

const normalizeLotCommitment = (row) => ({
  id: row.id,
  projectId: row.project_id,
  lot: row.lot,
  address: row.address || '',
  commitmentAmount: Number(row.commitment_amount || 0),
  permitNumber: row.permit_number || '',
  attachments: Array.isArray(row.attachments) ? row.attachments : [],
})

export const buildProjectWorkspace = ({ categoriesResult, invoicesResult, transactionsResult, costsResult, incomesResult, reviewResult, draftsResult, checksResult, lotCommitmentsResult }) => {
  // Costs are the core project ledger. Auxiliary sections must never make a
  // successful cost load look empty when one of their tables is unavailable.
  if (costsResult.error) throw costsResult.error
  const warnings = [categoriesResult, invoicesResult, transactionsResult, incomesResult, reviewResult, draftsResult, checksResult, lotCommitmentsResult]
    .filter((result) => result?.error)
    .map((result) => result.error.message)

  return {
    categories: (categoriesResult.data ?? []).map(normalizeCategory),
    invoices: (invoicesResult.data ?? []).map(normalizeInvoice),
    transactions: (transactionsResult.data ?? []).map(normalizeTransaction),
    costVersions: (costsResult.data ?? []).map(normalizeCostVersion),
    incomes: (incomesResult.data ?? []).map(normalizeIncome),
    reviewItems: (reviewResult.data ?? []).map(normalizeReviewItem),
    constructionDrafts: (draftsResult.data ?? []).map(normalizeConstructionDraft),
    projectChecks: (checksResult.data ?? []).map(normalizeProjectCheck),
    lotCommitments: (lotCommitmentsResult?.data ?? []).map(normalizeLotCommitment),
    warnings,
  }
}

export async function fetchProjectWorkspace(projectId) {
  if (!supabase || projectId == null) {
    return { categories: [], invoices: [], transactions: [], costVersions: [], incomes: [], reviewItems: [], constructionDrafts: [], projectChecks: [], lotCommitments: [] }
  }

  const [categoriesResult, invoicesResult, transactionsResult, costsResult, incomesResult, reviewResult, draftsResult, checksResult, lotCommitmentsResult] = await Promise.all([
    supabase.from('cost_categories').select('*').eq('project_id', projectId).order('created_at'),
    supabase.from('invoices').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
    supabase.from('transactions').select('*').eq('project_id', projectId).order('date'),
    supabase.from('cost_versions').select('*').eq('project_id', projectId).order('created_at'),
    supabase.from('incomes').select('*').eq('project_id', projectId).is('deleted_at', null).order('income_date', { ascending: false }),
    supabase.from('review_items').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
    supabase.from('construction_cost_drafts').select('*').eq('project_id', projectId).order('sort_order'),
    supabase.from('project_checks').select('*').eq('project_id', projectId).order('check_date', { ascending: false }),
    supabase.from('project_lot_commitments').select('*').eq('project_id', projectId).order('lot'),
  ])
  return buildProjectWorkspace({ categoriesResult, invoicesResult, transactionsResult, costsResult, incomesResult, reviewResult, draftsResult, checksResult, lotCommitmentsResult })
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
  const { data, error } = await supabase.from('project_checks').insert({
    project_id: check.projectId,
    check_number: check.checkNumber,
    payee: check.payee,
    amount: check.amount,
    check_date: check.date,
    memo: check.memo || '',
    account_label: check.accountLabel,
    template_key: check.templateKey || 'bofa',
    invoice_id: check.invoiceId || null,
    cost_id: check.costId || null,
    funded_by_income_id: check.fundedByIncomeId || null,
    lot: check.lot || null,
  }).select('*').single()
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
      shouldCreateUser: true,
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
    const { data, error } = await supabase.from('owners').insert(owner).select().single()

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
    const { data, error } = await supabase
      .from('owners')
      .update(updates)
      .eq('id', ownerId)
      .select()
      .single()

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
  const { data, error } = await supabase.rpc('create_cost_version_v2', {
    p_project_id: projectId,
    p_cost_id: costId,
    p_parent_cost_id: cost.parentCostId || null,
    p_owner_id: cost.ownerId,
    p_name: cost.name,
    p_amount: cost.amount,
    p_phase: cost.phase,
    p_cost_date: cost.date,
    p_attachments: cost.attachments || [],
    p_deleted: Boolean(cost.deleted),
  })
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

export async function saveIncome(income) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.from('incomes').insert({
    project_id: income.projectId,
    description: income.description,
    source: income.source,
    amount: income.amount,
    income_date: income.date,
    income_type: income.type,
    lot_breakdown: income.lotBreakdown || [],
    attachments: income.attachments || [],
  }).select('*').single()
  if (error) throw error
  return normalizeIncome(data)
}

export async function updateIncome(incomeId, updates) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.from('incomes').update({
    project_id: updates.projectId,
    description: updates.description,
    source: updates.source,
    amount: updates.amount,
    income_date: updates.date,
    income_type: updates.type,
    lot_breakdown: updates.lotBreakdown || [],
    attachments: updates.attachments || [],
    updated_at: new Date().toISOString(),
  }).eq('id', incomeId).select('*').single()
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

export async function uploadProjectDocument(projectId, file) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (projectId == null) throw new Error('Select a project before uploading a document')
  const storagePath = `${projectId}/${crypto.randomUUID()}-${safeFileName(file.name)}`
  const contentType = file.type || (file.name?.toLowerCase().endsWith('.pdf') ? 'application/pdf' : undefined)
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

export async function createDocumentSignedUrl(attachment) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!attachment?.storagePath) throw new Error('This attachment does not have a stored file path')
  const { data, error } = await supabase.storage
    .from(attachment.storageBucket || 'accounting-documents')
    .createSignedUrl(attachment.storagePath, 60, { download: false })
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
