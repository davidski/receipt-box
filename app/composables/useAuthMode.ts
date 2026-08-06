type AuthConfiguration = {
  enabled: boolean
}

export function useAuthMode() {
  const { apiUrl } = useApi()
  const enabled = useState<boolean | null>('oidc-enabled', () => null)

  async function load() {
    if (enabled.value === null) {
      const configuration = await $fetch<AuthConfiguration>(apiUrl('/auth/config'))
      enabled.value = configuration.enabled
    }
    return enabled.value
  }

  return { enabled, load }
}
