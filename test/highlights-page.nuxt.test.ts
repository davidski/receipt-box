import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

  it('leads with the latest price index unboxed and drops the stat tiles and eyebrows', async () => {
    reply = () => ({
      ...highlights([{ month: '2026-08-01', totalSpent: 400.5 }, { month: '2026-09-01', totalSpent: 800 }]),
      priceIndex: [
        { month: '2026-07-01', value: 100, matchedItems: 3 },
        { month: '2026-08-01', value: 101.5, matchedItems: 3 },
        { month: '2026-09-01', value: 104.25, matchedItems: 4 }
      ]
    })
    const wrapper = await mountPage()

    expect(wrapper.get('[data-index-hero]').text()).toBe('104.3')
    expect(wrapper.get('#price-index-heading').text()).toBe('Regular purchase price index')
    // No Nuxt UI cards and no uppercase eyebrows remain; sections are separated by rules instead.
    expect(wrapper.findAll('[data-slot="root"]').filter(node => node.classes().includes('rounded-lg'))).toHaveLength(0)
    expect(wrapper.findAll('p').filter(node => node.classes().includes('uppercase'))).toHaveLength(0)
    const spend = wrapper.findAll('p').find(node => node.text().startsWith('You spent'))!
    expect(spend.text()).toBe('You spent $1,200.50 across 4 receipts and 6 unique items.')
    expect(spend.find('.text-cents').text()).toBe('.50')
  })

  it('omits the hero figure when the index has fewer than two months', async () => {
    reply = () => ({ ...highlights([]), priceIndex: [{ month: '2026-09-01', value: 100, matchedItems: 3 }] })
    const wrapper = await mountPage()

    expect(wrapper.find('[data-index-hero]').exists()).toBe(false)
    expect(wrapper.text()).toContain('At least three matched regular items')
    expect(wrapper.findAll('p').find(node => node.text().startsWith('You spent'))!.text()).toContain('$0')
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

  it('keeps the unit-cost impact left-aligned on phones and right-aligned from sm up', async () => {
    reply = () => highlights([{ month: '2026-09-01', totalSpent: 100 }])
    const wrapper = await mountPage()
    const impact = wrapper.get('.shrinkflation-impact')

    expect(impact.classes()).not.toContain('justify-end')
    expect(impact.classes()).toContain('sm:justify-end')
    expect(impact.classes()).toContain('max-sm:grid-cols-[minmax(0,1fr)]')
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

  it('shows a spend move that rounds away as a flat chip, and an exact zero as "No change"', async () => {
    reply = () => ({
      ...highlights([{ month: '2026-09-01', totalSpent: 100 }]),
      spendChanges: [{ month: '2026-09-01', totalSpent: 100, change: 0.4, priceEffect: -0.2, basketEffect: 0, matchedItems: 4 }]
    })
    const wrapper = await mountPage()
    const cells = wrapper.get('.spend-explanation').findAll('div').slice(1)

    expect(cells.map(cell => cell.get('[data-figure]').text())).toEqual(['$0', '$0', 'No change'])
    expect(cells.map(cell => cell.find('.sr-only').exists() ? cell.get('.sr-only').text() : null)).toEqual(['flat, $0', 'flat, $0', null])
    for (const cell of cells) expect(cell.get('span').classes()).toEqual(expect.arrayContaining(['text-xs', 'text-muted']))
  })

  describe('chart point selection', () => {
    const months = [{ month: '2026-08-01', totalSpent: 410 }, { month: '2026-09-01', totalSpent: 1230 }]
    const index = [
      { month: '2026-07-01', value: 100, matchedItems: 3 },
      { month: '2026-08-01', value: null, matchedItems: 0 },
      { month: '2026-09-01', value: 103.2, matchedItems: 4 },
      { month: '2026-10-01', value: 104.5, matchedItems: 1 }
    ]
    const indexMarks = (wrapper: Awaited<ReturnType<typeof mountPage>>) => wrapper.get('svg[aria-label^="Same-item"]').findAll('g[role="button"]')
    const spendBars = (wrapper: Awaited<ReturnType<typeof mountPage>>) => wrapper.get('svg[aria-label="Total purchase dollars by month"]').findAll('g[role="button"]')
    const readout = (wrapper: Awaited<ReturnType<typeof mountPage>>) => wrapper.find('[data-index-readout]')
    const spendMonth = (wrapper: Awaited<ReturnType<typeof mountPage>>) => wrapper.get('.spend-explanation strong').text()
    const withCharts = () => {
      reply = () => ({
        ...highlights(months),
        priceIndex: index,
        spendChanges: [
          { month: '2026-08-01', totalSpent: 410, change: null, priceEffect: null, basketEffect: null, matchedItems: 0 },
          { month: '2026-09-01', totalSpent: 1230, change: 200, priceEffect: 3, basketEffect: 197, matchedItems: 4 }
        ]
      })
    }

    it('spaces price-index month labels so none touch, and always labels the first and latest month', async () => {
      const twelve = Array.from({ length: 12 }, (_, i) => ({
        month: `${new Date(Date.UTC(2025, 10 + i, 1)).toISOString().slice(0, 7)}-01`,
        value: 100 + i,
        matchedItems: 3
      }))
      reply = () => ({ ...highlights(months), priceIndex: twelve })
      const wrapper = await mountPage()
      const labels = wrapper.get('svg[aria-label^="Same-item"]').findAll('text').filter(text => /^[A-Z][a-z]{2} \d{2}$/.test(text.text()))
      const xs = labels.map(text => Number(text.attributes('x')))

      expect(labels[0]!.text()).toBe('Nov 25')
      expect(labels.at(-1)!.text()).toBe('Oct 26')
      for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(64)
    })

    it('has no SVG title tooltips, which only show on mouse hover', async () => {
      withCharts()
      const wrapper = await mountPage()
      expect(wrapper.find('svg title').exists()).toBe(false)
    })

    it('selects an index point on hover, focus, click, and keyboard, and skips months with no value', async () => {
      withCharts()
      const wrapper = await mountPage()
      const marks = indexMarks(wrapper)
      // The August gap has no value, so it draws no point and gets no Tab stop.
      expect(marks).toHaveLength(3)
      expect(readout(wrapper).exists()).toBe(false)
      expect(marks.map(mark => mark.attributes('tabindex'))).toEqual(['0', '0', '0'])
      expect(marks[0]!.attributes('aria-label')).toBe('July 2026: index 100.0, 3 matched items')

      await marks[0]!.trigger('pointerenter')
      expect(readout(wrapper).text()).toContain('100.0')
      expect(readout(wrapper).text()).toContain('July 2026')

      await marks[1]!.trigger('focus')
      expect(readout(wrapper).text()).toContain('103.2')
      expect(readout(wrapper).text()).toContain('4 matched items')

      await marks[2]!.trigger('click')
      expect(readout(wrapper).text()).toContain('1 matched item')
      expect(readout(wrapper).text()).not.toContain('items')

      await marks[0]!.trigger('keydown', { key: 'Enter' })
      expect(readout(wrapper).text()).toContain('July 2026')
      await marks[1]!.trigger('keydown', { key: ' ' })
      expect(readout(wrapper).text()).toContain('September 2026')
    })

    it('dismisses the index readout with Escape, ignores other keys, and clears it when the period changes', async () => {
      withCharts()
      const wrapper = await mountPage()
      await indexMarks(wrapper)[0]!.trigger('click')
      expect(readout(wrapper).exists()).toBe(true)

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
      await flushPromises()
      expect(readout(wrapper).exists()).toBe(true)

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await flushPromises()
      expect(readout(wrapper).exists()).toBe(false)

      await indexMarks(wrapper)[0]!.trigger('click')
      expect(readout(wrapper).exists()).toBe(true)
      await wrapper.getComponent({ name: 'USelect' }).vm.$emit('update:modelValue', 'all')
      await flushPromises()
      expect(readout(wrapper).exists()).toBe(false)
    })

    it('selects a spend month on hover and focus, and Escape returns to the latest month', async () => {
      withCharts()
      const wrapper = await mountPage()
      const bars = spendBars(wrapper)
      expect(bars).toHaveLength(2)
      expect(spendMonth(wrapper)).toBe('September 2026')

      await bars[0]!.trigger('pointerenter')
      expect(spendMonth(wrapper)).toBe('August 2026')
      await bars[1]!.trigger('focus')
      expect(spendMonth(wrapper)).toBe('September 2026')
      await bars[0]!.trigger('click')
      expect(spendMonth(wrapper)).toBe('August 2026')

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await flushPromises()
      expect(spendMonth(wrapper)).toBe('September 2026')
    })

    it('gives a month with no spending no Tab stop and no hover selection', async () => {
      reply = () => ({
        ...highlights([{ month: '2026-07-01', totalSpent: 0 }, { month: '2026-08-01', totalSpent: 410 }, { month: '2026-09-01', totalSpent: 1230 }]),
        spendChanges: [{ month: '2026-09-01', totalSpent: 1230, change: 200, priceEffect: 3, basketEffect: 197, matchedItems: 4 }]
      })
      const wrapper = await mountPage()
      const svg = wrapper.get('svg[aria-label="Total purchase dollars by month"]')

      // Only the two months with spending are buttons; the empty month keeps its axis label.
      expect(spendBars(wrapper)).toHaveLength(2)
      expect(spendBars(wrapper).map(bar => bar.attributes('aria-label'))).toEqual(['August 2026: $410', 'September 2026: $1,230'])
      expect(svg.findAll('[tabindex]')).toHaveLength(2)
      expect(svg.text()).toContain('Jul 26')

      await svg.findAll('g').find(group => group.text() === 'Jul 26')!.trigger('pointerenter')
      expect(spendMonth(wrapper)).toBe('September 2026')
    })

    it('removes the shared Escape listener when the page unmounts', async () => {
      const add = vi.spyOn(window, 'addEventListener')
      const remove = vi.spyOn(window, 'removeEventListener')
      withCharts()
      const wrapper = await mountPage()
      const handler = add.mock.calls.find(([type]) => type === 'keydown')?.[1]
      expect(handler).toBeTypeOf('function')
      expect(remove).not.toHaveBeenCalledWith('keydown', handler)

      wrapper.unmount()
      mounted.splice(0)
      expect(remove).toHaveBeenCalledWith('keydown', handler)
      vi.restoreAllMocks()
    })
  })
})
