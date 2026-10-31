import { defineEventHandler } from 'h3'
import { db } from '../../utils/db'
import { unmappedItems } from '../../utils/food-mapping'
import { isMealieConfigured } from '../../utils/mealie/client'

export default defineEventHandler(async () => ({ items: isMealieConfigured() ? await unmappedItems(db()) : [] }))
