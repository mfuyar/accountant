export const PROVIDENCE_LOAN_ACCOUNTS = Object.freeze({
  'Lot 2': { accountSuffix: '0784', noteId: '100500784', reference: 'CLxxxxx0784', originalBalance: 784126 },
  'Lot 3': { accountSuffix: '0786', noteId: '100500786', reference: 'CLxxxxx0786', originalBalance: 784126 },
  'Lot 4': { accountSuffix: '0792', noteId: '100500792', reference: 'CLxxxxx0792', originalBalance: 754126 },
})

export const providenceLoanAccountLabel = (lot) => {
  const account = PROVIDENCE_LOAN_ACCOUNTS[lot]
  return account ? `Providence loan ••••${account.accountSuffix}` : ''
}

export const identifyProvidenceLoan = (...values) => {
  const source = values.map((value) => typeof value === 'string' ? value : JSON.stringify(value ?? '')).join(' ')
  const digits = source.replace(/[^0-9]/g, ' ')
  return Object.entries(PROVIDENCE_LOAN_ACCOUNTS).map(([lot, account]) => ({ lot, ...account })).find((account) => {
    const suffixPattern = new RegExp(`(?:CL|loan|account|note|ID|\\*)[^0-9]{0,20}(?:[xX*]*${account.accountSuffix}|${account.noteId})`, 'i')
    return source.includes(account.noteId) || suffixPattern.test(source) || digits.split(/\s+/).includes(account.noteId)
  }) || (/(?:^|[^0-9])(?:754[,.]?126|136[,.]?726)(?:[^0-9]|$)/.test(source)
    ? { lot: 'Lot 4', ...PROVIDENCE_LOAN_ACCOUNTS['Lot 4'] }
    : null)
}
