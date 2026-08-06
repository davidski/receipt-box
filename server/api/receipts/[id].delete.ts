import { db } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !/^\d+$/.test(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid receipt id' })
  const deleted = await db()`DELETE FROM grocery_receipts WHERE id = ${id} RETURNING id`
  if (!deleted.length) throw createError({ statusCode: 404, statusMessage: 'Receipt not found' })
  setResponseStatus(event, 204)
  return null
})
