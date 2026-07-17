export function getLatestCostVersions(costVersions = []) {
  const latestByCostId = new Map()

  costVersions.forEach((cost) => {
    const costId = cost.costId ?? cost.id
    const normalized = {
      ...cost,
      costId,
      version: Number(cost.version || 1),
    }
    const current = latestByCostId.get(costId)

    if (!current || normalized.version > current.version) {
      latestByCostId.set(costId, normalized)
    }
  })

  return Array.from(latestByCostId.values())
}

export function getActiveCosts(costVersions = []) {
  return getLatestCostVersions(costVersions).filter((cost) => !cost.deletedAt)
}

