import { MASS_GRAMS, VOLUME_MILLILITERS } from './normalized-price.ts'
import { normalizeUnit } from './units.ts'

export type RecipeCostError = 'NO_PRICE' | 'NO_PACKAGE_SIZE' | 'INCOMPATIBLE_UNIT'

export type RecipeLine = { item: string, quantity: number, unit: string }

export type RecipePurchase = {
  price: string | number
  size: string | number | null
  unit: string | null
  saleItem: boolean
}

export type RecipeLineCost = RecipeLine & { cost: number | null, sale: boolean, error: RecipeCostError | null }

export function toBaseUnit(quantity: number, unitValue: unknown): { base: 'g' | 'mL' | 'ea', amount: number } | null {
  const unit = normalizeUnit(unitValue)
  if (!unit) return null
  if (unit === 'ea') return { base: 'ea', amount: quantity }
  if (MASS_GRAMS[unit]) return { base: 'g', amount: quantity * MASS_GRAMS[unit] }
  if (VOLUME_MILLILITERS[unit]) return { base: 'mL', amount: quantity * VOLUME_MILLILITERS[unit] }
  return null
}

export function costLine(line: RecipeLine, purchase: RecipePurchase | null): RecipeLineCost {
  const fail = (error: RecipeCostError, sale = false): RecipeLineCost => ({ ...line, cost: null, sale, error })
  if (!purchase) return fail('NO_PRICE')
  const sale = purchase.saleItem
  const size = Number(purchase.size)
  if (purchase.size === null || !(size > 0) || !normalizeUnit(purchase.unit)) return fail('NO_PACKAGE_SIZE', sale)
  const need = toBaseUnit(line.quantity, line.unit)
  const pack = toBaseUnit(size, purchase.unit)
  if (!need || !pack || need.base !== pack.base) return fail('INCOMPATIBLE_UNIT', sale)
  const cost = Math.round(need.amount * (Number(purchase.price) / pack.amount) * 100) / 100
  return { ...line, cost, sale, error: null }
}

export function summarizeRecipeCost(lines: RecipeLineCost[]) {
  const cents = lines.reduce((sum, line) => sum + (line.cost === null ? 0 : Math.round(line.cost * 100)), 0)
  return { total: cents / 100, excluded: lines.filter(line => line.error).length }
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
