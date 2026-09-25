const moneyPattern = /(?:\$\s*)?\(?-?[\d,]+\.\d{2}\)?/g

const amountFrom = (value) => {
  const negative = value.includes('(') || value.includes('-')
  const amount = Number(value.replace(/[^\d.]/g, ''))
  return negative ? -amount : amount
}

const statementYear = (text) => {
  const fourDigit = text.match(/(?:closing date|statement date|statement period)?[^\n]{0,30}\b(?:\d{1,2}[/-]\d{1,2}[/-])(20\d{2})\b/i)
  if (fourDigit) return Number(fourDigit[1])
  const short = text.match(/(?:closing date|statement date|statement period)[^\n]{0,30}\b\d{1,2}[/-]\d{1,2}[/-](\d{2})\b/i)
  return short ? 2000 + Number(short[1]) : new Date().getFullYear()
}

export function parseStatementText(text, { bank }) {
  const rows = [['Date', 'Description', 'Amount']]
  const year = statementYear(text)
  let section = ''

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\s+/g, ' ').trim()
    if (!line) continue
    if (/deposits|credits|payments received/i.test(line) && !/^\d/.test(line)) section = 'credit'
    if (/withdrawals|debits|checks|purchases|fees|charges/i.test(line) && !/^\d/.test(line)) section = 'debit'

    const dateMatch = line.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\s+(.+)$/)
    if (!dateMatch) continue
    const amounts = [...dateMatch[4].matchAll(moneyPattern)]
    if (!amounts.length) continue

    // Bank statements often end with both transaction amount and running balance.
    const amountMatch = bank !== 'amex' && amounts.length > 1 ? amounts.at(-2) : amounts.at(-1)
    const rawAmount = amountFrom(amountMatch[0])
    const description = dateMatch[4].slice(0, amountMatch.index).trim().replace(/\s+\$?$/, '')
    if (!description || /beginning balance|ending balance|daily balance/i.test(description)) continue

    const rowYear = dateMatch[3]
      ? (dateMatch[3].length === 2 ? 2000 + Number(dateMatch[3]) : Number(dateMatch[3]))
      : year
    const date = `${rowYear}-${dateMatch[1].padStart(2, '0')}-${dateMatch[2].padStart(2, '0')}`
    const creditWords = /credit|deposit|payment received|payment thank you|refund|cashback/i.test(description)
    const debitWords = /purchase|fee|withdrawal|check|interest charge|autopay/i.test(description)
    let amount
    if (rawAmount < 0) amount = rawAmount
    // Keep Amex's source convention here (charges positive, credits negative).
    // parseBankRows converts it to the bookkeeping convention used by the app.
    else if (bank === 'amex') amount = creditWords ? -rawAmount : rawAmount
    else amount = section === 'credit' || (creditWords && !debitWords) ? rawAmount : -rawAmount
    rows.push([date, description, amount])
  }
  return rows
}

export async function extractPdfStatementRows(file, options) {
  const { loadSafePdf } = await import('./pdfjsSetup')
  const document = await loadSafePdf({ data: await file.arrayBuffer() })
  const lines = []
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const content = await page.getTextContent()
    const grouped = new Map()
    content.items.forEach((item) => {
      const y = Math.round(item.transform?.[5] || 0)
      if (!grouped.has(y)) grouped.set(y, [])
      grouped.get(y).push(item)
    })
    ;[...grouped.entries()].sort(([a], [b]) => b - a).forEach(([, items]) => {
      lines.push(items.sort((a, b) => (a.transform?.[4] || 0) - (b.transform?.[4] || 0)).map((item) => item.str).join(' '))
    })
  }
  return parseStatementText(lines.join('\n'), options)
}
