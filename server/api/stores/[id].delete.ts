import { db } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !/^\d+$/.test(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid store id' })
  const sql = db()
  const [store] = await sql<{ name: string }[]>`SELECT name FROM grocery_stores WHERE id = ${id}`
  if (!store) throw createError({ statusCode: 404, statusMessage: 'Store not found' })
  const [usage] = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM grocery_entries WHERE lower(location) = lower(${store.name})
  `
  const count = Number(usage?.count ?? 0)
  if (count > 0) {
    throw createError({ statusCode: 409, statusMessage: `This store is used by ${count} entries. Rename it to merge those entries first.` })
  }
  await sql`DELETE FROM grocery_stores WHERE id = ${id}`
  setResponseStatus(event, 204)
})
