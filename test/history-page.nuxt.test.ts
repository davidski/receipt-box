import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { getQuery } from 'h3'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import HistoryPage from '../app/components/HistoryPage.vue'

const UButton = defineComponent({
  inheritAttrs: false,
  props: { to: [String, Object], label: String, disabled: Boolean },
  setup(props, { attrs }) {
    return () => {
      const to = props.to as string | { path: string, query?: Record<string, string> } | undefined
      const href = typeof to === 'string' ? to : to ? `${to.path}${to.query ? `?${new URLSearchParams(to.query)}` : ''}` : undefined
      return h(href ? 'a' : 'button', { ...attrs, href, disabled: props.disabled }, props.label)
    }
  }
})
const UIcon = defineComponent({ setup: () => () => h('span') })
const mounted: Array<{ unmount: () => void }> = []
let includeReceipt = false

beforeEach(() => {
  includeReceipt = false
  registerEndpoint('/api/auth/config', () => ({ enabled: false }))
  registerEndpoint('/api/entries', () => ({ entries: [], total: 0 }))
  registerEndpoint('/api/receipts/dates', () => ({ dates: [{ date: '2026-09-26', receiptCount: 1, itemCount: 0 }] }))
  registerEndpoint('/api/stores', () => [])
  registerEndpoint('/api/categories', () => [])
  registerEndpoint('/api/receipts', (event) => {
    const receipts = includeReceipt && getQuery(event).date === '2026-09-26'
      ? [{ id: '17', purchasedOn: '2026-09-26', location: 'Test Store', total: '0.00', itemCount: 0, entries: [] }]
      : []
    return { receipts, total: receipts.length }
  })
})

afterEach(() => mounted.splice(0).forEach(wrapper => wrapper.unmount()))

async function mountBrowser(route = '/') {
  const wrapper = await mountSuspended(HistoryPage, { route, global: { stubs: { UButton, UIcon } } })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}

describe('Receipts home', () => {
  it('starts on today and offers Add when that day is empty', async () => {
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const wrapper = await mountBrowser()
    const add = wrapper.findAll('a').find(link => link.text() === 'Add receipt')!
    expect(add.attributes('href')).toBe(`/receipts/new?date=${today}`)
    expect(wrapper.find('.receipt-calendar button[aria-pressed="true"]').exists()).toBe(true)
    expect(wrapper.find('.receipt-empty-state').text()).toContain('No receipts for this date')
  })

  it('keeps same-day Add available and edits the receipt by ID', async () => {
    includeReceipt = true
    const wrapper = await mountBrowser('/?date=2026-09-26')
    expect(wrapper.findAll('a').find(link => link.text() === 'Add receipt')!.attributes('href')).toBe('/receipts/new?date=2026-09-26')
    expect(wrapper.findAll('a').find(link => link.text() === 'Edit receipt')!.attributes('href')).toBe('/receipts/17')
  })

  it('selects an empty day without snapping back to an existing receipt', async () => {
    includeReceipt = true
    const wrapper = await mountBrowser('/?date=2026-09-26')
    const day = wrapper.findAll('.receipt-calendar button').find(button => button.text() === '25')!
    expect(day.attributes('disabled')).toBeUndefined()
    await day.trigger('click')
    await flushPromises()
    expect(day.attributes('aria-pressed')).toBe('true')
    expect(wrapper.findAll('a').find(link => link.text() === 'Add receipt')!.attributes('href')).toBe('/receipts/new?date=2026-09-25')
    expect(wrapper.find('.receipt-empty-state').text()).toContain('No receipts for this date')
    const newer = wrapper.findAll('button').find(button => button.text() === 'Newer')!
    expect(newer.attributes('disabled')).toBeUndefined()
    await newer.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('a').find(link => link.text() === 'Edit receipt')!.attributes('href')).toBe('/receipts/17')
  })
})
