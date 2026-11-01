// Without Mealie the recipe cost pages do not exist; native recipes live on /recipes.
export default defineNuxtRouteMiddleware(async () => {
  const { apiUrl } = useApi()
  const status = await $fetch<{ configured: boolean }>(apiUrl('/mealie/status')).catch(() => null)
  if (!status?.configured) return navigateTo('/recipes', { replace: true })
})
