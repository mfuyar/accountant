import { describe, expect, it } from 'vitest'
import { safeCsvText } from './csvSecurity'

describe('safeCsvText', () => {
  it('keeps imported spreadsheet formulas as text', () => {
    expect(safeCsvText('=HYPERLINK("https://example.com")')).toBe('\'=HYPERLINK("https://example.com")')
    expect(safeCsvText('  +SUM(1,2)')).toBe("'  +SUM(1,2)")
    expect(safeCsvText('\t@SUM(1,2)')).toBe("'\t@SUM(1,2)")
  })

  it('preserves ordinary negative amounts', () => {
    expect(safeCsvText('-2743.68')).toBe('-2743.68')
    expect(safeCsvText('Builder reimbursement')).toBe('Builder reimbursement')
  })
})
