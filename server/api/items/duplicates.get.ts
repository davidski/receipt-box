import { findLikelyDuplicateItems, type ItemNameSummary } from '../../../shared/utils/item-duplicates'
import { db } from '../../utils/db'

export default defineEventHandler(async () => {
  const sql = db()
  const [items, dismissals] = await Promise.all([
    sql<ItemNameSummary[]>`
      SELECT item AS name, count(*)::int AS uses, max(purchased_on)::text AS last_used
      FROM grocery_entries
      GROUP BY item
      ORDER BY lower(item), item
    `,
    sql<{ groupId: string }[]>`SELECT group_id FROM grocery_item_merge_dismissals`
  ])
  const hiddenIds = new Set(dismissals.map(row => row.groupId))
  const groups = findLikelyDuplicateItems(items)
  return {
    items,
    groups: groups.filter(group => !hiddenIds.has(group.id)),
    hiddenGroups: groups.filter(group => hiddenIds.has(group.id))
  }
})
