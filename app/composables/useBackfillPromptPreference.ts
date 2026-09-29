export function useBackfillPromptPreference() {
  const enabled = useState<boolean>('backfill-prompts-enabled', () => true)
  const loaded = useState<boolean>('backfill-prompts-loaded', () => false)
  const error = useState<string>('backfill-prompts-error', () => '')
  const { load: loadAuthMode } = useAuthMode()
  const { apiUrl } = useApi()

  async function load() {
    try {
      const oidcEnabled = await loadAuthMode()
      if (oidcEnabled && loaded.value && !error.value) return
      if (oidcEnabled) {
        const preference = await $fetch<{ enabled: boolean }>(apiUrl('/preferences/backfill-prompts'))
        enabled.value = preference.enabled
      } else if (import.meta.client) {
        try {
          enabled.value = localStorage.getItem('receipt-box:item-backfill-prompts') !== 'disabled'
        } catch {
          // Storage can be unavailable in privacy-restricted browser contexts.
        }
      }
      error.value = ''
    } catch {
      error.value = 'Could not load this preference. Try again.'
    } finally {
      loaded.value = true
    }
  }

  async function save(value: boolean) {
    const previous = enabled.value
    enabled.value = value
    error.value = ''
    try {
      if (await loadAuthMode()) {
        await $fetch(apiUrl('/preferences/backfill-prompts'), { method: 'PUT', body: { enabled: value } })
      } else if (import.meta.client) {
        try {
          localStorage.setItem('receipt-box:item-backfill-prompts', value ? 'enabled' : 'disabled')
        } catch {
          // Keep the setting for this session when browser storage is unavailable.
        }
      }
    } catch {
      enabled.value = previous
      error.value = 'Could not save this preference. Try again.'
    }
  }

  return { enabled, loaded, error, load, save }
}
