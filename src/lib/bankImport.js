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

  return rows.slice(headerIndex + 1).filter((row) => row.some((cell) => String(cell ?? '').trim())).map((row, index) => {
    const record = Object.fromEntries(headers.map((header, column) => [header || `column${column}`, row[column]]))
    const directAmount = parseMoney(valueFor(record, 'amount'))
    const debit = parseMoney(valueFor(record, 'debit'))
    const credit = parseMoney(valueFor(record, 'credit'))
    const amount = directAmount ?? ((credit ?? 0) - Math.abs(debit ?? 0))
    const date = formatDate(valueFor(record, 'date'))
    const importedVendor = cleanText(valueFor(record, 'vendor'))
    const vendor = importedVendor.toLowerCase().includes('providence bank')
      ? 'Providence Bank — GreenFort loan payment'
      : importedVendor
    const rawDescription = cleanText(valueFor(record, 'rawDescription'))
    const memo = cleanText(valueFor(record, 'memo'))
    const description = vendor || cleanText(valueFor(record, 'description')) || rawDescription || memo
    const importedCategory = cleanText(valueFor(record, 'category'))
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

    return {
      id: `${Date.now()}-${index}`,
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
      transactionType: cleanText(valueFor(record, 'transactionType')),
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
