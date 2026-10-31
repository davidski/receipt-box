import { createError, defineEventHandler } from 'h3'
import { isMealieConfigured } from '../../../utils/mealie/client'
import { listMealieRecipes, mealieRecipeError } from '../../../utils/mealie/recipes'

export default defineEventHandler(async () => {
  if (!isMealieConfigured()) return { recipes: [] }
  try {
    return { recipes: await listMealieRecipes() }
  } catch (error) {
    throw createError(mealieRecipeError(error))
  }
})
