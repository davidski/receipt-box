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
let deletedEntries: string[]
let includeEntry = false
let withoutNormalizedPrice = false
let priceChangePercent: string | null = null
let holdReceiptResponse = false
let releaseReceiptResponse: (() => void) | undefined
const entry = {
  id: '23', purchasedOn: '2026-09-26', item: 'Apples', category: null, location: 'Test Store', size: '1', unit: 'lb',
  price: '2.00', costPerUnit: '2.00', saleItem: false, nonGrocery: false, notes: null,
  previousPrice: null, previousCostPerUnit: null, previousPurchasedOn: null, priceChangePercent: null, comparisonBasis: null
}

beforeEach(() => {
  includeReceipt = false
  deletedEntries = []
  includeEntry = false
  withoutNormalizedPrice = false
  priceChangePercent = null
  holdReceiptResponse = false
  releaseReceiptResponse = undefined
  registerEndpoint('/api/auth/config', () => ({ enabled: false }))
  registerEndpoint('/api/entries', () => ({ entries: includeEntry ? [{ ...entry, costPerUnit: withoutNormalizedPrice ? null : entry.costPerUnit, priceChangePercent, comparisonBasis: priceChangePercent === null ? null : 'package' }] : [], total: includeEntry ? 1 : 0 }))
  registerEndpoint('/api/receipts/dates', () => ({ dates: [{ date: '2026-09-26', receiptCount: 1, itemCount: 0 }] }))
  registerEndpoint('/api/stores', () => [])
  registerEndpoint('/api/entries/23', { method: 'DELETE', handler: () => { deletedEntries.push('23'); return null } })
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

type Wrapper = Awaited<ReturnType<typeof mountBrowser>>
const table = (wrapper: Wrapper, caption: string) => wrapper.findAll('table').find(candidate => candidate.find('caption').text() === caption)!
const calendar = (wrapper: Wrapper) => table(wrapper, 'Choose any calendar date')
const receiptList = (wrapper: Wrapper) => table(wrapper, 'Receipt date, store, and total')
const entryTable = (wrapper: Wrapper) => table(wrapper, 'Purchase entries')

async function mountBrowser(route = '/', attachTo?: HTMLElement) {
  const wrapper = await mountSuspended(HistoryPage, { route, attachTo, global: { stubs: { UButton, UIcon } } })
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
    expect(calendar(wrapper).find('button[aria-pressed="true"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('No receipts for this date.')
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
    const day = calendar(wrapper).findAll('button').find(button => button.text() === '25')!
    expect(day.attributes('disabled')).toBeUndefined()
    await day.trigger('click')
    await flushPromises()
    expect(day.attributes('aria-pressed')).toBe('true')
    expect(wrapper.findAll('a').find(link => link.text() === 'Add receipt')!.attributes('href')).toBe('/receipts/new?date=2026-09-25')
    expect(wrapper.text()).toContain('No receipts for this date')
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
    await calendar(wrapper).findAll('button').find(button => button.text() === '25')!.trigger('click')
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
    const row = receiptList(wrapper).find('tbody tr')
    expect(row.attributes('tabindex')).toBe('0')
    const focus = vi.spyOn(row.element, 'focus')
    await row.trigger('click')
    expect(focus).toHaveBeenCalledOnce()
    const push = vi.spyOn(wrapper.vm.$router, 'push')
    await receiptList(wrapper).find('tbody tr').trigger('dblclick')
    await flushPromises()
    expect(push).toHaveBeenCalledWith('/receipts/17')
    expect(wrapper.find('a[aria-label="Edit Test Store receipt from Sep 26, 2026"]').exists()).toBe(true)
  })

  it('shows entry prices with the shared formatter', async () => {
    includeEntry = true
    const wrapper = await mountBrowser('/history/entries')
    const cells = entryTable(wrapper).findAll('tbody tr td')
    expect(cells[4]!.text()).toBe('$2.00')
    expect(cells[5]!.text()).toBe('$2.00')
  })

  it.each([
    ['12', 'up 12%', 'error', 'i-lucide-trending-up', '+12%'],
    ['-12', 'down 12%', 'success', 'i-lucide-trending-down', '−12%']
  ])('flags a %s%% price change with the shared movement chip', async (percent, spoken, color, icon, shown) => {
    includeEntry = true
    priceChangePercent = percent
    const wrapper = await mountBrowser('/history/entries')
    const chip = entryTable(wrapper).get('tbody tr td .sr-only')
    expect(chip.text()).toBe(spoken)
    expect(chip.element.parentElement!.className).toContain(color)
    expect(chip.element.parentElement!.innerHTML).toContain(icon)
    expect(chip.element.parentElement!.querySelector('[data-figure]')!.textContent).toBe(shown)
    expect(chip.element.parentElement!.getAttribute('title')).toContain(shown)
  })

  it('shows no movement chip for a change under 10%', async () => {
    includeEntry = true
    priceChangePercent = '9'
    const wrapper = await mountBrowser('/history/entries')
    expect(entryTable(wrapper).find('tbody tr td .sr-only').exists()).toBe(false)
  })

  it('shows a dash when an entry has no normalized price', async () => {
    includeEntry = true
    withoutNormalizedPrice = true
    const wrapper = await mountBrowser('/history/entries')
    expect(entryTable(wrapper).findAll('tbody tr td')[5]!.text()).toBe('—')
  })

  it('names the entries table and scopes every column header', async () => {
    includeEntry = true
    const wrapper = await mountBrowser('/history/entries')
    const headers = entryTable(wrapper).findAll('thead th')
    expect(headers).toHaveLength(7)
    expect(headers.every(header => header.attributes('scope') === 'col')).toBe(true)
    expect(headers[0]!.attributes('aria-sort')).toBe('descending')
  })

  it('formats receipt list totals in dollars and labels each phone-width cell', async () => {
    includeReceipt = true
    const wrapper = await mountBrowser('/history/receipts/list')
    const cells = receiptList(wrapper).findAll('tbody tr td')
    expect(cells[3]!.text()).toBe('$0.00')
    expect(cells.slice(0, 4).map(cell => cell.attributes('data-label'))).toEqual(['Date', 'Store', 'Items', 'Total'])
  })

  it('returns focus to the search field when it is cleared', async () => {
    includeEntry = true
    const wrapper = await mountBrowser('/history/entries?search=apple', document.body)
    const input = wrapper.get('input[type="search"]')
    expect((input.element as HTMLInputElement).value).toBe('apple')
    await wrapper.get('button[aria-label="Clear search"]').trigger('click')
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)))
    expect((input.element as HTMLInputElement).value).toBe('')
    expect(document.activeElement).toBe(input.element)
  })

  it('focuses an item entry row on click and opens its editor on double-click', async () => {
    includeEntry = true
    const wrapper = await mountBrowser('/history/entries')
    const row = entryTable(wrapper).find('tbody tr')
    expect(row.attributes('tabindex')).toBe('0')
    const focus = vi.spyOn(row.element, 'focus')
    await row.trigger('click')
    expect(focus).toHaveBeenCalledOnce()
    await entryTable(wrapper).find('tbody tr').trigger('dblclick')
    await flushPromises()
    expect(document.querySelector('.edit-dialog')).not.toBeNull()
    expect((document.getElementById('edit-item') as HTMLInputElement).value).toBe('Apples')
    expect(document.getElementById('edit-notes')?.getAttribute('maxlength')).toBe('100')
    expect(document.getElementById('edit-notes-character-count')?.textContent).toBe('0/100')
    const notes = document.getElementById('edit-notes') as HTMLTextAreaElement
    notes.value = 'x'.repeat(100)
    notes.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(document.getElementById('edit-notes-character-count')?.textContent).toBe('100/100')
  })

  it('keeps sort and filter choices in the URL and drops them when back at the defaults', async () => {
    includeEntry = true
    const wrapper = await mountBrowser('/history/entries')
    const query = () => wrapper.vm.$router.currentRoute.value.query

    await entryTable(wrapper).findAll('thead th button').find(button => button.text() === 'Item')!.trigger('click')
    await wrapper.findAll('button').find(button => button.text() === 'On sale')!.trigger('click')
    await vi.waitFor(() => expect(query()).toMatchObject({ sort: 'item', direction: 'asc', filter: 'sale' }))

    await entryTable(wrapper).findAll('thead th button').find(button => button.text() === 'Date')!.trigger('click')
    await wrapper.findAll('button').find(button => button.text() === 'All')!.trigger('click')
    await vi.waitFor(() => expect(query()).toEqual({}))
  })

  it('sends an unknown history view to the receipts calendar, keeping the query', async () => {
    const wrapper = await mountBrowser('/history/entries')
    const router = wrapper.vm.$router

    await router.push('/history/nonsense?store=Market')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/history/receipts/calendar?store=Market')
  })

  it('asks before deleting a purchase and only deletes once confirmed', async () => {
    includeEntry = true
    const wrapper = await mountBrowser('/history/entries', document.body)
    // The confirmation opens on top of the editor, so the last matching button is the confirmation's.
    const press = (label: string) => [...document.querySelectorAll('button')].filter(button => button.textContent?.trim() === label).at(-1) as HTMLButtonElement
    await entryTable(wrapper).find('tbody tr').trigger('dblclick')
    await flushPromises()

    press('Delete').click()
    await flushPromises()
    expect(document.body.textContent).toContain('Delete purchase?')
    expect(deletedEntries).toEqual([])

    press('Cancel').click()
    await flushPromises()
    expect(document.body.textContent).not.toContain('Delete purchase?')
    expect(deletedEntries).toEqual([])

    press('Delete').click()
    await flushPromises()
    press('Delete purchase').click()
    await vi.waitFor(() => expect(deletedEntries).toEqual(['23']))
    await vi.waitFor(() => expect(document.querySelector('.edit-dialog')).toBeNull())
  })
})
