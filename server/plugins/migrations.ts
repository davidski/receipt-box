import { db, migrate } from '../utils/db'
import { startMealieSync } from '../utils/mealie/sync'

export default defineNitroPlugin(async () => {
  // Static route generation must never require a database connection.
  if (import.meta.prerender) return
  await migrate()
  void startMealieSync(db)
})
