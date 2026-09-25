const validRoutes = new Set(['calendar', 'list', 'entries', 'receipts/calendar', 'receipts/list'])

export default defineNuxtRouteMiddleware((to) => {
  if (to.path === '/history') {
    return navigateTo({ path: '/history/receipts/calendar', query: to.query }, { redirectCode: 302 })
  }

  const value = to.params.view
  const routeKey = (Array.isArray(value) ? value.map(String) : [String(value || '')]).join('/')
  if (!validRoutes.has(routeKey)) {
    return navigateTo({ path: '/history/receipts/calendar', query: to.query }, { redirectCode: 302 })
  }
})
