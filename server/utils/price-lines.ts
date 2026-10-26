import { priceLine, type PriceLine } from '../../shared/utils/price-line.ts'
import type { db } from './db'

type Purchase = { key: string, price: string, size: string | null, unit: string | null, costPerUnit: string | null, saleItem: boolean }

// Price lines for many items in one query, keyed by lower-cased item name; dates bound the line as [start, end).
export async function priceLines(sql: ReturnType<typeof db>, items: string[], { start = null, end = null }: { start?: string | null, end?: string | null } = {}) {
  const keys = [...new Set(items.map(item => item.toLowerCase()))]
  const lines = new Map<string, PriceLine>()
  if (!keys.length) return lines
  const rows = await sql<Purchase[]>`
    SELECT lower(item) AS key, price::text, size::text, unit, cost_per_unit::text, sale_item
    FROM grocery_entry_details
    WHERE lower(item) = ANY(${keys}::text[])
      AND (${start}::date IS NULL OR purchased_on >= ${start}::date)
      AND (${end}::date IS NULL OR purchased_on < ${end}::date)
    ORDER BY purchased_on, id
  `
  const grouped = new Map<string, Purchase[]>()
  for (const row of rows) grouped.set(row.key, [...(grouped.get(row.key) || []), row])
  for (const [key, purchases] of grouped) lines.set(key, priceLine(purchases))
  return lines
}
