import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { db } from '../../../utils/db'
import { requireSplitId } from '../../../utils/receipt-split'

export default defineEventHandler(async (event) => {
  const id = requireSplitId(getRouterParam(event, 'id'), 'receipt id')
  const body = await readBody<{ entryIds?: unknown }>(event)
  if (!Array.isArray(body?.entryIds) || !body.entryIds.length || body.entryIds.length > 200) {
    throw createError({ statusCode: 400, statusMessage: 'Provide between one and 200 receipt line ids' })
  }
  const listed = body.entryIds.map(entryId => requireSplitId(entryId, 'receipt line id'))
  if (new Set(listed).size !== listed.length) {
    throw createError({ statusCode: 400, statusMessage: 'Receipt line ids must be unique' })
  }

  await db().begin(async (tx) => {
    const [receipt] = await tx<{ id: string }[]>`
      SELECT id::text FROM grocery_receipts WHERE id = ${id} FOR UPDATE
    `
    if (!receipt) throw createError({ statusCode: 404, statusMessage: 'Receipt not found' })

    const existing = await tx<{ id: string }[]>`
      SELECT id::text FROM grocery_entries WHERE receipt_id = ${id} ORDER BY position, id FOR UPDATE
    `
    const existingIds = new Set(existing.map(entry => entry.id))
    if (listed.some(entryId => !existingIds.has(entryId))) {
      throw createError({ statusCode: 400, statusMessage: 'One or more lines do not belong to this receipt' })
    }
    // Lines the client left out (unsaved edits) keep their current order after the listed ones.
    const listedSet = new Set(listed)
    const order = [...listed, ...existing.map(entry => entry.id).filter(entryId => !listedSet.has(entryId))]
    await tx`
      UPDATE grocery_entries entries
      SET position = ordered.position::int
      FROM unnest(${order}::bigint[]) WITH ORDINALITY AS ordered(id, position)
      WHERE entries.id = ordered.id
    `
  })
  return { ok: true }
})
