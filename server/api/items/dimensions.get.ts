import { db } from '../../utils/db'
import { itemDimensionVariants } from '../../utils/item-query'

export default defineEventHandler(async (event) => {
  const item = String(getQuery(event).item ?? '').trim()
  if (!item) throw createError({ statusCode: 400, statusMessage: 'Choose an item' })
  return itemDimensionVariants(db(), item)
})
