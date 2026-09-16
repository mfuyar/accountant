import { describe, expect, it } from 'vitest'
import { currency } from './currency'

describe('currency formatter', () => {
  it('always displays dollars with cents', () => {
    expect(currency.format(0)).toBe('$0.00')
    expect(currency.format(1250)).toBe('$1,250.00')
    expect(currency.format(1250.7)).toBe('$1,250.70')
    expect(currency.format(1250.75)).toBe('$1,250.75')
  })
})
