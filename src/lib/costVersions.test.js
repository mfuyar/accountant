import { describe, expect, it } from 'vitest'
import { getActiveCosts, getLatestCostVersions } from './costVersions'

describe('cost version selection', () => {
  it('uses only the latest version of each cost', () => {
    const versions = [
      { id: 'a-v1', costId: 'a', version: 1, amount: 100, deletedAt: null },
      { id: 'a-v2', costId: 'a', version: 2, amount: 175, deletedAt: null },
      { id: 'b-v1', costId: 'b', version: 1, amount: 50, deletedAt: null },
    ]

    expect(getLatestCostVersions(versions)).toHaveLength(2)
    expect(getActiveCosts(versions).reduce((sum, cost) => sum + cost.amount, 0)).toBe(225)
  })

  it('excludes a cost when its latest version is a tombstone', () => {
    const versions = [
      { id: 'a-v1', costId: 'a', version: 1, amount: 100, deletedAt: null },
      { id: 'a-v2', costId: 'a', version: 2, amount: 100, deletedAt: '2026-07-13T12:00:00.000Z' },
    ]

    expect(getLatestCostVersions(versions)[0].deletedAt).toBeTruthy()
    expect(getActiveCosts(versions)).toEqual([])
  })
})
