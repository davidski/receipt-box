import { db } from '../../utils/db'
import { mergeCategories, requireCategoryId } from '../../utils/category-query'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ sourceId?: unknown, targetId?: unknown } | null>(event)
  const sourceId = requireCategoryId(body?.sourceId)
  const targetId = requireCategoryId(body?.targetId)
  const sql = db()
  return sql.begin(tx => mergeCategories(tx, sourceId, targetId))
})
