import { normalizedHistoricalPrice } from './normalized-price.ts'

export type PriceLine = { values: number[], sale: boolean[] }

type Purchase = { price: string | number, size: string | number | null, unit: string | null, costPerUnit: string | number | null, saleItem: boolean }

// Same rule as the item page's default chart: normalize each purchase and keep the latest purchase's basis,
// so a list's price line matches the chart it links to. Purchases must be in date order.
export function priceLine(purchases: Purchase[]): PriceLine {
  const points = purchases.flatMap((purchase) => {
    const normalized = normalizedHistoricalPrice(purchase.price, purchase.size, purchase.unit, purchase.costPerUnit)
    return normalized ? [{ basis: normalized.basis, value: normalized.value, sale: purchase.saleItem }] : []
  })
  const basis = points.at(-1)?.basis
  const kept = points.filter(point => point.basis === basis)
  return { values: kept.map(point => point.value), sale: kept.map(point => point.sale) }
}
