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
  <section class="m-[clamp(3rem,10vh,7.5rem)_auto_0] grid w-[min(32.5rem,100%)] place-items-center rounded-3xl p-[clamp(1.75rem,5vw,3rem)] text-center shadow-(--shadow) [background:var(--surface)] [border:1px_solid_var(--line)]">
    <UIcon name="i-lucide-lock-keyhole" class="mb-5 size-[2.875rem] text-(--accent)" aria-hidden="true" />
    <p class="mb-1.5 text-xs font-[750] tracking-[.13em] text-(--accent) uppercase">Private application</p>
    <h1 class="leading-[1.04] text-display">Sign in to Receipt Box</h1>
    <p class="mt-3.5 mb-6 text-(--muted)">Continue through your organization’s identity provider.</p>
    <p v-if="route.query.error === 'oidc'" class="notice error w-full -mt-2 mb-5 rounded-[0.625rem] p-[0.6875rem_0.8125rem] text-sm" role="alert">
      Sign-in did not complete. Please try again.
    </p>
    <UButton :href="loginURL" external label="Continue to sign in" class="min-h-12 min-w-[13.125rem] justify-center rounded-xl px-4.5 font-[750] text-(--on-accent-fill) bg-(--accent-fill) hover:bg-(--accent-fill-hover)" />
  </section>
</template>
