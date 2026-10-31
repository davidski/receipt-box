import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { DOMWrapper, flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createError, readBody } from 'h3'
import ManagePage from '../app/components/ManagePage.vue'
import { clearNuxtData, clearNuxtState, useState } from '#imports'

const Slot = defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) })
// Renders the field's label next to its control, so tests can find a control by the label a person sees.
const Field = defineComponent({
  props: { label: String },
  setup: (props, { slots }) => () => h('div', [props.label ? h('label', props.label) : null, slots.default?.()])
})
const Button = defineComponent({
  props: { label: String, disabled: Boolean },
  setup: (props, { attrs }) => () => h('button', { ...attrs, disabled: props.disabled }, props.label)
})
const Select = defineComponent({
  props: ['modelValue', 'items'], emits: ['update:modelValue'],
  setup: (props, { emit, attrs }) => () => h('select', {
    ...attrs, value: props.modelValue,
    onChange: (event: Event) => emit('update:modelValue', (event.target as HTMLSelectElement).value)
  }, [h('option', { value: '' }, 'Choose'), ...(props.items || []).map((item: any) => h('option', { value: item.value ?? item }, item.label ?? item))])
})
const Modal = defineComponent({
  props: ['open', 'title', 'description'],
  setup: (props, { slots }) => () => props.open ? h('section', { 'data-dialog': props.title }, [h('p', props.description), slots.body?.(), slots.footer?.()]) : null
})
const Input = defineComponent({
  props: ['modelValue'], emits: ['update:modelValue'],
  setup: (props, { emit, attrs }) => () => h('input', { ...attrs, value: props.modelValue, onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).value) })
})
const CategoryInput = defineComponent({
  props: ['modelValue', 'items'], emits: ['update:modelValue'],
  setup: (props, { emit, attrs }) => () => h('select', {
    ...attrs, value: props.modelValue ?? '',
    onChange: (event: Event) => emit('update:modelValue', (event.target as HTMLSelectElement).value || null)
  }, [h('option', { value: '' }, 'Uncategorized'), ...(props.items || []).map((name: string) => h('option', { value: name }, name))])
})

const inputLabelled = (wrapper: { findAll: (selector: string) => any[] }, text: string) =>
  wrapper.findAll('label').find(label => label.text() === text)!.element.parentElement!.querySelector('input')!

let requests: Record<string, unknown>[]
let categoryRequests: Record<string, unknown>[]
let managedCategories: Array<{ id: string, name: string, itemCount: number, entryCount: number }>
let failResolution = false
let duplicateFetches: number
let preferenceSaves: unknown[]
let failPreferenceSave: boolean
beforeEach(() => {
  duplicateFetches = 0
  preferenceSaves = []
  failPreferenceSave = false
  registerEndpoint('/api/_auth/session', () => ({ user: { sub: 'user-1' } }))
  registerEndpoint('/api/preferences/backfill-prompts', async (event) => {
    if (event.method !== 'PUT') return { enabled: true }
    if (failPreferenceSave) throw createError({ statusCode: 500 })
    preferenceSaves.push(await readBody(event))
    return { enabled: false }
  })
  requests = []
  categoryRequests = []
  managedCategories = [
    { id: 'cat-dairy', name: 'Dairy', itemCount: 2, entryCount: 5 },
    { id: 'cat-beverages', name: 'Beverages', itemCount: 1, entryCount: 2 }
  ]
  failResolution = false
  registerEndpoint('/api/auth/config', () => ({ enabled: false }))
  registerEndpoint('/api/stores', () => [])
  registerEndpoint('/api/categories/manage', () => managedCategories)
  registerEndpoint('/api/categories', { method: 'POST', handler: async event => {
    const body = await readBody(event)
    categoryRequests.push({ method: 'POST', body })
    if (managedCategories.some(category => category.name.toLowerCase() === body.name.toLowerCase())) {
      throw createError({ statusCode: 409, statusMessage: 'A category with that name already exists' })
    }
    const category = { id: 'cat-new', name: body.name, itemCount: 0, entryCount: 0 }
    managedCategories.push(category)
    return category
  } })
  registerEndpoint('/api/categories/cat-dairy', { method: 'PATCH', handler: async event => {
    const body = await readBody(event)
    categoryRequests.push({ method: 'PATCH', body })
    managedCategories = managedCategories.map(category => category.id === 'cat-dairy' ? { ...category, name: body.name } : category)
    return managedCategories[0]
  } })
  registerEndpoint('/api/categories/merge', { method: 'POST', handler: async event => {
    const body = await readBody(event)
    categoryRequests.push({ method: 'POST', body })
    const source = managedCategories.find(category => category.id === body.sourceId)!
    const target = managedCategories.find(category => category.id === body.targetId)!
    target.itemCount += source.itemCount
    target.entryCount += source.entryCount
    managedCategories = managedCategories.filter(category => category.id !== source.id)
    return target
  } })
  registerEndpoint('/api/categories/cat-beverages', { method: 'DELETE', handler: () => {
    categoryRequests.push({ method: 'DELETE', body: {} })
    managedCategories = []
    return null
  } })
  registerEndpoint('/api/items/duplicates', () => { duplicateFetches++; return { items: [{ name: 'Soy milk', uses: 2, category: 'Dairy' }], groups: [], hiddenGroups: [] } })
  registerEndpoint('/api/items/dimensions', () => [])
  registerEndpoint('/api/items/rename', { method: 'PATCH', handler: async event => {
    const body = await readBody(event)
    requests.push(body)
    if (!Object.hasOwn(body, 'category')) throw createError({ statusCode: 409, data: { categories: ['Dairy', 'Beverages'] } })
    if (failResolution) throw createError({ statusCode: 400, statusMessage: 'Could not save category' })
    return { target: body.target, renamedEntries: body.source === body.target ? 0 : 2, updatedEntries: 0 }
  } })
})

async function openConflict() {
  const wrapper = await mountSuspended(ManagePage, {
    route: '/data/items',
    global: { stubs: { UCard: Slot, UFormField: Field, UButton: Button, USelectMenu: Select, UInput: Input, UModal: Modal, UIcon: true, UCheckbox: true, CategoryInput } }
  })
  await flushPromises()
  await wrapper.get('select[placeholder="Choose an item"]').setValue('Soy milk')
  await flushPromises()
  await wrapper.get('input[aria-label="Rename to"]').setValue('Milk')
  await wrapper.get('form[data-testid="item-history-editor"]').trigger('submit')
  await wrapper.get('[data-dialog="Apply item changes?"] button:last-child').trigger('click')
  await flushPromises()
  return wrapper
}

it('requires a category choice before retrying a conflicting rename', async () => {
  const wrapper = await openConflict()
  const dialog = wrapper.get('[data-dialog="Choose a category"]')
  expect(dialog.get('button:last-child').attributes('disabled')).toBeDefined()
  expect(requests).toHaveLength(1)
  expect(requests[0]).not.toHaveProperty('category')
  await dialog.get('select').setValue('Dairy')
  await dialog.get('button:last-child').trigger('click')
  await flushPromises()
  expect(requests[1]).toMatchObject({ source: 'Soy milk', target: 'Milk', category: 'Dairy' })
  await vi.waitFor(() => expect(wrapper.text()).toContain('2 entries were renamed to Milk'))
  wrapper.unmount()
})

it('renames, merges, and deletes managed categories with impact confirmation', async () => {
  const wrapper = await mountSuspended(ManagePage, {
    route: '/data/categories',
    global: { stubs: { UCard: Slot, UFormField: Field, UButton: Button, USelectMenu: Select, UInput: Input, UModal: Modal, UIcon: true, UCheckbox: true, CategoryInput } }
  })
  await flushPromises()
  expect(wrapper.text()).toContain('2 items across 5 unique entries')
  await wrapper.findAll('button').find(button => button.text() === 'Rename')!.trigger('click')
  await new DOMWrapper(inputLabelled(wrapper, 'Rename Dairy')).setValue('Milk')
  await wrapper.get('form[data-testid="category-edit"]').trigger('submit')
  await flushPromises()
  expect(categoryRequests[0]).toMatchObject({ method: 'PATCH', body: { name: 'Milk' } })
  await vi.waitFor(() => expect(wrapper.find('form[data-testid="category-edit"]').exists()).toBe(false))
  expect(wrapper.text()).toContain('Milk')

  await wrapper.get('select[aria-label="Merge Milk into"]').setValue('cat-beverages')
  await flushPromises()
  const mergeDialog = wrapper.get('[data-dialog="Merge categories?"]')
  expect(mergeDialog.text()).toContain('2 items and 5 unique purchase entries')
  await mergeDialog.findAll('button').at(-1)!.trigger('click')
  await flushPromises()
  expect(categoryRequests[1]).toMatchObject({ method: 'POST', body: { sourceId: 'cat-dairy', targetId: 'cat-beverages' } })
  await vi.waitFor(() => expect(wrapper.find('[data-dialog="Merge categories?"]').exists()).toBe(false))
  await vi.waitFor(() => expect(wrapper.text()).toContain('3 items across 7 unique entries'))

  await wrapper.findAll('button').find(button => button.text() === 'Delete')!.trigger('click')
  const deleteDialog = wrapper.get('[data-dialog="Delete category?"]')
  expect(deleteDialog.text()).toContain('3 items and 7 unique purchase entries')
  expect(deleteDialog.text()).toContain('Uncategorized')
  await deleteDialog.findAll('button').at(-1)!.trigger('click')
  await flushPromises()
  expect(categoryRequests[2]).toMatchObject({ method: 'DELETE', body: {} })
  await vi.waitFor(() => expect(wrapper.text()).toContain('No categories yet'))
  wrapper.unmount()
})

it('adds a category and reports a duplicate name', async () => {
  const wrapper = await mountSuspended(ManagePage, {
    route: '/data/categories',
    global: { stubs: { UCard: Slot, UFormField: Field, UButton: Button, USelectMenu: Select, UInput: Input, UModal: Modal, UIcon: true, UCheckbox: true, CategoryInput } }
  })
  await flushPromises()
  await new DOMWrapper(inputLabelled(wrapper, 'New category name')).setValue(' Frozen Foods ')
  await wrapper.get('form[data-testid="category-add"]').trigger('submit')
  await flushPromises()
  expect(categoryRequests[0]).toMatchObject({ method: 'POST', body: { name: 'Frozen Foods' } })
  await vi.waitFor(() => expect(wrapper.text()).toContain('Frozen Foods'))
  expect(wrapper.text()).toContain('0 items across 0 unique entries')

  await new DOMWrapper(inputLabelled(wrapper, 'New category name')).setValue('frozen foods')
  await wrapper.get('form[data-testid="category-add"]').trigger('submit')
  await flushPromises()
  expect(categoryRequests).toHaveLength(2)
  expect(wrapper.text()).toContain('A category with that name already exists')
  wrapper.unmount()
})

it('cancelling a category conflict makes no second write', async () => {
  const wrapper = await openConflict()
  await wrapper.get('[data-dialog="Choose a category"] button').trigger('click')
  expect(requests).toHaveLength(1)
  expect(wrapper.find('[data-dialog="Choose a category"]').exists()).toBe(false)
  wrapper.unmount()
})

it('shows a failed resolution without claiming the rename succeeded', async () => {
  const wrapper = await openConflict()
  failResolution = true
  const dialog = wrapper.get('[data-dialog="Choose a category"]')
  await dialog.get('select').setValue('Dairy')
  await dialog.get('button:last-child').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('Could not save category')
  expect(wrapper.text()).not.toContain('entries were renamed')
  wrapper.unmount()
})

it('changes an item category for all of its historical entries', async () => {
  const wrapper = await mountSuspended(ManagePage, {
    route: '/data/items',
    global: { stubs: { UCard: Slot, UFormField: Field, UButton: Button, USelectMenu: Select, UInput: Input, UModal: Modal, UIcon: true, UCheckbox: true, CategoryInput } }
  })
  await flushPromises()
  await wrapper.get('select[placeholder="Choose an item"]').setValue('Soy milk')
  await flushPromises()
  expect((wrapper.get('select[aria-label="Item category"]').element as HTMLSelectElement).value).toBe('Dairy')
  expect(wrapper.get('form[data-testid="item-history-editor"] button[type="submit"]').attributes('disabled')).toBeDefined()
  await wrapper.get('select[aria-label="Item category"]').setValue('Beverages')
  expect(wrapper.text()).toContain('Set category for all purchases of “Soy milk” to Beverages')
  await wrapper.get('form[data-testid="item-history-editor"]').trigger('submit')
  const confirmation = wrapper.get('[data-dialog="Apply item changes?"]')
  expect(confirmation.text()).toContain('all purchases of “Soy milk” to “Beverages”')
  await confirmation.get('button:last-child').trigger('click')
  await flushPromises()
  expect(requests[0]).toMatchObject({ source: 'Soy milk', target: 'Soy milk', category: 'Beverages' })
  await vi.waitFor(() => expect(wrapper.text()).toContain('Category for Soy milk was set to Beverages for all item history'))
  wrapper.unmount()
})

it('clears an item category for all of its historical entries', async () => {
  const wrapper = await mountSuspended(ManagePage, {
    route: '/data/items',
    global: { stubs: { UCard: Slot, UFormField: Field, UButton: Button, USelectMenu: Select, UInput: Input, UModal: Modal, UIcon: true, UCheckbox: true, CategoryInput } }
  })
  await flushPromises()
  await wrapper.get('select[placeholder="Choose an item"]').setValue('Soy milk')
  await flushPromises()
  await wrapper.get('select[aria-label="Item category"]').setValue('')
  expect(wrapper.text()).toContain('Set category for all purchases of “Soy milk” to Uncategorized')
  await wrapper.get('form[data-testid="item-history-editor"]').trigger('submit')
  await wrapper.get('[data-dialog="Apply item changes?"] button:last-child').trigger('click')
  await flushPromises()
  expect(requests[0]).toMatchObject({ source: 'Soy milk', target: 'Soy milk', category: null })
  await vi.waitFor(() => expect(wrapper.text()).toContain('Category for Soy milk was set to Uncategorized for all item history'))
  wrapper.unmount()
})

it('fetches duplicate item suggestions only once Items is opened', async () => {
  const stores = await mountSuspended(ManagePage, { route: '/data/stores', global: { stubs: { UCard: Slot, UFormField: Field, UButton: Button, UInput: Input, UModal: Modal, UIcon: true } } })
  await flushPromises()
  expect(duplicateFetches).toBe(0)
  stores.unmount()

  const items = await mountSuspended(ManagePage, { route: '/data/items', global: { stubs: { UCard: Slot, UFormField: Field, UButton: Button, USelectMenu: Select, UInput: Input, UModal: Modal, UIcon: true, UCheckbox: true, CategoryInput } } })
  await flushPromises()
  expect(duplicateFetches).toBe(1)
  items.unmount()
})

it('sends an unknown Manage section to Stores and keeps the query', async () => {
  const wrapper = await mountSuspended(ManagePage, { route: '/data/stores', global: { stubs: { UCard: Slot, UFormField: Field, UButton: Button, UInput: Input, UModal: Modal, UIcon: true } } })
  await wrapper.vm.$router.push('/data/nonsense?from=nav')
  await flushPromises()
  expect(wrapper.vm.$router.currentRoute.value.fullPath).toBe('/data/stores?from=nav')
  wrapper.unmount()
})

const Checkbox = defineComponent({
  props: { modelValue: Boolean, label: String },
  emits: ['update:modelValue'],
  setup: (props, { emit }) => () => h('button', { role: 'checkbox', 'aria-checked': String(props.modelValue), onClick: () => emit('update:modelValue', !props.modelValue) }, props.label)
})
const Alert = defineComponent({ props: { description: String }, setup: props => () => h('p', props.description) })
const preferenceStubs = { UCard: Slot, UButton: Button, UAlert: Alert, UIcon: true, UCheckbox: Checkbox }
const backfillPreferenceStates = ['backfill-prompts-enabled', 'backfill-prompts-loaded', 'backfill-prompts-error']
function signIn() {
  clearNuxtState(backfillPreferenceStates)
  useState('oidc-enabled').value = true
}
const preferenceToggle = (wrapper: Awaited<ReturnType<typeof mountSuspended>>) => wrapper.get('[role="checkbox"]')

afterEach(() => {
  clearNuxtState(['oidc-enabled', ...backfillPreferenceStates])
  vi.unstubAllGlobals()
})

it('remembers the receipt-prompt preference in the browser when sign-in is off', async () => {
  const stored = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) })
  clearNuxtState(backfillPreferenceStates)
  const wrapper = await mountSuspended(ManagePage, { route: '/data/preferences', global: { stubs: preferenceStubs } })
  await vi.waitFor(() => expect(preferenceToggle(wrapper).attributes('disabled')).toBeUndefined())
  expect(preferenceToggle(wrapper).attributes('aria-checked')).toBe('true')

  await preferenceToggle(wrapper).trigger('click')
  expect(stored.get('receipt-box:item-backfill-prompts')).toBe('disabled')
  expect(preferenceToggle(wrapper).attributes('aria-checked')).toBe('false')
  await preferenceToggle(wrapper).trigger('click')
  expect(stored.get('receipt-box:item-backfill-prompts')).toBe('enabled')
  wrapper.unmount()
})

it('saves the receipt-prompt preference to the account when signed in', async () => {
  signIn()
  const wrapper = await mountSuspended(ManagePage, { route: '/data/preferences', global: { stubs: preferenceStubs } })
  await vi.waitFor(() => expect(preferenceToggle(wrapper).attributes('disabled')).toBeUndefined())
  expect(preferenceToggle(wrapper).attributes('aria-checked')).toBe('true')

  await preferenceToggle(wrapper).trigger('click')
  await flushPromises()
  expect(preferenceSaves).toEqual([{ enabled: false }])
  expect(preferenceToggle(wrapper).attributes('aria-checked')).toBe('false')
  wrapper.unmount()
})

it('puts the receipt-prompt preference back and explains when the account save fails', async () => {
  failPreferenceSave = true
  signIn()
  const wrapper = await mountSuspended(ManagePage, { route: '/data/preferences', global: { stubs: preferenceStubs } })
  await vi.waitFor(() => expect(preferenceToggle(wrapper).attributes('disabled')).toBeUndefined())

  await preferenceToggle(wrapper).trigger('click')
  await vi.waitFor(() => expect(wrapper.text()).toContain('Could not save this preference. Try again.'))
  expect(preferenceToggle(wrapper).attributes('aria-checked')).toBe('true')
  wrapper.unmount()
})

// Real Nuxt UI field and input, so the label is tied to its control the way a screen reader sees it.
const labelledStubs = { UCard: Slot, UButton: Button, UModal: Modal, USelectMenu: Select, UIcon: true }
function expectLabelled(wrapper: Awaited<ReturnType<typeof mountSuspended>>, text: string, formSelector: string) {
  const label = wrapper.get(`${formSelector} label`)
  const input = wrapper.get(`${formSelector} input`).element as HTMLInputElement
  expect(label.text()).toBe(text)
  expect(input.id).not.toBe('')
  expect(label.attributes('for')).toBe(input.id)
  expect(input.getAttribute('aria-label')).toBeNull()
  expect(input.placeholder).toBe('')
}

it('labels the add-store field and the rename-store field with visible text', async () => {
  registerEndpoint('/api/stores', () => [{ id: 'store-1', name: 'Corner Market', uses: 3 }])
  const wrapper = await mountSuspended(ManagePage, { route: '/data/stores', global: { stubs: labelledStubs } })
  await flushPromises()
  expectLabelled(wrapper, 'New store name', 'form[data-testid="store-add"]')

  await wrapper.findAll('button').find(button => button.text() === 'Rename')!.trigger('click')
  await flushPromises()
  expectLabelled(wrapper, 'Rename Corner Market', 'form[data-testid="store-edit"]')
  expect(wrapper.find('form[data-testid="store-add"] label').exists()).toBe(true)
  wrapper.unmount()
})

it('labels the add-category field and the rename-category field with visible text', async () => {
  const wrapper = await mountSuspended(ManagePage, { route: '/data/categories', global: { stubs: labelledStubs } })
  await flushPromises()
  expectLabelled(wrapper, 'New category name', 'form[data-testid="category-add"]')

  await wrapper.findAll('button').find(button => button.text() === 'Rename')!.trigger('click')
  await flushPromises()
  expectLabelled(wrapper, 'Rename Dairy', 'form[data-testid="category-edit"]')
  // A label that survives typing is the point: the field keeps its name once it holds a value.
  await wrapper.get('form[data-testid="category-edit"] input').setValue('Milk')
  expect(wrapper.get('form[data-testid="category-edit"] label').text()).toBe('Rename Dairy')
  wrapper.unmount()
})

it('stacks the add-store and add-category fields on phones so the label does not wrap', async () => {
  for (const [route, form] of [['/data/stores', 'store-add'], ['/data/categories', 'category-add']]) {
    const wrapper = await mountSuspended(ManagePage, { route, global: { stubs: labelledStubs } })
    await flushPromises()
    expect(wrapper.get(`form[data-testid="${form}"]`).classes()).toEqual(expect.arrayContaining(['grid-cols-[1fr_auto]', 'max-sm:grid-cols-1']))
    wrapper.unmount()
  }
})

it('sets the item-change review sentences in ink, not muted, on the accent-soft panel', async () => {
  const wrapper = await mountSuspended(ManagePage, {
    route: '/data/items',
    global: { stubs: { UCard: Slot, UFormField: Field, UButton: Button, USelectMenu: Select, UInput: Input, UModal: Modal, UIcon: true, UCheckbox: true, CategoryInput } }
  })
  await flushPromises()
  await wrapper.get('select[placeholder="Choose an item"]').setValue('Soy milk')
  await flushPromises()
  await wrapper.get('input[aria-label="Rename to"]').setValue('Milk')
  const sentences = wrapper.get('.bg-accent-soft.border').findAll('span.block')
  expect(sentences.length).toBeGreaterThan(0)
  for (const sentence of sentences) {
    expect(sentence.classes()).toContain('text-ink')
    expect(sentence.classes()).not.toContain('text-muted')
  }
  wrapper.unmount()
})

const foods = [
  { id: 'food-a', name: 'Chickpeas', active: true },
  { id: 'food-b', name: null, active: false }
]

function registerFoodConflict(categories: string[]) {
  registerEndpoint('/api/items/rename', { method: 'PATCH', handler: async (event) => {
    const body = await readBody(event)
    requests.push(body)
    if (!Object.hasOwn(body, 'foodResolution')) throw createError({ statusCode: 409, statusMessage: 'Conflict', data: { categories, foods } })
    return { target: body.target, renamedEntries: 2, updatedEntries: 0 }
  } })
}

const mountedConflict = async () => {
  const wrapper = await openConflict()
  return { wrapper, dialog: wrapper.find('section[data-dialog]') }
}

it('resolves a food-only conflict with the chosen food', async () => {
  registerFoodConflict([])
  const { wrapper, dialog } = await mountedConflict()
  expect(dialog.attributes('data-dialog')).toBe('Choose a food')
  expect(dialog.text()).toContain('Food missing from the catalog (inactive)')
  expect(dialog.get('button:last-child').attributes('disabled')).toBeDefined()
  await dialog.get('select').setValue('food-a')
  await dialog.get('button:last-child').trigger('click')
  await flushPromises()
  expect(requests[1]).toMatchObject({ source: 'Soy milk', target: 'Milk', foodResolution: 'food-a' })
  expect(requests[1]).not.toHaveProperty('category')
  await vi.waitFor(() => expect(wrapper.text()).toContain('2 entries were renamed to Milk'))
})

it('sends null to clear the mapping', async () => {
  registerFoodConflict([])
  const { dialog } = await mountedConflict()
  await dialog.get('select').setValue('clear')
  await dialog.get('button:last-child').trigger('click')
  await flushPromises()
  expect(requests[1]!.foodResolution).toBeNull()
})

it('resolves a category and food conflict in one retry, needing both choices', async () => {
  registerFoodConflict(['Dairy', 'Beverages'])
  const { dialog } = await mountedConflict()
  expect(dialog.attributes('data-dialog')).toBe('Choose a category and food')
  const [category, food] = dialog.findAll('select')
  await category!.setValue('Dairy')
  expect(dialog.get('button:last-child').attributes('disabled')).toBeDefined()
  await food!.setValue('food-a')
  await dialog.get('button:last-child').trigger('click')
  await flushPromises()
  expect(requests).toHaveLength(2)
  expect(requests[1]).toMatchObject({ category: 'Dairy', foodResolution: 'food-a' })
})

it('keeps earlier choices when a retry finds another conflict', async () => {
  registerEndpoint('/api/items/rename', { method: 'PATCH', handler: async (event) => {
    const body = await readBody(event)
    requests.push(body)
    if (!Object.hasOwn(body, 'category')) throw createError({ statusCode: 409, data: { categories: ['Dairy', 'Beverages'], foods: [] } })
    if (!Object.hasOwn(body, 'foodResolution')) throw createError({ statusCode: 409, data: { categories: [], foods } })
    return { target: body.target, renamedEntries: 2, updatedEntries: 0 }
  } })
  const { wrapper, dialog } = await mountedConflict()
  await dialog.get('select').setValue('Dairy')
  await dialog.get('button:last-child').trigger('click')
  await flushPromises()
  const second = wrapper.get('[data-dialog="Choose a food"]')
  await second.get('select').setValue('food-a')
  await second.get('button:last-child').trigger('click')
  await flushPromises()
  expect(requests[2]).toMatchObject({ category: 'Dairy', foodResolution: 'food-a' })
})

it('shows a non-conflict 409 as an error, not a dialog', async () => {
  registerEndpoint('/api/items/rename', { method: 'PATCH', handler: () => { throw createError({ statusCode: 409, statusMessage: 'No entries still match' }) } })
  const { wrapper, dialog } = await mountedConflict()
  expect(dialog.exists()).toBe(false)
  expect(wrapper.text()).toContain('No entries still match')
})

it('sends the food resolution when merging a duplicate group', async () => {
  const mergeRequests: Record<string, unknown>[] = []
  clearNuxtData()
  registerEndpoint('/api/items/duplicates', () => ({
    items: [],
    groups: [{ id: 'g1', preferredTarget: 'Milk', reasons: ['similar'], variants: [{ name: 'Milk', uses: 1, lastUsed: '2026-01-01' }, { name: 'Soy milk', uses: 1, lastUsed: '2026-01-01' }] }],
    hiddenGroups: []
  }))
  registerEndpoint('/api/items/merge', { method: 'POST', handler: async (event) => {
    const body = await readBody(event)
    mergeRequests.push(body)
    if (!Object.hasOwn(body, 'foodResolution')) throw createError({ statusCode: 409, data: { categories: [], foods } })
    return { target: body.target, mergedNames: 1, mergedEntries: 1 }
  } })
  const wrapper = await mountSuspended(ManagePage, {
    route: '/data/items',
    global: { stubs: { UCard: Slot, UFormField: Field, UButton: Button, USelectMenu: Select, UInput: Input, UModal: Modal, UIcon: true, UCheckbox: true, CategoryInput, UBadge: true } }
  })
  await flushPromises()
  await wrapper.findAll('button').find(button => button.text() === 'Merge variants')!.trigger('click')
  await wrapper.get('[data-dialog="Merge item variants?"] button:last-child').trigger('click')
  await flushPromises()
  const dialog = wrapper.get('[data-dialog="Choose a food"]')
  await dialog.get('select').setValue('clear')
  await dialog.get('button:last-child').trigger('click')
  await flushPromises()
  expect(mergeRequests[1]).toEqual({ target: 'Milk', sources: ['Soy milk'], foodResolution: null })
  await vi.waitFor(() => expect(wrapper.text()).toContain('merged into Milk'))
})
