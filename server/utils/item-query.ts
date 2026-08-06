import type postgres from 'postgres'

type Transaction = postgres.TransactionSql

export async function renameItemVariants(tx: Transaction, target: string, sources: string[]) {
  let mergedEntries = 0
  for (const source of sources) {
    const updated = await tx<{ id: string }[]>`
      UPDATE grocery_entries
      SET item = ${target}, updated_at = now()
      WHERE item = ${source}
      RETURNING id::text
    `
    mergedEntries += updated.length
  }
  return mergedEntries
}
