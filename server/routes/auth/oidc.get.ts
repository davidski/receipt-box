import { getAuthMode } from '../../utils/auth-policy'

const oidcHandler = defineOAuthOidcEventHandler({
  config: {
    scope: ['openid', 'profile', 'email']
  },
  async onSuccess(event, { user }) {
    await setUserSession(event, {
      user: {
        sub: user.sub,
        givenName: user.given_name,
        name: user.name,
        email: user.email,
        preferredUsername: user.preferred_username
      }
    })
    return sendRedirect(event, useRuntimeConfig(event).app.baseURL)
  },
  onError(event) {
    const baseURL = useRuntimeConfig(event).app.baseURL
    return sendRedirect(event, `${baseURL}login?error=oidc`)
  }
})

export default defineEventHandler((event) => {
  if (getAuthMode() !== 'oidc') {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }
  return oidcHandler(event)
})
