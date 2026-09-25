import { db } from '../utils/db'
import { normalizeEntry, type EntryInput } from '../utils/entry-input'
import { ensureStore, upsertReceipt } from '../utils/receipt-query'
import { applyCategoryAssignments, categoryAssignments, lockItemWrites } from '../utils/category-query'

async function saveEntries(entries: EntryInput[]) {
  const sql = db()
  const assignments = categoryAssignments(entries)
  await sql.begin(async (tx) => {
    await lockItemWrites(tx)
    const groups = new Map<string, EntryInput[]>()
    for (const entry of entries) {
      const key = `${entry.purchasedOn}\u0000${entry.location}`
      groups.set(key, [...(groups.get(key) || []), entry])
    }
    for (const group of groups.values()) {
      const first = group[0]!
      const canonicalLocation = await ensureStore(tx, first.location)
      const receiptId = await upsertReceipt(tx, first.purchasedOn, canonicalLocation)
      const rows = group.map(entry => ({
        receipt_id: receiptId,
        item: entry.item,
        size: entry.size,
        unit: entry.unit,
        price: entry.price,
        sale_item: entry.saleItem,
        non_grocery: entry.nonGrocery,
        notes: entry.notes
      }))
      await tx`INSERT INTO grocery_entries ${tx(rows)}`
    }
    await applyCategoryAssignments(tx, assignments)
  })
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ records?: Record<string, unknown>[] }>(event)
  if (!Array.isArray(body.records) || !body.records.length) {
    throw createError({ statusCode: 400, statusMessage: 'No import records supplied' })
  }
  if (body.records.length > 500) {
    throw createError({ statusCode: 413, statusMessage: 'Import batches are limited to 500 rows' })
  }

  const entries: EntryInput[] = []
  const errors: string[] = []
  body.records.forEach((record, index) => {
    try {
      entries.push(normalizeEntry(record))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid row'
      errors.push(`Row ${index + 1}: ${message}`)
    }
  })
  if (!entries.length) throw createError({ statusCode: 400, statusMessage: errors[0] || 'No valid rows found' })

  await saveEntries(entries)
  return { imported: entries.length, skipped: errors.length, errors: errors.slice(0, 10) }
})
