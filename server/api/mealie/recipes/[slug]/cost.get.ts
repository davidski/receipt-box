import { createError, defineEventHandler, getRouterParam } from 'h3'
import { db } from '../../../../utils/db'
import { fetchMealieRecipe } from '../../../../utils/mealie/client'
import { costMealieRecipe, mealieRecipeError } from '../../../../utils/mealie/recipes'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug', { decode: true })
  // encodeURIComponent leaves dots alone, and a dot segment would reach a different Mealie path.
  if (!slug || /^\.+$/.test(slug)) throw createError({ statusCode: 400, statusMessage: 'Invalid recipe slug' })
  try {
    const recipe = await fetchMealieRecipe(slug)
    return await costMealieRecipe(db(), recipe)
  } catch (error) {
    throw createError(mealieRecipeError(error))
  }
})
