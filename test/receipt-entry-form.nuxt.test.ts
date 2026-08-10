import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
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
          emit('update:modelValue', value)
          emit('update:searchTerm', value)
        }
      }),
      ...props.items.map((item: any) => h('button', {
        type: 'button',
        'data-option': item.label ?? item,
        onClick: () => item.onSelect?.()
      }, item.label ?? item))
    ])
  }
})

const UButton = defineComponent({
  inheritAttrs: false,
  props: {
    label: { type: String, default: '' },
    disabled: Boolean,
    loading: Boolean
  },
  setup(props, { attrs }) {
    return () => h('button', { ...attrs, type: 'button', disabled: props.disabled || props.loading }, props.label)
  }
})

const UFormField = defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) })
const UPopover = defineComponent({ setup: (_, { slots }) => () => h('div', [slots.default?.(), slots.content?.()]) })
const UIcon = defineComponent({ setup: () => () => h('span') })
const UAlert = defineComponent({ props: { description: String }, setup: props => () => h('div', props.description) })
const UModal = defineComponent({ setup: (_, { slots }) => () => h('div', slots.body?.()) })
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
let suggestions: Array<{ value: string, size: string, unit: string, price: string }>

async function mountForm(initialLocation = 'Test Store') {
  const wrapper = await mountSuspended(ReceiptEntryForm, {
    props: { initialDate: '2026-08-10', initialLocation },
    route: '/',
    attachTo: document.body,
    global: { stubs }
  })
  await vi.advanceTimersByTimeAsync(0)
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    setTimeout(() => callback(0), 0)
    return 1
  })
  matchingReceipt = null
  entryAttempts = 0
  failEntrySaves = false
  deleteAttempts = 0
  failDeletes = false
  suggestions = []
  registerEndpoint('/api/receipts/match', () => ({ receipt: matchingReceipt }))
  registerEndpoint('/api/suggestions', () => suggestions)
  registerEndpoint('/api/entries', {
    method: 'POST',
    handler: () => {
      entryAttempts++
      if (failEntrySaves) throw new Error('offline')
      return {
        id: 'entry-new', receiptId: 'receipt-new', purchasedOn: '2026-08-10', location: 'Test Store',
        item: 'Coffee', price: '4.99', size: null, unit: null, saleItem: false, nonGrocery: false, notes: null
      }
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
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('receipt item entry interactions', () => {
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
    await details.trigger('keydown', { key: 'Tab' })
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
})
