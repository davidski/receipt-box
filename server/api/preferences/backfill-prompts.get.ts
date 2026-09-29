import { getAuthMode } from '../../utils/auth-policy'
import { db } from '../../utils/db'

export default defineEventHandler(async (event) => {
  if (getAuthMode() !== 'oidc') throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  const { user } = await requireUserSession(event)
  if (typeof user.sub !== 'string' || !user.sub) throw createError({ statusCode: 401, statusMessage: 'Authenticated user has no subject' })
  const sql = db()
  const [preference] = await sql`
    SELECT backfill_prompts_enabled AS enabled
    FROM grocery_user_preferences
    WHERE user_sub = ${user.sub}
  `
  return { enabled: preference?.enabled ?? true }
})
