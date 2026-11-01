import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { beforeEach, expect, it } from 'vitest'
import ManagePage from '../app/components/ManagePage.vue'
import { clearNuxtData } from '#imports'

const Slot = defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) })

const importHeading = 'Import purchases'
const importCopy = 'Add purchases from a CSV or XLSX file that uses the template or a Receipt Box export. Purchases are added to what\'s already here and aren\'t checked for duplicates, so importing a file twice adds them twice. Categories in the file replace an item\'s current category, and a blank category clears it.'

beforeEach(() => {
  clearNuxtData()
  registerEndpoint('/api/_auth/session', () => ({ user: { sub: 'user-1' } }))
  registerEndpoint('/api/auth/config', () => ({ enabled: false }))
  registerEndpoint('/api/stores', () => [])
  registerEndpoint('/api/mealie/status', () => ({ configured: false }))
})

async function mountTransfer() {
  const wrapper = await mountSuspended(ManagePage, {
    route: '/data/transfer',
    global: { stubs: { UCard: Slot, UButton: true, UAlert: true, UIcon: true } }
  })
  await flushPromises()
  return wrapper
}

it('titles the import section Import purchases and describes what it adds', async () => {
  const wrapper = await mountTransfer()
  const section = wrapper.get('section[aria-label="Import and export tools"]')
  expect(section.get('h2').text()).toBe(importHeading)
  expect(section.get('p').text()).toBe(importCopy)
  expect(wrapper.text()).not.toContain('Import spreadsheet')
  wrapper.unmount()
})
