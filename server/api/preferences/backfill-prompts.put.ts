import { getAuthMode } from '../../utils/auth-policy'
import { db } from '../../utils/db'

export default defineEventHandler(async (event) => {
  if (getAuthMode() !== 'oidc') throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  const { user } = await requireUserSession(event)
  if (typeof user.sub !== 'string' || !user.sub) throw createError({ statusCode: 401, statusMessage: 'Authenticated user has no subject' })
  const body = await readBody<{ enabled?: unknown } | null>(event)
  if (typeof body?.enabled !== 'boolean') throw createError({ statusCode: 400, statusMessage: 'enabled must be a boolean' })
  const sql = db()
  const [preference] = await sql`
    INSERT INTO grocery_user_preferences (user_sub, backfill_prompts_enabled)
    VALUES (${user.sub}, ${body.enabled})
    ON CONFLICT (user_sub) DO UPDATE SET backfill_prompts_enabled = EXCLUDED.backfill_prompts_enabled
    RETURNING backfill_prompts_enabled AS enabled
  `
  return { enabled: preference!.enabled }
})
