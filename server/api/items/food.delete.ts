import { defineEventHandler, getQuery } from 'h3'
import { db } from '../../utils/db'
import { deleteFoodMapping, requireItemName } from '../../utils/food-mapping'

// Not gated on Mealie: removing a local row needs nothing from it.
export default defineEventHandler(async (event) => {
  const item = requireItemName(getQuery(event).item)
  return { item, deleted: await db().begin(tx => deleteFoodMapping(tx, item)) }
})
