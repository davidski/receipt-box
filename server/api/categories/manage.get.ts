import { db } from '../../utils/db'
import { managedCategories } from '../../utils/category-query'

export default defineEventHandler(async () => managedCategories(db()))
