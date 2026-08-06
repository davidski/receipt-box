export type PriceStability = 'limited' | 'stable' | 'steady' | 'changing' | 'volatile'

export function priceStability(observations: number, averageChangePercent: number | null): PriceStability {
  if (observations < 3 || averageChangePercent === null || !Number.isFinite(averageChangePercent)) return 'limited'
  if (averageChangePercent <= 2) return 'stable'
  if (averageChangePercent <= 5) return 'steady'
  if (averageChangePercent <= 10) return 'changing'
  return 'volatile'
}

export function priceTrend(netChangePercent: number | null): 'flat' | 'up' | 'down' | 'unknown' {
  if (netChangePercent === null || !Number.isFinite(netChangePercent)) return 'unknown'
  if (Math.abs(netChangePercent) < 2) return 'flat'
  return netChangePercent > 0 ? 'up' : 'down'
}
