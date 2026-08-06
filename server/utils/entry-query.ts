import { db, publicEntry, type GroceryEntry } from './db'

export async function insertEntry(entry: Omit<GroceryEntry, 'id' | 'receiptId' | 'createdAt' | 'updatedAt'>) {
  const sql = db()
  const row = await sql.begin(async (tx) => {
    await tx`INSERT INTO grocery_stores (name) VALUES (${entry.location}) ON CONFLICT DO NOTHING`
    const [receipt] = await tx<{ id: string }[]>`
      INSERT INTO grocery_receipts (purchased_on, location)
      VALUES (${entry.purchasedOn}, ${entry.location})
      RETURNING id::text
    `
    const [inserted] = await tx<GroceryEntry[]>`
      INSERT INTO grocery_entries (
        receipt_id, purchased_on, item, location, size, unit, price, cost_per_unit,
        sale_item, non_grocery, notes
      ) VALUES (
        ${receipt!.id}, ${entry.purchasedOn}, ${entry.item}, ${entry.location}, ${entry.size},
        ${entry.unit}, ${entry.price}, ${entry.costPerUnit}, ${entry.saleItem},
        ${entry.nonGrocery}, ${entry.notes}
      )
      RETURNING *
    `
    return inserted
  })
  return row ? publicEntry(row) : undefined
}
