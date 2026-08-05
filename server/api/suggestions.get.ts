import { db } from '../utils/db'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const field = String(query.field ?? 'item')
  const search = String(query.q ?? '').trim()
  const limit = Math.min(Math.max(Number(query.limit) || 8, 1), 20)
  const sql = db()

  if (field === 'location') {
    return sql`
      SELECT stores.name AS value, count(entries.id)::int AS uses, max(entries.purchased_on) AS last_used
      FROM grocery_stores stores
      LEFT JOIN grocery_entries entries ON lower(entries.location) = lower(stores.name)
      WHERE (${search} = '' OR stores.name ILIKE ${`${search}%`})
      GROUP BY stores.id, stores.name
      ORDER BY max(entries.purchased_on) DESC NULLS LAST, count(entries.id) DESC, stores.name
      LIMIT ${limit}
    `
  }

  if (field === 'unit') {
    return sql`
      SELECT unit AS value, count(*)::int AS uses, max(purchased_on) AS last_used
      FROM grocery_entries
      WHERE unit IS NOT NULL AND (${search} = '' OR unit ILIKE ${`${search}%`})
      GROUP BY unit
      ORDER BY count(*) DESC, max(purchased_on) DESC
      LIMIT ${limit}
    `
  }

  return sql`
    SELECT DISTINCT ON (lower(item))
      item AS value, location, size, unit, price, cost_per_unit, purchased_on AS last_used
    FROM grocery_entries
    WHERE (${search} = '' OR item ILIKE ${`%${search}%`})
    ORDER BY lower(item), purchased_on DESC, id DESC
    LIMIT ${limit}
  `
})
