import { getAuthMode, requiresApiAuthentication } from '../utils/auth-policy'

export default defineEventHandler(async (event) => {
  if (getAuthMode() !== 'oidc') return

  const config = useRuntimeConfig(event)
  if (!requiresApiAuthentication(getRequestURL(event).pathname, config.app.baseURL)) return

  await requireUserSession(event)
})
