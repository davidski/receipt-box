import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError, getQuery, readBody } from 'h3'
import ManagePage from '../app/components/ManagePage.vue'
import MealieManage from '../app/components/MealieManage.vue'
import { clearNuxtData, useRoute } from '#imports'

const Slot = defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) })
const Button = defineComponent({
  props: { label: String, disabled: Boolean, to: String },
  setup: (props, { attrs }) => () => h('button', { ...attrs, disabled: props.disabled, 'data-to': props.to }, props.label)
})
const Alert = defineComponent({ props: ['description'], setup: (props, { slots, attrs }) => () => h('div', { ...attrs, role: 'alert' }, [props.description, slots.actions?.()]) })
const Badge = defineComponent({ props: ['label'], setup: props => () => h('span', props.label) })
const Tabs = defineComponent({
  props: ['items', 'modelValue'], emits: ['update:modelValue'],
  setup: (props, { emit }) => () => h('div', props.items.map((tab: { label: string, value: string }) => h('button', { 'data-tab': tab.value, onClick: () => emit('update:modelValue', tab.value) }, tab.label)))
})
const Select = defineComponent({
  props: ['items', 'modelValue', 'searchTerm'], emits: ['update:modelValue', 'update:searchTerm'],
  setup: (props, { emit, attrs }) => () => h('div', [
    h('input', { 'data-search': '', value: props.searchTerm, onInput: (event: Event) => emit('update:searchTerm', (event.target as HTMLInputElement).value) }),
    h('select', { 'aria-label': attrs['aria-label'], onChange: (event: Event) => emit('update:modelValue', (event.target as HTMLSelectElement).value) }, [
      h('option', { value: '' }, 'Choose'),
      ...props.items.map((item: { label: string, value: string }) => h('option', { value: item.value }, item.label))
    ])
  ])
})
const Modal = defineComponent({
  props: ['open', 'title', 'description'],
  setup: (props, { slots }) => () => props.open ? h('section', { 'data-dialog': props.title }, [h('p', props.description), slots.footer?.()]) : null
})
const stubs = { UCard: Slot, UButton: Button, UAlert: Alert, UBadge: Badge, UTabs: Tabs, USelectMenu: Select, UModal: Modal, UIcon: true }

const beans = { item: 'Beans & Rice', mealieFoodId: 'food-1', foodName: 'Chickpeas', broken: false, hasEntries: true }
const broken = { item: 'Old Sauce', mealieFoodId: 'food-2', foodName: 'Merged away', broken: true, hasEntries: true }
const orphan = { item: 'Gone Item', mealieFoodId: 'food-3', foodName: null, broken: true, hasEntries: false }
const configured = {
  configured: true, lastSyncedAt: '2026-10-01T12:00:00Z', lastError: null as string | null,
  counts: { activeFoods: 706, inactiveFoods: 2, aliases: 30, activeUnits: 12, inactiveUnits: 1 }
}

let status: Record<string, unknown>
let mappings: typeof beans[]
let unmapped: { item: string, entries: number }[]
let syncBodies: { force: boolean }[]
let syncHandler: (body: { force: boolean }) => unknown
let foodQueries: string[]
let puts: Record<string, unknown>[]
let deletes: unknown[]
let putFailure: Error | null
let deleteFailure: Error | null
let listFailure: boolean

enableAutoUnmount(afterEach)

beforeEach(() => {
  clearNuxtData()
  status = { ...configured }
  mappings = [beans, broken, orphan]
  unmapped = [{ item: 'Flour', entries: 1 }, { item: 'Sugar', entries: 3 }]
  syncBodies = []
  syncHandler = () => ({ status: 'synced', foods: 706, aliases: 30, units: 12, deactivatedFoods: 1, deactivatedUnits: 0 })
  foodQueries = []
  puts = []
  deletes = []
  putFailure = null
  deleteFailure = null
  listFailure = false
  registerEndpoint('/api/_auth/session', () => ({ user: { sub: 'user-1' } }))
  registerEndpoint('/api/auth/config', () => ({ enabled: false }))
  registerEndpoint('/api/stores', () => [{ id: 's1', name: 'Corner Shop', uses: 0 }])
  registerEndpoint('/api/preferences/backfill-prompts', () => ({ enabled: true }))
  registerEndpoint('/api/mealie/status', () => status)
  registerEndpoint('/api/mealie/sync', { method: 'POST', handler: async (event) => {
    const body = await readBody(event)
    syncBodies.push(body)
    return syncHandler(body)
  } })
  registerEndpoint('/api/mealie/foods', (event) => {
    const search = String(getQuery(event).search ?? '')
    foodQueries.push(search)
    return { foods: [{ id: 'food-1', name: 'Chickpeas' }, { id: 'food-9', name: 'Lentils' }].filter(food => food.name.toLowerCase().includes(search.toLowerCase())) }
  })
  registerEndpoint('/api/food-mappings', () => {
    if (listFailure) throw createError({ statusCode: 500 })
    return { mappings }
  })
  registerEndpoint('/api/food-mappings/unmapped', () => ({ items: unmapped }))
  registerEndpoint('/api/food-mappings/problems', () => ({
    brokenMappings: mappings.filter(mapping => mapping.broken),
    orphanedMappings: mappings.filter(mapping => !mapping.hasEntries),
    unmappedItems: unmapped,
    itemsWithoutPackageSize: [{ item: 'Sugar', entries: 3 }]
  }))
  registerEndpoint('/api/items/food', { method: 'PUT', handler: async (event) => {
    if (putFailure) throw putFailure
    const body = await readBody(event)
    puts.push(body)
    unmapped = unmapped.filter(row => row.item !== body.item)
    mappings = [...mappings, { item: body.item, mealieFoodId: body.mealieFoodId, foodName: 'Lentils', broken: false, hasEntries: true }]
    return {}
  } })
  registerEndpoint('/api/items/food', { method: 'DELETE', handler: (event) => {
    if (deleteFailure) throw deleteFailure
    const { item } = getQuery(event)
    deletes.push(item)
    mappings = mappings.filter(mapping => mapping.item !== item)
    return { item, deleted: true }
  } })
})

async function mountMealie() {
  const wrapper = await mountSuspended(MealieManage, { global: { stubs } })
  await flushPromises()
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof mountMealie>>
const button = (wrapper: Wrapper, label: string) => wrapper.get(`button[aria-label="${label}"]`)
const buttonText = (wrapper: Wrapper, text: string) => wrapper.findAll('button').find(candidate => candidate.text() === text)!
const rows = (wrapper: Wrapper) => wrapper.get('[data-testid="food-mapping-list"]').findAll('li strong').map(row => row.text())
const mountManage = async (route: string) => {
  const wrapper = await mountSuspended(ManagePage, { route, global: { stubs: { ...stubs, UFormField: Slot, UInput: true, UCheckbox: true, CategoryInput: true } } })
  await flushPromises()
  return wrapper
}

describe('hidden without Mealie', () => {
  beforeEach(() => { status = { configured: false, lastSyncedAt: null, lastError: null, counts: null } })

  it('shows no Mealie link or requests on the existing pages', async () => {
    const wrapper = await mountManage('/data/stores')
    expect(wrapper.find('[data-to="/data/mealie"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Manage stores')
    expect(wrapper.text()).not.toContain('Mealie')
  })

  it('redirects the Mealie address to Stores', async () => {
    const wrapper = await mountManage('/data/mealie')
    await vi.waitFor(() => expect(useRoute().path).toBe('/data/stores'))
    expect(wrapper.text()).not.toContain('Food mappings')
  })

  it('stays hidden when the status cannot be read', async () => {
    registerEndpoint('/api/mealie/status', () => { throw createError({ statusCode: 500 }) })
    const wrapper = await mountManage('/data/stores')
    expect(wrapper.find('[data-to="/data/mealie"]').exists()).toBe(false)
  })
})

it('links to the Mealie section when configured', async () => {
  const stores = await mountManage('/data/stores')
  expect(stores.find('[data-to="/data/mealie"]').exists()).toBe(true)
  const section = await mountManage('/data/mealie')
  expect(section.text()).toContain('Food mappings')
})

describe('integration', () => {
  it('shows counts and the last sync time', async () => {
    const text = (await mountMealie()).get('[data-testid="mealie-status"]').text()
    expect(text).toContain(new Date(configured.lastSyncedAt).toLocaleString())
    expect(text).toContain('Active foods706')
    expect(text).toContain('Inactive foods2')
    expect(text).toContain('Aliases30')
    expect(text).toContain('Active units12')
    expect(text).toContain('Inactive units1')
  })

  it('shows a catalog that has never synced, and the last error', async () => {
    status = { ...configured, lastSyncedAt: null, lastError: 'Mealie GET /api/foods returned 500' }
    const wrapper = await mountMealie()
    expect(wrapper.get('[data-testid="mealie-status"]').text()).toContain('Never')
    expect(wrapper.get('[data-testid="mealie-last-error"]').text()).toContain('returned 500')
  })

  it('syncs without force and reports the result', async () => {
    const wrapper = await mountMealie()
    await buttonText(wrapper, 'Sync now').trigger('click')
    await flushPromises()
    expect(syncBodies).toEqual([{ force: false }])
    await vi.waitFor(() => expect(wrapper.text()).toContain('Synced 706 foods, 30 aliases and 12 units. Deactivated 1 foods'))
  })

  it('says when another sync already holds the lock', async () => {
    syncHandler = () => ({ status: 'skipped' })
    const wrapper = await mountMealie()
    await buttonText(wrapper, 'Sync now').trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('Another sync is already running'))
  })

  it('only forces after an explicit confirmation of the guard', async () => {
    syncHandler = ({ force }) => {
      if (!force) throw createError({ statusCode: 409, statusMessage: 'Mealie sync refused to deactivate 300 of 706 cached foods', data: { forceable: true } })
      return { status: 'synced', foods: 406, aliases: 0, units: 0, deactivatedFoods: 300, deactivatedUnits: 0 }
    }
    const wrapper = await mountMealie()
    await buttonText(wrapper, 'Sync now').trigger('click')
    await flushPromises()
    const dialog = wrapper.get('[data-dialog="Deactivate these foods?"]')
    expect(dialog.text()).toContain('refused to deactivate 300 of 706')
    expect(syncBodies).toEqual([{ force: false }])

    await buttonText(wrapper, 'Force sync').trigger('click')
    await flushPromises()
    expect(syncBodies).toEqual([{ force: false }, { force: true }])
    await vi.waitFor(() => expect(wrapper.text()).toContain('Deactivated 300 foods'))
    expect(wrapper.find('[data-dialog]').exists()).toBe(false)
  })

  it('does not force when the guard confirmation is cancelled', async () => {
    syncHandler = () => { throw createError({ statusCode: 409, statusMessage: 'refused', data: { forceable: true } }) }
    const wrapper = await mountMealie()
    await buttonText(wrapper, 'Sync now').trigger('click')
    await flushPromises()
    await buttonText(wrapper, 'Cancel').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-dialog]').exists()).toBe(false)
    expect(syncBodies).toEqual([{ force: false }])
    expect(wrapper.get('[data-testid="mealie-last-error"]').text()).toContain('refused')
  })

  it.each([
    [409, 'Mealie is not configured'],
    [502, 'Mealie GET /api/foods returned 500']
  ])('shows a %i that is not the guard without offering force', async (statusCode, statusMessage) => {
    syncHandler = () => { throw createError({ statusCode, statusMessage }) }
    const wrapper = await mountMealie()
    await buttonText(wrapper, 'Sync now').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-dialog]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="mealie-last-error"]').text()).toContain(statusMessage)
  })
})

describe('food mappings', () => {
  it('filters All, Mapped, Unmapped and Broken with counts', async () => {
    const wrapper = await mountMealie()
    expect(wrapper.get('[data-tab="all"]').text()).toBe('All (5)')
    expect(rows(wrapper)).toEqual(['Old Sauce', 'Gone Item', 'Flour', 'Sugar', 'Beans & Rice'])
    await wrapper.get('[data-tab="mapped"]').trigger('click')
    expect(rows(wrapper)).toEqual(['Beans & Rice'])
    await wrapper.get('[data-tab="unmapped"]').trigger('click')
    expect(rows(wrapper)).toEqual(['Flour', 'Sugar'])
    await wrapper.get('[data-tab="broken"]').trigger('click')
    expect(rows(wrapper)).toEqual(['Old Sauce', 'Gone Item'])
    expect(wrapper.get('[data-testid="food-mapping-list"]').text()).toContain('Food missing from the catalog')
  })

  it('shows an empty filter', async () => {
    mappings = []
    const wrapper = await mountMealie()
    await wrapper.get('[data-tab="broken"]').trigger('click')
    expect(wrapper.find('[data-testid="food-mapping-list"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Nothing here.')
  })

  it('pages long lists and restarts when the filter changes', async () => {
    unmapped = Array.from({ length: 35 }, (_, index) => ({ item: `Item ${index}`, entries: 1 }))
    mappings = []
    const wrapper = await mountMealie()
    expect(rows(wrapper)).toHaveLength(30)
    await buttonText(wrapper, 'Show 30 more').trigger('click')
    expect(rows(wrapper)).toHaveLength(35)
    await wrapper.get('[data-tab="broken"]').trigger('click')
    await wrapper.get('[data-tab="unmapped"]').trigger('click')
    expect(rows(wrapper)).toHaveLength(30)
  })

  it('offers only Clear when the item no longer has entries', async () => {
    const wrapper = await mountMealie()
    expect(wrapper.find('button[aria-label="Change food for Gone Item"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label="Clear mapping for Gone Item"]').exists()).toBe(true)
    expect(wrapper.find('button[aria-label="Clear mapping for Flour"]').exists()).toBe(false)
  })

  it('searches the cached foods and maps the chosen one', async () => {
    const wrapper = await mountMealie()
    await button(wrapper, 'Choose food for Flour').trigger('click')
    await vi.waitFor(() => expect(foodQueries).toEqual(['']))
    await wrapper.get('input[data-search]').setValue('lent')
    await vi.waitFor(() => expect(foodQueries).toEqual(['', 'lent']))
    await vi.waitFor(() => expect(wrapper.get('select[aria-label="Mealie food for Flour"]').text()).not.toContain('Chickpeas'))

    await wrapper.get('select[aria-label="Mealie food for Flour"]').setValue('food-9')
    await flushPromises()
    expect(puts).toEqual([{ item: 'Flour', mealieFoodId: 'food-9' }])
    await vi.waitFor(() => expect(wrapper.find('button[aria-label="Change food for Flour"]').exists()).toBe(true))
    expect(wrapper.find('select').exists()).toBe(false)
  })

  it('ignores a slower response to an older search', async () => {
    const pending: Array<() => void> = []
    registerEndpoint('/api/mealie/foods', async (event) => {
      const search = String(getQuery(event).search ?? '')
      if (search === 'slow') await new Promise<void>(resolve => pending.push(resolve))
      return { foods: [{ id: search, name: `Result ${search}` }] }
    })
    const wrapper = await mountMealie()
    await button(wrapper, 'Choose food for Flour').trigger('click')
    await wrapper.get('input[data-search]').setValue('slow')
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    await wrapper.get('input[data-search]').setValue('fast')
    await vi.waitFor(() => expect(wrapper.get('select').text()).toContain('Result fast'))
    pending[0]!()
    await flushPromises()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(wrapper.get('select').text()).not.toContain('Result slow')
  })

  it('shows a failed food search', async () => {
    registerEndpoint('/api/mealie/foods', () => { throw createError({ statusCode: 500, statusMessage: 'Search broke' }) })
    const wrapper = await mountMealie()
    await button(wrapper, 'Choose food for Flour').trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('Search broke'))
  })

  it('keeps the picker open and shows why a mapping failed', async () => {
    putFailure = createError({ statusCode: 409, statusMessage: 'That food is no longer active in Mealie' })
    const wrapper = await mountMealie()
    await button(wrapper, 'Choose food for Flour').trigger('click')
    await vi.waitFor(() => expect(wrapper.get('select').text()).toContain('Lentils'))
    await wrapper.get('select').setValue('food-9')
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.text()).toContain('no longer active in Mealie'))
    expect(wrapper.find('select').exists()).toBe(true)
    await buttonText(wrapper, 'Cancel').trigger('click')
    expect(wrapper.find('select').exists()).toBe(false)
  })

  it('clears a mapping after confirmation, encoding the item name', async () => {
    const wrapper = await mountMealie()
    await button(wrapper, 'Clear mapping for Beans & Rice').trigger('click')
    expect(deletes).toEqual([])
    await buttonText(wrapper, 'Clear mapping').trigger('click')
    await flushPromises()
    expect(deletes).toEqual(['Beans & Rice'])
    await vi.waitFor(() => expect(wrapper.find('button[aria-label="Clear mapping for Beans & Rice"]').exists()).toBe(false))
  })

  it('shows a failed clear and keeps the mapping', async () => {
    deleteFailure = createError({ statusCode: 500, statusMessage: 'Clear broke' })
    const wrapper = await mountMealie()
    await button(wrapper, 'Clear mapping for Beans & Rice').trigger('click')
    await buttonText(wrapper, 'Clear mapping').trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('Clear broke'))
    expect(wrapper.find('button[aria-label="Clear mapping for Beans & Rice"]').exists()).toBe(true)
  })

  it('offers a retry when the list cannot load', async () => {
    listFailure = true
    const wrapper = await mountMealie()
    expect(wrapper.text()).toContain('Could not load the food mappings.')
    expect(wrapper.find('[data-testid="food-mapping-list"]').exists()).toBe(false)
    listFailure = false
    await buttonText(wrapper, 'Try again').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[data-testid="food-mapping-list"]').exists()).toBe(true))
  })
})

describe('problems', () => {
  const group = (wrapper: Wrapper, title: string) => wrapper.get(`section[aria-label="${title}"]`).text()

  it('lists all four cached problem groups', async () => {
    const wrapper = await mountMealie()
    expect(group(wrapper, 'Mapped to an inactive or missing food')).toContain('Old Sauce')
    expect(group(wrapper, 'Mapped to an inactive or missing food')).toContain('Merged away')
    expect(group(wrapper, 'Mapped, but the item has no entries')).toContain('Gone Item')
    expect(group(wrapper, 'Unmapped items')).toContain('Flour')
    expect(group(wrapper, 'Unmapped items')).toContain('1 entry')
    expect(group(wrapper, 'No usable package size')).toContain('3 entries')
  })

  it('shows None for an empty group and refreshes after a change', async () => {
    mappings = [broken]
    const wrapper = await mountMealie()
    expect(group(wrapper, 'Mapped, but the item has no entries')).toContain('None.')
    await button(wrapper, 'Clear mapping for Old Sauce').trigger('click')
    await buttonText(wrapper, 'Clear mapping').trigger('click')
    await vi.waitFor(() => expect(group(wrapper, 'Mapped to an inactive or missing food')).toContain('None.'))
  })

  it('shows a load failure', async () => {
    registerEndpoint('/api/food-mappings/problems', () => { throw createError({ statusCode: 500 }) })
    expect((await mountMealie()).text()).toContain('Could not load the problems.')
  })
})
