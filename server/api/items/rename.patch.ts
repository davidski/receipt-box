import { db } from '../../utils/db'
import { normalizeUnit } from '../../../shared/utils/units'
import { renameItemVariants, updateItemDimensions, type ItemDimensionUpdate } from '../../utils/item-query'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ source?: unknown, target?: unknown, dimensions?: Record<string, unknown> }>(event)
  const source = typeof body.source === 'string' ? body.source.trim() : ''
  const target = typeof body.target === 'string' ? body.target.trim() : ''
  if (!source) throw createError({ statusCode: 400, statusMessage: 'Choose an item to rename' })
  if (!target) throw createError({ statusCode: 400, statusMessage: 'An item name is required' })
  if (target.length > 200) throw createError({ statusCode: 400, statusMessage: 'The new item name is too long' })

  let dimensions: ItemDimensionUpdate | null = null
  if (body.dimensions) {
    const scope = body.dimensions.scope
    const size = Number(body.dimensions.size)
    const unit = normalizeUnit(body.dimensions.unit)
    if (!['all', 'missing', 'variant'].includes(String(scope))) throw createError({ statusCode: 400, statusMessage: 'Choose which entries to update' })
    if (!Number.isFinite(size) || size <= 0) throw createError({ statusCode: 400, statusMessage: 'Package quantity must be greater than zero' })
    if (!unit) throw createError({ statusCode: 400, statusMessage: 'A package unit is required' })
    const matchSize = body.dimensions.matchSize === null ? null : Number(body.dimensions.matchSize)
    const matchUnit = normalizeUnit(body.dimensions.matchUnit)
    if (scope === 'variant' && body.dimensions.matchSize !== null && (typeof matchSize !== 'number' || !Number.isFinite(matchSize) || matchSize <= 0)) {
      throw createError({ statusCode: 400, statusMessage: 'The selected package quantity is invalid' })
    }
    dimensions = { scope: scope as ItemDimensionUpdate['scope'], size, unit, matchSize, matchUnit }
  }
  if (source === target && !dimensions) throw createError({ statusCode: 400, statusMessage: 'Choose a name or package change' })

  const sql = db()
  return sql.begin(async (tx) => {
    const existing = await tx<{ item: string }[]>`
      SELECT item FROM grocery_entries WHERE item = ${source} FOR UPDATE
    `
    if (!existing.length) throw createError({ statusCode: 404, statusMessage: 'That item name no longer exists' })
    const updatedEntries = dimensions ? await updateItemDimensions(tx, source, dimensions) : 0
    if (dimensions && !updatedEntries) throw createError({ statusCode: 409, statusMessage: 'No entries still match that package selection' })
    const renamedEntries = source === target ? 0 : await renameItemVariants(tx, target, [source])
    return { source, target, renamedEntries, updatedEntries }
  })
})
