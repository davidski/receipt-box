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
  const dateFilter = purchasedOn ? sql`WHERE purchased_on = ${purchasedOn}` : sql``

  if (String(query.summary ?? '') === 'true') {
    const [rows, countRows] = await Promise.all([
      sql<{ id: string, purchasedOn: string | Date, location: string, receiptTotal: string, receiptItemCount: number }[]>`
        SELECT receipts.id::text, receipts.purchased_on, receipts.location,
          sum(entries.price)::text AS receipt_total,
          count(entries.id)::int AS receipt_item_count
        FROM grocery_receipt_details receipts
        INNER JOIN grocery_entries entries ON entries.receipt_id = receipts.id
        ${purchasedOn ? sql`WHERE receipts.purchased_on = ${purchasedOn}` : sql``}
        GROUP BY receipts.id, receipts.purchased_on, receipts.location
        ORDER BY receipts.purchased_on DESC, lower(receipts.location), receipts.location, receipts.id DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql<{ count: string }[]>`
        SELECT count(DISTINCT receipts.id)::text AS count
        FROM grocery_receipt_details receipts
        INNER JOIN grocery_entries entries ON entries.receipt_id = receipts.id
        ${purchasedOn ? sql`WHERE receipts.purchased_on = ${purchasedOn}` : sql``}
      `
    ])

    return {
      receipts: rows.map(row => ({
        id: row.id,
        purchasedOn: row.purchasedOn instanceof Date ? row.purchasedOn.toISOString().slice(0, 10) : String(row.purchasedOn).slice(0, 10),
        location: row.location,
        total: row.receiptTotal,
        itemCount: row.receiptItemCount,
        entries: []
      })),
      total: Number(countRows[0]?.count ?? 0)
    }
  }

  const [rows, countRows] = await Promise.all([
    sql<ReceiptRow[]>`
      WITH selected_receipts AS (
        SELECT id, purchased_on, location
        FROM grocery_receipt_details
        ${dateFilter}
        ORDER BY purchased_on DESC, lower(location), location
        LIMIT ${limit} OFFSET ${offset}
      ), receipt_summaries AS (
        SELECT selected.id AS receipt_id, selected.purchased_on, selected.location,
          sum(entries.price)::text AS receipt_total,
          count(*)::int AS receipt_item_count
        FROM selected_receipts selected
        INNER JOIN grocery_entries entries ON entries.receipt_id = selected.id
        GROUP BY selected.id, selected.purchased_on, selected.location
      )
      SELECT entries.*, summaries.receipt_total, summaries.receipt_item_count
      FROM grocery_entry_details entries
      INNER JOIN receipt_summaries summaries ON summaries.receipt_id = entries.receipt_id
      ORDER BY entries.purchased_on DESC, lower(entries.location), entries.location, entries.receipt_id DESC, entries.id
    `,
    sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM grocery_receipt_details
      ${dateFilter}
    `
  ])

  const receipts = new Map<string, {
    id: string
    purchasedOn: string
    location: string
    total: string
    itemCount: number
    entries: ReturnType<typeof publicEntry>[]
  }>()

  for (const row of rows) {
    const entry = publicEntry(row)
    const key = entry.receiptId
    const receipt = receipts.get(key) ?? {
      id: entry.receiptId,
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
