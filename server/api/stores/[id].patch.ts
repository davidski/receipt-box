import { db } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !/^\d+$/.test(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid store id' })
  const body = await readBody<{ name?: unknown }>(event)
  const name = String(body.name ?? '').trim()
  if (!name) throw createError({ statusCode: 400, statusMessage: 'Store name is required' })
  if (name.length > 120) throw createError({ statusCode: 400, statusMessage: 'Store name is too long' })

  const sql = db()
  return sql.begin(async (tx) => {
    const [current] = await tx<{ id: string, name: string }[]>`
      SELECT id::text, name FROM grocery_stores WHERE id = ${id} FOR UPDATE
    `
    if (!current) throw createError({ statusCode: 404, statusMessage: 'Store not found' })

    const [target] = await tx<{ id: string, name: string }[]>`
      SELECT id::text, name FROM grocery_stores
      WHERE lower(name) = lower(${name}) AND id <> ${id}
      FOR UPDATE
    `
    if (target) {
      await tx`UPDATE grocery_entries SET location = ${target.name}, updated_at = now() WHERE lower(location) = lower(${current.name})`
      await tx`DELETE FROM grocery_stores WHERE id = ${id}`
      return { ...target, merged: true }
    }

    await tx`UPDATE grocery_stores SET name = ${name} WHERE id = ${id}`
    await tx`UPDATE grocery_entries SET location = ${name}, updated_at = now() WHERE lower(location) = lower(${current.name})`
    return { id, name, merged: false }
  })
})
