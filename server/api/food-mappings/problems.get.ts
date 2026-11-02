import { defineEventHandler } from 'h3'
import { db } from '../../utils/db'
import { foodMappingProblems } from '../../utils/food-mapping'
import { isMealieConfigured } from '../../utils/mealie/client'

export default defineEventHandler(async () => isMealieConfigured()
  ? foodMappingProblems(db())
  : { itemsWithoutPackageSize: [] })
