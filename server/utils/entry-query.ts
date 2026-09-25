import { db, publicEntry, type GroceryEntry } from './db'
import { ensureStore, upsertReceipt } from './receipt-query'
import { applyCategoryAssignments, categoryAssignments, lockItemWrites } from './category-query'

export async function insertEntry(entry: Omit<GroceryEntry, 'id' | 'receiptId' | 'createdAt' | 'updatedAt' | 'costPerUnit' | 'category'> & { category?: string | null }) {
  const sql = db()
  const row = await sql.begin(async (tx) => {
    await lockItemWrites(tx)
    const canonicalLocation = await ensureStore(tx, entry.location)
    const receiptId = await upsertReceipt(tx, entry.purchasedOn, canonicalLocation)
    const [inserted] = await tx<{ id: string }[]>`
      INSERT INTO grocery_entries (
        receipt_id, item, size, unit, price,
        sale_item, non_grocery, notes
      ) VALUES (
        ${receiptId}, ${entry.item}, ${entry.size}, ${entry.unit}, ${entry.price}, ${entry.saleItem},
        ${entry.nonGrocery}, ${entry.notes}
      )
      RETURNING id
    `
    if (!inserted) return undefined
    await applyCategoryAssignments(tx, categoryAssignments([entry]))
    const [saved] = await tx<GroceryEntry[]>`
      SELECT * FROM grocery_entry_details WHERE id = ${inserted.id}
    `
    return saved
  })
  return row ? publicEntry(row) : undefined
}
