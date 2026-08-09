export type HighlightObservation = {
  purchasedOn: string
  item: string
  size: number | null
  unit: string | null
  price: number
  costPerUnit: number | null
  saleItem: boolean
}

export type PriceIndexPoint = { month: string, value: number | null, matchedItems: number }
export type SpendChangePoint = {
  month: string
  totalSpent: number
  change: number | null
  priceEffect: number | null
  basketEffect: number | null
  matchedItems: number
}
export type ShrinkflationItem = {
  item: string
  previousPurchasedOn: string
  purchasedOn: string
  previousSize: number
  size: number
  unit: string
  previousPrice: number
  price: number
  previousUnitPrice: number
  unitPrice: number
  unitPriceLabel: string
  sizeChangePercent: number
  unitCostChangePercent: number
}

const VARIABLE_QUANTITY_UNITS = new Set(['LB', 'EA'])

function monthOf(date: string) {
  return `${date.slice(0, 7)}-01`
}

function median(values: number[]) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

function itemKey(item: string) {
  return item.trim().toLocaleLowerCase()
}

function normalizedBasis(row: HighlightObservation) {
  if (row.costPerUnit !== null && row.costPerUnit > 0 && row.unit) {
    return { basis: `${itemKey(row.item)}\u0000${row.unit.toUpperCase()}`, value: row.costPerUnit }
  }
  if (row.price > 0) {
    return { basis: `${itemKey(row.item)}\u0000package:${row.size ?? ''}:${row.unit?.toUpperCase() ?? ''}`, value: row.price }
  }
  return null
}

function packageBasis(row: HighlightObservation) {
  return `${itemKey(row.item)}\u0000${row.size ?? ''}\u0000${row.unit?.toUpperCase() ?? ''}`
}

function groupedMedians<T>(rows: T[], key: (row: T) => string, value: (row: T) => number) {
  const groups = new Map<string, number[]>()
  for (const row of rows) {
    const group = key(row)
    groups.set(group, [...(groups.get(group) || []), value(row)])
  }
  return new Map([...groups].map(([group, values]) => [group, median(values)!]))
}

export function priceIndex(rows: HighlightObservation[]): PriceIndexPoint[] {
  const months = [...new Set(rows.map(row => monthOf(row.purchasedOn)))].sort()
  const monthly = new Map(months.map(month => {
    const comparable = rows.filter(row => monthOf(row.purchasedOn) === month && !row.saleItem)
      .flatMap(row => {
        const normalized = normalizedBasis(row)
        return normalized ? [{ key: normalized.basis, value: normalized.value, spend: row.price }] : []
      })
    const prices = groupedMedians(comparable, row => row.key, row => row.value)
    const spend = new Map<string, number>()
    for (const row of comparable) spend.set(row.key, (spend.get(row.key) || 0) + row.spend)
    return [month, { prices, spend }]
  }))

  let value = 100
  return months.map((month, index) => {
    if (index === 0) return { month, value, matchedItems: 0 }
    const previous = monthly.get(months[index - 1]!)!
    const current = monthly.get(month)!
    const relatives = [...current.prices].flatMap(([key, currentPrice]) => {
      const previousPrice = previous.prices.get(key)
      const weight = previous.spend.get(key) || 0
      return previousPrice && previousPrice > 0 && currentPrice > 0 && weight > 0
        ? [{ relative: currentPrice / previousPrice, weight }]
        : []
    })
    if (relatives.length < 3) return { month, value: null, matchedItems: relatives.length }
    const totalWeight = relatives.reduce((total, item) => total + item.weight, 0)
    const relative = Math.exp(relatives.reduce((total, item) => total + Math.log(item.relative) * item.weight, 0) / totalWeight)
    value *= relative
    return { month, value: Number(value.toFixed(2)), matchedItems: relatives.length }
  })
}

export function spendChanges(rows: HighlightObservation[]): SpendChangePoint[] {
  const months = [...new Set(rows.map(row => monthOf(row.purchasedOn)))].sort()
  return months.map((month, index) => {
    const currentRows = rows.filter(row => monthOf(row.purchasedOn) === month)
    const totalSpent = currentRows.reduce((total, row) => total + row.price, 0)
    if (index === 0) return { month, totalSpent, change: null, priceEffect: null, basketEffect: null, matchedItems: 0 }
    const previousRows = rows.filter(row => monthOf(row.purchasedOn) === months[index - 1])
    const previousTotal = previousRows.reduce((total, row) => total + row.price, 0)
    const previousPrices = groupedMedians(previousRows, packageBasis, row => row.price)
    const currentPrices = groupedMedians(currentRows, packageBasis, row => row.price)
    const counts = new Map<string, number>()
    for (const row of currentRows) counts.set(packageBasis(row), (counts.get(packageBasis(row)) || 0) + 1)
    let priceEffect = 0
    let matchedItems = 0
    for (const [key, currentPrice] of currentPrices) {
      const previousPrice = previousPrices.get(key)
      if (previousPrice === undefined) continue
      priceEffect += (currentPrice - previousPrice) * (counts.get(key) || 0)
      matchedItems += 1
    }
    const change = totalSpent - previousTotal
    return {
      month,
      totalSpent: Number(totalSpent.toFixed(2)),
      change: Number(change.toFixed(2)),
      priceEffect: Number(priceEffect.toFixed(2)),
      basketEffect: Number((change - priceEffect).toFixed(2)),
      matchedItems
    }
  })
}

export function shrinkflation(rows: HighlightObservation[]): ShrinkflationItem[] {
  const byItem = new Map<string, HighlightObservation[]>()
  for (const row of rows) byItem.set(itemKey(row.item), [...(byItem.get(itemKey(row.item)) || []), row])
  const findings: ShrinkflationItem[] = []
  for (const itemRows of byItem.values()) {
    const ordered = [...itemRows].sort((a, b) => a.purchasedOn.localeCompare(b.purchasedOn))
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1]!
      const current = ordered[index]!
      if (!previous.size || !current.size || !previous.unit || !current.unit || previous.unit.toUpperCase() !== current.unit.toUpperCase()) continue
      if (VARIABLE_QUANTITY_UNITS.has(current.unit.toUpperCase())) continue
      if (current.size >= previous.size || current.price < previous.price) continue
      const previousUnitCost = previous.price / previous.size
      const currentUnitCost = current.price / current.size
      const previousNormalized = normalizedHistoricalPrice(previous.price, previous.size, previous.unit, previous.costPerUnit)
      const currentNormalized = normalizedHistoricalPrice(current.price, current.size, current.unit, current.costPerUnit)
      if (!previousNormalized || !currentNormalized || previousNormalized.basis !== currentNormalized.basis) continue
      findings.push({
        item: current.item,
        previousPurchasedOn: previous.purchasedOn,
        purchasedOn: current.purchasedOn,
        previousSize: previous.size,
        size: current.size,
        unit: current.unit,
        previousPrice: previous.price,
        price: current.price,
        previousUnitPrice: Number(previousNormalized.value.toFixed(4)),
        unitPrice: Number(currentNormalized.value.toFixed(4)),
        unitPriceLabel: currentNormalized.label,
        sizeChangePercent: Number((((current.size - previous.size) / previous.size) * 100).toFixed(1)),
        unitCostChangePercent: Number((((currentUnitCost - previousUnitCost) / previousUnitCost) * 100).toFixed(1))
      })
    }
  }
  return findings.sort((a, b) => b.purchasedOn.localeCompare(a.purchasedOn) || b.unitCostChangePercent - a.unitCostChangePercent).slice(0, 10)
}

export function sparklinePoints(values: number[], width = 120, height = 32) {
  if (!values.length) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min
  return values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width
    const y = range === 0 ? height / 2 : height - ((value - min) / range) * height
    return `${Number(x.toFixed(1))},${Number(y.toFixed(1))}`
  }).join(' ')
}
import { normalizedHistoricalPrice } from './normalized-price.ts'
