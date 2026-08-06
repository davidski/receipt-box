import { db, publicEntry, type GroceryEntry } from '../../utils/db'
import { normalizeEntry, type EntryInput } from '../../utils/entry-input'
import { normalizeStoreName } from '../../../shared/utils/store-name'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !/^\d+$/.test(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid receipt id' })

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
    throw createError({ statusCode: 400, statusMessage: 'A receipt must contain at least one line' })
  }
  if (body.entries.length > 200) {
    throw createError({ statusCode: 413, statusMessage: 'Receipts are limited to 200 lines' })
  }

  const entries: EntryInput[] = []
  const entryIds: Array<string | null> = []
  const errors: string[] = []
  body.entries.forEach((line, index) => {
    const entryId = line.id === undefined || line.id === null || line.id === '' ? null : String(line.id)
    if (entryId !== null && !/^\d+$/.test(entryId)) errors.push(`Line ${index + 1}: Invalid entry id`)
    entryIds.push(entryId)
    try {
      entries.push(normalizeEntry({ ...line, purchasedOn, location }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid line'
      errors.push(`Line ${index + 1}: ${message}`)
    }
  })
  const keptIds = entryIds.filter((entryId): entryId is string => entryId !== null)
  if (new Set(keptIds).size !== keptIds.length) errors.push('Receipt lines contain duplicate entry ids')
  if (errors.length) throw createError({ statusCode: 400, statusMessage: errors.slice(0, 5).join('; ') })

  const sql = db()
  const savedEntries = await sql.begin(async (tx) => {
    const [receipt] = await tx<{ id: string }[]>`
      SELECT id::text FROM grocery_receipts WHERE id = ${id} FOR UPDATE
    `
    if (!receipt) throw createError({ statusCode: 404, statusMessage: 'Receipt not found' })

    const existing = await tx<{ id: string }[]>`
      SELECT id::text FROM grocery_entries WHERE receipt_id = ${id} FOR UPDATE
    `
    const existingIds = new Set(existing.map(entry => entry.id))
    if (keptIds.some(entryId => !existingIds.has(entryId))) {
      throw createError({ statusCode: 400, statusMessage: 'One or more lines do not belong to this receipt' })
    }

    await tx`INSERT INTO grocery_stores (name) VALUES (${location}) ON CONFLICT DO NOTHING`
    await tx`
      UPDATE grocery_receipts
      SET purchased_on = ${purchasedOn}, location = ${location}, updated_at = now()
      WHERE id = ${id}
    `

    if (keptIds.length) {
      await tx`DELETE FROM grocery_entries WHERE receipt_id = ${id} AND id NOT IN ${tx(keptIds)}`
    } else {
      await tx`DELETE FROM grocery_entries WHERE receipt_id = ${id}`
    }

    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index]!
      const entryId = entryIds[index]
      if (entryId) {
        await tx`
          UPDATE grocery_entries SET
            purchased_on = ${entry.purchasedOn}, item = ${entry.item}, location = ${entry.location},
            size = ${entry.size}, unit = ${entry.unit}, price = ${entry.price},
            cost_per_unit = ${entry.costPerUnit}, sale_item = ${entry.saleItem},
            non_grocery = ${entry.nonGrocery}, notes = ${entry.notes}, updated_at = now()
          WHERE id = ${entryId} AND receipt_id = ${id}
        `
      } else {
        await tx`
          INSERT INTO grocery_entries (
            receipt_id, purchased_on, item, location, size, unit, price, cost_per_unit,
            sale_item, non_grocery, notes
          ) VALUES (
            ${id}, ${entry.purchasedOn}, ${entry.item}, ${entry.location}, ${entry.size},
            ${entry.unit}, ${entry.price}, ${entry.costPerUnit}, ${entry.saleItem},
            ${entry.nonGrocery}, ${entry.notes}
          )
        `
      }
    }

    return tx<GroceryEntry[]>`SELECT * FROM grocery_entries WHERE receipt_id = ${id} ORDER BY id`
  })

  return {
    id,
    purchasedOn,
    location,
    itemCount: savedEntries.length,
    total: entries.reduce((sum, entry) => sum + entry.price, 0).toFixed(2),
    entries: savedEntries.map(publicEntry)
  }
})
