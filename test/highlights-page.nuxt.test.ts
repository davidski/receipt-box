import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import HighlightsPage from '../app/pages/highlights.vue'

const mover = {
  id: '1', purchasedOn: '2026-09-20', item: 'Whole milk', location: 'Corner Market', size: '1', unit: 'gal', price: '4.50', saleItem: false,
  previousPurchasedOn: '2026-08-20', previousLocation: 'Big Grocer', priceChangePercent: '12', comparisonBasis: 'normalized'
}
const coreItem = {
  name: 'Whole milk', purchases: 5, activeMonths: 4, averageDaysBetween: 14, lastPurchasedOn: '2026-09-20', priceObservations: 5,
  averageChangePercent: 2, netChangePercent: 4, stability: 'stable', trend: 'up', priceSeries: [4, 4.2, 4.5]
}
const shrink = {
  item: 'Cereal', previousPurchasedOn: '2026-07-01', purchasedOn: '2026-09-01', previousSize: 16, size: 14, unit: 'oz', previousPrice: 4, price: 4,
  previousUnitPrice: 0.25, unitPrice: 0.29, unitPriceLabel: 'per oz', sizeChangePercent: -12.5, unitCostChangePercent: 14
}
const crackers = { ...shrink, item: 'Crackers', previousPrice: 4, price: 4.5, sizeChangePercent: -5, unitCostChangePercent: 40 }
const highlights = (monthlySpend: { month: string, totalSpent: number }[], shrinkflation = [shrink]) => ({
  availableYears: [2026],
  reportingPeriod: null,
  summary: { entries: 10, receipts: 4, items: 6, stores: 2, firstDate: '2026-07-01', lastDate: '2026-09-20' },
  movers: [mover],
  topStores: [],
  coreItems: [coreItem],
  monthlySpend,
  priceIndex: [],
  categoryPriceChanges: [],
  spendChanges: [],
  shrinkflation
})

const mounted: Array<{ unmount: () => void }> = []
let reply: () => unknown

beforeEach(() => {
  registerEndpoint('/api/auth/config', () => ({ enabled: false }))
  registerEndpoint('/api/highlights', () => reply())
})

afterEach(() => {
  mounted.splice(0).forEach(wrapper => wrapper.unmount())
})

async function mountPage() {
  const wrapper = await mountSuspended(HighlightsPage, { route: '/highlights', attachTo: document.body })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}

describe('Highlights page', () => {
  it('gives every table a caption and column-scoped headers', async () => {
    reply = () => highlights([{ month: '2026-09-01', totalSpent: 100 }])
    const wrapper = await mountPage()
    const tables = wrapper.findAll('table')

    expect(tables).toHaveLength(3)
    for (const table of tables) {
      expect(table.find('caption').text()).not.toBe('')
      const headers = table.findAll('th')
      expect(headers.length).toBeGreaterThan(0)
      for (const header of headers) expect(header.attributes('scope')).toBe('col')
    }
  })

  it('renders each panel and tile as its own card with the card radius winning over Nuxt UI', async () => {
    reply = () => highlights([{ month: '2026-09-01', totalSpent: 100 }])
    const wrapper = await mountPage()
    // Nuxt UI's card root ships rounded-lg and tailwind-merge cannot replace it with rounded-card, so the token is forced.
    const cards = wrapper.findAll('[data-slot="root"]').filter(node => node.classes().includes('rounded-lg'))

    expect(cards).toHaveLength(10)
    for (const card of cards) expect(card.classes()).toContain('rounded-card!')
    const card = (heading: string) => cards.find(node => node.findAll('h2').some(h2 => h2.text() === heading))
    expect(card('Category price movement')).toBeDefined()
    expect(card('Purchases by month')).toBeDefined()
    expect(card('Category price movement')!.element).not.toBe(card('Purchases by month')!.element)
  })

  it('keeps the gap under each panel eyebrow despite the global h2 margin reset', async () => {
    reply = () => highlights([{ month: '2026-09-01', totalSpent: 100 }])
    const wrapper = await mountPage()
    const headings = wrapper.findAll('h2').filter(h2 => ['Regular purchase price index', 'Category price movement', 'Purchases by month'].includes(h2.text()))

    expect(headings).toHaveLength(3)
    for (const heading of headings) expect(heading.classes()).toContain('mt-1!')
  })

  it('keeps aria-sort on the sortable shrinkflation headers', async () => {
    reply = () => highlights([{ month: '2026-09-01', totalSpent: 100 }])
    const wrapper = await mountPage()
    const headers = wrapper.findAll('table')[1]!.findAll('th')

    expect(headers.map(header => header.attributes('aria-sort'))).toEqual(['none', 'none', 'none', 'descending'])
    await headers[0]!.get('button').trigger('click')
    expect(wrapper.findAll('table')[1]!.findAll('th')[0]!.attributes('aria-sort')).toBe('ascending')
  })

  it('sorts shrinkflation by impact first, then by any column, and reverses on a second click', async () => {
    reply = () => highlights([{ month: '2026-09-01', totalSpent: 100 }], [shrink, crackers])
    const wrapper = await mountPage()
    const table = () => wrapper.findAll('table')[1]!
    const items = () => table().findAll('td[data-label="Item"] strong').map(cell => cell.text())
    const sortBy = (column: string) => table().findAll('th button').find(button => button.text().includes(column))!.trigger('click')

    expect(items()).toEqual(['Crackers', 'Cereal'])
    await sortBy('Item')
    expect(items()).toEqual(['Cereal', 'Crackers'])
    await sortBy('Item')
    expect(items()).toEqual(['Crackers', 'Cereal'])
    await sortBy('Package')
    expect(items()).toEqual(['Crackers', 'Cereal'])
    await sortBy('Package')
    expect(items()).toEqual(['Cereal', 'Crackers'])
    await sortBy('price')
    expect(items()).toEqual(['Crackers', 'Cereal'])
    await sortBy('impact')
    expect(items()).toEqual(['Crackers', 'Cereal'])
    await sortBy('impact')
    expect(items()).toEqual(['Cereal', 'Crackers'])
  })

  it('draws monthly spend on a pretty scale that starts at zero and covers the tallest bar', async () => {
    reply = () => highlights([{ month: '2026-08-01', totalSpent: 410 }, { month: '2026-09-01', totalSpent: 1230 }])
    const wrapper = await mountPage()
    const labels = wrapper.get('svg[aria-label="Total purchase dollars by month"]').findAll('line + text').map(text => text.text())

    expect(labels).toEqual(['$1,500', '$1,000', '$500', '$0'])
  })

  it('keeps the zero baseline when a period has no spending', async () => {
    reply = () => highlights([{ month: '2026-09-01', totalSpent: 0 }])
    const wrapper = await mountPage()
    const labels = wrapper.get('svg[aria-label="Total purchase dollars by month"]').findAll('line + text').map(text => text.text())

    expect(labels).toEqual(['$1', '$0'])
  })

  it('shows every price movement with the shared glyph, color, true minus, and spoken direction', async () => {
    reply = () => ({
      ...highlights([{ month: '2026-09-01', totalSpent: 100 }]),
      movers: [mover, { ...mover, id: '2', item: 'Butter', priceChangePercent: '-8' }],
      coreItems: [coreItem, { ...coreItem, name: 'Rice', netChangePercent: 1.2, trend: 'flat' }, { ...coreItem, name: 'Salt', netChangePercent: null, trend: 'unknown' }],
      priceIndex: [{ month: '2026-08-01', value: 100, matchedItems: 3 }, { month: '2026-09-01', value: 96.5, matchedItems: 3 }],
      categoryPriceChanges: [{ category: 'Dairy', startMonth: '2026-08-01', endMonth: '2026-09-01', matchedItems: 3, change: 4.25 }],
      spendChanges: [{ month: '2026-09-01', totalSpent: 100, change: -20.4, priceEffect: 3, basketEffect: -23.4, matchedItems: 4 }]
    })
    const wrapper = await mountPage()
    const chips = wrapper.findAll('.sr-only').filter(node => /^(up|down|flat|no change|no comparison)/.test(node.text()))
    const spoken = chips.map(node => node.text())

    // Price index and spend explanation.
    expect(spoken).toContain('down 3.5%')
    expect(spoken).toContain('up 4.3%')
    expect(spoken).toEqual(expect.arrayContaining(['down $20', 'up $3', 'down $23']))
    // Recent movers, core items (including the flat and unknown cases), and shrinkflation.
    expect(spoken).toEqual(expect.arrayContaining(['up 12%', 'down 8%', 'up 4%', 'flat, +1.2%', 'no comparison', 'up 14%']))
    const html = wrapper.html()
    expect(html).toContain('i-lucide:trending-up')
    expect(html).toContain('i-lucide:trending-down')
    expect(wrapper.text()).not.toMatch(/-\d+(\.\d+)?%/)
    for (const chip of chips.filter(node => node.text().startsWith('up'))) expect(chip.element.parentElement!.className).toContain('error')
    for (const chip of chips.filter(node => node.text().startsWith('down'))) expect(chip.element.parentElement!.className).toContain('success')
  })
})
