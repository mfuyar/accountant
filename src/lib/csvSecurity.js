// A CSV cell that starts with a spreadsheet formula can run code when opened in Excel.
// Preserve ordinary numeric amounts while forcing imported text to remain text.
export const safeCsvText = (value) => {
  const text = String(value ?? '')
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return text
  const firstCodePoint = text.codePointAt(0)
  return /^\s*[=+\-@]/.test(text) || (firstCodePoint != null && firstCodePoint <= 31) ? `'${text}` : text
}
