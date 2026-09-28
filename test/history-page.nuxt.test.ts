import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { getQuery } from 'h3'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
let includeEntry = false
let holdReceiptResponse = false
let releaseReceiptResponse: (() => void) | undefined
const entry = {
  id: '23', purchasedOn: '2026-09-26', item: 'Apples', category: null, location: 'Test Store', size: '1', unit: 'lb',
  price: '2.00', costPerUnit: '2.00', saleItem: false, nonGrocery: false, notes: null,
  previousPrice: null, previousCostPerUnit: null, previousPurchasedOn: null, priceChangePercent: null, comparisonBasis: null
}

beforeEach(() => {
  includeReceipt = false
  includeEntry = false
  holdReceiptResponse = false
  releaseReceiptResponse = undefined
  registerEndpoint('/api/auth/config', () => ({ enabled: false }))
  registerEndpoint('/api/entries', () => ({ entries: includeEntry ? [entry] : [], total: includeEntry ? 1 : 0 }))
  registerEndpoint('/api/receipts/dates', () => ({ dates: [{ date: '2026-09-26', receiptCount: 1, itemCount: 0 }] }))
  registerEndpoint('/api/stores', () => [])
  registerEndpoint('/api/categories', () => [])
  registerEndpoint('/api/receipts', async (event) => {
    const query = getQuery(event)
    if (holdReceiptResponse && query.date === '2026-09-25') {
      await new Promise<void>(resolve => { releaseReceiptResponse = resolve })
    }
    const receipts = includeReceipt && (query.date === '2026-09-26' || query.summary === 'true')
      ? [{ id: '17', purchasedOn: '2026-09-26', location: 'Test Store', total: '0.00', itemCount: 0, entries: [] }]
      : []
    return { receipts, total: receipts.length }
  })
})

afterEach(async () => {
  mounted.splice(0).forEach(wrapper => wrapper.unmount())
  releaseReceiptResponse?.()
  releaseReceiptResponse = undefined
  vi.useRealTimers()
  await flushPromises()
})

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

  it('waits 150ms before showing the receipt loading message', async () => {
    const wrapper = await mountBrowser('/?date=2026-09-26')
    vi.useFakeTimers()
    holdReceiptResponse = true
    await wrapper.findAll('.receipt-calendar button').find(button => button.text() === '25')!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).not.toContain('Gathering receipts…')
    await vi.advanceTimersByTimeAsync(149)
    expect(wrapper.text()).not.toContain('Gathering receipts…')
    await vi.advanceTimersByTimeAsync(1)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Gathering receipts…')

    vi.useRealTimers()
    releaseReceiptResponse?.()
    await flushPromises()
    await new Promise(resolve => setTimeout(resolve, 0))
    await flushPromises()
    expect(wrapper.text()).not.toContain('Gathering receipts…')
  })

  it('focuses a receipt row on click and opens its editor on double-click', async () => {
    includeReceipt = true
    const wrapper = await mountBrowser('/history/receipts/list')
    const row = wrapper.find('.receipt-list tbody tr')
    expect(row.attributes('tabindex')).toBe('0')
    const focus = vi.spyOn(row.element, 'focus')
    await row.trigger('click')
    expect(focus).toHaveBeenCalledOnce()
    const push = vi.spyOn(wrapper.vm.$router, 'push')
    await wrapper.find('.receipt-list tbody tr').trigger('dblclick')
    await flushPromises()
    expect(push).toHaveBeenCalledWith('/receipts/17')
    expect(wrapper.find('a[aria-label="Edit Test Store receipt from Sep 26, 2026"]').exists()).toBe(true)
  })

  it('focuses an item entry row on click and opens its editor on double-click', async () => {
    includeEntry = true
    const wrapper = await mountBrowser('/history/entries')
    const row = wrapper.find('.history-table tbody tr')
    expect(row.attributes('tabindex')).toBe('0')
    const focus = vi.spyOn(row.element, 'focus')
    await row.trigger('click')
    expect(focus).toHaveBeenCalledOnce()
    await wrapper.find('.history-table tbody tr').trigger('dblclick')
    await flushPromises()
    expect(document.querySelector('.edit-dialog')).not.toBeNull()
    expect((document.getElementById('edit-item') as HTMLInputElement).value).toBe('Apples')
    expect(document.getElementById('edit-notes')?.getAttribute('maxlength')).toBe('100')
    expect(document.getElementById('edit-notes-character-count')?.textContent).toBe('0/100')
  })
})
