import { db } from '../../utils/db'
import { renameItemVariants } from '../../utils/item-query'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ source?: unknown, target?: unknown }>(event)
  const source = typeof body.source === 'string' ? body.source.trim() : ''
  const target = typeof body.target === 'string' ? body.target.trim() : ''
  if (!source) throw createError({ statusCode: 400, statusMessage: 'Choose an item to rename' })
  if (!target) throw createError({ statusCode: 400, statusMessage: 'A new item name is required' })
  if (target.length > 200) throw createError({ statusCode: 400, statusMessage: 'The new item name is too long' })
  if (source === target) throw createError({ statusCode: 400, statusMessage: 'The new item name must be different' })

  const sql = db()
  return sql.begin(async (tx) => {
    const existing = await tx<{ item: string }[]>`
      SELECT item FROM grocery_entries WHERE item = ${source} FOR UPDATE
    `
    if (!existing.length) throw createError({ statusCode: 404, statusMessage: 'That item name no longer exists' })
    const renamedEntries = await renameItemVariants(tx, target, [source])
    return { source, target, renamedEntries }
  })
})
