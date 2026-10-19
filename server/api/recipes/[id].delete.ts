import { createError, defineEventHandler, getRouterParam, setResponseStatus } from 'h3'
import { db } from '../../utils/db'
import { parseRecipeId } from '../../utils/recipe-query'

export default defineEventHandler(async (event) => {
  const id = parseRecipeId(getRouterParam(event, 'id'))
  const deleted = await db()`DELETE FROM grocery_recipes WHERE id = ${id} RETURNING id`
  if (!deleted.length) throw createError({ statusCode: 404, statusMessage: 'Recipe not found' })
  setResponseStatus(event, 204)
  return null
})
