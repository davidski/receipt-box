import { normalizeUnit } from '../../shared/utils/units.ts'
import { normalizeStoreName } from '../../shared/utils/store-name.ts'
import { normalizeCategory } from '../../shared/utils/category.ts'

export type EntryInput = {
  purchasedOn: string
  item: string
  location: string
  size: number | null
  unit: string | null
  price: number
  costPerUnit: number | null
  saleItem: boolean
  nonGrocery: boolean
  notes: string | null
  category?: string | null
}

function optionalNumber(value: unknown) {
  if (value === '' || value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function truthy(value: unknown) {
  if (typeof value === 'boolean') return value
  return ['1', 'true', 'yes', 'y', 'x'].includes(String(value ?? '').trim().toLowerCase())
}

function isCalendarDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

export function normalizeEntry(input: Record<string, unknown>): EntryInput {
  const rawDate = input.purchasedOn ?? input.food_Date ?? input.date ?? ''
  const purchasedOn = rawDate instanceof Date
    ? rawDate.toISOString().slice(0, 10)
    : String(rawDate).slice(0, 10)
  const item = String(input.item ?? input.Item ?? '').trim()
  const location = normalizeStoreName(input.location ?? input.Location)
  const price = Number(input.price ?? input.Price)
  const size = optionalNumber(input.size ?? input.Size)
  const unit = normalizeUnit(input.unit ?? input.Unit)
  const costPerUnit = size && price >= 0
    ? ['g', 'mL'].includes(unit || '')
      ? (price / size) * 100
      : price / size
    : null

  if (!isCalendarDate(purchasedOn)) {
    throw createError({ statusCode: 400, statusMessage: 'A valid purchase date is required' })
  }
  if (!item) throw createError({ statusCode: 400, statusMessage: 'Item is required' })
  if (!location) throw createError({ statusCode: 400, statusMessage: 'Store is required' })
  if (!Number.isFinite(price) || price < 0) {
    throw createError({ statusCode: 400, statusMessage: 'Price must be zero or greater' })
  }
  if (size !== null && size <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Size must be greater than zero' })
  }

  let category: string | null | undefined
  try {
    category = normalizeCategory(input.category)
  } catch (error) {
    throw createError({ statusCode: 400, statusMessage: error instanceof Error ? error.message : 'Invalid category' })
  }

  return {
    purchasedOn,
    item,
    location,
    size,
    unit,
    price,
    costPerUnit,
    saleItem: truthy(input.saleItem ?? input.Sale_Item),
    nonGrocery: truthy(input.nonGrocery ?? input.Non_Grocery),
    notes: String(input.notes ?? input.Notes ?? '').trim() || null,
    ...(category === undefined ? {} : { category })
  }
}
