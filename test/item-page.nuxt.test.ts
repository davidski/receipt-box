import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ItemPage from '../app/pages/items/[item].vue'

const mounted: Array<{ unmount: () => void }> = []
let entries: Array<Record<string, unknown>>

const purchase = (id: string, purchasedOn: string, price: string, saleItem = false) => ({
  id, purchasedOn, item: 'Whole Milk', location: 'Test Mart', size: '1', unit: 'gal', price, costPerUnit: null, saleItem
})

beforeEach(() => {
  entries = [purchase('1', '2026-01-10', '3.50'), purchase('2', '2026-02-10', '3.80', true), purchase('3', '2026-03-10', '4.25')]
  registerEndpoint('/api/auth/config', () => ({ enabled: false }))
  registerEndpoint('/api/items/history', () => ({ item: 'Whole Milk', entries }))
})

afterEach(() => {
  mounted.splice(0).forEach(wrapper => wrapper.unmount())
})

async function mountPage() {
  const wrapper = await mountSuspended(ItemPage, { route: '/items/whole-milk', attachTo: document.body })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}

const points = (wrapper: Awaited<ReturnType<typeof mountPage>>) => wrapper.findAll('svg g[role="button"]')
const panel = (wrapper: Awaited<ReturnType<typeof mountPage>>) => wrapper.find('[aria-live="polite"]')

describe('Item price history page', () => {
  it('describes the purchases table with a caption and column scopes', async () => {
    const wrapper = await mountPage()
    const table = wrapper.get('table')

    expect(table.get('caption').text()).toContain('Purchases of Whole Milk')
    const headers = table.findAll('thead th')
    expect(headers).toHaveLength(6)
    headers.forEach(header => expect(header.attributes('scope')).toBe('col'))
    expect(table.findAll('tbody tr')).toHaveLength(3)
    // Newest first, with prices formatted by the shared money helper.
    expect(table.findAll('tbody tr')[0]!.text()).toContain('$4.25')
  })

  it('selects a point on hover, focus, click, and keyboard, with no SVG title tooltips', async () => {
    const wrapper = await mountPage()
    const marks = points(wrapper)
    expect(marks).toHaveLength(3)
    expect(wrapper.find('svg title').exists()).toBe(false)
    expect(panel(wrapper).exists()).toBe(false)

    await marks[0]!.trigger('pointerenter')
    expect(panel(wrapper).text()).toContain('Test Mart')

    await marks[1]!.trigger('focus')
    expect(panel(wrapper).text()).toContain('Sale')

    await marks[2]!.trigger('click')
    expect(panel(wrapper).text()).not.toContain('Sale')

    await marks[1]!.trigger('keydown', { key: 'Enter' })
    expect(panel(wrapper).text()).toContain('Sale')
    await marks[2]!.trigger('keydown', { key: ' ' })
    expect(panel(wrapper).text()).not.toContain('Sale')
  })

  it('dismisses the selected point with Escape and ignores other keys', async () => {
    const wrapper = await mountPage()
    await points(wrapper)[1]!.trigger('click')
    expect(panel(wrapper).exists()).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    await flushPromises()
    expect(panel(wrapper).exists()).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(panel(wrapper).exists()).toBe(false)
  })

  it('stops listening for Escape after the page unmounts', async () => {
    const wrapper = await mountPage()
    wrapper.unmount()
    mounted.splice(0)
    expect(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))).not.toThrow()
  })

  it('shows an empty state instead of a trend line for a single purchase', async () => {
    entries = [purchase('1', '2026-01-10', '3.50')]
    const wrapper = await mountPage()

    expect(wrapper.text()).toContain('Add another comparable purchase')
    expect(points(wrapper)).toHaveLength(0)
    expect(wrapper.get('table').findAll('tbody tr')).toHaveLength(1)
  })
})
