import { db } from '../../utils/db'
import { normalizeStoreName } from '../../../shared/utils/store-name'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ name?: unknown }>(event)
  const name = normalizeStoreName(body.name)
  if (!name) throw createError({ statusCode: 400, statusMessage: 'Store name is required' })
  if (name.length > 120) throw createError({ statusCode: 400, statusMessage: 'Store name is too long' })

  const sql = db()
  const [store] = await sql<{ id: string, name: string }[]>`
    INSERT INTO grocery_stores (name) VALUES (${name})
    ON CONFLICT DO NOTHING
    RETURNING id::text, name
  `
  if (!store) throw createError({ statusCode: 409, statusMessage: 'That store already exists' })
  setResponseStatus(event, 201)
  return { ...store, uses: 0 }
})
