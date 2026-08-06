import { db, publicEntry, type GroceryEntry } from '../../utils/db'
import { normalizeEntry } from '../../utils/entry-input'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !/^\d+$/.test(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid entry id' })
  const input = normalizeEntry(await readBody(event))
  const sql = db()
  const row = await sql.begin(async (tx) => {
    await tx`INSERT INTO grocery_stores (name) VALUES (${input.location}) ON CONFLICT DO NOTHING`
    const [current] = await tx<{ receiptId: string }[]>`
      SELECT receipt_id::text FROM grocery_entries WHERE id = ${id} FOR UPDATE
    `
    if (!current) return undefined
    await tx`
      UPDATE grocery_receipts
      SET purchased_on = ${input.purchasedOn}, location = ${input.location}, updated_at = now()
      WHERE id = ${current.receiptId}
    `
    await tx`
      UPDATE grocery_entries
      SET purchased_on = ${input.purchasedOn}, location = ${input.location}, updated_at = now()
      WHERE receipt_id = ${current.receiptId}
    `
    const [updated] = await tx<GroceryEntry[]>`
      UPDATE grocery_entries SET
        item = ${input.item}, size = ${input.size}, unit = ${input.unit}, price = ${input.price},
        cost_per_unit = ${input.costPerUnit}, sale_item = ${input.saleItem},
        non_grocery = ${input.nonGrocery}, notes = ${input.notes},
        updated_at = now()
      WHERE id = ${id}
      RETURNING *
    `
    return updated
  })
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Entry not found' })
  return publicEntry(row)
})
