import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { createError, getQuery, readBody } from 'h3'
import { defineComponent, h, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RouterView } from 'vue-router'
import { UApp } from '#components'
import { clearNuxtState, useState } from '#imports'
import ReceiptEntryForm from '../app/components/ReceiptEntryForm.vue'
import { maxEntryNotesLength } from '../shared/utils/entry-notes'

const UInput = defineComponent({
  inheritAttrs: false,
  props: { modelValue: { type: [String, Number], default: '' } },
  emits: ['update:modelValue'],
  setup(props, { attrs, emit, slots, expose }) {
    const inputRef = ref<HTMLInputElement>()
    expose({ inputRef })
    return () => h('div', [
      h('input', {
        ref: inputRef,
        ...attrs,
        value: props.modelValue,
        onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).value)
      }),
      slots.trailing?.()
    ])
  }
})

const UInputMenu = defineComponent({
  inheritAttrs: false,
  props: {
    modelValue: { type: String, default: '' },
    items: { type: Array, default: () => [] }
  },
  emits: ['update:modelValue', 'update:searchTerm', 'update:open', 'create'],
  setup(props, { attrs, emit, expose }) {
    const inputRef = ref<HTMLInputElement>()
    expose({ inputRef })
    return () => h('div', [
      h('input', {
        ref: inputRef,
        ...attrs,
        role: 'combobox',
        value: props.modelValue,
        onInput: (event: Event) => {
          const value = (event.target as HTMLInputElement).value
          if (!('data-line-category' in attrs)) emit('update:modelValue', value)
          emit('update:searchTerm', value)
        }
      }),
      ...props.items.map((item: any) => h('button', {
        type: 'button',
        'data-option': item.label ?? item,
        onClick: () => {
          item.onSelect?.()
          emit('update:modelValue', item.value ?? item)
        }
      }, item.label ?? item))
    ])
  }
})

const UButton = defineComponent({
  inheritAttrs: false,
  props: {
    label: { type: String, default: '' },
    icon: String,
    variant: String,
    color: String,
    to: [String, Object],
    disabled: Boolean,
    loading: Boolean,
    ui: Object
  },
  setup(props, { attrs }) {
    return () => h('button', { ...attrs, type: 'button', 'data-label-class': props.ui?.label, 'data-icon': props.icon, 'data-variant': props.variant, 'data-color': props.color, 'data-to': props.to ? JSON.stringify(props.to) : undefined, disabled: props.disabled || props.loading }, props.label)
  }
})

const UFormField = defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) })
const UPopover = defineComponent({ setup: (_, { slots }) => () => h('div', [slots.default?.(), slots.content?.()]) })
const UTooltip = defineComponent({ props: { text: String }, setup: (_, { slots }) => () => h('span', slots.default?.()) })
const UIcon = defineComponent({ setup: () => () => h('span') })
const UAlert = defineComponent({ props: { description: String }, setup: props => () => h('div', props.description) })
const UModal = defineComponent({
  props: { title: String, description: String, open: Boolean },
  setup(props, { slots }) {
    return () => h('div', props.open ? [h('h2', props.title), h('p', props.description), slots.default?.(), slots.body?.(), slots.footer?.()] : [])
  }
})
const UCheckbox = defineComponent({
  props: { modelValue: Boolean, label: String },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () => h('button', {
      type: 'button',
      role: 'checkbox',
      'aria-checked': String(Boolean(props.modelValue)),
      onClick: () => emit('update:modelValue', !props.modelValue)
    }, props.label)
  }
})
const USwitch = defineComponent({
  inheritAttrs: false,
  props: { modelValue: Boolean, label: String },
  emits: ['update:modelValue'],
  setup(props, { attrs, emit }) {
    return () => h('button', {
      ...attrs,
      type: 'button',
      role: 'switch',
      onClick: () => emit('update:modelValue', !props.modelValue)
    }, props.label)
  }
})

const stubs = { UInput, UInputMenu, UButton, UFormField, UPopover, UTooltip, UIcon, UAlert, UModal, UCheckbox, USwitch }
const RouteView = defineComponent({ setup: () => () => h(RouterView) })
const localStorageStub = {
  values: new Map<string, string>(),
  getItem(key: string) { return this.values.get(key) ?? null },
  setItem(key: string, value: string) { this.values.set(key, value) },
  removeItem(key: string) { this.values.delete(key) },
  clear() { this.values.clear() }
}

function receipt() {
  return {
    id: 'receipt-1',
    purchasedOn: '2026-08-10',
    location: 'Test Store',
    itemCount: 1,
    total: '4.99',
    entries: [{
      id: 'entry-1', item: 'Coffee', price: '4.99', size: '12', unit: 'oz',
      saleItem: false, nonGrocery: false, notes: null
    }]
  }
}

let matchingReceipt: ReturnType<typeof receipt> | null
let sourceReceiptForTests: ReturnType<typeof receipt> | null
let failReceiptMatch: boolean
let resolveReceiptFetch: ((value: { receipt: ReturnType<typeof receipt> }) => void) | undefined
let entryAttempts: number
let failEntrySaves: boolean
let deleteAttempts: number
let failDeletes: boolean
let backfillChecks: number
let backfillCounts: { size: number, unit: number, either: number }
let backfillUpdates: any[]
let suggestions: Array<{ value: string, category?: string | null, size: string, unit: string, price: string }>
let categories: string[]
let entryBodies: Array<{ method: string, body: any }>
let splitRequests: Array<{ method: string, body: any }>
let splitResult: any
let splitUndoResult: any
let orderRequests: Array<{ method: string, body: any }>
let failOrder: boolean
const mountedForms: Array<{ unmount: () => void }> = []
let mountedRouter: any

async function mountForm(initialLocation = 'Test Store', initialReceiptId?: string) {
  const wrapper = await mountSuspended(ReceiptEntryForm, {
    props: { initialDate: '2026-08-10', initialLocation, initialReceiptId },
    route: '/',
    attachTo: document.body,
    global: { stubs }
  })
  if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0)
  await flushPromises()
  mountedForms.push(wrapper)
  return wrapper
}

function findCategoryMenu(wrapper: Awaited<ReturnType<typeof mountForm>>) {
  return wrapper.findAllComponents(UInputMenu).find(menu => menu.find('[data-line-category]').exists())!
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('localStorage', localStorageStub)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    setTimeout(() => callback(0), 0)
    return 1
  })
  matchingReceipt = null
  sourceReceiptForTests = null
  entryAttempts = 0
  failEntrySaves = false
  deleteAttempts = 0
  failDeletes = false
  backfillChecks = 0
  backfillCounts = { size: 1, unit: 1, either: 1 }
  backfillUpdates = []
  suggestions = []
  categories = ['Beverages']
  entryBodies = []
  splitRequests = []
  splitResult = null
  splitUndoResult = null
  orderRequests = []
  failOrder = false
  localStorageStub.clear()
  failReceiptMatch = false
  registerEndpoint('/api/auth/config', () => ({ enabled: false }))
  resolveReceiptFetch = undefined
  registerEndpoint('/api/receipts/match', (event: any) => {
    if (failReceiptMatch) throw new Error('match unavailable')
    const query = getQuery(event)
    return {
      receipt: matchingReceipt
        && matchingReceipt.id !== String(query.excludeId || '')
        && matchingReceipt.purchasedOn === String(query.date)
        && matchingReceipt.location === String(query.location)
        ? matchingReceipt
        : null
    }
  })
  registerEndpoint('/api/receipts/receipt-1', () => ({ receipt: sourceReceiptForTests ?? (matchingReceipt?.id === 'receipt-1' ? matchingReceipt : receipt()) }))
  registerEndpoint('/api/receipts/receipt-2', () => new Promise(resolve => { resolveReceiptFetch = resolve }))
  registerEndpoint('/api/receipts/receipt-1/split', {
    method: 'POST',
    handler: async (event: any) => {
      const body = await readBody(event)
      splitRequests.push({ method: 'POST', body })
      return splitResult
    }
  })
  registerEndpoint('/api/receipts/receipt-1/split-undo', {
    method: 'POST',
    handler: async (event: any) => {
      const body = await readBody(event)
      splitRequests.push({ method: 'UNDO', body })
      return splitUndoResult
    }
  })
  registerEndpoint('/api/receipts/receipt-1/order', {
    method: 'PUT',
    handler: async (event: any) => {
      orderRequests.push({ method: 'PUT', body: await readBody(event) })
      if (failOrder) throw createError({ statusCode: 409, statusMessage: 'Entries changed' })
      return { ok: true }
    }
  })
  registerEndpoint('/api/suggestions', () => suggestions)
  registerEndpoint('/api/categories', () => categories)
  registerEndpoint('/api/items/backfill', async (event: any) => {
    if (event.method === 'PATCH') {
      backfillUpdates.push(await readBody(event))
      return { updated: 1 }
    }
    backfillChecks++
    return backfillCounts
  })
registerEndpoint('/api/entries', {
    method: 'POST',
    handler: async (event: any) => {
      entryAttempts++
      const body = await readBody(event)
      entryBodies.push({ method: 'POST', body })
      if (failEntrySaves) throw new Error('offline')
      return {
        id: 'entry-new', receiptId: 'receipt-new', purchasedOn: '2026-08-10', location: 'Test Store',
        item: body.item, price: body.price, size: null, unit: null, saleItem: false, nonGrocery: false, notes: body.notes, category: body.category ?? null
      }
    }
  })
  registerEndpoint('/api/entries/entry-1', {
    method: 'PUT',
    handler: async (event: any) => {
      const body = await readBody(event)
      entryBodies.push({ method: 'PUT', body })
      if (failEntrySaves) throw new Error('offline')
      return { ...matchingReceipt?.entries[0], ...body, id: 'entry-1', receiptId: 'receipt-1' }
    }
  })
  registerEndpoint('/api/entries/entry-2', {
    method: 'PUT',
    handler: async (event: any) => {
      const body = await readBody(event)
      entryBodies.push({ method: 'PUT', body })
      return { ...matchingReceipt?.entries[1], ...body, id: 'entry-2', receiptId: 'receipt-1' }
    }
  })
  registerEndpoint('/api/entries/entry-1', {
    method: 'DELETE',
    handler: () => {
      deleteAttempts++
      if (failDeletes) throw new Error('delete failed')
      matchingReceipt = null
      return null
    }
  })
  registerEndpoint('/api/entries/entry-new', {
    method: 'PUT',
    handler: async (event: any) => {
      const body = await readBody(event)
      entryBodies.push({ method: 'PUT', body })
      return ({
      id: 'entry-new', receiptId: 'receipt-new', purchasedOn: '2026-08-10', location: 'Test Store',
      item: body.item, price: body.price, size: body.size, unit: body.unit, saleItem: body.saleItem, nonGrocery: body.nonGrocery, notes: body.notes, category: body.category ?? null
      })
    }
  })
})

afterEach(async () => {
  mountedForms.splice(0).forEach(wrapper => wrapper.unmount())
  vi.useRealTimers()
  if (mountedRouter) await mountedRouter.replace('/')
  await flushPromises()
  mountedRouter = undefined
  document.body.innerHTML = ''
  localStorageStub.clear()
  vi.unstubAllGlobals()
})

describe('receipt item entry interactions', () => {
  it('loads the exact receipt requested by stable ID', async () => {
    const wrapper = await mountForm('', 'receipt-1')

    expect((wrapper.get('[data-line-item]').element as HTMLInputElement).value).toBe('Coffee')
    expect((wrapper.get('input[type="date"]').element as HTMLInputElement).disabled).toBe(true)
    expect(wrapper.text()).toContain('All changes saved')
    wrapper.unmount()
  })

  it('keeps a new receipt date fixed to the selected calendar day', async () => {
    const wrapper = await mountForm()
    const dateDisplay = wrapper.get('[data-receipt-date-display]')

    expect(dateDisplay.attributes('datetime')).toBe('2026-08-10')
    expect(dateDisplay.text()).toContain('2026')
    expect(wrapper.find('input[type="date"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label^="Unlock"], [aria-label^="Lock"]').exists()).toBe(false)
    expect(wrapper.get('[data-icon="i-lucide-arrow-left"]').text()).toBe('Back to Aug 10, 2026')

    await wrapper.setProps({ initialDate: '2026-08-11' })
    expect(dateDisplay.attributes('datetime')).toBe('2026-08-11')
    wrapper.unmount()
  })

  it('keeps date and store in the header only, not in the sticky footer', async () => {
    const wrapper = await mountForm()
    const footer = wrapper.get('[data-receipt-footer]')

    expect(wrapper.find('[data-receipt-footer-context]').exists()).toBe(false)
    expect(footer.find('dl, time').exists()).toBe(false)
    expect(footer.text()).not.toContain('Test Store')
    expect(wrapper.get('header').text()).toContain('Aug 10, 2026')
    // The footer is one row: status, then count and total, then the main action.
    expect(footer.classes().some(name => name.startsWith('max-xl:'))).toBe(false)
    expect(footer.findAll('button').map(button => button.text())).toEqual(['Save and add another'])
    wrapper.unmount()
  })

  it('keeps the help sentence in the DOM and on a named info button', async () => {
    const wrapper = await mountForm()

    expect(wrapper.get('header p').text()).toBe('Choose a store and enter its purchases. Completed rows save automatically.')
    expect(wrapper.get('header [aria-label="About this page"]').attributes('data-icon')).toBe('i-lucide-info')
    wrapper.unmount()
  })

  it('gives the saved-receipt footer actions accessible names and titles', async () => {
    sourceReceiptForTests = receipt()
    const wrapper = await mountForm('', 'receipt-1')
    const footer = wrapper.get('[data-receipt-footer]')

    for (const name of ['Delete receipt', 'Export receipt']) {
      const button = footer.get(`[aria-label="${name}"]`)
      expect(button.attributes('title')).toBe(name)
      expect(button.attributes('data-variant')).toBe('ghost')
      // Icon-only at every width so the edit footer stays one row on phones.
      expect(button.attributes('data-label-class')).toBe('sr-only')
    }
    expect(footer.find('[data-receipt-footer-context]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('ignores an exact-ID load that resolves after the route props changed', async () => {
    const wrapper = await mountForm('', 'receipt-2')
    await wrapper.setProps({ initialReceiptId: undefined, initialDate: '2026-08-11', initialLocation: '' })
    resolveReceiptFetch?.({ receipt: receipt() })
    await flushPromises()

    expect(wrapper.get('[data-receipt-date-display]').attributes('datetime')).toBe('2026-08-11')
    expect(wrapper.find('[data-line-item]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('offers an explicit open action for a matching receipt in new mode', async () => {
    matchingReceipt = receipt()
    const wrapper = await mountForm()

    expect(wrapper.find('[data-line-item]').exists()).toBe(false)
    expect(wrapper.text()).toContain('A receipt already exists for this store and date with 1 item.')
    expect(wrapper.text()).toContain('Open existing receipt')
    wrapper.unmount()
  })

  it('confirms before opening a matching receipt when a new receipt has a draft', async () => {
    matchingReceipt = receipt()
    vi.useRealTimers()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      setTimeout(() => callback(0), 0)
      return 1
    })
    const wrapper = await mountSuspended(RouteView, {
      route: '/receipts/new?date=2026-08-10',
      attachTo: document.body,
      global: { stubs }
    })
    mountedForms.push(wrapper)
    mountedRouter = wrapper.findComponent(ReceiptEntryForm).vm.$router
    await wrapper.get('[data-receipt-store]').setValue('Other Store')
    await vi.waitFor(() => expect(wrapper.find('[data-line-item]').exists()).toBe(true))
    await wrapper.get('[data-line-item]').setValue('Coffee')
    await wrapper.get('[data-line-price]').setValue('9.99')
    await wrapper.get('[data-receipt-store]').setValue('Test Store')
    await vi.waitFor(() => expect(wrapper.text()).toContain('Open existing receipt'))
    expect(wrapper.find('[data-line-item]').exists()).toBe(false)
    await flushPromises()
    expect(wrapper.text()).toContain('Open existing receipt')

    await wrapper.findAll('button').find(button => button.text() === 'Open existing receipt')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Discard unsaved receipt?')
    expect(wrapper.text()).toContain('Add receipt')
    expect(wrapper.find('[data-line-item]').exists()).toBe(false)

    await wrapper.findAll('button').find(button => button.text() === 'Cancel')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('Discard unsaved receipt?')
    expect(wrapper.text()).toContain('Add receipt')
    expect(wrapper.find('[data-line-item]').exists()).toBe(false)

    await wrapper.findAll('button').find(button => button.text() === 'Open existing receipt')!.trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === 'Discard changes')!.trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.text()).toContain('Edit receipt'))
    expect((wrapper.get('[data-line-item]').element as HTMLInputElement).value).toBe('Coffee')
    wrapper.unmount()
  })

  it('blocks autosave and Save and add another while a new receipt has a duplicate match', async () => {
    matchingReceipt = receipt()
    const wrapper = await mountForm()
    expect(wrapper.find('[data-line-item]').exists()).toBe(false)
    await wrapper.get('[data-receipt-store]').setValue('Other Store')
    await vi.waitFor(() => expect(wrapper.find('[data-line-item]').exists()).toBe(true))
    await wrapper.get('[data-line-item]').setValue('Tea')
    await wrapper.get('[data-line-price]').setValue('3.25')
    await wrapper.get('[data-receipt-store]').setValue('Test Store')
    await vi.waitFor(() => expect(wrapper.text()).toContain('Open existing receipt'))
    expect(wrapper.find('[data-line-item]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Your draft lines are kept while you choose another store.')
    await flushPromises()

    const saveAndAdd = wrapper.findAll('button').find(button => button.text() === 'Save and add another')!
    expect(saveAndAdd).toBeUndefined()
    await vi.advanceTimersByTimeAsync(700)
    await flushPromises()
    expect(entryAttempts).toBe(0)
    await wrapper.get('[data-receipt-store]').setValue('Other Store')
    await vi.waitFor(() => expect((wrapper.get('[data-line-item]').element as HTMLInputElement).value).toBe('Tea'))
    wrapper.unmount()
  })

  it('fails closed when duplicate lookup fails in new mode', async () => {
    failReceiptMatch = true
    const wrapper = await mountForm()
    await vi.advanceTimersByTimeAsync(700)
    await flushPromises()

    expect(wrapper.text()).toContain('Retry the check before saving.')
    expect(wrapper.find('[data-line-item]').exists()).toBe(false)
    expect(wrapper.findAll('button').find(button => button.text() === 'Retry receipt check')).toBeDefined()
    expect(entryAttempts).toBe(0)
    wrapper.unmount()
  })

  it('keeps a draft row when the first autosaved row changes the URL to its receipt ID', async () => {
    const wrapper = await mountForm()
    await wrapper.get('[data-line-item]').setValue('Coffee')
    await wrapper.get('[data-line-price]').setValue('4.99')
    await wrapper.findAll('button').find(button => button.text() === 'Add another line')!.trigger('click')
    const itemInputs = wrapper.findAll('[data-line-item]')
    await itemInputs[1]!.setValue('Tea')
    await vi.advanceTimersByTimeAsync(600)
    await flushPromises()

    await wrapper.setProps({ initialReceiptId: 'receipt-new', initialDate: '', initialLocation: '' })
    await flushPromises()
    expect((wrapper.findAll('[data-line-item]')[1]!.element as HTMLInputElement).value).toBe('Tea')
    wrapper.unmount()
  })

  it('keeps explicit merge confirmation for an edit key collision', async () => {
    matchingReceipt = { ...receipt(), id: 'receipt-2', purchasedOn: '2026-08-11', entries: [{ ...receipt().entries[0]!, id: 'entry-2' }] }
    const wrapper = await mountForm('Test Store', 'receipt-1')
    await wrapper.get('[aria-label="Unlock to change the date"]').trigger('click')
    await wrapper.get('input[type="date"]').setValue('2026-08-11')
    await flushPromises()

    await vi.waitFor(() => expect(wrapper.text()).toContain('Merge duplicate receipt?'))
    expect(wrapper.text()).not.toContain('Open existing receipt')
    await vi.advanceTimersByTimeAsync(700)
    await flushPromises()
    expect(entryAttempts).toBe(0)
    expect(entryBodies).toHaveLength(0)

    await wrapper.findAll('button').find(button => button.text() === 'Cancel')!.trigger('click')
    await flushPromises()
    expect((wrapper.get('input[type="date"]').element as HTMLInputElement).value).toBe('2026-08-10')
    await vi.advanceTimersByTimeAsync(700)
    await flushPromises()
    expect(entryBodies).toHaveLength(0)

    await wrapper.get('input[type="date"]').setValue('2026-08-11')
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.text()).toContain('Merge duplicate receipt?'))
    await wrapper.findAll('button').find(button => button.text() === 'Merge receipts')!.trigger('click')
    await vi.advanceTimersByTimeAsync(600)
    await flushPromises()
    expect(entryBodies).toHaveLength(1)
    expect(entryBodies[0]?.method).toBe('PUT')
    wrapper.unmount()
  })

  it('moves selected saved lines in one request and can undo the split', async () => {
    const first = receipt().entries[0]!
    const second = { ...first, id: 'entry-2', item: 'Tea', price: '3.25', size: null, unit: null }
    sourceReceiptForTests = { ...receipt(), itemCount: 2, total: '8.24', entries: [first, second] }
    splitResult = {
      source: { ...sourceReceiptForTests, itemCount: 1, total: '3.25', entries: [second] },
      targetReceiptId: 'receipt-2', targetWasCreated: true, movedEntryIds: ['entry-1'], movedCount: 1,
      targetPurchasedOn: '2026-08-11', targetLocation: 'New Store'
    }
    splitUndoResult = { source: sourceReceiptForTests }
    const wrapper = await mountForm('Test Store', 'receipt-1')

    expect(wrapper.findAllComponents(UCheckbox)).toHaveLength(0)
    await wrapper.findAll('button').find(button => button.text() === 'Split receipt')!.trigger('click')
    expect(wrapper.findAllComponents(UCheckbox)).toHaveLength(2)
    expect(wrapper.find('[data-line-content]').attributes('inert')).toBeDefined()
    await wrapper.get('[aria-label="Select Coffee to move"]').trigger('click')
    await wrapper.findAll('button').find(button => button.text() === 'Move 1 line')!.trigger('click')
    await wrapper.get('[data-split-date]').setValue('2026-08-11')
    await wrapper.get('[data-split-store]').setValue('New Store')
    await vi.waitFor(() => expect(wrapper.text()).not.toContain('Checking for a receipt at this destination'))
    await wrapper.findAllComponents(UCheckbox).find(box => box.props('label') === 'I reviewed these lines and the destination.')!.trigger('click')
    const moveButton = wrapper.findAll('button').filter(button => button.text() === 'Move 1 line').at(-1)!
    expect(moveButton.attributes('disabled')).toBeUndefined()
    await moveButton.trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.get('[data-split-notice]').text()).toContain('Moved 1 line to New Store'))

    expect(splitRequests[0]).toMatchObject({ method: 'POST', body: { entryIds: ['entry-1'], purchasedOn: '2026-08-11', location: 'New Store' } })
    expect(wrapper.text()).toContain('Moved 1 line to New Store')
    expect(wrapper.findAll('[data-receipt-line]')).toHaveLength(1)
    await wrapper.findAll('button').find(button => button.text() === 'Undo')!.trigger('click')
    await flushPromises()
    expect(splitRequests[1]?.method).toBe('UNDO')
    await vi.waitFor(() => expect(wrapper.findAll('[data-receipt-line]')).toHaveLength(2))
    expect(wrapper.text()).not.toContain('Moved 1 line to New Store')
    wrapper.unmount()
  })

  it('requires an explicit choice before moving lines into an existing receipt', async () => {
    const first = receipt().entries[0]!
    const second = { ...first, id: 'entry-2', item: 'Tea', price: '3.25', size: null, unit: null }
    sourceReceiptForTests = { ...receipt(), itemCount: 2, total: '8.24', entries: [first, second] }
    matchingReceipt = { ...receipt(), id: 'receipt-2', purchasedOn: '2026-08-11', location: 'Other Store', itemCount: 4 }
    splitResult = {
      source: { ...sourceReceiptForTests, itemCount: 1, total: '3.25', entries: [second] },
      targetReceiptId: 'receipt-2', targetWasCreated: false, movedEntryIds: ['entry-1'], movedCount: 1,
      targetPurchasedOn: '2026-08-11', targetLocation: 'Other Store'
    }
    const wrapper = await mountForm('Test Store', 'receipt-1')

    await wrapper.findAll('button').find(button => button.text() === 'Split receipt')!.trigger('click')
    await wrapper.get('[aria-label="Select Coffee to move"]').trigger('click')
    await wrapper.findAll('button').find(button => button.text() === 'Move 1 line')!.trigger('click')
    await wrapper.get('[data-split-date]').setValue('2026-08-11')
    await wrapper.get('[data-split-store]').setValue('Other Store')
    await vi.waitFor(() => expect(wrapper.text()).toContain('A receipt already exists for Other Store'))
    await wrapper.findAllComponents(UCheckbox).find(box => box.props('label') === 'I reviewed these lines and the destination.')!.trigger('click')
    const moveButton = wrapper.findAll('button').filter(button => button.text() === 'Move 1 line').at(-1)!
    expect(moveButton.attributes('disabled')).toBeDefined()
    await wrapper.findAllComponents(UCheckbox).find(box => String(box.props('label')).startsWith('Add these lines to the existing'))!.trigger('click')
    expect(moveButton.attributes('disabled')).toBeUndefined()
    await moveButton.trigger('click')
    await flushPromises()

    expect(splitRequests[0]?.body.targetReceiptId).toBe('receipt-2')
    wrapper.unmount()
  })

  const lockFields = [
    { name: 'date', locked: 'Unlock to change the date', unlocked: 'Lock the date', input: 'input[type="date"]', change: '2026-08-12', saved: 'Date saved and locked.', body: (body: any) => body.purchasedOn },
    { name: 'store', locked: 'Unlock to change the store', unlocked: 'Lock the store', input: '[data-receipt-store]', change: 'Other Store', saved: 'Store saved and locked.', body: (body: any) => body.location }
  ]
  // No size or unit, so a save does not stop for a backfill prompt.
  const plainReceipt = () => ({ ...receipt(), entries: [{ ...receipt().entries[0]!, size: null, unit: null }] })

  for (const field of lockFields) {
    const lockQuery = (label: string) => `[aria-label="${label}"]`

    it(`locks the saved receipt ${field.name} until its lock button unlocks it`, async () => {
      matchingReceipt = receipt()
      const wrapper = await mountForm('Test Store', 'receipt-1')
      const input = () => wrapper.get(field.input).element as HTMLInputElement

      expect(wrapper.text()).toContain('Unlock the date or store to change it.')
      expect(input().disabled).toBe(true)
      const lock = wrapper.get(lockQuery(field.locked))
      expect(lock.attributes('data-icon')).toBe('i-lucide-lock')
      expect(lock.attributes('data-variant')).toBe('ghost')
      expect(lock.attributes('data-color')).toBe('neutral')
      expect(lock.attributes('aria-pressed')).toBeUndefined()
      await lock.trigger('click')
      await flushPromises()

      const unlock = wrapper.get(lockQuery(field.unlocked))
      expect(unlock.attributes('data-icon')).toBe('i-lucide-lock-open')
      expect(unlock.attributes('data-variant')).toBe('soft')
      expect(unlock.attributes('data-color')).toBe('primary')
      expect(unlock.attributes('aria-pressed')).toBeUndefined()
      expect(input().disabled).toBe(false)
      expect(document.activeElement).toBe(input())
      await unlock.trigger('click')
      expect(input().disabled).toBe(true)
      expect(wrapper.find(lockQuery(field.locked)).exists()).toBe(true)
      wrapper.unmount()
    })

    it(`relocks the ${field.name}, announces it, and keeps focus on its lock button once the change saves`, async () => {
      matchingReceipt = plainReceipt()
      const wrapper = await mountForm('Test Store', 'receipt-1')
      await wrapper.get(lockQuery(field.locked)).trigger('click')
      await flushPromises()
      await wrapper.get(field.input).setValue(field.change)
      await vi.waitFor(async () => {
        await vi.advanceTimersByTimeAsync(700)
        expect(entryBodies).toHaveLength(1)
      })
      await flushPromises()

      expect(field.body(entryBodies.at(-1)?.body)).toBe(field.change)
      expect((wrapper.get(field.input).element as HTMLInputElement).disabled).toBe(true)
      expect(wrapper.find(lockQuery(field.locked)).exists()).toBe(true)
      expect(document.activeElement).toBe(wrapper.get(lockQuery(field.locked)).element)
      expect(wrapper.get('[role="status"]').text()).toBe(field.saved)
      wrapper.unmount()
    })

    it(`keeps the ${field.name} unlocked and silent when its change fails to save`, async () => {
      matchingReceipt = plainReceipt()
      const wrapper = await mountForm('Test Store', 'receipt-1')
      failEntrySaves = true
      await wrapper.get(lockQuery(field.locked)).trigger('click')
      await flushPromises()
      await wrapper.get(field.input).setValue(field.change)
      await vi.waitFor(async () => {
        await vi.advanceTimersByTimeAsync(700)
        expect(entryBodies).toHaveLength(1)
      })
      await flushPromises()

      expect(wrapper.text()).toContain('Changes could not be saved')
      expect((wrapper.get(field.input).element as HTMLInputElement).disabled).toBe(false)
      expect(wrapper.find(lockQuery(field.unlocked)).exists()).toBe(true)
      expect(wrapper.text()).not.toContain('saved and locked')
      wrapper.unmount()
    })

    // Locking mid-edit is a deliberate choice: the edit stays, the field locks, and autosave still saves it.
    it(`keeps an unsaved ${field.name} edit when the field is locked, and autosave still saves it`, async () => {
      matchingReceipt = plainReceipt()
      const wrapper = await mountForm('Test Store', 'receipt-1')
      await wrapper.get(lockQuery(field.locked)).trigger('click')
      await flushPromises()
      await wrapper.get(field.input).setValue(field.change)
      await wrapper.get(lockQuery(field.unlocked)).trigger('click')
      await flushPromises()

      const input = () => wrapper.get(field.input).element as HTMLInputElement
      expect(input().value).toBe(field.change)
      expect(input().disabled).toBe(true)
      expect(wrapper.get(lockQuery(field.locked)).attributes('data-icon')).toBe('i-lucide-lock')
      expect(entryBodies).toHaveLength(0)

      await vi.waitFor(async () => {
        await vi.advanceTimersByTimeAsync(700)
        expect(entryBodies).toHaveLength(1)
      })
      await flushPromises()

      expect(field.body(entryBodies.at(-1)?.body)).toBe(field.change)
      expect(input().value).toBe(field.change)
      expect(input().disabled).toBe(true)
      expect(wrapper.get(lockQuery(field.locked)).attributes('data-icon')).toBe('i-lucide-lock')
      wrapper.unmount()
    })

    it(`saves nothing when the ${field.name} is locked with no unsaved edit`, async () => {
      matchingReceipt = plainReceipt()
      const wrapper = await mountForm('Test Store', 'receipt-1')
      await wrapper.get(lockQuery(field.locked)).trigger('click')
      await flushPromises()
      await wrapper.get(lockQuery(field.unlocked)).trigger('click')
      await flushPromises()

      await vi.advanceTimersByTimeAsync(1000)
      await flushPromises()

      expect(entryBodies).toHaveLength(0)
      expect((wrapper.get(field.input).element as HTMLInputElement).disabled).toBe(true)
      expect(wrapper.find(lockQuery(field.locked)).exists()).toBe(true)
      wrapper.unmount()
    })
  }

  it('does not move focus to a lock button when the focus was elsewhere at relock', async () => {
    matchingReceipt = plainReceipt()
    const wrapper = await mountForm('Test Store', 'receipt-1')
    await wrapper.get('[aria-label="Unlock to change the date"]').trigger('click')
    await flushPromises()
    await wrapper.get('input[type="date"]').setValue('2026-08-12')
    ;(wrapper.get('[data-line-item]').element as HTMLInputElement).focus()
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(700)
      expect(entryBodies).toHaveLength(1)
    })
    await flushPromises()

    expect(document.activeElement).toBe(wrapper.get('[data-line-item]').element)
    wrapper.unmount()
  })

  it('announces one combined message when a save relocks both fields', async () => {
    matchingReceipt = plainReceipt()
    const wrapper = await mountForm('Test Store', 'receipt-1')
    await wrapper.get('[aria-label="Unlock to change the date"]').trigger('click')
    await wrapper.get('[aria-label="Unlock to change the store"]').trigger('click')
    await flushPromises()
    await wrapper.get('input[type="date"]').setValue('2026-08-12')
    await wrapper.get('[data-receipt-store]').setValue('Other Store')
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(700)
      expect(entryBodies).toHaveLength(1)
    })
    await flushPromises()

    expect(wrapper.find('[aria-label="Unlock to change the date"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Unlock to change the store"]').exists()).toBe(true)
    expect(wrapper.get('[role="status"]').text()).toBe('Date and store saved and locked.')
    wrapper.unmount()
  })

  it('renders each lock beside its input, never inside another button or link', async () => {
    matchingReceipt = receipt()
    // Real Nuxt UI components: the stubs cannot show where the trailing slot or sibling lands.
    // UApp supplies the tooltip provider the header's info button needs.
    const wrapper = await mountSuspended(defineComponent({
      render: () => h(UApp, null, () => h(ReceiptEntryForm, { initialDate: '2026-08-10', initialLocation: 'Test Store', initialReceiptId: 'receipt-1' }))
    }), {
      route: '/',
      attachTo: document.body
    })
    await flushPromises()
    mountedForms.push(wrapper)

    for (const label of ['Unlock to change the date', 'Unlock to change the store']) {
      const lock = wrapper.get(`[aria-label="${label}"]`).element
      expect(lock.tagName).toBe('BUTTON')
      expect(lock.parentElement?.closest('button, a')).toBeNull()
    }
    expect(wrapper.get('[data-receipt-store]').classes()).toContain('pe-[4.75rem]')
    // The native picker icon would draw under the lock.
    expect(wrapper.get('input[type="date"]').classes()).toContain('[&::-webkit-calendar-picker-indicator]:hidden')
    wrapper.unmount()
  })

  it('names the back link after the form date in add and edit modes', async () => {
    const add = await mountForm()
    expect(add.get('[data-icon="i-lucide-arrow-left"]').text()).toBe('Back to Aug 10, 2026')
    expect(add.get('[data-icon="i-lucide-arrow-left"]').attributes('data-variant')).toBe('ghost')
    expect(JSON.parse(add.get('[data-icon="i-lucide-arrow-left"]').attributes('data-to')!)).toEqual({ path: '/', query: { date: '2026-08-10' } })
    await add.setProps({ initialDate: '2026-08-11' })
    expect(add.get('[data-icon="i-lucide-arrow-left"]').text()).toBe('Back to Aug 11, 2026')
    add.unmount()

    matchingReceipt = receipt()
    const edit = await mountForm('Test Store', 'receipt-1')
    expect(edit.get('[data-icon="i-lucide-arrow-left"]').text()).toBe('Back to Aug 10, 2026')
    await edit.get('[aria-label="Unlock to change the date"]').trigger('click')
    await edit.get('input[type="date"]').setValue('2026-08-12')
    expect(edit.get('[data-icon="i-lucide-arrow-left"]').text()).toBe('Back to Aug 12, 2026')
    edit.unmount()
  })

  it('clearly labels the action that clears an item category', async () => {
    const wrapper = await mountForm()
    await wrapper.get('[data-line-details]').trigger('click')
    expect(wrapper.find('[data-category-clear]').exists()).toBe(false)
    findCategoryMenu(wrapper).vm.$emit('update:modelValue', 'Beverages')
    await flushPromises()

    const clearCategory = wrapper.get('[data-category-clear]')
    expect(clearCategory.attributes('aria-label')).toBe('Clear item category')
    expect(clearCategory.attributes('data-icon')).toBe('i-lucide-x')
    expect(clearCategory.attributes('data-variant')).toBe('ghost')
    await clearCategory.trigger('click')
    expect((wrapper.get('[data-line-category]').element as HTMLInputElement).value).toBe('')
    expect(wrapper.find('[data-category-clear]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('adds a category explicitly and sends it with the first valid entry', async () => {
    const wrapper = await mountForm()
    await wrapper.get('[data-line-item]').setValue('Coffee')
    await wrapper.get('[data-line-details]').trigger('click')
    await flushPromises()
    const categoryMenu = findCategoryMenu(wrapper)
    categoryMenu.vm.$emit('create', { value: 'Pantry' })
    expect(entryBodies).toHaveLength(0)
    await wrapper.get('[data-line-price]').setValue('4.99')
    await vi.advanceTimersByTimeAsync(600)
    await flushPromises()

    expect(entryBodies.at(-1)).toMatchObject({ method: 'POST', body: { category: 'Pantry' } })
    expect((wrapper.get('[data-line-category]').element as HTMLInputElement).value).toBe('Pantry')
    expect(categoryMenu.props('items')).toContain('Pantry')
    wrapper.unmount()
  })

  it('omits category from notes-only saves', async () => {
    matchingReceipt = receipt()
    matchingReceipt.entries[0]!.category = 'Beverages'
    const wrapper = await mountForm('Test Store', 'receipt-1')
    await wrapper.get('[data-line-details]').trigger('click')
    await wrapper.get('[data-line-notes]').setValue('weekly coupon')
    await vi.advanceTimersByTimeAsync(600)
    await flushPromises()

    expect(entryBodies.at(-1)?.method).toBe('PUT')
    expect(Object.hasOwn(entryBodies.at(-1)!.body, 'category')).toBe(false)
    wrapper.unmount()
  })


  it('asks for inline confirmation before accepting a new item', async () => {
    const wrapper = await mountForm()
    const itemMenu = wrapper.findAllComponents(UInputMenu)[1]!
    await wrapper.get('[data-line-item]').setValue('Dragon fruit')

    itemMenu.vm.$emit('create', 'Dragon fruit')
    await vi.advanceTimersByTimeAsync(0)

    expect(wrapper.text()).toContain('Create “Dragon fruit” as a new item?')
    expect((wrapper.get('[data-line-item]').element as HTMLInputElement).value).toBe('')
    expect(document.activeElement).toBe(wrapper.get('[data-confirm-item]').element)

    await wrapper.findAll('button').find(button => button.text() === 'Cancel')!.trigger('click')
    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.text()).not.toContain('Create “Dragon fruit” as a new item?')
    expect(document.activeElement).toBe(wrapper.get('[data-line-item]').element)

    await wrapper.get('[data-line-item]').setValue('Dragon fruit')
    wrapper.findAllComponents(UInputMenu)[1]!.vm.$emit('create', { value: 'Dragon fruit' })
    await vi.advanceTimersByTimeAsync(0)
    await wrapper.get('[data-confirm-item]').trigger('click')
    await vi.advanceTimersByTimeAsync(0)

    expect((wrapper.get('[data-line-item]').element as HTMLInputElement).value).toBe('Dragon fruit')
    expect(document.activeElement).toBe(wrapper.get('[data-line-price]').element)
  })

  it('saves the current receipt, starts a blank one, and focuses Store', async () => {
    const wrapper = await mountForm()
    await wrapper.get('[data-line-item]').setValue('Coffee')
    await wrapper.get('[data-line-price]').setValue('4.99')
    await flushPromises()

    const addAnother = wrapper.findAll('button').find(button => button.text() === 'Save and add another')!
    expect(addAnother.attributes('disabled')).toBeUndefined()
    await addAnother.trigger('click')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(0)
    await flushPromises()

    expect(entryAttempts).toBe(1)
    expect((wrapper.get('[data-receipt-store]').element as HTMLInputElement).value).toBe('')
    expect(wrapper.find('[data-line-item]').exists()).toBe(false)
    expect(wrapper.get('[data-receipt-date-display]').attributes('datetime')).toBe('2026-08-10')
    expect(document.activeElement).toBe(wrapper.get('[data-receipt-store]').element)
    expect(wrapper.text()).toContain('Receipt saved. Ready for another receipt.')
  })

  it('supports the documented keyboard shortcut for saving and starting another receipt', async () => {
    const wrapper = await mountForm()
    await wrapper.get('[data-line-item]').setValue('Coffee')
    await wrapper.get('[data-line-price]').setValue('4.99')

    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      ctrlKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true
    }))
    await flushPromises()
    await vi.advanceTimersByTimeAsync(0)
    await flushPromises()

    expect(entryAttempts).toBe(1)
    expect((wrapper.get('[data-receipt-store]').element as HTMLInputElement).value).toBe('')
    expect(document.activeElement).toBe(wrapper.get('[data-receipt-store]').element)
  })

  it('keeps the current receipt visible when save-and-add-another fails', async () => {
    failEntrySaves = true
    const wrapper = await mountForm()
    await wrapper.get('[data-line-item]').setValue('Coffee')
    await wrapper.get('[data-line-price]').setValue('4.99')

    await wrapper.findAll('button').find(button => button.text() === 'Save and add another')!.trigger('click')
    await flushPromises()

    expect(entryAttempts).toBe(1)
    expect((wrapper.get('[data-receipt-store]').element as HTMLInputElement).value).toBe('Test Store')
    expect((wrapper.get('[data-line-item]').element as HTMLInputElement).value).toBe('Coffee')
    expect(wrapper.text()).toContain('Changes could not be saved')
    expect(wrapper.find('[data-receipt-notice]').exists()).toBe(true)
  })

  it('adds a row with Command+Shift+Enter from an item field', async () => {
    const wrapper = await mountForm()
    await wrapper.get('[data-line-item]').setValue('Coffee')
    await wrapper.get('[data-line-price]').setValue('4.99')

    wrapper.get('[data-line-item]').element.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true
    }))
    await vi.advanceTimersByTimeAsync(0)

    expect(wrapper.findAll('[data-receipt-line]')).toHaveLength(2)
    expect(document.activeElement).toBe(wrapper.findAll('[data-line-item]')[1]!.element)
  })

  it('ignores a repeating add-row shortcut', async () => {
    const wrapper = await mountForm()
    await wrapper.get('[data-line-item]').setValue('Coffee')
    await wrapper.get('[data-line-price]').setValue('4.99')

    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      metaKey: true,
      shiftKey: true,
      repeat: true,
      bubbles: true,
      cancelable: true
    }))
    await vi.advanceTimersByTimeAsync(0)

    expect(wrapper.findAll('[data-receipt-line]')).toHaveLength(1)
  })

  it('includes expanded details in the forward keyboard path before adding a row', async () => {
    const wrapper = await mountForm()
    await wrapper.get('[data-line-item]').setValue('Coffee')
    await wrapper.get('[data-line-price]').setValue('4.99')

    const details = wrapper.get('[data-line-details]')
    await details.trigger('click')
    findCategoryMenu(wrapper).vm.$emit('update:modelValue', 'Beverages')
    await flushPromises()
    await details.trigger('keydown', { key: 'Tab' })
    await vi.advanceTimersByTimeAsync(0)
    expect(document.activeElement).toBe(wrapper.get('[data-line-category]').element)

    await wrapper.get('[data-line-category]').trigger('keydown', { key: 'Tab' })
    await vi.advanceTimersByTimeAsync(0)
    expect(document.activeElement).toBe(wrapper.get('[data-category-clear]').element)

    await wrapper.get('[data-category-clear]').trigger('keydown', { key: 'Tab' })
    await vi.advanceTimersByTimeAsync(0)
    expect(document.activeElement).toBe(wrapper.get('[data-line-notes]').element)

    await wrapper.get('[data-line-notes]').trigger('keydown', { key: 'Tab' })
    await vi.advanceTimersByTimeAsync(0)
    expect(document.activeElement).toBe(wrapper.get('[data-line-non-grocery]').element)

    await wrapper.get('[data-line-non-grocery]').trigger('keydown', { key: 'Tab' })
    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.findAll('[data-receipt-line]')).toHaveLength(2)
    expect(document.activeElement).toBe(wrapper.findAll('[data-line-item]')[1]!.element)
  })

  it('does not repeatedly retry a failed autosave and supports explicit retry', async () => {
    failEntrySaves = true
    const wrapper = await mountForm()
    await wrapper.get('[data-line-item]').setValue('Coffee')
    await wrapper.get('[data-line-price]').setValue('4.99')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(600)
    await flushPromises()
    expect(entryAttempts).toBe(1)

    await vi.advanceTimersByTimeAsync(1800)
    await flushPromises()
    expect(entryAttempts).toBe(1)

    failEntrySaves = false
    await wrapper.findAll('button').find(button => button.text() === 'Retry')!.trigger('click')
    await flushPromises()
    expect(entryAttempts).toBe(2)
    expect(wrapper.findAll('button').some(button => button.text() === 'Retry')).toBe(false)
  })

  it('confirms before deleting a saved entry', async () => {
    matchingReceipt = receipt()
    const wrapper = await mountForm('Test Store', 'receipt-1')
    await wrapper.get('[aria-label="Remove line 1"]').trigger('click')
    expect(deleteAttempts).toBe(0)
    expect(wrapper.text()).toContain('This saved entry will be permanently deleted.')

    await wrapper.findAll('button').find(button => button.text() === 'Keep item')!.trigger('click')
    expect(wrapper.text()).not.toContain('This saved entry will be permanently deleted.')

    await wrapper.get('[aria-label="Remove line 1"]').trigger('click')
    await wrapper.findAll('button').find(button => button.text() === 'Remove item')!.trigger('click')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(100)
    await flushPromises()
    expect(deleteAttempts).toBe(1)
    expect(wrapper.text()).not.toContain('This saved entry will be permanently deleted.')
  })

  it('focuses Keep item and cancels row deletion with Escape', async () => {
    matchingReceipt = receipt()
    const wrapper = await mountForm('Test Store', 'receipt-1')
    const remove = wrapper.get('[aria-label="Remove line 1"]')

    await remove.trigger('click')
    await vi.advanceTimersByTimeAsync(0)
    expect(document.activeElement).toBe(wrapper.get('[data-line-keep]').element)

    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true
    }))
    await vi.advanceTimersByTimeAsync(0)

    expect(deleteAttempts).toBe(0)
    expect(wrapper.text()).not.toContain('This saved entry will be permanently deleted.')
    expect(document.activeElement).toBe(remove.element)
  })

  it('keeps a saved row when deletion fails', async () => {
    matchingReceipt = receipt()
    failDeletes = true
    const wrapper = await mountForm('Test Store', 'receipt-1')
    await wrapper.get('[aria-label="Remove line 1"]').trigger('click')
    await wrapper.findAll('button').find(button => button.text() === 'Remove item')!.trigger('click')
    await flushPromises()

    expect(deleteAttempts).toBe(1)
    expect((wrapper.get('[data-line-item]').element as HTMLInputElement).value).toBe('Coffee')
    expect(wrapper.text()).toContain('This saved entry will be permanently deleted.')
    expect(wrapper.find('[data-receipt-notice]').exists()).toBe(true)
  })

  it('preserves saved dimensions when selecting another suggestion', async () => {
    matchingReceipt = receipt()
    suggestions = [{ value: 'Ground coffee', size: '16', unit: 'lb', price: '8.99' }]
    const wrapper = await mountForm('Test Store', 'receipt-1')
    await wrapper.get('[data-line-item]').setValue('Ground')
    await vi.advanceTimersByTimeAsync(160)
    await flushPromises()
    await wrapper.get('[data-option="Ground coffee"]').trigger('click')

    expect((wrapper.get('[data-line-size]').element as HTMLInputElement).value).toBe('12')
    expect((wrapper.get('[data-line-unit]').element as HTMLInputElement).value).toBe('oz')
    expect((wrapper.get('[data-line-price]').element as HTMLInputElement).value).toBe('4.99')
  })

  it('offers historical backfill once per line and respects the maintenance setting', async () => {
    const wrapper = await mountForm()
    await wrapper.get('[data-line-item]').setValue('Coffee')
    await wrapper.get('[data-line-price]').setValue('4.99')
    await vi.advanceTimersByTimeAsync(600)
    await flushPromises()

    await wrapper.get('[data-line-size]').setValue('12')
    await vi.advanceTimersByTimeAsync(600)
    await flushPromises()
    await vi.advanceTimersByTimeAsync(0)
    await flushPromises()
    expect(wrapper.find('.item-backfill-summary').exists()).toBe(true)
    expect(backfillChecks, JSON.stringify(entryBodies)).toBe(1)

    await wrapper.findAll('button').find(button => button.text() === 'Keep unchanged')!.trigger('click')
    await wrapper.get('[data-line-unit]').setValue('oz')
    await vi.advanceTimersByTimeAsync(600)
    await flushPromises()
    await wrapper.get('[data-line-unit]').trigger('blur')
    await flushPromises()

    expect(backfillChecks).toBe(1)
    expect(wrapper.find('.item-backfill-summary').exists()).toBe(false)

    localStorage.setItem('receipt-box:item-backfill-prompts', 'disabled')
    const disabledWrapper = await mountForm()
    await disabledWrapper.get('[data-line-item]').setValue('Coffee')
    await disabledWrapper.get('[data-line-price]').setValue('4.99')
    await vi.advanceTimersByTimeAsync(600)
    await flushPromises()
    await disabledWrapper.get('[data-line-size]').setValue('12')
    await vi.advanceTimersByTimeAsync(600)
    await flushPromises()

    expect(backfillChecks).toBe(1)
    expect(disabledWrapper.find('.item-backfill-summary').exists()).toBe(false)
  })

  it('exports receipt columns in the same order as the CSV headers', async () => {
    sourceReceiptForTests = {
      ...receipt(),
      entries: [{ ...receipt().entries[0], category: 'Produce', nonGrocery: true, notes: 'Farmers market' }]
    }
    let exportedBlob: Blob | undefined
    // Stays constructible: Nuxt 4.6's router prefetch calls `new URL` after each navigation.
    vi.stubGlobal('URL', Object.assign(class extends URL {}, {
      createObjectURL: (blob: Blob) => { exportedBlob = blob; return 'blob:receipt-export' },
      revokeObjectURL: vi.fn()
    }))
    // happy-dom would navigate to the blob URL, which breaks `new URL` for later tests.
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const wrapper = await mountForm('', 'receipt-1')

    await wrapper.findAll('button').find(button => button.text() === 'Export receipt')!.trigger('click')
    anchorClick.mockRestore()

    const csv = await exportedBlob!.text()
    expect(csv.split('\r\n')[1]).toBe('2026-08-10,Coffee,Produce,Test Store,12,oz,4.99,,,false,true,Farmers market')
  })

  it('sizes saved-receipt footer actions xl so their text stays 16px', async () => {
    sourceReceiptForTests = receipt()
    const wrapper = await mountForm('', 'receipt-1')
    const sizeOf = (label: string) => wrapper.findAll('button').find(button => button.text() === label)!.attributes('size')

    expect(sizeOf('Delete receipt')).toBe('xl')
    expect(sizeOf('Export receipt')).toBe('xl')
    expect(sizeOf('Save and add another')).toBe('xl')
  })
})

describe('receipt line keyboard flow', () => {
  const key = (wrapper: Awaited<ReturnType<typeof mountForm>>, selector: string, init: KeyboardEventInit) =>
    wrapper.get(selector).trigger('keydown', { key: 'Enter', ...init })

  async function completeFirstLine() {
    const wrapper = await mountForm()
    await wrapper.get('[data-line-item]').setValue('Coffee')
    await wrapper.get('[data-line-price]').setValue('4.99')
    return wrapper
  }

  it('walks Enter from Price to Size to Unit, then starts the next row', async () => {
    const wrapper = await completeFirstLine()

    await key(wrapper, '[data-line-price]', {})
    await vi.advanceTimersByTimeAsync(0)
    expect(document.activeElement).toBe(wrapper.get('[data-line-size]').element)

    await key(wrapper, '[data-line-size]', {})
    await vi.advanceTimersByTimeAsync(0)
    expect(document.activeElement).toBe(wrapper.get('[data-line-unit]').element)

    await key(wrapper, '[data-line-unit]', {})
    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.findAll('[data-receipt-line]')).toHaveLength(2)
    expect(document.activeElement).toBe(wrapper.findAll('[data-line-item]')[1]!.element)
  })

  it('tabs from Unit through the sale and details toggles to the next row', async () => {
    const wrapper = await completeFirstLine()

    await wrapper.get('[data-line-unit]').trigger('keydown', { key: 'Tab' })
    await vi.advanceTimersByTimeAsync(0)
    expect(document.activeElement).toBe(wrapper.get('[data-line-sale]').element)

    await wrapper.get('[data-line-sale]').trigger('keydown', { key: 'Tab' })
    await vi.advanceTimersByTimeAsync(0)
    expect(document.activeElement).toBe(wrapper.get('[data-line-details]').element)

    await wrapper.get('[data-line-details]').trigger('keydown', { key: 'Tab' })
    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.findAll('[data-receipt-line]')).toHaveLength(2)
    expect(document.activeElement).toBe(wrapper.findAll('[data-line-item]')[1]!.element)
  })

  for (const [name, modifier] of [['Command', { metaKey: true }], ['Control', { ctrlKey: true }]] as const) {
    for (const field of ['item', 'price', 'size', 'unit']) {
      it(`${name}+Enter finishes a complete row from ${field}`, async () => {
        const wrapper = await completeFirstLine()

        await key(wrapper, `[data-line-${field}]`, modifier)
        await vi.advanceTimersByTimeAsync(0)

        expect(wrapper.findAll('[data-receipt-line]')).toHaveLength(2)
        expect(document.activeElement).toBe(wrapper.findAll('[data-line-item]')[1]!.element)
      })
    }
  }

  it('returns to Item when finishing a row without one', async () => {
    const wrapper = await mountForm()
    await wrapper.get('[data-line-price]').setValue('4.99')

    await key(wrapper, '[data-line-price]', { metaKey: true })
    await vi.advanceTimersByTimeAsync(0)

    expect(wrapper.findAll('[data-receipt-line]')).toHaveLength(1)
    expect(document.activeElement).toBe(wrapper.get('[data-line-item]').element)
  })

  it('returns to Price when finishing a row without one', async () => {
    const wrapper = await mountForm()
    await wrapper.get('[data-line-item]').setValue('Coffee')

    await key(wrapper, '[data-line-item]', { ctrlKey: true })
    await vi.advanceTimersByTimeAsync(0)

    expect(wrapper.findAll('[data-receipt-line]')).toHaveLength(1)
    expect(document.activeElement).toBe(wrapper.get('[data-line-price]').element)
  })

  it('moves to the next existing row instead of adding another', async () => {
    sourceReceiptForTests = {
      ...receipt(),
      itemCount: 2,
      entries: [receipt().entries[0]!, { ...receipt().entries[0]!, id: 'entry-2', item: 'Tea', price: '3.50' }]
    }
    const wrapper = await mountForm('', 'receipt-1')

    await key(wrapper, '[data-line-price]', { metaKey: true })
    await vi.advanceTimersByTimeAsync(0)

    expect(wrapper.findAll('[data-receipt-line]')).toHaveLength(2)
    expect(document.activeElement).toBe(wrapper.findAll('[data-line-item]')[1]!.element)
  })

  it('fills size and unit from a chosen suggestion and moves focus to Price', async () => {
    suggestions = [{ value: 'Ground coffee', size: '16', unit: 'lb', price: '8.99' }]
    const wrapper = await mountForm()
    await wrapper.get('[data-line-item]').setValue('Ground')
    await vi.advanceTimersByTimeAsync(160)
    await flushPromises()
    await wrapper.findAllComponents(UInputMenu)[1]!.get('[data-option="Ground coffee"]').trigger('click')
    await vi.advanceTimersByTimeAsync(0)

    expect((wrapper.get('[data-line-item]').element as HTMLInputElement).value).toBe('Ground coffee')
    expect((wrapper.get('[data-line-size]').element as HTMLInputElement).value).toBe('16')
    expect((wrapper.get('[data-line-unit]').element as HTMLInputElement).value).toBe('lb')
    expect(document.activeElement).toBe(wrapper.get('[data-line-price]').element)
  })
})

describe('receipt line controls', () => {
  it('toggles the sale flag and reports its state through its label and title', async () => {
    const wrapper = await mountForm()
    const sale = () => wrapper.get('[data-line-sale]')

    expect(sale().attributes('aria-label')).toBe('Mark as purchased at a sale price')
    expect(sale().attributes('title')).toBe('Mark as purchased at a sale price.')
    await sale().trigger('click')
    expect(sale().attributes('aria-label')).toBe('Remove sale-price flag')
    expect(sale().attributes('title')).toBe('Purchased at a sale price. Click to remove.')
    await sale().trigger('click')
    expect(sale().attributes('aria-label')).toBe('Mark as purchased at a sale price')
  })

  it('toggles the details panel and reports its state through its label, title and aria-expanded', async () => {
    const wrapper = await mountForm()
    const details = () => wrapper.get('[data-line-details]')

    expect(wrapper.find('[data-line-panel]').exists()).toBe(false)
    expect(details().attributes('aria-label')).toBe('Show details')
    expect(details().attributes('title')).toBe('Show item details')
    expect(details().attributes('aria-expanded')).toBe('false')
    await details().trigger('click')
    expect(wrapper.find('[data-line-panel]').exists()).toBe(true)
    expect(details().attributes('aria-label')).toBe('Hide details')
    expect(details().attributes('title')).toBe('Hide item details')
    expect(details().attributes('aria-expanded')).toBe('true')
  })

  it('names each line in its remove button and title', async () => {
    const wrapper = await mountForm()
    await wrapper.get('[data-line-item]').setValue('Coffee')
    await wrapper.get('[data-line-price]').setValue('4.99')
    await wrapper.get('[data-line-item]').trigger('keydown', { key: 'Enter', metaKey: true })
    await vi.advanceTimersByTimeAsync(0)

    const remove = wrapper.findAll('[data-line-remove]')
    expect(remove.map(button => button.attributes('aria-label'))).toEqual(['Remove line 1', 'Remove line 2'])
    expect(remove.map(button => button.attributes('title'))).toEqual(['Remove line 1', 'Remove line 2'])
  })

  it('limits notes, shows a live character count and ties the category hint to its selector', async () => {
    const wrapper = await mountForm()
    await wrapper.get('[data-line-details]').trigger('click')
    const notes = wrapper.get('[data-line-notes]')
    const describedBy = (selector: string) => document.getElementById(wrapper.get(selector).attributes('aria-describedby')!)

    expect(notes.attributes('maxlength')).toBe(String(maxEntryNotesLength))
    expect(describedBy('[data-line-notes]')!.textContent).toBe(`0/${maxEntryNotesLength}`)
    expect(describedBy('[data-line-notes]')!.getAttribute('aria-live')).toBe('polite')
    await notes.setValue('Farmers market')
    expect(describedBy('[data-line-notes]')!.textContent).toBe(`14/${maxEntryNotesLength}`)
    expect(describedBy('[data-line-category]')!.textContent).not.toBe('')
  })
})

describe('receipt discard warning', () => {
  const unload = () => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }

  it('asks the browser to confirm leaving the page only while rows are unsaved', async () => {
    const wrapper = await mountForm()
    expect(unload()).toBe(false)

    await wrapper.get('[data-line-item]').setValue('Coffee')
    await wrapper.get('[data-line-price]').setValue('4.99')
    expect(unload()).toBe(true)

    await vi.advanceTimersByTimeAsync(600)
    await flushPromises()
    expect(unload()).toBe(false)
  })

  it('stops warning once the form is gone', async () => {
    const wrapper = await mountForm()
    await wrapper.get('[data-line-item]').setValue('Coffee')
    await wrapper.get('[data-line-price]').setValue('4.99')
    expect(unload()).toBe(true)

    wrapper.unmount()
    expect(unload()).toBe(false)
  })
})

describe('previous-entry backfill prompt', () => {
  async function saveDimensions(size: string, unit: string) {
    const wrapper = await mountForm()
    await wrapper.get('[data-line-item]').setValue('Coffee')
    await wrapper.get('[data-line-price]').setValue('4.99')
    await vi.advanceTimersByTimeAsync(600)
    await flushPromises()
    if (size) await wrapper.get('[data-line-size]').setValue(size)
    if (unit) await wrapper.get('[data-line-unit]').setValue(unit)
    await vi.advanceTimersByTimeAsync(600)
    await flushPromises()
    if (unit) {
      await wrapper.get('[data-line-unit]').trigger('blur')
      await flushPromises()
    }
    await vi.advanceTimersByTimeAsync(0)
    await flushPromises()
    return wrapper
  }
  const button = (wrapper: Awaited<ReturnType<typeof mountForm>>, label: string) =>
    wrapper.findAll('button').find(candidate => candidate.text() === label)!
  const checkbox = (wrapper: Awaited<ReturnType<typeof mountForm>>, label: string) => wrapper.findAll('[role="checkbox"]').find(candidate => candidate.text() === label)

  it('offers both new dimensions, counts the union and sends only the selected fields', async () => {
    backfillCounts = { size: 2, unit: 3, either: 4 }
    const wrapper = await saveDimensions('12', 'oz')

    expect(wrapper.text()).toContain('Update previous entries?')
    expect(checkbox(wrapper, 'Update missing sizes')!.attributes('aria-checked')).toBe('true')
    expect(checkbox(wrapper, 'Update missing units')!.attributes('aria-checked')).toBe('true')
    expect(button(wrapper, 'Update 4 entries')).toBeDefined()

    await checkbox(wrapper, 'Update missing units')!.trigger('click')
    expect(button(wrapper, 'Update 2 entries')).toBeDefined()
    await button(wrapper, 'Update 2 entries').trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).not.toContain('Update previous entries?'))

    expect(backfillUpdates).toEqual([{ item: 'Coffee', excludeId: 'entry-new', size: '12', unit: 'oz', fields: ['size'] }])
  })

  it('disables the update button when nothing is selected', async () => {
    backfillCounts = { size: 1, unit: 1, either: 1 }
    const wrapper = await saveDimensions('12', 'oz')

    await checkbox(wrapper, 'Update missing sizes')!.trigger('click')
    await checkbox(wrapper, 'Update missing units')!.trigger('click')

    expect(button(wrapper, 'Update 0 entries').attributes('disabled')).toBeDefined()
  })

  it('offers only the dimension that was entered and leaves older entries alone when kept unchanged', async () => {
    backfillCounts = { size: 2, unit: 5, either: 6 }
    const wrapper = await saveDimensions('12', '')

    expect(checkbox(wrapper, 'Update missing sizes')).toBeDefined()
    expect(checkbox(wrapper, 'Update missing units')).toBeUndefined()
    expect(button(wrapper, 'Update 2 entries')).toBeDefined()

    await button(wrapper, 'Keep unchanged').trigger('click')
    await flushPromises()
    expect(backfillUpdates).toEqual([])
    expect(wrapper.text()).not.toContain('Update previous entries?')
  })

  it('does not prompt when no earlier entry is missing the entered dimension', async () => {
    backfillCounts = { size: 0, unit: 4, either: 4 }
    const wrapper = await saveDimensions('12', '')

    expect(backfillChecks).toBe(1)
    expect(wrapper.text()).not.toContain('Update previous entries?')
  })

  it('keeps the prompt open and shows the error when the update fails', async () => {
    backfillCounts = { size: 1, unit: 0, either: 1 }
    const wrapper = await saveDimensions('12', '')
    registerEndpoint('/api/items/backfill', async (event: any) => {
      if (event.method === 'PATCH') throw createError({ statusCode: 500, statusMessage: 'Backfill failed' })
      return backfillCounts
    })

    await button(wrapper, 'Update 1 entry').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Update previous entries?')
    expect(wrapper.text()).toContain('Backfill failed')
  })

  it('follows the signed-in preference instead of local storage', async () => {
    registerEndpoint('/api/preferences/backfill-prompts', () => ({ enabled: false }))
    clearNuxtState(['backfill-prompts-enabled', 'backfill-prompts-loaded'])
    useState('oidc-enabled').value = true
    try {
      const wrapper = await saveDimensions('12', 'oz')

      expect(backfillChecks).toBe(0)
      expect(wrapper.text()).not.toContain('Update previous entries?')
    } finally {
      clearNuxtState(['oidc-enabled', 'backfill-prompts-enabled', 'backfill-prompts-loaded'])
    }
  })
})

describe('receipt line reordering', () => {
  function twoLineReceipt() {
    const base = receipt()
    return {
      ...base,
      itemCount: 2,
      entries: [
        base.entries[0]!,
        { ...base.entries[0]!, id: 'entry-2', item: 'Tea', price: '3.50' }
      ]
    }
  }
  const handleFor = (wrapper: Awaited<ReturnType<typeof mountForm>>, label: string) => wrapper.get(`button[aria-label="${label}"]`)
  const itemOrder = (wrapper: Awaited<ReturnType<typeof mountForm>>) => wrapper.findAll('[data-line-item]').map(input => (input.element as HTMLInputElement).value)

  it('moves a line with Alt+Arrow, keeps focus on its handle and saves the order after a debounce', async () => {
    sourceReceiptForTests = twoLineReceipt()
    const wrapper = await mountForm('', 'receipt-1')

    await handleFor(wrapper, 'Reorder line 1, Coffee').trigger('keydown', { key: 'ArrowDown', altKey: true })
    await vi.advanceTimersByTimeAsync(0)

    expect(itemOrder(wrapper)).toEqual(['Tea', 'Coffee'])
    expect(document.activeElement).toBe(handleFor(wrapper, 'Reorder line 2, Coffee').element)
    expect(orderRequests).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(399)
    expect(orderRequests).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(wrapper.get('[data-order-status]').text()).toBe('Saving order…')
    await vi.advanceTimersByTimeAsync(50)
    await flushPromises()

    expect(orderRequests).toEqual([{ method: 'PUT', body: { entryIds: ['entry-2', 'entry-1'] } }])
    expect(wrapper.get('[data-order-status]').text()).toBe('Order saved')
    expect(entryBodies).toHaveLength(0)
  })

  it('sends one request with the final order after several quick moves', async () => {
    sourceReceiptForTests = twoLineReceipt()
    const wrapper = await mountForm('', 'receipt-1')

    await handleFor(wrapper, 'Reorder line 1, Coffee').trigger('keydown', { key: 'ArrowDown', altKey: true })
    await vi.advanceTimersByTimeAsync(100)
    await handleFor(wrapper, 'Reorder line 2, Coffee').trigger('keydown', { key: 'ArrowUp', altKey: true })
    await vi.advanceTimersByTimeAsync(500)
    await flushPromises()

    expect(orderRequests.map(request => request.body.entryIds)).toEqual([['entry-1', 'entry-2']])
  })

  it('sends only saved lines and ignores plain arrows and moves past the ends', async () => {
    sourceReceiptForTests = twoLineReceipt()
    const wrapper = await mountForm('', 'receipt-1')
    await wrapper.findAll('button').find(button => button.text() === 'Add another line')!.trigger('click')
    await vi.advanceTimersByTimeAsync(0)

    await handleFor(wrapper, 'Reorder line 3').trigger('keydown', { key: 'ArrowDown', altKey: true })
    await handleFor(wrapper, 'Reorder line 1, Coffee').trigger('keydown', { key: 'ArrowDown' })
    await handleFor(wrapper, 'Reorder line 1, Coffee').trigger('keydown', { key: 'ArrowUp', altKey: true })
    await vi.advanceTimersByTimeAsync(500)
    expect(orderRequests).toHaveLength(0)

    await handleFor(wrapper, 'Reorder line 3').trigger('keydown', { key: 'ArrowUp', altKey: true })
    await vi.advanceTimersByTimeAsync(500)
    await flushPromises()

    expect(orderRequests.map(request => request.body.entryIds)).toEqual([['entry-1', 'entry-2']])
  })

  it('does not call the server when fewer than two lines are saved', async () => {
    const wrapper = await mountForm('', 'receipt-1')
    await wrapper.findAll('button').find(button => button.text() === 'Add another line')!.trigger('click')
    await vi.advanceTimersByTimeAsync(0)

    await handleFor(wrapper, 'Reorder line 2').trigger('keydown', { key: 'ArrowUp', altKey: true })
    await vi.advanceTimersByTimeAsync(500)
    await flushPromises()

    expect(orderRequests).toHaveLength(0)
    expect(wrapper.find('[data-order-status]').exists()).toBe(false)
  })

  it('shows the server error and retries the order save', async () => {
    sourceReceiptForTests = twoLineReceipt()
    failOrder = true
    const wrapper = await mountForm('', 'receipt-1')

    await handleFor(wrapper, 'Reorder line 1, Coffee').trigger('keydown', { key: 'ArrowDown', altKey: true })
    await vi.advanceTimersByTimeAsync(500)
    await flushPromises()
    expect(wrapper.get('[data-order-status]').text()).toContain('Entries changed')

    failOrder = false
    await wrapper.get('[data-order-status] button').trigger('click')
    await vi.advanceTimersByTimeAsync(50)
    await flushPromises()
    expect(orderRequests).toHaveLength(2)
    expect(orderRequests[1]!.body.entryIds).toEqual(['entry-2', 'entry-1'])
    expect(wrapper.get('[data-order-status]').text()).toBe('Order saved')
  })

  it('hides the reorder handles while selecting lines to split', async () => {
    sourceReceiptForTests = twoLineReceipt()
    const wrapper = await mountForm('', 'receipt-1')
    expect(wrapper.findAll('[data-reorder-handle]')).toHaveLength(2)

    await wrapper.findAll('button').find(button => button.text() === 'Split receipt')!.trigger('click')
    await vi.advanceTimersByTimeAsync(0)

    expect(wrapper.findAll('[data-reorder-handle]')).toHaveLength(0)
  })

  it('drags a line to a new position and saves the order', async () => {
    sourceReceiptForTests = twoLineReceipt()
    const wrapper = await mountForm('', 'receipt-1')
    wrapper.findAll('[data-receipt-line]').forEach((row, index) => {
      row.element.getBoundingClientRect = () => ({ top: index * 60, bottom: index * 60 + 60, height: 60 } as DOMRect)
    })
    const handle = handleFor(wrapper, 'Reorder line 1, Coffee').element
    handle.setPointerCapture = () => {}
    const fire = (type: string, clientY: number) => handle.dispatchEvent(new PointerEvent(type, { bubbles: true, clientY, button: 0, pointerId: 1 }))

    fire('pointerdown', 30)
    fire('pointermove', 100)
    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.findAll('[data-receipt-line]')[1]!.attributes('style')).toContain('translateY(-60px)')
    fire('pointerup', 100)
    await vi.advanceTimersByTimeAsync(500)
    await flushPromises()

    expect(itemOrder(wrapper)).toEqual(['Tea', 'Coffee'])
    expect(orderRequests.map(request => request.body.entryIds)).toEqual([['entry-2', 'entry-1']])
  })

  function saveNewLinesToReceipt1() {
    registerEndpoint('/api/entries', {
      method: 'POST',
      handler: async (event: any) => {
        const body = await readBody(event)
        entryBodies.push({ method: 'POST', body })
        return {
          id: 'entry-new', receiptId: 'receipt-1', purchasedOn: '2026-08-10', location: 'Test Store',
          item: body.item, price: body.price, size: null, unit: null, saleItem: false, nonGrocery: false, notes: body.notes, category: null
        }
      }
    })
  }

  async function addFilledLine(wrapper: Awaited<ReturnType<typeof mountForm>>) {
    await wrapper.findAll('button').find(button => button.text() === 'Add another line')!.trigger('click')
    await vi.advanceTimersByTimeAsync(0)
    await wrapper.findAll('[data-line-item]')[2]!.setValue('Milk')
    await wrapper.findAll('[data-line-price]')[2]!.setValue('2.50')
  }

  it('resends the order when a new line moved above saved lines is autosaved', async () => {
    sourceReceiptForTests = twoLineReceipt()
    saveNewLinesToReceipt1()
    const wrapper = await mountForm('', 'receipt-1')
    await addFilledLine(wrapper)

    await handleFor(wrapper, 'Reorder line 3, Milk').trigger('keydown', { key: 'ArrowUp', altKey: true })
    await vi.advanceTimersByTimeAsync(450)
    await flushPromises()
    expect(orderRequests.map(request => request.body.entryIds)).toEqual([['entry-1', 'entry-2']])

    await vi.advanceTimersByTimeAsync(200)
    await flushPromises()
    expect(entryBodies.filter(request => request.method === 'POST')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(500)
    await flushPromises()

    expect(itemOrder(wrapper)).toEqual(['Coffee', 'Milk', 'Tea'])
    expect(orderRequests).toHaveLength(2)
    expect(orderRequests[1]!.body.entryIds).toEqual(['entry-1', 'entry-new', 'entry-2'])
    expect(wrapper.get('[data-order-status]').text()).toBe('Order saved')
  })

  it('does not send an order when a new line appended at the bottom is autosaved', async () => {
    sourceReceiptForTests = twoLineReceipt()
    saveNewLinesToReceipt1()
    const wrapper = await mountForm('', 'receipt-1')
    await addFilledLine(wrapper)

    await vi.advanceTimersByTimeAsync(1500)
    await flushPromises()

    expect(entryBodies.filter(request => request.method === 'POST')).toHaveLength(1)
    expect(itemOrder(wrapper)).toEqual(['Coffee', 'Tea', 'Milk'])
    expect(orderRequests).toHaveLength(0)
    expect(wrapper.find('[data-order-status]').exists()).toBe(false)
  })
})
