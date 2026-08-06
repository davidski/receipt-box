import { db } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !/^\d+$/.test(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid entry id' })
  const sql = db()
  const deleted = await sql.begin(async (tx) => {
    const [entry] = await tx<{ receiptId: string }[]>`
      DELETE FROM grocery_entries WHERE id = ${id} RETURNING receipt_id::text
    `
    if (!entry) return false
    await tx`
      DELETE FROM grocery_receipts receipts
      WHERE receipts.id = ${entry.receiptId}
        AND NOT EXISTS (SELECT 1 FROM grocery_entries WHERE receipt_id = receipts.id)
    `
    return true
  })
  if (!deleted) throw createError({ statusCode: 404, statusMessage: 'Entry not found' })
  setResponseStatus(event, 204)
  return null
})
