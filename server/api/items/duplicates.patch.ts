import { db } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ id?: unknown, hidden?: unknown }>(event)
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!id || id.length > 10000) throw createError({ statusCode: 400, statusMessage: 'A valid merge suggestion is required' })
  if (typeof body.hidden !== 'boolean') throw createError({ statusCode: 400, statusMessage: 'Choose whether to hide the suggestion' })

  const sql = db()
  if (body.hidden) {
    await sql`
      INSERT INTO grocery_item_merge_dismissals (group_id)
      VALUES (${id})
      ON CONFLICT (group_id) DO NOTHING
    `
  } else {
    await sql`DELETE FROM grocery_item_merge_dismissals WHERE group_id = ${id}`
  }
  return { id, hidden: body.hidden }
})
