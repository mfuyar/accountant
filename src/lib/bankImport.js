const headerAliases = {
  date: ['date', 'posteddate', 'postingdate', 'transactiondate', 'effectivedate'],
  description: ['description', 'memo', 'payee', 'details', 'transactiondescription', 'merchant'],
  amount: ['amount', 'transactionamount', 'netamount'],
  debit: ['debit', 'debits', 'withdrawal', 'withdrawals'],
  credit: ['credit', 'credits', 'deposit', 'deposits'],
  balance: ['balance', 'runningbalance', 'availablebalance'],
  owner: ['owner', 'accountowner', 'customername', 'name'],
  account: ['account', 'accountname', 'accountnumber'],
  category: ['category'],
  phase: ['phase'],
  vendor: ['vendorpayee', 'vendor', 'payee'],
  memo: ['memoreference', 'memo', 'reference'],
  confidence: ['confidence', 'reviewstatus'],
  statement: ['statement', 'statementname', 'sourcefile'],
  transactionType: ['type', 'transactiontype'],
  rawDescription: ['rawbankdescription', 'bankdescription'],
}

const normalizeHeader = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

function parseMoney(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value == null || value === '') return null
  const text = String(value).trim()
  const negative = text.startsWith('(') && text.endsWith(')')
  const parsed = Number(text.replace(/[^0-9.-]/g, ''))
  if (!Number.isFinite(parsed)) return null
  return negative ? -Math.abs(parsed) : parsed
}

const transactionFingerprint = (parts) => {
  let hash = 2166136261
  const text = parts.map((part) => String(part ?? '').trim().toLowerCase()).join('|')
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

const categoryForDescription = (description, amount) => {
  const text = description.toLowerCase()
  if (amount > 0) {
    if (/private (?:person |lender )?loan|loan from|promissory note|personal loan proceeds/.test(text)) return 'Private Lender Loan Proceeds'
    if (/payment received|autopay payment|online payment|thank you/.test(text)) return 'Credit Card Payment'
    if (/interest (?:earned|paid)|interest income/.test(text)) return 'Interest Income'
    if (/cash\s*back|cashback|rewards? (?:credit|redemption)|reward dollars/.test(text)) return 'Bank Cash Back'
    if (/refund|reimbursement|statement credit/.test(text)) return 'Refund / Reimbursement'
    if (/deposit|mobile check|merchant services|customer payment|client payment|invoice payment|sales receipt/.test(text)) return 'Business Income'
    return ''
  }
  const rules = [
    [/private (?:person |lender )?loan|private loan payment|promissory note/, 'Private Lender Loan Payment'],
    [/american express|amex.*payment|credit card payment/, 'Credit Card Payment'],
    [/account transfer|online transfer|transfer between/, 'Bank Transfer'],
    [/bank fee|service charge|wire fee|late fee|interest charge|annual fee/, 'Bank Fees'],
    [/facebook|google ads|marketing|meta platforms|signage|advertis/, 'Advertising & Marketing'],
    [/adobe|amazon web services|aws|dropbox|google workspace|lovable|microsoft|netlify|quickbooks|software|taxact|vercel/, 'Software & Technology'],
    [/insurance|geico|progressive|state farm/, 'Insurance'],
    [/irs|department of revenue|property tax|tax payment|license fee/, 'Taxes & Licenses'],
    [/electric|energy|gas bill|internet|phone|spectrum|utility|verizon|water/, 'Utilities'],
    [/permit|inspection|recording fee/, 'Permits & Fees'],
    [/attorney|law office|legal|accountant|cpa|bookkeep/, 'Legal & Professional'],
    [/concrete|contractor|construction|electrician|plumb|roofing/, 'Contract Labor'],
    [/home depot|lowe'?s|lumber|building material|supply house/, 'Materials & Supplies'],
    [/repair|maintenance|equipment service/, 'Repairs & Maintenance'],
    [/office rent|rent payment|commercial lease|workspace/, 'Rent or Lease'],
    [/exxon|fuel|gas station|shell oil|toll|parking|vehicle/, 'Vehicle Expense'],
    [/restaurant|cafe|coffee|doordash|grubhub|uber eats/, 'Meals'],
    [/airlines|airways|hotel|marriott|rental car/, 'Travel'],
    [/office depot|office max|staples/, 'Office Supplies'],
    [/providence bank/, 'Financing / Loan Payment'],
  ]
  return rules.find(([pattern]) => pattern.test(text))?.[1] || ''
}

const businessIncomeCategories = new Set(['Business Income', 'Project Income', 'Interest Income'])
const nonTaxCategories = new Set([
  'Bank Cash Back',
  'Bank Transfer',
  'Credit Card Payment',
  'Financing / Loan Payment',
  'Loan Draw',
  'Owner Contribution',
  'Personal / Non-Project',
  'Private Lender Loan Payment',
  'Private Lender Loan Principal',
  'Private Lender Loan Proceeds',
])

export function taxTreatmentFor(item) {
  if (item.reviewReasons?.length || !item.category) return 'Needs review'
  if (businessIncomeCategories.has(item.category)) return 'Business income'
  if (nonTaxCategories.has(item.category)) return 'Non-tax cash movement'
  if (item.category === 'Refund / Reimbursement') return 'Needs review'
  if (item.amount < 0) return 'Business expense'
  return 'Needs review'
}

function formatDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`
  }
  const text = String(value ?? '').trim()
  if (!text) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (match) {
    const year = match[3].length === 2 ? `20${match[3]}` : match[3]
    return `${year}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`
  }
  return ''
}

function valueFor(record, field) {
  const alias = headerAliases[field].find((candidate) => Object.hasOwn(record, candidate))
  return alias ? record[alias] : undefined
}

function detectOwner(record, bank, defaultOwner, amount, category) {
  if (bank === 'flagstar') return 'Banu U'
  if (bank === 'providence' || bank === 'amex') return 'GreenFort'
  if (category.startsWith('Private Lender Loan')) return 'GreenFort'
  const explicitOwner = `${valueFor(record, 'owner') ?? ''} ${valueFor(record, 'account') ?? ''}`.toLowerCase()
  if (explicitOwner.includes('banu')) return 'Banu U'
  if (explicitOwner.includes('kemal')) return 'Kemal I'

  const rowText = Object.values(record).join(' ').toLowerCase()
  if (rowText.includes('providence bank')) return 'GreenFort'
  if (rowText.includes('flagstar')) return 'Banu U'

  const isContribution = amount > 0 && category.toLowerCase().includes('owner contribution')
  if (!isContribution) return 'Project / Unassigned'
  if (rowText.includes('banu')) return 'Banu U'
  if (rowText.includes('kemal')) return 'Kemal I'
  return defaultOwner
}

const cleanText = (value) => String(value ?? '').replaceAll('&amp;', '&').trim()

const isGreenFortParty = (value) => {
  const normalized = cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return /^(?:green fort|greenfort)(?: llc)?$/.test(normalized)
}

const isGreenFortAccountTransfer = ({ bank, description, vendor, memo, rawDescription, transactionType }) => {
  if (!['boa', 'flagstar'].includes(bank)) return false
  const text = [description, vendor, memo, rawDescription, transactionType].map(cleanText).join(' ').toLowerCase()
  const namedAsPayee = [description, vendor].some(isGreenFortParty)
  const namesGreenFort = /\bgreen\s*fort(?:\s*\*?\s*l\.?l\.?c\.?)?\b|\bgreenfort(?:\s+l\.?l\.?c\.?)?\b/.test(text)
  const namesOtherBank = bank === 'boa'
    ? /\bflagstar\b|\bflagbk\b/.test(text)
    : /bank of america|\bbofa\b/.test(text)
  const transferEvidence = /\btransfer\b|webxfr|acctverify|account verify/.test(text)
  return namedAsPayee || (namesGreenFort && namesOtherBank && transferEvidence)
}

function reviewClassification({ amount, category, owner }) {
  let normalizedCategory = category.replace(/\s*\(review\)\s*/gi, '').trim()
  const reviewReasons = []

  if (normalizedCategory.toLowerCase() === 'owner contribution / loan draw') {
    if (amount > 0 && (owner === 'Banu U' || owner === 'Kemal I')) {
      normalizedCategory = 'Owner Contribution'
    } else {
      reviewReasons.push('Choose whether these incoming funds are an owner contribution, loan draw, transfer, or project income.')
    }
  } else if (normalizedCategory.toLowerCase() === 'personal / non-project') {
    reviewReasons.push('Confirm whether this is personal or a project expense.')
  } else if (normalizedCategory === 'Private Lender Loan Payment') {
    reviewReasons.push('Choose whether this payment is principal, interest, or a combination that must be split.')
  } else if (normalizedCategory === 'Refund / Reimbursement') {
    reviewReasons.push('Choose whether this offsets an expense or should be reported as business income.')
  }

  if (!normalizedCategory) reviewReasons.push('Choose a transaction category.')

  return {
    category: normalizedCategory,
    reviewReasons,
    classificationStatus: reviewReasons.length ? 'needs_review' : 'auto_classified',
  }
}

export function parseBankRows(rows, { bank, defaultOwner = 'Project / Unassigned', sourceName = 'Bank import' }) {
  const headerIndex = rows.findIndex((row) => row.some((cell) => String(cell ?? '').trim()))
  if (headerIndex < 0) return []
  const headers = rows[headerIndex].map(normalizeHeader)

  const duplicateOccurrences = new Map()
  return rows.slice(headerIndex + 1).filter((row) => row.some((cell) => String(cell ?? '').trim())).map((row) => {
    const record = Object.fromEntries(headers.map((header, column) => [header || `column${column}`, row[column]]))
    const directAmount = parseMoney(valueFor(record, 'amount'))
    const debit = parseMoney(valueFor(record, 'debit'))
    const credit = parseMoney(valueFor(record, 'credit'))
    const importedAmount = directAmount ?? ((credit ?? 0) - Math.abs(debit ?? 0))
    // American Express exports charges as positive and payments/credits as negative.
    const amount = bank === 'amex' && directAmount != null ? -importedAmount : importedAmount
    const date = formatDate(valueFor(record, 'date'))
    const importedVendor = cleanText(valueFor(record, 'vendor'))
    const vendor = importedVendor.toLowerCase().includes('providence bank')
      ? 'Providence Bank — GreenFort loan payment'
      : importedVendor
    const rawDescription = cleanText(valueFor(record, 'rawDescription'))
    const memo = cleanText(valueFor(record, 'memo'))
    const description = vendor || cleanText(valueFor(record, 'description')) || rawDescription || memo
    const importedTransactionType = cleanText(valueFor(record, 'transactionType'))
    const isAccountTransfer = isGreenFortAccountTransfer({ bank, description, vendor, memo, rawDescription, transactionType: importedTransactionType })
    const importedCategory = isAccountTransfer
      ? 'Bank Transfer'
      : cleanText(valueFor(record, 'category')) || categoryForDescription(`${description} ${memo} ${rawDescription}`, amount)
    const phase = cleanText(valueFor(record, 'phase'))
    const confidence = cleanText(valueFor(record, 'confidence'))
    const owner = detectOwner(record, bank, defaultOwner, amount, importedCategory)
    const classification = reviewClassification({ amount, category: importedCategory, owner })
    const isFeeWaiver = amount === 0 && `${memo} ${rawDescription}`.toLowerCase().includes('fee waiver')
    const category = isFeeWaiver ? 'Bank Fee Waiver' : classification.category
    const isOwnerContribution = amount > 0
      && category === 'Owner Contribution'
      && (owner === 'Banu U' || owner === 'Kemal I')
    const reviewReasons = [...classification.reviewReasons]
    if (!date) reviewReasons.push('missing date')
    if (!description) reviewReasons.push('missing description')
    if (!Number.isFinite(amount) || (amount === 0 && !isFeeWaiver)) reviewReasons.push('missing or zero amount')

    const fingerprint = transactionFingerprint([bank, date, amount, description, valueFor(record, 'account')])
    const occurrence = duplicateOccurrences.get(fingerprint) || 0
    duplicateOccurrences.set(fingerprint, occurrence + 1)
    const sourceRowId = `${bank}:${fingerprint}:${occurrence}`

    return {
      id: sourceRowId,
      sourceRowId,
      bank,
      owner,
      isOwnerContribution,
      date,
      description: description || 'Description needs review',
      amount: Number.isFinite(amount) ? amount : 0,
      balance: parseMoney(valueFor(record, 'balance')),
      account: String(valueFor(record, 'account') ?? '').trim(),
      sourceName: cleanText(valueFor(record, 'statement')) || sourceName,
      category,
      phase,
      vendor,
      memo,
      confidence,
      classificationStatus: reviewReasons.length ? 'needs_review' : classification.classificationStatus,
      transactionType: importedTransactionType,
      rawDescription,
      reviewReasons: [...new Set(reviewReasons)],
    }
  })
}

export function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '"' && quoted && text[index + 1] === '"') {
      cell += '"'
      index += 1
    } else if (character === '"') {
      quoted = !quoted
    } else if (character === ',' && !quoted) {
      row.push(cell)
      cell = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(cell)
      if (row.some((value) => value !== '')) rows.push(row)
      row = []
      cell = ''
    } else {
      cell += character
    }
  }
  row.push(cell)
  if (row.some((value) => value !== '')) rows.push(row)
  return rows
}
