import { normalizeUnit } from '../../../shared/utils/units'
import { db } from '../../utils/db'
import { backfillItemDimensions } from '../../utils/item-backfill'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ item?: unknown, excludeId?: unknown, size?: unknown, unit?: unknown, fields?: unknown }>(event)
  const item = typeof body.item === 'string' ? body.item.trim() : ''
  const excludeId = typeof body.excludeId === 'string' ? body.excludeId : ''
  const size = typeof body.size === 'string' || typeof body.size === 'number' ? String(body.size).trim() : ''
  const unit = normalizeUnit(body.unit)
  const fields = Array.isArray(body.fields)
    ? [...new Set(body.fields.filter((field): field is 'size' | 'unit' => field === 'size' || field === 'unit'))]
    : []
  if (!item || item.length > 200) throw createError({ statusCode: 400, statusMessage: 'A valid item name is required' })
  if (!/^\d+$/.test(excludeId)) throw createError({ statusCode: 400, statusMessage: 'A valid current entry is required' })
  if (!fields.length) throw createError({ statusCode: 400, statusMessage: 'Choose at least one field to backfill' })
  if (fields.includes('size') && (!size || !Number.isFinite(Number(size)) || Number(size) <= 0)) {
    throw createError({ statusCode: 400, statusMessage: 'A valid size is required' })
  }
  if (fields.includes('unit') && !unit) throw createError({ statusCode: 400, statusMessage: 'A valid unit is required' })

  const sql = db()
  const affectedEntries = await sql.begin(tx => backfillItemDimensions(tx, item, excludeId, size, unit!, fields))
  return { affectedEntries }
})
