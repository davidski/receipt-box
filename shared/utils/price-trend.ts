type TrendPoint = { purchasedOn: string, normalizedPrice: number, saleItem: boolean }

export const PRICE_TREND_MIN_PURCHASES = 3
// A smaller move reads as steady, as on Highlights.
export const PRICE_TREND_FLAT_PERCENT = 2

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

function monthsBefore(today: string, months: number) {
  const [year, month, day] = today.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(year, month - 1 - months, day)).toISOString().slice(0, 10)
}

// Compares the median regular price of the last 6 months with the same 6 months a year earlier, so one
// sale or one-off price can't set the trend and the season matches. Null when either period is too thin to say.
export function regularPriceTrend(points: TrendPoint[], today: string) {
  const within = (from: string, to: string) => points.filter((point) => {
    const date = point.purchasedOn.slice(0, 10)
    return date > from && date <= to
  })
  const recent = within(monthsBefore(today, 6), today)
  const recentRegular = recent.filter(point => !point.saleItem).map(point => point.normalizedPrice)
  const earlierRegular = within(monthsBefore(today, 18), monthsBefore(today, 12)).filter(point => !point.saleItem).map(point => point.normalizedPrice)
  if (recentRegular.length < PRICE_TREND_MIN_PURCHASES || earlierRegular.length < PRICE_TREND_MIN_PURCHASES) return null
  const from = median(earlierRegular)
  const to = median(recentRegular)
  if (from <= 0) return null
  const change = (to - from) / from * 100
  return {
    from,
    to,
    change,
    direction: Math.abs(change) < PRICE_TREND_FLAT_PERCENT ? 'steady' as const : change > 0 ? 'up' as const : 'down' as const,
    recentPurchases: recent.length,
    recentSales: recent.length - recentRegular.length
  }
}

const DAY = 24 * 60 * 60 * 1000
const timeOf = (point: TrendPoint) => Date.parse(point.purchasedOn.slice(0, 10))

// The median regular price around each regular purchase, in the order given. A median keeps sales and one-off
// prices from pulling the line, so it moves in steps when an item's prices sit at a few exact values.
export function rollingRegularMedian<T extends TrendPoint>(points: T[], days = 60) {
  const regular = points.filter(point => !point.saleItem)
  return regular.map((point) => {
    const time = timeOf(point)
    return { point, value: median(regular.filter(other => Math.abs(timeOf(other) - time) <= days * DAY).map(other => other.normalizedPrice)) }
  })
}
