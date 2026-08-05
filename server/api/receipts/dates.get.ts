import { db } from '../../utils/db'

export default defineEventHandler(async () => {
  const rows = await db()<{
    date: string | Date
    receiptCount: number
    itemCount: number
  }[]>`
    SELECT purchased_on AS date,
      count(DISTINCT location)::int AS receipt_count,
      count(*)::int AS item_count
    FROM grocery_entries
    GROUP BY purchased_on
    ORDER BY purchased_on DESC
  `

  return {
    dates: rows.map(row => ({
      date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date).slice(0, 10),
      receiptCount: row.receiptCount,
      itemCount: row.itemCount
    }))
  }
})
