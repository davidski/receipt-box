import { normalizeUnit, toBaseUnit, type BaseQuantity } from './units.ts'

export type RecipeCostError = 'NO_PRICE' | 'NO_PACKAGE_SIZE' | 'NO_QUANTITY' | 'NO_UNIT' | 'UNSTANDARDIZED_UNIT' | 'DIMENSION_MISMATCH'

export type RecipeLine = { item: string, quantity: number, unit: string }

export type RecipePurchase = {
  price: string | number
  size: string | number | null
  unit: string | null
  saleItem: boolean
}

export type PurchaseCandidate = RecipePurchase & { id: string, item: string, purchasedOn: string }

export type PurchaseObservation = PurchaseCandidate & { usedSalePrice: boolean }

export type RecipeLineCost = RecipeLine & { cost: number | null, sale: boolean, error: RecipeCostError | null }

/** The latest purchase with a package size and unit, sale or not, across every candidate's item name. */
export function selectPurchase(candidates: PurchaseCandidate[]): PurchaseObservation | null {
  const eligible = candidates.filter(candidate => Number(candidate.size) > 0 && candidate.unit !== null)
  if (!eligible.length) return null
  const { id, item, price, size, unit, saleItem, purchasedOn } = eligible.reduce((latest, candidate) => {
    if (candidate.purchasedOn !== latest.purchasedOn) return candidate.purchasedOn > latest.purchasedOn ? candidate : latest
    return BigInt(candidate.id) > BigInt(latest.id) ? candidate : latest
  })
  return { id, item, price, size, unit, saleItem, purchasedOn, usedSalePrice: saleItem }
}

/** `need` overrides the line's quantity in base units, for callers that normalize it another way; null means it could not be normalized. */
export function costLine(line: RecipeLine, purchase: RecipePurchase | null, need: BaseQuantity | null = toBaseUnit(line.quantity, line.unit)): RecipeLineCost {
  const fail = (error: RecipeCostError, sale = false): RecipeLineCost => ({ ...line, cost: null, sale, error })
  if (!purchase) return fail('NO_PRICE')
  const sale = purchase.saleItem
  const size = Number(purchase.size)
  if (purchase.size === null || !(size > 0) || !normalizeUnit(purchase.unit)) return fail('NO_PACKAGE_SIZE', sale)
  if (!(line.quantity > 0)) return fail('NO_QUANTITY', sale)
  if (!need && !normalizeUnit(line.unit)) return fail('NO_UNIT', sale)
  const pack = toBaseUnit(size, purchase.unit)
  if (!need || !pack) return fail('UNSTANDARDIZED_UNIT', sale)
  if (need.base !== pack.base) return fail('DIMENSION_MISMATCH', sale)
  const cost = Math.round(need.amount * (Number(purchase.price) / pack.amount) * 100) / 100
  return { ...line, cost, sale, error: null }
}

export function summarizeRecipeCost(lines: { cost: number | null, error: string | null }[]) {
  const cents = lines.reduce((sum, line) => sum + (line.cost === null ? 0 : Math.round(line.cost * 100)), 0)
  return { total: cents / 100, excluded: lines.filter(line => line.error).length }
}

/** Dollars per serving rounded down to a cent, so a displayed "≥" bound never exceeds the true figure. Works in integer cents; the epsilon absorbs float error such as 33 / 1.1. */
export function costPerServingLowerBound(total: number, servings: number): number {
  return Math.floor(Math.round(total * 100) / servings + 1e-9) / 100
}

/** Points every line named like `target` or a source at `target`, keeping the first of any duplicates. */
export function renameRecipeLineItems(lines: RecipeLine[], target: string, sources: string[]): RecipeLine[] {
  const matches = new Set([target, ...sources].map(name => name.trim().toLowerCase()))
  const seen = new Set<string>()
  return lines.flatMap((line) => {
    const key = line.item.trim().toLowerCase()
    const item = matches.has(key) ? target : line.item
    const itemKey = item.trim().toLowerCase()
    if (seen.has(itemKey)) return []
    seen.add(itemKey)
    return [{ ...line, item }]
  })
}
