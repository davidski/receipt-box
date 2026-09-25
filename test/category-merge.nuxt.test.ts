import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { beforeEach, expect, it, vi } from 'vitest'
import { createError, readBody } from 'h3'
import ManagePage from '../app/components/ManagePage.vue'

const Slot = defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) })
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

let requests: Record<string, unknown>[]
let categoryRequests: Record<string, unknown>[]
let managedCategories: Array<{ id: string, name: string, itemCount: number, entryCount: number }>
let failResolution = false
beforeEach(() => {
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
  registerEndpoint('/api/items/duplicates', () => ({ items: [{ name: 'Soy milk', uses: 2, category: 'Dairy' }], groups: [], hiddenGroups: [] }))
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
    global: { stubs: { UCard: Slot, UFormField: Slot, UButton: Button, USelectMenu: Select, UInput: Input, UModal: Modal, UIcon: true, UCheckbox: true, CategoryInput } }
  })
  await flushPromises()
  await wrapper.get('select[placeholder="Choose an item"]').setValue('Soy milk')
  await flushPromises()
  await wrapper.get('input[aria-label="Item name"]').setValue('Milk')
  await wrapper.get('form.item-history-editor').trigger('submit')
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
    global: { stubs: { UCard: Slot, UFormField: Slot, UButton: Button, USelectMenu: Select, UInput: Input, UModal: Modal, UIcon: true, UCheckbox: true, CategoryInput } }
  })
  await flushPromises()
  expect(wrapper.text()).toContain('2 items · 5 unique entries')
  await wrapper.findAll('button').find(button => button.text() === 'Rename')!.trigger('click')
  await wrapper.get('input[aria-label="Rename Dairy"]').setValue('Milk')
  await wrapper.get('form.store-edit').trigger('submit')
  await flushPromises()
  expect(categoryRequests[0]).toMatchObject({ method: 'PATCH', body: { name: 'Milk' } })
  await vi.waitFor(() => expect(wrapper.find('form.store-edit').exists()).toBe(false))
  expect(wrapper.text()).toContain('Milk')

  const mergeButton = wrapper.findAll('button').find(button => button.text() === 'Merge')!
  expect(mergeButton.attributes('disabled')).toBeDefined()
  await wrapper.get('select[aria-label="Merge Milk into"]').setValue('cat-beverages')
  expect(mergeButton.attributes('disabled')).toBeUndefined()
  await mergeButton.trigger('click')
  const mergeDialog = wrapper.get('[data-dialog="Merge categories?"]')
  expect(mergeDialog.text()).toContain('2 items and 5 unique purchase entries')
  await mergeDialog.findAll('button').at(-1)!.trigger('click')
  await flushPromises()
  expect(categoryRequests[1]).toMatchObject({ method: 'POST', body: { sourceId: 'cat-dairy', targetId: 'cat-beverages' } })
  await vi.waitFor(() => expect(wrapper.find('[data-dialog="Merge categories?"]').exists()).toBe(false))
  await vi.waitFor(() => expect(wrapper.text()).toContain('3 items · 7 unique entries'))

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
    global: { stubs: { UCard: Slot, UFormField: Slot, UButton: Button, USelectMenu: Select, UInput: Input, UModal: Modal, UIcon: true, UCheckbox: true, CategoryInput } }
  })
  await flushPromises()
  await wrapper.get('input[aria-label="New category name"]').setValue(' Frozen Foods ')
  await wrapper.get('form.store-add').trigger('submit')
  await flushPromises()
  expect(categoryRequests[0]).toMatchObject({ method: 'POST', body: { name: 'Frozen Foods' } })
  await vi.waitFor(() => expect(wrapper.text()).toContain('Frozen Foods'))
  expect(wrapper.text()).toContain('0 items · 0 unique entries')

  await wrapper.get('input[aria-label="New category name"]').setValue('frozen foods')
  await wrapper.get('form.store-add').trigger('submit')
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
    global: { stubs: { UCard: Slot, UFormField: Slot, UButton: Button, USelectMenu: Select, UInput: Input, UModal: Modal, UIcon: true, UCheckbox: true, CategoryInput } }
  })
  await flushPromises()
  await wrapper.get('select[placeholder="Choose an item"]').setValue('Soy milk')
  await flushPromises()
  expect((wrapper.get('select[aria-label="Item category"]').element as HTMLSelectElement).value).toBe('Dairy')
  expect(wrapper.get('form.item-history-editor button[type="submit"]').attributes('disabled')).toBeDefined()
  await wrapper.get('select[aria-label="Item category"]').setValue('Beverages')
  expect(wrapper.text()).toContain('Set category for all purchases of “Soy milk” to Beverages')
  await wrapper.get('form.item-history-editor').trigger('submit')
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
    global: { stubs: { UCard: Slot, UFormField: Slot, UButton: Button, USelectMenu: Select, UInput: Input, UModal: Modal, UIcon: true, UCheckbox: true, CategoryInput } }
  })
  await flushPromises()
  await wrapper.get('select[placeholder="Choose an item"]').setValue('Soy milk')
  await flushPromises()
  await wrapper.get('select[aria-label="Item category"]').setValue('')
  expect(wrapper.text()).toContain('Set category for all purchases of “Soy milk” to Uncategorized')
  await wrapper.get('form.item-history-editor').trigger('submit')
  await wrapper.get('[data-dialog="Apply item changes?"] button:last-child').trigger('click')
  await flushPromises()
  expect(requests[0]).toMatchObject({ source: 'Soy milk', target: 'Soy milk', category: null })
  await vi.waitFor(() => expect(wrapper.text()).toContain('Category for Soy milk was set to Uncategorized for all item history'))
  wrapper.unmount()
})
