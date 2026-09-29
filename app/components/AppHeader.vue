<script setup lang="ts">
import { userDisplayName } from '#shared/utils/user-display-name'

const route = useRoute()
const brandIconURL = `${useRuntimeConfig().app.baseURL}favicon.svg`
const { enabled: authEnabled } = useAuthMode()
const { loggedIn, user, clear } = useUserSession()
const displayName = computed(() => userDisplayName(user.value))

const links = [
  { to: '/', label: 'Receipts', icon: 'i-lucide-receipt-text' },
  { to: '/highlights', label: 'Highlights', icon: 'i-lucide-sparkles' },
  { to: '/data/stores', label: 'Manage', icon: 'i-lucide-settings' }
]

function isActive(to: string) {
  return route.path === to || (to === '/' && (route.path.startsWith('/receipts/') || route.path.startsWith('/history/') || route.path.startsWith('/items/'))) || (to === '/data/stores' && (route.path === '/data' || route.path.startsWith('/data/')))
}

async function logout() {
  await clear()
  await navigateTo('/login')
}
</script>

<template>
  <header class="app-header sticky top-0 z-30 grid min-h-19 grid-cols-[1fr_auto_1fr] items-center p-[10px_max(24px,env(safe-area-inset-left))] backdrop-blur-[18px] [background:color-mix(in_srgb,var(--bg),transparent_7%)] [border-bottom:1px_solid_color-mix(in_srgb,var(--line),transparent_15%)]">
    <NuxtLink to="/" class="brand inline-flex w-max items-center gap-2.5 no-underline" aria-label="Receipt Box home">
      <img :src="brandIconURL" class="brand-mark block size-[42px]" alt="" width="42" height="42">
      <strong>Receipt Box</strong>
    </NuxtLink>

    <nav class="main-nav desktop-nav flex gap-[5px] rounded-full p-[5px] [background:var(--surface)] [border:1px_solid_var(--line)]" aria-label="Main navigation">
      <NuxtLink v-for="link in links" :key="link.to" :to="link.to" :aria-current="isActive(link.to) ? 'page' : undefined">
        <UIcon :name="link.icon" aria-hidden="true" />{{ link.label }}
      </NuxtLink>
    </nav>

    <div class="header-actions flex gap-2 justify-self-end">
      <span
        v-if="authEnabled && loggedIn && displayName"
        class="signed-in-user inline-flex max-w-[150px] items-center gap-[5px] truncate px-[6px] text-[13px] font-semibold text-(--muted)"
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

  <nav class="main-nav mobile-nav hidden gap-[5px] rounded-full p-[5px] [background:var(--surface)] [border:1px_solid_var(--line)]" aria-label="Main navigation">
    <NuxtLink v-for="link in links" :key="link.to" :to="link.to" :aria-current="isActive(link.to) ? 'page' : undefined">
      <UIcon :name="link.icon" aria-hidden="true" /><span>{{ link.label }}</span>
    </NuxtLink>
  </nav>
</template>
