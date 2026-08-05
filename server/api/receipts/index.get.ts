import { db, publicEntry, type GroceryEntry } from '../../utils/db'

type ReceiptRow = GroceryEntry & {
  receiptTotal: string
  receiptItemCount: number
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const purchasedOn = String(query.date ?? '').trim()
  if (purchasedOn && !/^\d{4}-\d{2}-\d{2}$/.test(purchasedOn)) {
    throw createError({ statusCode: 400, statusMessage: 'Date must use YYYY-MM-DD format' })
  }
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 50)
  const offset = Math.max(Number(query.offset) || 0, 0)
  const sql = db()

  const [rows, countRows] = await Promise.all([
    sql<ReceiptRow[]>`
      WITH matching_receipts AS (
        SELECT purchased_on, location
        FROM grocery_entries
        WHERE (${purchasedOn} = '' OR purchased_on = ${purchasedOn}::date)
        GROUP BY purchased_on, location
      ), selected_receipts AS (
        SELECT purchased_on, location
        FROM matching_receipts
        ORDER BY purchased_on DESC, lower(location), location
        LIMIT ${limit} OFFSET ${offset}
      ), receipt_summaries AS (
        SELECT entries.purchased_on, entries.location,
          sum(entries.price)::text AS receipt_total,
          count(*)::int AS receipt_item_count
        FROM grocery_entries entries
        INNER JOIN selected_receipts selected
          ON selected.purchased_on = entries.purchased_on
          AND selected.location = entries.location
        GROUP BY entries.purchased_on, entries.location
      )
      SELECT entries.*, summaries.receipt_total, summaries.receipt_item_count
      FROM grocery_entries entries
      INNER JOIN receipt_summaries summaries
        ON summaries.purchased_on = entries.purchased_on
        AND summaries.location = entries.location
      ORDER BY entries.purchased_on DESC, lower(entries.location), entries.location, lower(entries.item), entries.id
    `,
    sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM (
        SELECT purchased_on, location
        FROM grocery_entries
        WHERE (${purchasedOn} = '' OR purchased_on = ${purchasedOn}::date)
        GROUP BY purchased_on, location
      ) matching_receipts
    `
  ])

  const receipts = new Map<string, {
    purchasedOn: string
    location: string
    total: string
    itemCount: number
    entries: ReturnType<typeof publicEntry>[]
  }>()

  for (const row of rows) {
    const entry = publicEntry(row)
    const key = `${entry.purchasedOn}\u0000${entry.location}`
    const receipt = receipts.get(key) ?? {
      purchasedOn: entry.purchasedOn,
      location: entry.location,
      total: row.receiptTotal,
      itemCount: row.receiptItemCount,
      entries: []
    }
    receipt.entries.push(entry)
    receipts.set(key, receipt)
  }

  return { receipts: [...receipts.values()], total: Number(countRows[0]?.count ?? 0) }
})
