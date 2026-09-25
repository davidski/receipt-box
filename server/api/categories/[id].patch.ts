import { db } from '../../utils/db'
import { renameCategory, requireCategoryId } from '../../utils/category-query'

export default defineEventHandler(async (event) => {
  const id = requireCategoryId(getRouterParam(event, 'id'))
  const body = await readBody<{ name?: unknown } | null>(event)
  const sql = db()
  const category = await sql.begin(tx => renameCategory(tx, id, body?.name))
  return category
})
