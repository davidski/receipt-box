import { db } from '../utils/db'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const field = String(query.field ?? 'item')
  const search = String(query.q ?? '').trim()
  const limit = Math.min(Math.max(Number(query.limit) || 8, 1), 20)
  const sql = db()

  if (field === 'location') {
    return sql`
      WITH ranked_stores AS (
        SELECT stores.name AS value,
          count(receipts.id)::int AS uses,
          max(receipts.purchased_on) AS last_used,
          coalesce(
            sum(power(
              0.5::numeric,
              greatest(current_date - receipts.purchased_on, 0)::numeric / 90
            )) FILTER (WHERE receipts.id IS NOT NULL),
            0
          ) AS frecency
        FROM grocery_stores stores
        LEFT JOIN grocery_receipt_details receipts ON receipts.location = stores.name
        WHERE (${search} = '' OR stores.name ILIKE ${`${search}%`})
        GROUP BY stores.id, stores.name
      )
      SELECT value, uses, last_used
      FROM ranked_stores
      ORDER BY frecency DESC, last_used DESC NULLS LAST, uses DESC, lower(value)
      LIMIT ${limit}
    `
  }

  if (field === 'unit') {
    return sql`
      SELECT unit AS value, count(*)::int AS uses, max(purchased_on) AS last_used
      FROM grocery_entry_details
      WHERE unit IS NOT NULL AND (${search} = '' OR unit ILIKE ${`${search}%`})
      GROUP BY unit
      ORDER BY count(*) DESC, max(purchased_on) DESC
      LIMIT ${limit}
    `
  }

  return sql`
    WITH latest_items AS (
      SELECT DISTINCT ON (lower(item))
        item AS value, location, size, unit, price, cost_per_unit, category,
        purchased_on AS last_used
      FROM grocery_entry_details
      WHERE (${search} = '' OR item ILIKE ${`%${search}%`})
      ORDER BY lower(item), purchased_on DESC, id DESC
    )
    SELECT value, location, size, unit, price, cost_per_unit, category, last_used
    FROM latest_items
    ORDER BY
      CASE
        WHEN lower(value) = lower(${search}) THEN 0
        WHEN value ILIKE ${`${search}%`} THEN 1
        ELSE 2
      END,
      last_used DESC,
      lower(value)
    LIMIT ${limit}
  `
})
