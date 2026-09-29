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
  <section class="login-panel m-[clamp(48px,10vh,120px)_auto_0] grid w-[min(520px,100%)] place-items-center rounded-3xl p-[clamp(28px,5vw,48px)] text-center shadow-(--shadow) [background:var(--surface)] [border:1px_solid_var(--line)]">
    <UIcon name="i-lucide-lock-keyhole" class="login-icon mb-5 size-[46px] text-(--accent)" aria-hidden="true" />
    <p class="mb-1.5 text-xs font-[750] tracking-[.13em] text-(--accent) uppercase">Private application</p>
    <h1 class="leading-1.04 text-[clamp(34px,3.5vw,42px)]">Sign in to Receipt Box</h1>
    <p>Continue through your organization’s identity provider.</p>
    <p v-if="route.query.error === 'oidc'" class="notice error m-[15px_0_0] rounded-[10px] p-[11px_13px] text-sm" role="alert">
      Sign-in did not complete. Please try again.
    </p>
    <a :href="loginURL" class="primary-button text-[white] [background:var(--accent)]">Continue to sign in</a>
  </section>
</template>
