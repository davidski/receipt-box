import { db } from '../../utils/db'
import {
  DATABASE_RESET_CONFIRMATION,
  hasDatabaseResetConfirmation,
  resetDatabase
} from '../../utils/database-reset'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ confirmation?: unknown }>(event)
  if (!hasDatabaseResetConfirmation(body?.confirmation)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Type ${DATABASE_RESET_CONFIRMATION} to confirm the database reset`
    })
  }

  await resetDatabase(db())
  return { reset: true }
})
