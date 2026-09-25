import { db } from '../../utils/db'
import { itemBackfillCounts } from '../../utils/item-backfill'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const item = String(query.item ?? '').trim()
  const excludeId = String(query.excludeId ?? '')
  if (!item || item.length > 200) throw createError({ statusCode: 400, statusMessage: 'A valid item name is required' })
  if (!/^\d+$/.test(excludeId)) throw createError({ statusCode: 400, statusMessage: 'A valid current entry is required' })
  return itemBackfillCounts(db(), item, excludeId)
})
