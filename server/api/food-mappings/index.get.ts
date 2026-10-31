import { defineEventHandler } from 'h3'
import { db } from '../../utils/db'
import { listFoodMappings } from '../../utils/food-mapping'
import { isMealieConfigured } from '../../utils/mealie/client'

export default defineEventHandler(async () => ({ mappings: isMealieConfigured() ? await listFoodMappings(db()) : [] }))
