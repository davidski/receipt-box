import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ItemPage from '../app/pages/items/[item].vue'
import { itemPath } from '../app/utils/item-path'

const mounted: Array<{ unmount: () => void }> = []
let entries: Array<Record<string, unknown>>
let historyFetches: number

const purchase = (id: string, purchasedOn: string, price: string, saleItem = false) => ({
  id, purchasedOn, item: 'Whole Milk', location: 'Test Mart', size: '1', unit: 'gal', price, costPerUnit: null, saleItem
})

beforeEach(() => {
  entries = [purchase('1', '2026-01-10', '3.50'), purchase('2', '2026-02-10', '3.80', true), purchase('3', '2026-03-10', '4.25')]
  historyFetches = 0
  registerEndpoint('/api/auth/config', () => ({ enabled: false }))
  registerEndpoint('/api/items/history', () => {
    historyFetches += 1
    return { item: 'Whole Milk', entries }
  })
})

afterEach(() => {
  mounted.splice(0).forEach(wrapper => wrapper.unmount())
})

// The page redirects a non-canonical slug, and that navigation refetches history. Mount the canonical path (what the app links to)
// so no redirect runs in the background; the redirect has its own test below.
async function mountPage(route = itemPath('Whole Milk')) {
  const wrapper = await mountSuspended(ItemPage, { route, attachTo: document.body })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}

const points = (wrapper: Awaited<ReturnType<typeof mountPage>>) => wrapper.findAll('svg g[role="button"]')
const panel = (wrapper: Awaited<ReturnType<typeof mountPage>>) => wrapper.find('[aria-live="polite"]')
const backLink = (wrapper: Awaited<ReturnType<typeof mountPage>>) => wrapper.get('header a')

describe('Item price history page', () => {
  describe('price trend', () => {
    const history = (earlier: string, recent: string) => [
      ...['05', '06', '07'].map((month, index) => purchase(`e${index}`, `2025-${month}-10`, earlier)),
      purchase('s1', '2026-05-02', '1.00', true),
      ...['06', '07', '08'].map((month, index) => purchase(`r${index}`, `2026-${month}-10`, recent))
    ]
    beforeEach(() => { vi.useFakeTimers({ now: new Date(2026, 10, 1), toFake: ['Date'] }) })
    afterEach(() => { vi.useRealTimers() })

    it('states a rise with its figures and a chip, and replaces the range', async () => {
      entries = history('4.00', '5.00')
      const wrapper = await mountPage()
      const trend = wrapper.get('[data-price-trend]')
      expect(trend.text()).toContain('Regular price is up over the past year, from $0.11 to $0.13 per 100 mL.')
      expect(trend.text()).toContain('+25%')
      expect(trend.text()).toContain('1 of 4 purchases in the last 6 months was on sale.')
      expect(wrapper.find('[data-price-range]').exists()).toBe(false)
      expect(wrapper.get('[data-latest-price]').text()).toContain('0.')
    })

    it('states a fall', async () => {
      entries = history('5.00', '4.00')
      const text = (await mountPage()).get('[data-price-trend]').text()
      expect(text).toContain('Regular price is down over the past year')
      expect(text).toContain('−20%')
    })

    it('says steady for a small move', async () => {
      entries = history('5.00', '5.05')
      const text = (await mountPage()).get('[data-price-trend]').text()
      expect(text).toContain('Regular price has held steady over the past year, at about')
      expect(text).not.toContain('Regular price is')
    })

    it('uses the plural for several sales', async () => {
      entries = [...history('4.00', '5.00'), purchase('s2', '2026-05-03', '1.00', true)]
      expect((await mountPage()).get('[data-price-trend]').text()).toContain('2 of 5 purchases in the last 6 months were on sale.')
    })

    it('falls back to the range when a period is too thin', async () => {
      const wrapper = await mountPage()
      expect(wrapper.find('[data-price-trend]').exists()).toBe(false)
      expect(wrapper.find('[data-price-range]').exists()).toBe(true)
    })
  })

  describe('dense chart', () => {
    const many = (count: number) => Array.from({ length: count }, (_, index) => purchase(String(index), new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10), index % 5 ? '3.50' : '2.00', !(index % 5)))

    it('keeps individual interactive points at the threshold', async () => {
      entries = many(40)
      const wrapper = await mountPage()
      expect(points(wrapper)).toHaveLength(40)
      expect(wrapper.find('[data-trend-line]').exists()).toBe(false)
      expect(wrapper.find('[data-trend-legend]').exists()).toBe(false)
      expect(wrapper.find('[data-trend-caption]').exists()).toBe(false)
    })

    it('draws a trend line over backgrounded marks above it, with no per-point tab stops', async () => {
      entries = many(41)
      const wrapper = await mountPage()
      expect(points(wrapper)).toHaveLength(0)
      expect(wrapper.findAll('[data-dense-mark]')).toHaveLength(41)
      expect(wrapper.findAll('[data-dense-mark] path')).toHaveLength(9)
      expect(wrapper.get('[data-trend-line]').attributes('points')!.split(' ')).toHaveLength(32)
      expect(wrapper.find('[data-trend-legend]').exists()).toBe(true)
      expect(wrapper.get('[data-trend-caption]').text()).toContain('median regular price')
      expect(wrapper.find('svg [tabindex]').exists()).toBe(false)
    })

    it.each(['pointermove', 'pointerdown'])('selects the nearest purchase on %s and dismisses on Escape', async (type) => {
      entries = many(41)
      const wrapper = await mountPage()
      await wrapper.get('[data-chart-hit]').trigger(type, { clientX: 0 })
      expect(panel(wrapper).text()).toContain('Jan 1, 2026')
      expect(wrapper.find('[data-selected-mark]').exists()).toBe(true)
      await wrapper.get('[data-chart-hit]').trigger(type, { clientX: 100000 })
      expect(panel(wrapper).text()).toContain('Feb 10, 2026')
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await flushPromises()
      expect(wrapper.find('[data-selected-mark]').exists()).toBe(false)
    })

    it('keeps the ordinary chart when almost everything is on sale', async () => {
      entries = many(41).map((entry, index) => ({ ...entry, saleItem: index > 0 }))
      const wrapper = await mountPage()
      expect(wrapper.find('[data-trend-line]').exists()).toBe(false)
      expect(points(wrapper)).toHaveLength(41)
    })
  })

  describe('purchases table limit', () => {
    const many = (count: number) => Array.from({ length: count }, (_, index) => purchase(String(index), `2026-01-${String(index + 1).padStart(2, '0')}`, '3.50'))
    const showAll = (wrapper: Awaited<ReturnType<typeof mountPage>>) => wrapper.findAll('button').find(button => button.text().startsWith('Show all'))

    it('shows every row with no button at the limit', async () => {
      entries = many(20)
      const wrapper = await mountPage()
      expect(wrapper.get('table').findAll('tbody tr')).toHaveLength(20)
      expect(showAll(wrapper)).toBeUndefined()
    })

    it('shows the newest 20 until asked for all, and keeps every point on the chart', async () => {
      entries = many(21)
      const wrapper = await mountPage()
      expect(wrapper.get('table').findAll('tbody tr')).toHaveLength(20)
      expect(wrapper.get('table tbody tr').text()).toContain('Jan 21, 2026')
      expect(points(wrapper)).toHaveLength(21)
      expect(showAll(wrapper)!.text()).toBe('Show all 21 purchases')
      await showAll(wrapper)!.trigger('click')
      expect(wrapper.get('table').findAll('tbody tr')).toHaveLength(21)
      expect(showAll(wrapper)).toBeUndefined()
    })

    it('collapses again when the comparison basis changes', async () => {
      entries = [...many(21), { ...purchase('oz', '2026-02-01', '2.00'), size: '8', unit: 'oz' }, { ...purchase('oz2', '2026-02-02', '2.00'), size: '8', unit: 'ea' }]
      const wrapper = await mountPage()
      const gal = wrapper.findAll('.series-picker button').find(button => button.text().includes('(21)'))
      if (gal) await gal.trigger('click')
      await showAll(wrapper)?.trigger('click')
      expect(wrapper.get('table').findAll('tbody tr')).toHaveLength(21)
      const other = wrapper.findAll('.series-picker button').find(button => !button.text().includes('(21)'))!
      await other.trigger('click')
      await gal!.trigger('click')
      expect(wrapper.get('table').findAll('tbody tr')).toHaveLength(20)
    })
  })

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

  it('removes its Escape listener when the page unmounts', async () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const wrapper = await mountPage()
    const handler = add.mock.calls.find(([type]) => type === 'keydown')?.[1]
    expect(handler).toBeTypeOf('function')
    expect(remove).not.toHaveBeenCalledWith('keydown', handler)

    wrapper.unmount()
    mounted.splice(0)
    expect(remove).toHaveBeenCalledWith('keydown', handler)
    vi.restoreAllMocks()
  })

  it('leads with the latest price and its range, with no stat tiles, cards or eyebrows', async () => {
    entries = [purchase('1', '2026-01-10', '3.50'), purchase('2', '2026-02-10', '2.99', true), purchase('3', '2026-03-10', '4.25')]
    const wrapper = await mountPage()

    // $4.25 a gallon is $0.11 per 100 mL.
    expect(wrapper.get('[data-latest-price]').text()).toMatch(/^\$0\.11\s*per 100 ml$/)
    expect(wrapper.get('[data-latest-price] .text-cents').text()).toBe('.11')
    expect(wrapper.get('[data-price-range]').text()).toBe('Ranged from $0.08 to $0.11 over 3 charted purchases.')
    expect(wrapper.text()).toContain('Mar 10, 2026 at Test Mart')
    expect(wrapper.findAll('[data-slot="root"]').filter(node => node.classes().includes('rounded-lg'))).toHaveLength(0)
    expect(wrapper.findAll('p').filter(node => node.classes().includes('uppercase'))).toHaveLength(0)
  })

  it('marks a latest purchase bought on sale and uses the singular for one purchase', async () => {
    entries = [purchase('1', '2026-01-10', '2.99', true)]
    const wrapper = await mountPage()

    expect(wrapper.get('section[aria-label="Latest price"]').text()).toContain('Sale')
    expect(wrapper.get('[data-price-range]').text()).toBe('Ranged from $0.08 to $0.08 over 1 charted purchase.')
  })

  it('shows an empty state instead of a trend line for a single purchase', async () => {
    entries = [purchase('1', '2026-01-10', '3.50')]
    const wrapper = await mountPage()

    expect(wrapper.text()).toContain('Add another comparable purchase')
    expect(points(wrapper)).toHaveLength(0)
    expect(wrapper.get('table').findAll('tbody tr')).toHaveLength(1)
  })

  it('offers Edit on purchases the comparison leaves out', async () => {
    const bare = (id: string, purchasedOn: string, size: string | null, unit: string | null) => ({ ...purchase(id, purchasedOn, '2.00'), size, unit })
    entries = [purchase('1', '2026-01-10', '3.50'), bare('2', '2026-02-10', null, null), bare('3', '2026-03-10', '0', 'lb'), bare('4', '2026-04-10', '2', null)]
    const wrapper = await mountPage()

    expect(wrapper.get('table').findAll('tbody tr')).toHaveLength(1)
    const section = wrapper.get('section[aria-labelledby="unpriced-heading"]')
    expect(section.get('h2').text()).toBe('Missing a package size')
    const rows = section.findAll('li')
    // Newest first, each with the same edit link the table uses.
    expect(rows.map(row => row.text())).toEqual([
      expect.stringContaining('Apr 10, 2026'),
      expect.stringContaining('Mar 10, 2026'),
      expect.stringContaining('Feb 10, 2026')
    ])
    expect(rows[2]!.text()).toContain('No size')
    expect(rows[1]!.text()).toContain('0 lb')
    expect(rows[0]!.text()).toContain('2')
    expect(rows.map(row => row.get('a').attributes('href'))).toEqual(['/history/entries?edit=4', '/history/entries?edit=3', '/history/entries?edit=2'])
    expect(rows[2]!.get('a').attributes('aria-label')).toBe('Edit Feb 10, 2026 purchase at Test Mart')
  })

  it('sets the price of each purchase missing a size in tabular figures', async () => {
    entries = [purchase('1', '2026-01-10', '3.50'), { ...purchase('2', '2026-02-10', '12.40'), size: null, unit: null }]
    const prices = (await mountPage()).get('section[aria-labelledby="unpriced-heading"]').findAll('li span span.tabular-nums')

    expect(prices.map(price => price.text())).toEqual(['$12.40'])
  })

  it('has no missing-size section when every purchase is priced', async () => {
    const wrapper = await mountPage()
    expect(wrapper.find('section[aria-labelledby="unpriced-heading"]').exists()).toBe(false)
  })

  it('redirects a non-canonical item URL to its canonical path and reloads the history', async () => {
    const wrapper = await mountPage('/items/whole-milk')

    await vi.waitFor(() => expect(wrapper.vm.$router.currentRoute.value.path).toBe(itemPath('Whole Milk')))
    await vi.waitFor(() => expect(historyFetches).toBe(2))
    await vi.waitFor(() => expect(points(wrapper)).toHaveLength(3))
  })

  it('offers Back to Mealie when opened from the Mealie list', async () => {
    const wrapper = await mountPage(`${itemPath('Whole Milk')}?from=mealie`)

    expect(backLink(wrapper).text()).toBe('Back to Mealie')
    expect(backLink(wrapper).attributes('href')).toBe('/data/mealie')
  })

  it('keeps Back to history, with the same target, for any other arrival', async () => {
    const wrapper = await mountPage()

    expect(backLink(wrapper).text()).toBe('Back to history')
    expect(backLink(wrapper).attributes('href')).toBe('/history/receipts/calendar')
  })

  it('keeps the Mealie origin through the canonical redirect', async () => {
    const wrapper = await mountPage('/items/whole-milk?from=mealie')

    await vi.waitFor(() => expect(wrapper.vm.$router.currentRoute.value.fullPath).toBe(`${itemPath('Whole Milk')}?from=mealie`))
    await vi.waitFor(() => expect(points(wrapper)).toHaveLength(3))
    expect(backLink(wrapper).text()).toBe('Back to Mealie')
    expect(backLink(wrapper).attributes('href')).toBe('/data/mealie')
  })

  it.each(['from=elsewhere', 'from=MEALIE', 'from=https%3A%2F%2Fevil.example', 'from=mealie&from=mealie'])('ignores an unknown origin (%s) for the back link and the Edit links', async (query) => {
    const wrapper = await mountPage(`${itemPath('Whole Milk')}?${query}`)

    expect(backLink(wrapper).text()).toBe('Back to history')
    expect(backLink(wrapper).attributes('href')).toBe('/history/receipts/calendar')
    expect(wrapper.get('table tbody a').attributes('href')).toBe('/history/entries?edit=3')
  })

  it('carries the Mealie origin to the Edit links, so the edit can return there', async () => {
    entries = [purchase('1', '2026-01-10', '3.50'), { ...purchase('2', '2026-02-10', '2.00'), size: null, unit: null }]
    const wrapper = await mountPage(`${itemPath('Whole Milk')}?from=mealie`)

    expect(wrapper.get('table tbody a').attributes('href')).toBe('/history/entries?edit=1&from=mealie')
    expect(wrapper.get('section[aria-labelledby="unpriced-heading"] li a').attributes('href')).toBe('/history/entries?edit=2&from=mealie')
  })
})
