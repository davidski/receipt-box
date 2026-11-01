import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { beforeEach, expect, it } from 'vitest'
import { createError } from 'h3'
import ManagePage from '../app/components/ManagePage.vue'
import { clearNuxtData } from '#imports'

const Slot = defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) })
const Button = defineComponent({
  props: { label: String, disabled: Boolean },
  setup: (props, { attrs }) => () => h('button', { ...attrs, disabled: props.disabled }, props.label)
})

const mealieCopy = 'Permanently delete your receipts, purchases, stores, categories, saved recipes, and Mealie food mappings. This can\'t be undone. Your preferences and the food list synced from Mealie are kept.'
const notConfiguredCopy = 'Permanently delete your receipts, purchases, stores, categories, and saved recipes. This can\'t be undone. Your preferences are kept.'

beforeEach(() => {
  clearNuxtData()
  registerEndpoint('/api/_auth/session', () => ({ user: { sub: 'user-1' } }))
  registerEndpoint('/api/auth/config', () => ({ enabled: false }))
  registerEndpoint('/api/stores', () => [])
})

async function mountMaintenance(mealieStatus: () => unknown) {
  registerEndpoint('/api/mealie/status', mealieStatus)
  const wrapper = await mountSuspended(ManagePage, {
    route: '/data/maintenance',
    global: { stubs: { UCard: Slot, UButton: Button, UAlert: true, UIcon: true } }
  })
  await flushPromises()
  return wrapper
}

const resetCopy = (wrapper: Awaited<ReturnType<typeof mountMaintenance>>) => wrapper.get('section[aria-label="Maintenance tools"] p').text()

it('describes the Mealie food mappings in the reset copy when Mealie is configured', async () => {
  const wrapper = await mountMaintenance(() => ({ configured: true }))
  expect(resetCopy(wrapper)).toBe(mealieCopy)
  wrapper.unmount()
})

it('keeps the reset copy as Mealie wording while the confirmation is open', async () => {
  const wrapper = await mountMaintenance(() => ({ configured: true }))
  wrapper.findAll('button').find(button => button.text() === 'Reset database')!.trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('Type RESET to confirm')
  expect(resetCopy(wrapper)).toBe(mealieCopy)
  expect(wrapper.findAll('button').find(button => button.text() === 'Permanently reset database')!.attributes('disabled')).toBeDefined()
  wrapper.unmount()
})

it('uses the not-configured reset copy when Mealie is not configured', async () => {
  const wrapper = await mountMaintenance(() => ({ configured: false }))
  expect(resetCopy(wrapper)).toBe(notConfiguredCopy)
  expect(wrapper.text()).not.toContain('Mealie')
  wrapper.unmount()
})

it('uses the not-configured reset copy when the Mealie status read fails', async () => {
  const wrapper = await mountMaintenance(() => {
    throw createError({ statusCode: 500, statusMessage: 'Mealie unavailable' })
  })
  expect(resetCopy(wrapper)).toBe(notConfiguredCopy)
  expect(wrapper.text()).not.toContain('Mealie food mappings')
  wrapper.unmount()
})
