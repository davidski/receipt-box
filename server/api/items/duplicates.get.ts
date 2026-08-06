import { findLikelyDuplicateItems, type ItemNameSummary } from '../../../shared/utils/item-duplicates'
import { db } from '../../utils/db'

export default defineEventHandler(async () => {
  const sql = db()
  const items = await sql<ItemNameSummary[]>`
    SELECT item AS name, count(*)::int AS uses, max(purchased_on)::text AS last_used
    FROM grocery_entries
    GROUP BY item
    ORDER BY lower(item), item
  `
  return { groups: findLikelyDuplicateItems(items) }
})
