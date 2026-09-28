import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { getQuery, readBody } from 'h3'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RouterView } from 'vue-router'
import ReceiptEntryForm from '../app/components/ReceiptEntryForm.vue'

const UInput = defineComponent({
  inheritAttrs: false,
  props: { modelValue: { type: [String, Number], default: '' } },
  emits: ['update:modelValue'],
  setup(props, { attrs, emit }) {
    return () => h('input', {
      ...attrs,
      value: props.modelValue,
      onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).value)
    })
  }
})

const UInputMenu = defineComponent({
  inheritAttrs: false,
  props: {
    modelValue: { type: String, default: '' },
    items: { type: Array, default: () => [] }
  },
  emits: ['update:modelValue', 'update:searchTerm', 'update:open', 'create'],
  setup(props, { attrs, emit }) {
    return () => h('div', [
      h('input', {
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
    disabled: Boolean,
    loading: Boolean
  },
  setup(props, { attrs }) {
    return () => h('button', { ...attrs, type: 'button', 'data-icon': props.icon, 'data-variant': props.variant, disabled: props.disabled || props.loading }, props.label)
  }
})

const UFormField = defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) })
const UPopover = defineComponent({ setup: (_, { slots }) => () => h('div', [slots.default?.(), slots.content?.()]) })
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

const stubs = { UInput, UInputMenu, UButton, UFormField, UPopover, UIcon, UAlert, UModal, UCheckbox, USwitch }
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
let suggestions: Array<{ value: string, category?: string | null, size: string, unit: string, price: string }>
let categories: string[]
let entryBodies: Array<{ method: string, body: any }>
let splitRequests: Array<{ method: string, body: any }>
let splitResult: any
let splitUndoResult: any
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
  suggestions = []
  categories = ['Beverages']
  entryBodies = []
  splitRequests = []
  splitResult = null
  splitUndoResult = null
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
  registerEndpoint('/api/suggestions', () => suggestions)
  registerEndpoint('/api/categories', () => categories)
  registerEndpoint('/api/items/backfill', () => {
    backfillChecks++
    return { size: 1, unit: 1, either: 1 }
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
    expect(wrapper.findAllComponents(UCheckbox).some(box => box.props('label') === 'Allow date change')).toBe(false)

    await wrapper.setProps({ initialDate: '2026-08-11' })
    expect(dateDisplay.attributes('datetime')).toBe('2026-08-11')
    wrapper.unmount()
  })

  it('shows the current date and store in the read-only sticky footer summary', async () => {
    const wrapper = await mountForm()
    const footerContext = wrapper.get('[data-receipt-footer-context]')

    expect(footerContext.text()).toContain('DateAug 10, 2026')
    expect(footerContext.text()).toContain('StoreTest Store')
    expect(footerContext.find('input, button').exists()).toBe(false)

    await wrapper.get('[data-receipt-store]').setValue('Other Store')
    await vi.waitFor(() => expect(wrapper.get('[data-receipt-footer-context]').text()).toContain('Other Store'))
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
    await wrapper.findAllComponents(UCheckbox).find(box => box.props('label') === 'Allow date change')!.trigger('click')
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

    expect(wrapper.findAllComponents(UCheckbox)).toHaveLength(2)
    await wrapper.findAll('button').find(button => button.text() === 'Split receipt')!.trigger('click')
    expect(wrapper.findAllComponents(UCheckbox)).toHaveLength(4)
    expect(wrapper.find('.receipt-line-content').attributes('inert')).toBeDefined()
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
    await vi.waitFor(() => expect(wrapper.find('.receipt-split-notice').exists()).toBe(true))

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

  it('locks saved receipt date and store until each change is explicitly allowed', async () => {
    matchingReceipt = receipt()
    const wrapper = await mountForm('Test Store', 'receipt-1')
    const datePermission = wrapper.findAllComponents(UCheckbox).find(box => box.props('label') === 'Allow date change')!
    const storePermission = wrapper.findAllComponents(UCheckbox).find(box => box.props('label') === 'Allow store change')!

    expect((wrapper.get('input[type="date"]').element as HTMLInputElement).disabled).toBe(true)
    expect(datePermission.props('modelValue')).toBe(false)
    expect(storePermission.props('modelValue')).toBe(false)

    await datePermission.trigger('click')
    expect((wrapper.get('input[type="date"]').element as HTMLInputElement).disabled).toBe(false)
    wrapper.unmount()
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
    expect(wrapper.find('.notice').exists()).toBe(true)
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
    expect(wrapper.find('.notice').exists()).toBe(true)
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
    vi.stubGlobal('URL', {
      createObjectURL: (blob: Blob) => { exportedBlob = blob; return 'blob:receipt-export' },
      revokeObjectURL: vi.fn()
    })
    const wrapper = await mountForm('', 'receipt-1')

    await wrapper.findAll('button').find(button => button.text() === 'Export receipt')!.trigger('click')

    const csv = await exportedBlob!.text()
    expect(csv.split('\r\n')[1]).toBe('2026-08-10,Coffee,Produce,Test Store,12,oz,4.99,,,false,true,Farmers market')
  })
})
