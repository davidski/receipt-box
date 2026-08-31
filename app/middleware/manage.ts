const validSections = new Set(['stores', 'items', 'import-export', 'transfer', 'maintenance'])

export default defineNuxtRouteMiddleware((to) => {
  const section = String(to.params.section || '')
  if (!validSections.has(section)) {
    return navigateTo({ path: '/data/stores', query: to.query }, { redirectCode: 302 })
  }
})
