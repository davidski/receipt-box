import { db } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !/^\d+$/.test(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid entry id' })
  const sql = db()
  const result = await sql`DELETE FROM grocery_entries WHERE id = ${id} RETURNING id`
  if (!result.length) throw createError({ statusCode: 404, statusMessage: 'Entry not found' })
  setResponseStatus(event, 204)
  return null
})
