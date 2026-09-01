<script setup lang="ts">
const route = useRoute()
const { enabled, load } = useAuthMode()
const { loggedIn } = useUserSession()
const baseURL = useRuntimeConfig().app.baseURL
const loginURL = `${baseURL}auth/oidc`

await load()
if (!enabled.value || loggedIn.value) await navigateTo('/')
</script>

<template>
  <section class="login-panel">
    <UIcon name="i-lucide-lock-keyhole" class="login-icon" aria-hidden="true" />
    <p class="mb-1.5 text-xs font-[750] tracking-[.13em] uppercase text-[var(--accent)]">Private application</p>
    <h1 class="text-[clamp(34px,3.5vw,42px)] leading-[1.04]">Sign in to Receipt Box</h1>
    <p>Continue through your organization’s identity provider.</p>
    <p v-if="route.query.error === 'oidc'" class="notice error" role="alert">
      Sign-in did not complete. Please try again.
    </p>
    <a :href="loginURL" class="primary-button">Continue to sign in</a>
  </section>
</template>
