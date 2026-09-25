import { db } from '../utils/db'

export default defineEventHandler(async () => {
  const sql = db()
  const rows = await sql<{ name: string }[]>`
    SELECT name FROM grocery_categories ORDER BY lower(name), name
  `
  return rows.map(row => row.name)
})
