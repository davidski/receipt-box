import { defineEventHandler, getQuery } from 'h3'
import { db } from '../../utils/db'
import { searchActiveFoods } from '../../utils/food-mapping'
import { isMealieConfigured } from '../../utils/mealie/client'

export default defineEventHandler(async (event) => {
  const { search } = getQuery(event)
  return { foods: isMealieConfigured() ? await searchActiveFoods(db(), typeof search === 'string' ? search.trim() : '') : [] }
})
