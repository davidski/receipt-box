import { MASS_GRAMS, normalizeUnit, VOLUME_MILLILITERS } from './units.ts'

type NormalizedPrice = {
  basis: string
  label: string
  value: number
}

export function normalizedHistoricalPrice(
  priceValue: string | number,
  sizeValue: string | number | null,
  unitValue: string | null,
  storedCostValue: string | number | null
): NormalizedPrice | null {
  const price = Number(priceValue)
  const size = sizeValue === null || sizeValue === '' ? null : Number(sizeValue)
  const storedCost = storedCostValue === null || storedCostValue === '' ? null : Number(storedCostValue)
  const unit = normalizeUnit(unitValue)
  if (!Number.isFinite(price) || price < 0) return null

  if (unit && MASS_GRAMS[unit]) {
    const grams = MASS_GRAMS[unit]
    const value = size !== null && Number.isFinite(size) && size > 0
      ? (price / (size * grams)) * 100
      : storedCost !== null && Number.isFinite(storedCost) && storedCost >= 0
        ? unit === 'g' ? storedCost : (storedCost / grams) * 100
        : null
    return value === null ? null : { basis: 'mass', label: 'Per 100 g', value }
  }

  if (unit && VOLUME_MILLILITERS[unit]) {
    const milliliters = VOLUME_MILLILITERS[unit]
    const value = size !== null && Number.isFinite(size) && size > 0
      ? (price / (size * milliliters)) * 100
      : storedCost !== null && Number.isFinite(storedCost) && storedCost >= 0
        ? unit === 'mL' ? storedCost : (storedCost / milliliters) * 100
        : null
    return value === null ? null : { basis: 'volume', label: 'Per 100 mL', value }
  }

  if (unit === 'ea') {
    const value = size !== null && Number.isFinite(size) && size > 0
      ? price / size
      : storedCost !== null && Number.isFinite(storedCost) && storedCost >= 0 ? storedCost : price
    return { basis: 'each', label: 'Each', value }
  }

  if (storedCost === null || !Number.isFinite(storedCost) || storedCost < 0) return null
  const labelUnit = unit || 'unit'
  return { basis: `unit:${labelUnit}`, label: `Per ${labelUnit}`, value: storedCost }
}
