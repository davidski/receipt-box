import { migrate } from '../utils/db'

export default defineNitroPlugin(async () => {
  // Static route generation must never require a database connection.
  if (import.meta.prerender) return
  await migrate()
})
