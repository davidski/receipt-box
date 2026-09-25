import { db } from '../../utils/db'
import { createCategory } from '../../utils/category-query'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ name?: unknown }>(event)
  const category = await db().begin(tx => createCategory(tx, body?.name))
  setResponseStatus(event, 201)
  return category
})
