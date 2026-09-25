import { db } from '../../utils/db'

export default defineEventHandler(async () => {
  const sql = db()
  return sql`
    SELECT stores.id::text, stores.name, count(entries.id)::int AS uses
    FROM grocery_stores stores
    LEFT JOIN grocery_entry_details entries ON entries.location = stores.name
    GROUP BY stores.id, stores.name
    ORDER BY lower(stores.name)
  `
})
