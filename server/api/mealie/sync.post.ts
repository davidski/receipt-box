import { createError, defineEventHandler, readBody } from 'h3'
import { db } from '../../utils/db'
import { MealieError } from '../../utils/mealie/client'
import { MealieGuardError, syncMealieCatalog } from '../../utils/mealie/sync'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ force?: unknown } | undefined>(event)
  let result
  try {
    result = await syncMealieCatalog(db, { force: body?.force === true })
  } catch (error) {
    if (error instanceof MealieGuardError) throw createError({ statusCode: 409, statusMessage: error.message })
    if (error instanceof MealieError) throw createError({ statusCode: 502, statusMessage: error.message })
    throw error
  }
  if (result.status === 'disabled') throw createError({ statusCode: 409, statusMessage: 'Mealie is not configured' })
  return result
})
