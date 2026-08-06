import { db, publicEntry, type GroceryEntry } from '../../utils/db'
import { normalizeStoreName } from '../../../shared/utils/store-name'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const purchasedOn = String(query.date ?? '').slice(0, 10)
  const location = normalizeStoreName(query.location)
  const excludeId = String(query.excludeId ?? '')

  if (!/^\d{4}-\d{2}-\d{2}$/.test(purchasedOn) || !location) return { receipt: null }
  if (excludeId && !/^\d+$/.test(excludeId)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid excluded receipt id' })
  }

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
    FROM grocery_receipts receipts
    LEFT JOIN grocery_entries entries ON entries.receipt_id = receipts.id
    WHERE receipts.purchased_on = ${purchasedOn}
      AND lower(receipts.location) = lower(${location})
      AND (${excludeId} = '' OR receipts.id <> ${excludeId || '0'})
    GROUP BY receipts.id, receipts.purchased_on, receipts.location
    LIMIT 1
  `

  if (!receipt) return { receipt: null }

  const entries = await sql<GroceryEntry[]>`
    SELECT *
    FROM grocery_entries
    WHERE receipt_id = ${receipt.id}
    ORDER BY id
  `

  const receiptDate = receipt.purchasedOn instanceof Date
    ? receipt.purchasedOn.toISOString().slice(0, 10)
    : String(receipt.purchasedOn).slice(0, 10)

  return { receipt: { ...receipt, purchasedOn: receiptDate, entries: entries.map(publicEntry) } }
})
