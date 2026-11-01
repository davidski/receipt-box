import { createError, defineEventHandler, getRouterParam } from 'h3'
import { db } from '../../../utils/db'
import { cachedFood, requireFoodId } from '../../../utils/food-mapping'
import { isMealieConfigured } from '../../../utils/mealie/client'

// One cached food, active or not, so a link can name the food it points at.
export default defineEventHandler(async (event) => {
  const id = requireFoodId(getRouterParam(event, 'id', { decode: true }))
  const food = isMealieConfigured() ? await cachedFood(db(), id) : null
  if (!food) throw createError({ statusCode: 404, statusMessage: 'Food not found in the synced Mealie catalog' })
  return food
})
