import { db, publicEntry, type GroceryEntry } from '../../utils/db'
import { itemSlug, itemSlugBase } from '../../../shared/utils/item-slug'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const requestedItem = String(query.item ?? '').trim()
  const requestedSlug = String(query.slug ?? '').trim()
  if (!requestedItem && !requestedSlug) throw createError({ statusCode: 400, statusMessage: 'Item is required' })
  if (requestedItem.length > 250 || requestedSlug.length > 250) throw createError({ statusCode: 400, statusMessage: 'Item name is too long' })

  const sql = db()
  let item = requestedItem
  let rows = item
    ? await sql<GroceryEntry[]>`
        SELECT * FROM grocery_entry_details
        WHERE lower(item) = lower(${item})
        ORDER BY purchased_on, id
      `
    : []

  if (!rows.length && requestedSlug) {
    const names = await sql<{ item: string }[]>`SELECT DISTINCT item FROM grocery_entry_details ORDER BY item`
    const matches = names.filter(candidate => itemSlug(candidate.item) === requestedSlug)
    const legacyMatches = matches.length ? matches : names.filter(candidate => itemSlugBase(candidate.item) === requestedSlug)
    const distinctMatches = new Set(legacyMatches.map(candidate => candidate.item.toLowerCase()))
    if (distinctMatches.size > 1) throw createError({ statusCode: 409, statusMessage: 'This item URL is ambiguous' })
    item = legacyMatches[0]?.item || ''
    if (item) {
      rows = await sql<GroceryEntry[]>`
        SELECT * FROM grocery_entry_details
        WHERE lower(item) = lower(${item})
        ORDER BY purchased_on, id
      `
    }
  }

  if (!rows.length) throw createError({ statusCode: 404, statusMessage: 'Item not found' })

  return {
    item: rows.at(-1)?.item ?? item,
    entries: rows.map(publicEntry)
  }
})
