const appBaseURL = process.env.NUXT_APP_BASE_URL || '/'
if (!appBaseURL.startsWith('/') || !appBaseURL.endsWith('/')) {
  throw new Error('NUXT_APP_BASE_URL must start and end with a slash (for example, /pricebook/)')
}
const defaultApiBase = `${appBaseURL === '/' ? '' : appBaseURL.replace(/\/$/, '')}/api`
const apiBase = process.env.NUXT_PUBLIC_API_BASE || defaultApiBase
const manifestURL = `${appBaseURL.replace(/\/$/, '')}/manifest.webmanifest`
const faviconURL = `${appBaseURL.replace(/\/$/, '')}/favicon.svg`
const assetRoute = `${appBaseURL === '/' ? '' : appBaseURL.replace(/\/$/, '')}/_nuxt/**`

export default defineNuxtConfig({
  compatibilityDate: '2026-08-01',
  // The browser owns all rendering and navigation. Nitro exists only for /api.
  ssr: false,
  devtools: { enabled: true },
  modules: ['@nuxt/ui'],
  fonts: {
    provider: 'local'
  },
  css: ['~/assets/css/main.css'],
  app: {
    // Static client asset and router URLs are fixed when the app is built.
    baseURL: appBaseURL,
    head: {
      title: 'Receipt Box',
      meta: [
        { name: 'description', content: 'A private receipt tracker with grocery price history.' },
        { name: 'theme-color', media: '(prefers-color-scheme: light)', content: '#f4f0e6' },
        { name: 'theme-color', media: '(prefers-color-scheme: dark)', content: '#111512' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' }
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: faviconURL },
        { rel: 'manifest', href: manifestURL },
        { rel: 'preconnect', href: 'https://fonts.bunny.net' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.bunny.net/css?family=ibm-plex-sans:600|open-sans:400,600,700&display=swap'
        }
      ]
    }
  },
  runtimeConfig: {
    // Kept empty in the build; server/utils/db.ts reads DATABASE_URL at runtime.
    databaseUrl: '',
    public: {
      appName: 'Receipt Box',
      // Browser-visible and therefore also embedded in the static client build.
      apiBase
    }
  },
  routeRules: {
    '/api/**': { headers: { 'cache-control': 'no-store' } },
    [assetRoute]: { headers: { 'cache-control': 'public, max-age=31536000, immutable' } }
  },
  nitro: {
    preset: process.env.NITRO_PRESET || 'node-server',
    compressPublicAssets: true,
    prerender: {
      crawlLinks: false,
      routes: ['/', '/highlights', '/history', '/data']
    }
  },
  typescript: {
    strict: true,
    typeCheck: false
  }
})
