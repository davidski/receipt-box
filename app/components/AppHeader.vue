<script setup lang="ts">
import { userDisplayName } from '#shared/utils/user-display-name'

const route = useRoute()
const config = useRuntimeConfig()
const brandIconURL = `${config.app.baseURL}favicon.svg`
const appVersion = config.public.appVersion
const repoURL = 'https://github.com/davidski/receipt-box'
const { enabled: authEnabled } = useAuthMode()
const { loggedIn, user, clear } = useUserSession()
const displayName = computed(() => userDisplayName(user.value))

const links = [
  { to: '/', label: 'Receipts', icon: 'i-lucide-receipt-text' },
  { to: '/highlights', label: 'Highlights', icon: 'i-lucide-sparkles' },
  { to: '/recipes', label: 'Recipes', icon: 'i-lucide-chef-hat' },
  { to: '/data/stores', label: 'Manage', icon: 'i-lucide-settings' }
]

function isActive(to: string) {
  return route.path === to || (to === '/' && (route.path.startsWith('/receipts/') || route.path.startsWith('/history/') || route.path.startsWith('/items/'))) || (to === '/recipes' && route.path === '/recipe') || (to === '/data/stores' && (route.path === '/data' || route.path.startsWith('/data/')))
}

async function logout() {
  await clear()
  await navigateTo('/login')
}
</script>

<template>
  <header class="app-header sticky top-0 z-30 grid min-h-19 grid-cols-[1fr_auto_1fr] items-center p-[0.625rem_max(1.5rem,env(safe-area-inset-left))] backdrop-blur-[18px] [background:color-mix(in_srgb,var(--bg),transparent_7%)] [border-bottom:1px_solid_color-mix(in_srgb,var(--line),transparent_15%)] max-[900.01px]:grid-cols-[minmax(0,_1fr)_auto] max-[900.01px]:min-h-[4.375rem] max-[640.01px]:grid-cols-[1fr_auto] max-[640.01px]:px-[1rem]">
    <div class="flex w-max flex-col">
      <NuxtLink to="/" class="brand inline-flex w-max items-center gap-2.5 no-underline" aria-label="Receipt Box home">
        <img :src="brandIconURL" class="block size-[2.625rem] max-[640.01px]:w-[2.4375rem] max-[640.01px]:h-[2.4375rem]" alt="" width="42" height="42">
        <strong class="[font-family:var(--font-display)] text-title font-[600] leading-[1] tracking-[-.015em]">Receipt Box</strong>
      </NuxtLink>
      <ULink
        :to="repoURL"
        target="_blank"
        class="app-version -mt-2.5 ml-[3.25rem] w-max font-mono text-xs leading-none text-(--muted) max-[640.01px]:hidden"
        :aria-label="`Version ${appVersion}, view source on GitHub`"
      >
        {{ appVersion }}
      </ULink>
    </div>

    <nav class="flex gap-[0.3125rem] rounded-full p-[0.3125rem] [background:var(--surface)] [border:1px_solid_var(--line)] max-[900.01px]:hidden" aria-label="Main navigation">
      <NuxtLink v-for="link in links" :key="link.to" :to="link.to" :aria-current="isActive(link.to) ? 'page' : undefined" class="flex items-center gap-1.5 min-h-[2.625rem] px-4.5 rounded-full text-(--muted) text-sm font-[650] no-underline aria-[current=page]:bg-(--accent-soft) aria-[current=page]:text-(--accent-strong)">
        <UIcon :name="link.icon" aria-hidden="true" />{{ link.label }}
      </NuxtLink>
    </nav>

    <div class="flex gap-2 justify-self-end">
      <span
        v-if="authEnabled && loggedIn && displayName"
        class="signed-in-user inline-flex max-w-[9.375rem] items-center gap-[0.3125rem] truncate px-[0.375rem] text-sm font-semibold text-(--muted) max-[640.01px]:max-w-[5.625rem] max-[640.01px]:px-[0.125rem]"
        :title="`Signed in as ${displayName}`"
      >
        <UIcon name="i-lucide-user-round" aria-hidden="true" />
        {{ displayName }}
      </span>
      <UButton
        v-if="authEnabled && loggedIn"
        icon="i-lucide-log-out"
        aria-label="Sign out"
        size="xl"
        variant="outline"
        color="neutral"
        @click="logout"
      />
      <UColorModeButton size="xl" variant="outline" color="neutral" />
    </div>
  </header>

  <nav class="hidden gap-[0.3125rem] rounded-full p-[0.3125rem] [background:var(--surface)] [border:1px_solid_var(--line)] max-[900.01px]:fixed max-[900.01px]:z-[40] max-[900.01px]:right-[max(0.875rem,_env(safe-area-inset-right))] max-[900.01px]:bottom-[max(0.75rem,_env(safe-area-inset-bottom))] max-[900.01px]:left-[max(0.875rem,_env(safe-area-inset-left))] max-[900.01px]:flex max-[900.01px]:justify-around max-[900.01px]:[box-shadow:0_12px_36px_rgb(0_0_0_/_20%)]" aria-label="Main navigation">
    <NuxtLink v-for="link in links" :key="link.to" :to="link.to" :aria-current="isActive(link.to) ? 'page' : undefined" class="flex items-center gap-1.5 min-h-[2.625rem] rounded-full text-(--muted) text-sm font-[650] no-underline aria-[current=page]:bg-(--accent-soft) aria-[current=page]:text-(--accent-strong) flex-1 justify-center min-w-0 px-2.5 max-[640.01px]:flex-col max-[640.01px]:gap-0.5 max-[640.01px]:px-1 max-[640.01px]:text-xs">
      <UIcon :name="link.icon" aria-hidden="true" class="max-[640.01px]:size-[1.0625rem]" /><span>{{ link.label }}</span>
    </NuxtLink>
  </nav>
</template>
