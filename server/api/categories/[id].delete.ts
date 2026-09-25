import { db } from '../../utils/db'
import { deleteCategory, requireCategoryId } from '../../utils/category-query'

export default defineEventHandler(async (event) => {
  const id = requireCategoryId(getRouterParam(event, 'id'))
  const sql = db()
  return sql.begin(tx => deleteCategory(tx, id))
})
