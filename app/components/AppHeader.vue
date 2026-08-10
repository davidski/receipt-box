<script setup lang="ts">
import { userDisplayName } from '#shared/utils/user-display-name'

const route = useRoute()
const brandIconURL = `${useRuntimeConfig().app.baseURL}favicon.svg`
const { enabled: authEnabled } = useAuthMode()
const { loggedIn, user, clear } = useUserSession()
const displayName = computed(() => userDisplayName(user.value))

const links = [
  { to: '/', label: 'Add/edit receipt', icon: 'i-lucide-receipt-text' },
  { to: '/highlights', label: 'Highlights', icon: 'i-lucide-sparkles' },
  { to: '/history', label: 'History', icon: 'i-lucide-history' },
  { to: '/data', label: 'Manage', icon: 'i-lucide-settings' }
]

function isActive(to: string) {
  return route.path === to || (to === '/history' && route.path.startsWith('/items/'))
}

async function logout() {
  await clear()
  await navigateTo('/login')
}
</script>

<template>
  <header class="app-header">
    <NuxtLink to="/" class="brand" aria-label="Receipt Box home">
      <img :src="brandIconURL" class="brand-mark" alt="" width="42" height="42">
      <strong>Receipt Box</strong>
    </NuxtLink>

    <nav class="main-nav desktop-nav" aria-label="Main navigation">
      <NuxtLink v-for="link in links" :key="link.to" :to="link.to" :aria-current="isActive(link.to) ? 'page' : undefined">
        <UIcon :name="link.icon" aria-hidden="true" />{{ link.label }}
      </NuxtLink>
    </nav>

    <div class="header-actions">
      <span
        v-if="authEnabled && loggedIn && displayName"
        class="signed-in-user"
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

  <nav class="main-nav mobile-nav" aria-label="Main navigation">
    <NuxtLink v-for="link in links" :key="link.to" :to="link.to" :aria-current="isActive(link.to) ? 'page' : undefined">
      <UIcon :name="link.icon" aria-hidden="true" /><span>{{ link.label }}</span>
    </NuxtLink>
  </nav>
</template>
