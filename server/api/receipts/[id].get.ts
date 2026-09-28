import { createError, defineEventHandler, getRouterParam } from 'h3'
import { db, publicEntry, type GroceryEntry } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !/^\d+$/.test(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid receipt id' })

  const sql = db()
  const [receipt] = await sql<{
    id: string
    purchasedOn: string | Date
    location: string
    itemCount: number
    total: string
  }[]>`
    SELECT receipts.id::text, receipts.purchased_on, receipts.location,
      count(entries.id)::int AS item_count,
      coalesce(sum(entries.price), 0)::text AS total
    FROM grocery_receipt_details receipts
    LEFT JOIN grocery_entries entries ON entries.receipt_id = receipts.id
    WHERE receipts.id = ${id}
    GROUP BY receipts.id, receipts.purchased_on, receipts.location
  `
  if (!receipt) throw createError({ statusCode: 404, statusMessage: 'Receipt not found' })

  const entries = await sql<GroceryEntry[]>`
    SELECT * FROM grocery_entry_details WHERE receipt_id = ${id} ORDER BY id
  `
  const purchasedOn = receipt.purchasedOn instanceof Date
    ? receipt.purchasedOn.toISOString().slice(0, 10)
    : String(receipt.purchasedOn).slice(0, 10)

  return {
    receipt: {
      id: receipt.id,
      purchasedOn,
      location: receipt.location,
      itemCount: receipt.itemCount,
      total: receipt.total,
      entries: entries.map(publicEntry)
    }
  }
})
