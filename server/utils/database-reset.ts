export const DATABASE_RESET_CONFIRMATION = 'RESET'

export function hasDatabaseResetConfirmation(value: unknown): value is string {
  return typeof value === 'string' && value === DATABASE_RESET_CONFIRMATION
}

type ResetTransaction = {
  unsafe: (query: string) => Promise<unknown>
}

type ResetDatabaseClient = {
  begin: <T>(callback: (transaction: ResetTransaction) => Promise<T>) => Promise<T>
}

export async function resetDatabase(sql: ResetDatabaseClient): Promise<void> {
  await sql.begin(async (transaction) => {
    await transaction.unsafe(`
      TRUNCATE TABLE grocery_entries, grocery_receipts, grocery_stores
      RESTART IDENTITY
    `)
  })
}
