export function useApi() {
  const config = useRuntimeConfig()
  const apiBase = String(config.public.apiBase || '/api').replace(/\/+$/, '')

  function apiUrl(path = '') {
    const suffix = path ? `/${path.replace(/^\/+/, '')}` : ''
    return `${apiBase}${suffix}`
  }

  return { apiBase, apiUrl }
}
