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
const highlights = (monthlySpend: { month: string, totalSpent: number }[]) => ({
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
  shrinkflation: [shrink]
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

  it('keeps aria-sort on the sortable shrinkflation headers', async () => {
    reply = () => highlights([{ month: '2026-09-01', totalSpent: 100 }])
    const wrapper = await mountPage()
    const headers = wrapper.findAll('table')[1]!.findAll('th')

    expect(headers.map(header => header.attributes('aria-sort'))).toEqual(['none', 'none', 'none', 'descending'])
    await headers[0]!.get('button').trigger('click')
    expect(wrapper.findAll('table')[1]!.findAll('th')[0]!.attributes('aria-sort')).toBe('ascending')
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
})
