const smallNumbers = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

const wholeNumberWords = (value) => {
  if (value < 20) return smallNumbers[value]
  if (value < 100) return `${tens[Math.floor(value / 10)]}${value % 10 ? `-${smallNumbers[value % 10]}` : ''}`
  if (value < 1000) return `${smallNumbers[Math.floor(value / 100)]} Hundred${value % 100 ? ` ${wholeNumberWords(value % 100)}` : ''}`
  if (value < 1_000_000) return `${wholeNumberWords(Math.floor(value / 1000))} Thousand${value % 1000 ? ` ${wholeNumberWords(value % 1000)}` : ''}`
  if (value < 1_000_000_000) return `${wholeNumberWords(Math.floor(value / 1_000_000))} Million${value % 1_000_000 ? ` ${wholeNumberWords(value % 1_000_000)}` : ''}`
  return 'Amount exceeds printable limit'
}

export const amountToCheckWords = (amount) => {
  const normalized = Math.round(Number(amount || 0) * 100)
  const dollars = Math.floor(normalized / 100)
  const cents = normalized % 100
  return `${wholeNumberWords(dollars)} and ${String(cents).padStart(2, '0')}/100 Dollars`
}
