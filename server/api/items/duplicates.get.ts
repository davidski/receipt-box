import { findLikelyDuplicateItems, type ItemNameSummary } from '../../../shared/utils/item-duplicates'
import { db } from '../../utils/db'

export default defineEventHandler(async () => {
  const sql = db()
  const [items, dismissals] = await Promise.all([
    sql<ItemNameSummary[]>`
      SELECT entries.item AS name, count(*)::int AS uses, max(entries.purchased_on)::text AS last_used, categories.name AS category
      FROM grocery_entry_details entries
      LEFT JOIN grocery_item_categories mappings ON mappings.item = entries.item
      LEFT JOIN grocery_categories categories ON categories.id = mappings.category_id
      GROUP BY entries.item, categories.name
      ORDER BY lower(entries.item), entries.item
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
