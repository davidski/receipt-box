import { db, publicEntry, type GroceryEntry } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !/^\d+$/.test(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid entry ID' })

  const rows = await db()<GroceryEntry[]>`
    SELECT * FROM grocery_entries WHERE id = ${id} LIMIT 1
  `
  if (!rows[0]) throw createError({ statusCode: 404, statusMessage: 'Purchase not found' })
  return publicEntry(rows[0])
})
