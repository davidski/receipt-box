import { db } from '../../utils/db'
import { renameItemVariants } from '../../utils/item-query'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ target?: unknown, sources?: unknown }>(event)
  const target = typeof body.target === 'string' ? body.target.trim() : ''
  const sources = Array.isArray(body.sources)
    ? [...new Set(body.sources.filter((source): source is string => typeof source === 'string').map(source => source.trim()).filter(Boolean))]
    : []

  if (!target) throw createError({ statusCode: 400, statusMessage: 'A unified item name is required' })
  if (target.length > 200) throw createError({ statusCode: 400, statusMessage: 'The unified item name is too long' })
  if (!sources.length) throw createError({ statusCode: 400, statusMessage: 'Choose at least one item name to merge' })
  if (sources.length > 20) throw createError({ statusCode: 400, statusMessage: 'Too many item names were selected' })
  if (sources.includes(target)) throw createError({ statusCode: 400, statusMessage: 'The unified name cannot also be a source' })

  const sql = db()
  return sql.begin(async (tx) => {
    const existing = await tx<{ item: string }[]>`
      SELECT item FROM grocery_entries
      WHERE item = ${target} OR item = ANY(${sources}::text[])
      FOR UPDATE
    `
    const existingNames = new Set(existing.map(row => row.item))
    if (!existingNames.has(target)) throw createError({ statusCode: 404, statusMessage: 'The unified item name no longer exists' })
    const missing = sources.filter(source => !existingNames.has(source))
    if (missing.length) throw createError({ statusCode: 409, statusMessage: 'One or more item variants changed. Refresh and try again.' })

    const mergedEntries = await renameItemVariants(tx, target, sources)
    return { target, mergedNames: sources.length, mergedEntries }
  })
})
