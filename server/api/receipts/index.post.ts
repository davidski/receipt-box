import { db, publicEntry, type GroceryEntry } from '../../utils/db'
import { normalizeEntry, type EntryInput } from '../../utils/entry-input'
import { normalizeStoreName } from '../../../shared/utils/store-name'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    purchasedOn?: unknown
    location?: unknown
    entries?: Record<string, unknown>[]
  }>(event)
  const purchasedOn = String(body.purchasedOn ?? '').slice(0, 10)
  const location = normalizeStoreName(body.location)

  if (!/^\d{4}-\d{2}-\d{2}$/.test(purchasedOn)) {
    throw createError({ statusCode: 400, statusMessage: 'A valid receipt date is required' })
  }
  if (!location) throw createError({ statusCode: 400, statusMessage: 'Store is required' })
  if (!Array.isArray(body.entries) || !body.entries.length) {
    throw createError({ statusCode: 400, statusMessage: 'Add at least one receipt line' })
  }
  if (body.entries.length > 200) {
    throw createError({ statusCode: 413, statusMessage: 'Receipts are limited to 200 lines' })
  }

  const entries: EntryInput[] = []
  const errors: string[] = []
  body.entries.forEach((line, index) => {
    try {
      entries.push(normalizeEntry({ ...line, purchasedOn, location }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid line'
      errors.push(`Line ${index + 1}: ${message}`)
    }
  })
  if (errors.length) {
    throw createError({ statusCode: 400, statusMessage: errors.slice(0, 5).join('; ') })
  }

  const sql = db()
  const saved = await sql.begin(async (tx) => {
    await tx`INSERT INTO grocery_stores (name) VALUES (${location}) ON CONFLICT DO NOTHING`
    const [receipt] = await tx<{ id: string }[]>`
      INSERT INTO grocery_receipts (purchased_on, location)
      VALUES (${purchasedOn}, ${location})
      RETURNING id::text
    `
    const rows = entries.map(entry => ({
      receipt_id: receipt!.id,
      purchased_on: entry.purchasedOn,
      item: entry.item,
      location: entry.location,
      size: entry.size,
      unit: entry.unit,
      price: entry.price,
      cost_per_unit: entry.costPerUnit,
      sale_item: entry.saleItem,
      non_grocery: entry.nonGrocery,
      notes: entry.notes
    }))
    const inserted = await tx<GroceryEntry[]>`INSERT INTO grocery_entries ${tx(rows)} RETURNING *`
    return { receiptId: receipt!.id, entries: inserted.map(publicEntry) }
  })

  setResponseStatus(event, 201)
  return {
    id: saved.receiptId,
    purchasedOn,
    location,
    itemCount: saved.entries.length,
    total: entries.reduce((sum, entry) => sum + entry.price, 0).toFixed(2),
    entries: saved.entries
  }
})
