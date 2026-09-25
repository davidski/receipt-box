import { getAuthMode } from '../../utils/auth-policy'

export default defineEventHandler(() => ({
  enabled: getAuthMode() === 'oidc'
}))
