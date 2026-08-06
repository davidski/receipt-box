import { db } from '../../utils/db'

export default defineEventHandler(async () => {
  const rows = await db()<{
    date: string | Date
    receiptCount: number
    itemCount: number
  }[]>`
    SELECT receipts.purchased_on AS date,
      count(DISTINCT receipts.id)::int AS receipt_count,
      count(entries.id)::int AS item_count
    FROM grocery_receipts receipts
    INNER JOIN grocery_entries entries ON entries.receipt_id = receipts.id
    GROUP BY receipts.purchased_on
    ORDER BY receipts.purchased_on DESC
  `

  return {
    dates: rows.map(row => ({
      date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date).slice(0, 10),
      receiptCount: row.receiptCount,
      itemCount: row.itemCount
    }))
  }
})
