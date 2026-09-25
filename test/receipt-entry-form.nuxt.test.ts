import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { readBody } from 'h3'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
const UModal = defineComponent({ setup: (_, { slots }) => () => h('div', [slots.body?.(), slots.footer?.()]) })
const UCheckbox = UInput
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
let entryAttempts: number
let failEntrySaves: boolean
let deleteAttempts: number
let failDeletes: boolean
let backfillChecks: number
let suggestions: Array<{ value: string, category?: string | null, size: string, unit: string, price: string }>
let categories: string[]
let entryBodies: Array<{ method: string, body: any }>
const mountedForms: Array<{ unmount: () => void }> = []

async function mountForm(initialLocation = 'Test Store') {
  const wrapper = await mountSuspended(ReceiptEntryForm, {
    props: { initialDate: '2026-08-10', initialLocation },
    route: '/',
    attachTo: document.body,
    global: { stubs }
  })
  await vi.advanceTimersByTimeAsync(0)
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
  entryAttempts = 0
  failEntrySaves = false
  deleteAttempts = 0
  failDeletes = false
  backfillChecks = 0
  suggestions = []
  categories = ['Beverages']
  entryBodies = []
  localStorageStub.clear()
  registerEndpoint('/api/receipts/match', () => ({ receipt: matchingReceipt }))
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
  await flushPromises()
  document.body.innerHTML = ''
  localStorageStub.clear()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('receipt item entry interactions', () => {
  it('clearly labels the action that clears an item category', async () => {
    const wrapper = await mountForm()
    await wrapper.get('[data-line-details]').trigger('click')
    findCategoryMenu(wrapper).vm.$emit('update:modelValue', 'Beverages')
    await flushPromises()

    const clearCategory = wrapper.get('[data-category-clear]')
    expect(clearCategory.text()).toBe('Clear item category')
    expect(clearCategory.attributes('data-icon')).toBe('i-lucide-x')
    expect(clearCategory.attributes('data-variant')).toBe('outline')
    await clearCategory.trigger('click')
    expect((wrapper.get('[data-line-category]').element as HTMLInputElement).value).toBe('')
    expect(clearCategory.attributes('disabled')).toBeDefined()
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
    const wrapper = await mountForm()
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
    expect((wrapper.get('input[type="date"]').element as HTMLInputElement).value).toBe('2026-08-10')
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
    const wrapper = await mountForm()
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
    const wrapper = await mountForm()
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
    const wrapper = await mountForm()
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
    const wrapper = await mountForm()
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
})
