import { createError, defineEventHandler, readBody, setResponseStatus } from 'h3'
import { getAuthMode } from '../../utils/auth-policy'
import { db } from '../../utils/db'
import { findRecipe, parseRecipeLines, parseRecipeName, recipeWriteError, snapshotTotal } from '../../utils/recipe-query'

export default defineEventHandler(async (event) => {
  let createdBy: string | null = null
  if (getAuthMode() === 'oidc') {
    const { user } = await requireUserSession(event)
    if (typeof user.sub !== 'string' || !user.sub) throw createError({ statusCode: 401, statusMessage: 'Authenticated user has no subject' })
    createdBy = user.sub
  }
  const body = await readBody<{ name?: unknown, lines?: unknown } | null>(event)
  const name = parseRecipeName(body?.name)
  const lines = parseRecipeLines(body?.lines)

  const sql = db()
  const savedTotal = await snapshotTotal(sql, lines)
  const [created] = await sql<{ id: string }[]>`
    INSERT INTO grocery_recipes (name, lines, saved_total, created_by)
    VALUES (${name}, ${sql.json(lines)}, ${savedTotal}, ${createdBy})
    RETURNING id::text
  `.catch(recipeWriteError)
  setResponseStatus(event, 201)
  return findRecipe(sql, created!.id)
})
