import { defineEventHandler, getQuery } from 'h3'
import { db } from '../../utils/db'
import { getFoodMapping, requireItemName } from '../../utils/food-mapping'
import { isMealieConfigured } from '../../utils/mealie/client'

export default defineEventHandler(async (event) => {
  const item = requireItemName(getQuery(event).item)
  return { item, mapping: isMealieConfigured() ? await getFoodMapping(db(), item) : null }
})
