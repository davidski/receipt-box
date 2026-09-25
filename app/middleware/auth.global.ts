export default defineNuxtRouteMiddleware(async (to) => {
  const { load } = useAuthMode()
  if (!await load() || to.path === '/login') return

  const { loggedIn, ready, fetch } = useUserSession()
  if (!ready.value) await fetch()
  if (!loggedIn.value) return navigateTo('/login')
})
