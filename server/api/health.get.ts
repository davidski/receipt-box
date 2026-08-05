import { db } from '../utils/db'

export default defineEventHandler(async () => {
  const sql = db()
  await sql`SELECT 1`
  return { status: 'ok' }
})
