import { defineEventHandler, readBody } from 'h3'
import { db } from '../utils/db'
import { parseRecipeLines, priceRecipe } from '../utils/recipe-query'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ lines?: unknown } | null>(event)
  return priceRecipe(db(), parseRecipeLines(body?.lines))
})
