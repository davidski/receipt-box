import { createError, defineEventHandler, readBody } from 'h3'
import { db } from '../../utils/db'
import { requireFoodId, requireItemName, setFoodMapping } from '../../utils/food-mapping'
import { isMealieConfigured } from '../../utils/mealie/client'

export default defineEventHandler(async (event) => {
  if (!isMealieConfigured()) throw createError({ statusCode: 409, statusMessage: 'Mealie is not configured' })
  const body = await readBody<{ item?: unknown, mealieFoodId?: unknown } | undefined>(event)
  const item = requireItemName(body?.item)
  const foodId = requireFoodId(body?.mealieFoodId)
  return db().begin(tx => setFoodMapping(tx, item, foodId))
})
