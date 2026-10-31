import { createError, defineEventHandler, getQuery } from 'h3'
import { db } from '../../utils/db'
import { foodSuggestions, requireItemName } from '../../utils/food-mapping'
import { isMealieConfigured } from '../../utils/mealie/client'

export default defineEventHandler(async (event) => {
  const item = requireItemName(getQuery(event).item)
  if (item.length > 200) throw createError({ statusCode: 400, statusMessage: 'The item name is too long' })
  return { item, suggestions: isMealieConfigured() ? await foodSuggestions(db(), item) : [] }
})
