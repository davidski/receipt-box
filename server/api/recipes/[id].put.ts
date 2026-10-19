import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { db } from '../../utils/db'
import { findRecipe, parseRecipeId, parseRecipeLines, parseRecipeName, recipeWriteError, snapshotTotal } from '../../utils/recipe-query'

export default defineEventHandler(async (event) => {
  const id = parseRecipeId(getRouterParam(event, 'id'))
  const body = await readBody<{ name?: unknown, lines?: unknown, updateSavedPrice?: unknown } | null>(event)
  const name = parseRecipeName(body?.name)
  const lines = parseRecipeLines(body?.lines)
  if (body?.updateSavedPrice !== undefined && typeof body.updateSavedPrice !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'updateSavedPrice must be a boolean' })
  }

  const sql = db()
  // Check first so a missing recipe is a 404 even when the new name is taken by another recipe.
  const [existing] = await sql<{ id: string }[]>`SELECT id::text FROM grocery_recipes WHERE id = ${id}`
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Recipe not found' })
  const updated = body?.updateSavedPrice
    ? await sql<{ id: string }[]>`
      UPDATE grocery_recipes
      SET name = ${name}, lines = ${sql.json(lines)}, saved_total = ${await snapshotTotal(sql, lines)},
        saved_at = now(), updated_at = now()
      WHERE id = ${id}
      RETURNING id::text
    `.catch(recipeWriteError)
    : await sql<{ id: string }[]>`
      UPDATE grocery_recipes
      SET name = ${name}, lines = ${sql.json(lines)}, updated_at = now()
      WHERE id = ${id}
      RETURNING id::text
    `.catch(recipeWriteError)
  if (!updated.length) throw createError({ statusCode: 404, statusMessage: 'Recipe not found' })
  return findRecipe(sql, id)
})
