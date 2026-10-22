export const STANDARD_UNITS = ['g', 'kg', 'mL', 'L', 'oz', 'fl oz', 'lb', 'pt', 'qt', 'gal', 'tsp', 'tbsp', 'cup', 'ea'] as const

const UNIT_ALIASES: Record<string, string> = {
  g: 'g',
  gr: 'g',
  gm: 'g',
  gram: 'g',
  grams: 'g',
  gramme: 'g',
  grammes: 'g',
  kg: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  kilogramme: 'kg',
  kilogrammes: 'kg',
  ml: 'mL',
  milliliter: 'mL',
  milliliters: 'mL',
  millilitre: 'mL',
  millilitres: 'mL',
  l: 'L',
  liter: 'L',
  liters: 'L',
  litre: 'L',
  litres: 'L',
  oz: 'oz',
  ounce: 'oz',
  ounces: 'oz',
  'fl oz': 'fl oz',
  floz: 'fl oz',
  'fluid ounce': 'fl oz',
  'fluid ounces': 'fl oz',
  lb: 'lb',
  lbs: 'lb',
  pound: 'lb',
  pounds: 'lb',
  pt: 'pt',
  pts: 'pt',
  pint: 'pt',
  pints: 'pt',
  qt: 'qt',
  qts: 'qt',
  quart: 'qt',
  quarts: 'qt',
  gal: 'gal',
  gals: 'gal',
  gallon: 'gal',
  gallons: 'gal',
  tsp: 'tsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  tbsp: 'tbsp',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  cup: 'cup',
  cups: 'cup',
  ea: 'ea',
  each: 'ea',
  unit: 'ea',
  units: 'ea',
  count: 'ea',
  ct: 'ea',
  piece: 'ea',
  pieces: 'ea',
  pc: 'ea'
}

export function normalizeUnit(value: unknown): string | null {
  const unit = String(value ?? '').trim()
  if (!unit) return null
  const key = unit.toLowerCase().replaceAll('.', '').replace(/\s+/g, ' ')
  return UNIT_ALIASES[key] ?? unit
}

/** Grams per mass unit. */
export const MASS_GRAMS: Record<string, number> = {
  g: 1,
  kg: 1000,
  oz: 28.349523125,
  lb: 453.59237
}

/** Milliliters per volume unit. `oz` is mass; only `fl oz` is volume. */
export const VOLUME_MILLILITERS: Record<string, number> = {
  mL: 1,
  L: 1000,
  'fl oz': 29.5735295625,
  tsp: 4.92892159375,
  tbsp: 14.78676478125,
  cup: 236.5882365,
  pt: 473.176473,
  qt: 946.352946,
  gal: 3785.411784
}

export type BaseQuantity = { base: 'g' | 'mL' | 'ea', amount: number }

/** Converts a quantity to grams, milliliters or each; null for blank, non-numeric or unconvertible units. */
export function toBaseUnit(quantity: number, unitValue: unknown): BaseQuantity | null {
  const unit = normalizeUnit(unitValue)
  if (!unit) return null
  if (unit === 'ea') return { base: 'ea', amount: quantity }
  if (MASS_GRAMS[unit]) return { base: 'g', amount: quantity * MASS_GRAMS[unit] }
  if (VOLUME_MILLILITERS[unit]) return { base: 'mL', amount: quantity * VOLUME_MILLILITERS[unit] }
  return null
}

const positiveNumber = (value: unknown): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (value === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

/**
 * A package's size in base units, or null when it cannot be priced:
 * `non_grocery` entry, null/non-positive size, or null/unconvertible unit.
 */
export function normalizePackageQuantity(
  package_: { size: unknown, unit: unknown, nonGrocery?: boolean | null }
): BaseQuantity | null {
  if (package_.nonGrocery) return null
  const size = positiveNumber(package_.size)
  return size === null ? null : toBaseUnit(size, package_.unit)
}

/** Mealie `standardUnit` values; matched exactly, never via UNIT_ALIASES (so `ounce` is always mass). */
const MEALIE_STANDARD_UNITS: Record<string, string> = {
  gram: 'g',
  kilogram: 'kg',
  ounce: 'oz',
  pound: 'lb',
  liter: 'L',
  milliliter: 'mL',
  cup: 'cup',
  fluid_ounce: 'fl oz'
}

/**
 * A Mealie recipe quantity in base units: `quantity × standardQuantity × standardUnit`.
 * Never looks at the unit's name. Null when the unit is unstandardized (missing or unknown
 * `standardUnit`, non-positive `standardQuantity`) or the quantity is not positive.
 */
export function normalizeMealieQuantity(
  quantity: unknown,
  standardQuantity: unknown,
  standardUnit: unknown
): BaseQuantity | null {
  const amount = positiveNumber(quantity)
  const factor = positiveNumber(standardQuantity)
  if (amount === null || factor === null) return null
  if (typeof standardUnit !== 'string' || !Object.hasOwn(MEALIE_STANDARD_UNITS, standardUnit)) return null
  const total = amount * factor
  return Number.isFinite(total) ? toBaseUnit(total, MEALIE_STANDARD_UNITS[standardUnit]) : null
}
