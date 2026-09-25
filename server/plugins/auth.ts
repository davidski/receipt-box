import { getAuthMode, missingOidcEnvironment } from '../utils/auth-policy'

export default defineNitroPlugin(() => {
  if (getAuthMode() !== 'oidc') return

  const missing = missingOidcEnvironment()
  if (missing.length) {
    throw new Error(`AUTH_MODE=oidc requires: ${missing.join(', ')}`)
  }
})
