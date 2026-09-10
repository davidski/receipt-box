import { db, publicEntry, type GroceryEntry } from './db'
import { ensureStore, upsertReceipt } from './receipt-query'

export async function insertEntry(entry: Omit<GroceryEntry, 'id' | 'receiptId' | 'createdAt' | 'updatedAt' | 'costPerUnit'>) {
  const sql = db()
  const row = await sql.begin(async (tx) => {
    const canonicalLocation = await ensureStore(tx, entry.location)
    const receiptId = await upsertReceipt(tx, entry.purchasedOn, canonicalLocation)
    const [inserted] = await tx<GroceryEntry[]>`
      INSERT INTO grocery_entries (
        receipt_id, purchased_on, item, location, size, unit, price,
        sale_item, non_grocery, notes
      ) VALUES (
        ${receiptId}, ${entry.purchasedOn}, ${entry.item}, ${canonicalLocation}, ${entry.size},
        ${entry.unit}, ${entry.price}, ${entry.saleItem},
        ${entry.nonGrocery}, ${entry.notes}
      )
      RETURNING *
    `
    return inserted
  })
  return row ? publicEntry(row) : undefined
}
