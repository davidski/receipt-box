import { normalizedHistoricalPrice } from '../../shared/utils/normalized-price.ts'

export const entryExportHeaders = [
  'purchase_date', 'item', 'category', 'store', 'package_size', 'package_unit', 'price',
  'normalized_price', 'normalized_basis', 'on_sale', 'non_grocery', 'notes'
]

export type ExportEntry = {
  purchasedOn: string
  item: string
  category: string | null
  location: string
  size: string | null
  unit: string | null
  price: string
  costPerUnit: string | null
  saleItem: boolean
  nonGrocery: boolean
  notes: string | null
}

export function entryValues(entry: ExportEntry): (string | number | boolean | Date | null)[] {
  const normalized = normalizedHistoricalPrice(entry.price, entry.size, entry.unit, entry.costPerUnit)
  return [
    entry.purchasedOn, entry.item, entry.category, entry.location,
    entry.size === null ? null : Number(entry.size), entry.unit, Number(entry.price),
    normalized ? Number(normalized.value.toFixed(6)) : null,
    normalized?.label ?? null,
    entry.saleItem, entry.nonGrocery, entry.notes
  ]
}

export function csvCell(value: unknown) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function entryCsv(rows: unknown[][]) {
  const lines = [entryExportHeaders, ...rows]
  return `\uFEFF${lines.map(row => row.map(csvCell).join(',')).join('\r\n')}`
}
