import { readFileSync } from 'node:fs'
import typescriptParser from '@typescript-eslint/parser'
import tailwindcss from 'eslint-plugin-tailwindcss'
import vueParser from 'vue-eslint-parser'

// Keep the CSS exceptions and interaction hooks explicit; new class typos fail lint.
const cssClasses = [...new Set([...readFileSync(new URL('./app/assets/css/main.css', import.meta.url), 'utf8').matchAll(/\.([a-z][\w-]*)/g)].map(match => match[1]))]
const interactionHooks = ['app-header', 'brand', 'category-scope-hint', 'filter-bar', 'history-heading', 'item-backfill-proposed', 'item-backfill-summary', 'item-duplicate-list', 'item-package-editor', 'monthly-spend-panel', 'monthly-spend-scroll', 'movers-panel', 'price-chart-scroll', 'price-index-help', 'price-index-line', 'receipt-browser', 'receipt-line-content', 'receipt-line-number', 'receipt-store-prompt', 'selected-receipts', 'store-add', 'store-bar', 'store-name', 'store-name-label', 'store-rank-list', 'store-spend-value']

export default [
  {
    ...tailwindcss.configs.recommended,
    files: ['app/**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: { parser: typescriptParser }
    },
    settings: {
      tailwindcss: {
        cssConfigPath: './app/assets/css/main.css'
      }
    },
    rules: {
      // CSS selectors and explicit interaction hooks are validated alongside utilities.
      'tailwindcss/no-custom-classname': ['error', { whitelist: [...cssClasses, ...interactionHooks, 'i-lucide-.*'] }]
    }
  }
]
