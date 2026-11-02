import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref, watch } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError, getQuery, readBody } from 'h3'
import ManagePage from '../app/components/ManagePage.vue'
import MealieManage from '../app/components/MealieManage.vue'
import { itemPath } from '../app/utils/item-path'
import { clearNuxtData, useFormField, useRoute } from '#imports'

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
// Mirrors UInputMenu where it matters here: one box showing the typed text or else the chosen label,
// client-side filtering unless ignore-filter, and the text cleared when an option is chosen.
// The real one emits again for the chosen option only when the kept model is a different object, which the browser run covers.
type StubItem = { label: string, value: string, description?: string }
const InputMenu = defineComponent({
  inheritAttrs: false,
  props: {
    items: { type: Array, default: () => [] }, modelValue: null, searchTerm: String, by: String, placeholder: String,
    id: String, ignoreFilter: Boolean, disabled: Boolean, loading: Boolean, virtualize: Boolean, defaultOpen: Boolean, openOnFocus: Boolean, openOnClick: Boolean, autofocus: Boolean
  },
  emits: ['update:modelValue', 'update:searchTerm'],
  setup(props, { emit }) {
    // The real one takes its id from the surrounding UFormField, which is what ties the visible label to the box.
    const { id } = useFormField(props)
    const typed = ref<string>(props.searchTerm ?? '')
    watch(() => props.searchTerm, term => { typed.value = term ?? '' })
    const valueOf = (model: unknown) => model && typeof model === 'object' ? (model as StubItem).value : model
    const shown = () => {
      if (!props.modelValue) return ''
      const found = (props.items as StubItem[]).find(item => item.value === valueOf(props.modelValue))
      return found?.label ?? (typeof props.modelValue === 'object' ? (props.modelValue as StubItem).label : String(props.modelValue))
    }
    const choose = (item: StubItem) => {
      typed.value = ''
      emit('update:searchTerm', '')
      emit('update:modelValue', item)
    }
    return () => h('div', { 'data-loading': String(Boolean(props.loading)) }, [
      h('input', {
        id: id.value, role: 'combobox', 'data-search': '', placeholder: props.placeholder, disabled: props.disabled,
        value: typed.value || shown(),
        onInput: (event: Event) => { typed.value = (event.target as HTMLInputElement).value; emit('update:searchTerm', typed.value) }
      }),
      h('ul', { role: 'listbox' }, (props.items as StubItem[])
        .filter(item => props.ignoreFilter || !typed.value || item.label.toLowerCase().includes(typed.value.toLowerCase()))
        .map(item => h('li', { role: 'option', 'data-value': item.value, onClick: () => choose(item) }, [item.label, item.description].filter(Boolean).join(' — '))))
    ])
  }
})
const Modal = defineComponent({
  props: ['open', 'title', 'description'],
  setup: (props, { slots }) => () => props.open ? h('section', { 'data-dialog': props.title }, [h('p', props.description), slots.footer?.()]) : null
})
const stubs = { UCard: Slot, UButton: Button, UAlert: Alert, UBadge: Badge, UTabs: Tabs, UInputMenu: InputMenu, UModal: Modal, UIcon: true }

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
let putGate: Promise<void> | null
let deleteFailure: Error | null
let listFailure: boolean
let suggestionsByItem: Record<string, unknown[]>
let suggestionQueries: unknown[]
let suggestionFailure: boolean
let cachedFoods: Record<string, { id: string, name: string, active: boolean } | 'invalid' | 'broken'>

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
  putGate = null
  deleteFailure = null
  listFailure = false
  suggestionsByItem = {}
  suggestionQueries = []
  suggestionFailure = false
  cachedFoods = { 'food-9': { id: 'food-9', name: 'Lentils', active: true }, 'food-2': { id: 'food-2', name: 'Merged away', active: false }, bad: 'invalid', oops: 'broken' }
  registerEndpoint('/api/food-mappings/suggestions', (event) => {
    const { item } = getQuery(event)
    suggestionQueries.push(item)
    if (suggestionFailure) throw createError({ statusCode: 500 })
    return { item, suggestions: suggestionsByItem[String(item)] ?? [] }
  })
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
  // registerEndpoint matches literal paths, so each id the tests use gets its own route.
  for (const id of ['food-9', 'food-2', 'food-new', 'bad', 'oops']) {
    registerEndpoint(`/api/mealie/foods/${id}`, () => {
      const food = cachedFoods[id]
      if (food === 'invalid') throw createError({ statusCode: 400, statusMessage: 'Invalid Mealie food id' })
      if (food === 'broken') throw createError({ statusCode: 500, statusMessage: 'Lookup broke' })
      if (!food) throw createError({ statusCode: 404, statusMessage: 'Food not found in the synced Mealie catalog' })
      return food
    })
  }
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
    itemsWithoutPackageSize: [{ item: 'Beans & Rice', entries: 3 }]
  }))
  registerEndpoint('/api/items/food', { method: 'PUT', handler: async (event) => {
    await putGate
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

async function mountMealie(route = '/data/mealie') {
  const wrapper = await mountSuspended(MealieManage, { route, global: { stubs } })
  await flushPromises()
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof mountMealie>>
const button = (wrapper: Wrapper, label: string) => wrapper.get(`button[aria-label="${label}"]`)
const buttonText = (wrapper: Wrapper, text: string) => wrapper.findAll('button').find(candidate => candidate.text() === text)!
// The control a visible <label> points at, so a field only counts when its label is really associated.
const box = (scope: Wrapper | ReturnType<Wrapper['get']>, label: string) => {
  const caption = scope.findAll('label').find(candidate => candidate.text() === label)
  if (!caption) throw new Error(`No visible label “${label}”`)
  return scope.get(`[id="${caption.attributes('for')}"]`)
}
const optionTexts = (scope: Wrapper | ReturnType<Wrapper['get']>) => scope.findAll('[role="option"]').map(option => option.text())
const choose = (scope: Wrapper | ReturnType<Wrapper['get']>, value: string) => scope.get(`[role="option"][data-value="${value}"]`).trigger('click')
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
    expect(text).toContain('Foods706')
    expect(text).toContain('Units12')
    expect(text).not.toMatch(/inactive|alias/i)
  })

  it('introduces the section in plain words', async () => {
    const wrapper = await mountMealie()
    const text = wrapper.text()
    expect(wrapper.findAll('h2').map(heading => heading.text())).toEqual(['Sync', 'Food mappings'])
    expect(text).toContain('Brings in foods and units from Mealie. Runs when Receipt Box starts, or whenever you choose Sync now.')
    expect(text).not.toContain('kept up to date')
    expect(text).not.toContain('read-only')
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
    await vi.waitFor(() => expect(wrapper.text()).toContain('Synced 706 foods and 12 units. 1 food is no longer in Mealie.'))
    expect(wrapper.text()).not.toMatch(/alias|Deactivated/i)
  })

  it.each([
    [{ deactivatedFoods: 0, deactivatedUnits: 0 }, 'Synced 706 foods and 12 units.'],
    [{ deactivatedFoods: 2, deactivatedUnits: 0 }, 'Synced 706 foods and 12 units. 2 foods are no longer in Mealie.'],
    [{ deactivatedFoods: 0, deactivatedUnits: 1 }, 'Synced 706 foods and 12 units. 1 unit is no longer in Mealie.'],
    [{ deactivatedFoods: 1, deactivatedUnits: 3 }, 'Synced 706 foods and 12 units. 1 food is no longer in Mealie. 3 units are no longer in Mealie.']
  ])('mentions only the foods and units that left Mealie: %j', async (gone, notice) => {
    syncHandler = () => ({ status: 'synced', foods: 706, aliases: 30, units: 12, ...gone })
    const wrapper = await mountMealie()
    await buttonText(wrapper, 'Sync now').trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain(notice))
    if (!gone.deactivatedFoods && !gone.deactivatedUnits) expect(wrapper.text()).not.toContain('no longer in Mealie.')
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
    await vi.waitFor(() => expect(wrapper.text()).toContain('300 foods are no longer in Mealie.'))
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
  it('filters All, Mapped, Unmapped and Needs attention with counts', async () => {
    const wrapper = await mountMealie()
    expect(wrapper.get('[data-tab="all"]').text()).toBe('All (5)')
    expect(rows(wrapper)).toEqual(['Old Sauce', 'Gone Item', 'Flour', 'Sugar', 'Beans & Rice'])
    await wrapper.get('[data-tab="mapped"]').trigger('click')
    expect(rows(wrapper)).toEqual(['Beans & Rice'])
    await wrapper.get('[data-tab="unmapped"]').trigger('click')
    expect(rows(wrapper)).toEqual(['Flour', 'Sugar'])
    await wrapper.get('[data-tab="attention"]').trigger('click')
    expect(rows(wrapper)).toEqual(['Old Sauce', 'Gone Item', 'Beans & Rice'])
    expect(wrapper.get('[data-testid="food-mapping-list"]').text()).toContain('Food no longer in Mealie')
  })

  it('shows an empty filter', async () => {
    mappings = []
    const wrapper = await mountMealie()
    await wrapper.get('[data-tab="attention"]').trigger('click')
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
    await wrapper.get('[data-tab="attention"]').trigger('click')
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
    await vi.waitFor(() => expect(optionTexts(wrapper)).toEqual(['Lentils']))
    expect(puts).toEqual([])

    await choose(wrapper, 'food-9')
    await flushPromises()
    expect(puts).toEqual([{ item: 'Flour', mealieFoodId: 'food-9' }])
    await vi.waitFor(() => expect(wrapper.find('button[aria-label="Change food for Flour"]').exists()).toBe(true))
    expect(wrapper.find('input[role="combobox"]').exists()).toBe(false)
  })

  it('opens the food box as one focused text box that searches the server', async () => {
    const wrapper = await mountMealie()
    await button(wrapper, 'Choose food for Flour').trigger('click')
    const menu = wrapper.findComponent(InputMenu)
    expect(menu.props()).toMatchObject({ defaultOpen: true, autofocus: true, openOnFocus: true, openOnClick: true, ignoreFilter: true, placeholder: 'Search foods…' })
    expect(menu.props('virtualize')).toBeFalsy()
    expect(wrapper.findAll('input[role="combobox"]')).toHaveLength(1)
    expect(wrapper.find('select').exists()).toBe(false)
  })

  it('writes nothing while the food is only typed, blurred or dismissed', async () => {
    const wrapper = await mountMealie()
    await button(wrapper, 'Choose food for Flour').trigger('click')
    const input = box(wrapper, 'Mealie food')
    await input.setValue('lent')
    await input.trigger('blur')
    await input.trigger('keydown', { key: 'Escape' })
    await new Promise(resolve => setTimeout(resolve, 300))
    await flushPromises()
    expect(puts).toEqual([])
    expect(box(wrapper, 'Mealie food').attributes('role')).toBe('combobox')
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
    await vi.waitFor(() => expect(optionTexts(wrapper)).toEqual(['Result fast']))
    pending[0]!()
    await flushPromises()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(optionTexts(wrapper)).toEqual(['Result fast'])
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
    await vi.waitFor(() => expect(optionTexts(wrapper)).toContain('Lentils'))
    await choose(wrapper, 'food-9')
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.text()).toContain('no longer active in Mealie'))
    expect(wrapper.find('input[role="combobox"]').exists()).toBe(true)
    await buttonText(wrapper, 'Cancel').trigger('click')
    expect(wrapper.find('input[role="combobox"]').exists()).toBe(false)
  })

  it('keeps the chosen food in the box after a failure and retries by choosing it again', async () => {
    putFailure = createError({ statusCode: 500, statusMessage: 'Mapping broke' })
    const wrapper = await mountMealie()
    await button(wrapper, 'Choose food for Flour').trigger('click')
    await vi.waitFor(() => expect(optionTexts(wrapper)).toContain('Lentils'))
    await choose(wrapper, 'food-9')
    await vi.waitFor(() => expect(wrapper.text()).toContain('Mapping broke'))
    await flushPromises()
    expect((box(wrapper, 'Mealie food').element as HTMLInputElement).value).toBe('Lentils')
    expect(puts).toEqual([])
    expect(wrapper.find('button[aria-label="Choose food for Flour"]').exists()).toBe(false)

    putFailure = null
    await choose(wrapper, 'food-9')
    await vi.waitFor(() => expect(puts).toEqual([{ item: 'Flour', mealieFoodId: 'food-9' }]))
    await vi.waitFor(() => expect(wrapper.find('button[aria-label="Change food for Flour"]').exists()).toBe(true))
    expect(wrapper.find('input[role="combobox"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Mapping broke')
  })

  it('keeps a chosen food that a refreshed search no longer lists', async () => {
    putFailure = createError({ statusCode: 500, statusMessage: 'Mapping broke' })
    const wrapper = await mountMealie()
    await button(wrapper, 'Choose food for Flour').trigger('click')
    await vi.waitFor(() => expect(optionTexts(wrapper)).toContain('Lentils'))
    registerEndpoint('/api/mealie/foods', () => ({ foods: [{ id: 'food-1', name: 'Chickpeas' }] }))
    await choose(wrapper, 'food-9')
    await vi.waitFor(() => expect(optionTexts(wrapper)).toEqual(['Chickpeas']))
    expect((box(wrapper, 'Mealie food').element as HTMLInputElement).value).toBe('Lentils')
  })

  it('ignores a second choice while a mapping is still being saved', async () => {
    let release!: () => void
    putGate = new Promise<void>((resolve) => { release = resolve })
    const wrapper = await mountMealie()
    await button(wrapper, 'Choose food for Flour').trigger('click')
    await vi.waitFor(() => expect(optionTexts(wrapper)).toEqual(['Chickpeas', 'Lentils']))
    await choose(wrapper, 'food-9')
    await choose(wrapper, 'food-1')
    await choose(wrapper, 'food-9')
    release()
    await vi.waitFor(() => expect(puts).toEqual([{ item: 'Flour', mealieFoodId: 'food-9' }]))
    await flushPromises()
    expect(puts).toHaveLength(1)
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

describe('suggestions', () => {
  const lentils = { mealieFoodId: 'food-9', foodName: 'Lentils', matchType: 'exact_alias', matchedText: 'Red dal', similarity: null }
  const chickpeas = { mealieFoodId: 'food-1', foodName: 'Chickpeas', matchType: 'fuzzy', matchedText: 'Chick peas', similarity: 0.456 }

  it('asks only for visible rows that need a food, encoding the name', async () => {
    unmapped = [{ item: 'Flour & Co', entries: 1 }]
    await mountMealie()
    await vi.waitFor(() => expect([...suggestionQueries].sort()).toEqual(['Flour & Co', 'Old Sauce']))
  })

  it('asks for rows revealed by Show 30 more, once each', async () => {
    mappings = []
    unmapped = Array.from({ length: 31 }, (_, index) => ({ item: `Item ${index}`, entries: 1 }))
    const wrapper = await mountMealie()
    await vi.waitFor(() => expect(suggestionQueries).toHaveLength(30))
    await buttonText(wrapper, 'Show 30 more').trigger('click')
    await vi.waitFor(() => expect(suggestionQueries).toHaveLength(31))
    await wrapper.get('[data-tab="attention"]').trigger('click')
    await wrapper.get('[data-tab="all"]').trigger('click')
    await flushPromises()
    expect(suggestionQueries).toHaveLength(31)
  })

  it.each([
    ['exact_name', 'Flour', null, 'Matched Mealie food name “Flour”'],
    ['plural_name', 'Flours', null, 'Matched Mealie plural name “Flours”'],
    ['exact_alias', 'Plain flour', null, 'Matched Mealie alias “Plain flour”'],
    ['normalized_name', 'Flour!', null, 'Matched “Flour!”, ignoring punctuation and plurals'],
    ['fuzzy', 'Flor', 0.456, 'Similar to “Flor” (46%)']
  ])('explains a %s match', async (matchType, matchedText, similarity, reason) => {
    suggestionsByItem.Flour = [{ mealieFoodId: 'food-9', foodName: 'Wheat flour', matchType, matchedText, similarity }]
    const wrapper = await mountMealie()
    await vi.waitFor(() => expect(wrapper.get('[data-testid="food-suggestion"]').text()).toContain(reason))
    expect(wrapper.get('[data-testid="food-suggestion"]').text()).toContain('Suggested food: Wheat flour')
  })

  it('writes nothing until Accept, then maps the suggested food', async () => {
    suggestionsByItem.Flour = [lentils]
    const wrapper = await mountMealie()
    await vi.waitFor(() => expect(wrapper.find('button[aria-label="Accept Lentils for Flour"]').exists()).toBe(true))
    expect(puts).toEqual([])
    await button(wrapper, 'Accept Lentils for Flour').trigger('click')
    await vi.waitFor(() => expect(puts).toEqual([{ item: 'Flour', mealieFoodId: 'food-9' }]))
    await vi.waitFor(() => expect(wrapper.find('button[aria-label="Change food for Flour"]').exists()).toBe(true))
    expect(wrapper.find('button[aria-label="Accept Lentils for Flour"]').exists()).toBe(false)
  })

  it('offers a replacement for a broken mapping, but not when the item has no entries', async () => {
    suggestionsByItem['Old Sauce'] = [lentils]
    suggestionsByItem['Gone Item'] = [lentils]
    const wrapper = await mountMealie()
    await vi.waitFor(() => expect(wrapper.text()).toContain('Suggested replacement: Lentils'))
    expect(wrapper.find('button[aria-label="Accept Lentils for Old Sauce"]').exists()).toBe(true)
    expect(wrapper.find('button[aria-label="Accept Lentils for Gone Item"]').exists()).toBe(false)
    expect(suggestionQueries).not.toContain('Gone Item')
  })

  it('Choose another lists the suggestions with reasons, then the catalog without repeats', async () => {
    suggestionsByItem.Flour = [lentils, chickpeas]
    const wrapper = await mountMealie()
    await vi.waitFor(() => expect(wrapper.find('button[aria-label="Choose another for Flour"]').exists()).toBe(true))
    await button(wrapper, 'Choose another for Flour').trigger('click')
    await vi.waitFor(() => expect(foodQueries).toEqual(['']))
    await flushPromises()
    const options = () => optionTexts(wrapper)
    await vi.waitFor(() => expect(options()).toEqual(['Lentils — Matched Mealie alias “Red dal”', 'Chickpeas — Similar to “Chick peas” (46%)']))

    await wrapper.get('input[data-search]').setValue('lent')
    await vi.waitFor(() => expect(options()).toEqual(['Lentils']))
    await choose(wrapper, 'food-9')
    await vi.waitFor(() => expect(puts).toEqual([{ item: 'Flour', mealieFoodId: 'food-9' }]))
  })

  it('loads suggestions into the picker for a healthy mapping without showing them on the row', async () => {
    suggestionsByItem['Beans & Rice'] = [lentils]
    const wrapper = await mountMealie()
    expect(suggestionQueries).not.toContain('Beans & Rice')
    expect(wrapper.find('button[aria-label="Accept Lentils for Beans & Rice"]').exists()).toBe(false)
    await button(wrapper, 'Change food for Beans & Rice').trigger('click')
    await vi.waitFor(() => expect(optionTexts(wrapper).join()).toContain('Matched Mealie alias'))
  })

  it('keeps Choose food when there is no suggestion', async () => {
    const wrapper = await mountMealie()
    await vi.waitFor(() => expect(suggestionQueries).toContain('Flour'))
    await flushPromises()
    expect(wrapper.find('button[aria-label="Choose food for Flour"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="food-suggestion"]').exists()).toBe(false)
  })

  it('shows a failed load and retries it', async () => {
    unmapped = [{ item: 'Flour', entries: 1 }]
    mappings = []
    suggestionFailure = true
    const wrapper = await mountMealie()
    await vi.waitFor(() => expect(wrapper.text()).toContain('Could not load suggestions.'))
    expect(wrapper.find('button[aria-label="Choose food for Flour"]').exists()).toBe(true)
    suggestionFailure = false
    suggestionsByItem.Flour = [lentils]
    await button(wrapper, 'Try the suggestions for Flour again').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('button[aria-label="Accept Lentils for Flour"]').exists()).toBe(true))
  })

  it('shows why Accept failed and replaces the stale suggestion', async () => {
    suggestionsByItem.Flour = [lentils]
    putFailure = createError({ statusCode: 409, statusMessage: 'That food is no longer active in Mealie' })
    const wrapper = await mountMealie()
    await vi.waitFor(() => expect(wrapper.find('button[aria-label="Accept Lentils for Flour"]').exists()).toBe(true))
    suggestionsByItem.Flour = [chickpeas]
    await button(wrapper, 'Accept Lentils for Flour').trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('no longer active in Mealie'))
    await vi.waitFor(() => expect(wrapper.find('button[aria-label="Accept Chickpeas for Flour"]').exists()).toBe(true))
    expect(puts).toEqual([])
  })

  it('leaves another open picker alone when a suggestion is accepted', async () => {
    suggestionsByItem.Flour = [lentils]
    const wrapper = await mountMealie()
    await vi.waitFor(() => expect(wrapper.find('button[aria-label="Accept Lentils for Flour"]').exists()).toBe(true))
    await button(wrapper, 'Choose food for Sugar').trigger('click')
    await button(wrapper, 'Accept Lentils for Flour').trigger('click')
    await vi.waitFor(() => expect(puts).toHaveLength(1))
    await flushPromises()
    expect(box(wrapper, 'Mealie food').attributes('role')).toBe('combobox')
  })

  it('reloads after a sync and drops an answer that started before it', async () => {
    const pending: Array<() => void> = []
    suggestionsByItem.Flour = [lentils]
    registerEndpoint('/api/food-mappings/suggestions', async (event) => {
      const { item } = getQuery(event)
      const answer = suggestionsByItem[String(item)] ?? []
      if (item === 'Flour' && answer[0] === lentils) await new Promise<void>(resolve => pending.push(resolve))
      return { item, suggestions: answer }
    })
    const wrapper = await mountMealie()
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    suggestionsByItem.Flour = [chickpeas]
    await buttonText(wrapper, 'Sync now').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('button[aria-label="Accept Chickpeas for Flour"]').exists()).toBe(true))
    pending[0]!()
    await new Promise(resolve => setTimeout(resolve, 20))
    await flushPromises()
    expect(wrapper.find('button[aria-label="Accept Chickpeas for Flour"]').exists()).toBe(true)
    expect(wrapper.find('button[aria-label="Accept Lentils for Flour"]').exists()).toBe(false)
  })
})

describe('needs attention', () => {
  const openTab = async () => {
    const wrapper = await mountMealie()
    await wrapper.get('[data-tab="attention"]').trigger('click')
    return wrapper
  }

  it('labels each mapping with every issue it has', async () => {
    const list = (await openTab()).get('[data-testid="food-mapping-list"]')
    const row = (name: string) => list.findAll('li').find(candidate => candidate.text().includes(name))!.text()
    expect(row('Old Sauce')).toContain('Broken')
    expect(row('Gone Item')).toContain('Broken')
    expect(row('Gone Item')).toContain('No entries')
    expect(row('Beans & Rice')).toContain('No package size')
    expect(row('Beans & Rice')).not.toContain('Broken')
  })

  it('shows one row for a mapping with several issues, and leaves out healthy and unmapped items', async () => {
    registerEndpoint('/api/food-mappings/problems', () => ({ itemsWithoutPackageSize: [{ item: 'Old Sauce', entries: 1 }, { item: 'Sugar', entries: 3 }] }))
    expect(rows(await openTab())).toEqual(['Old Sauce', 'Gone Item'])
  })

  it('keeps a no-package-size mapping under Mapped too', async () => {
    const wrapper = await mountMealie()
    await wrapper.get('[data-tab="mapped"]').trigger('click')
    expect(rows(wrapper)).toEqual(['Beans & Rice'])
    expect(wrapper.get('[data-testid="food-mapping-list"]').text()).toContain('No package size')
  })

  it('links a no-package-size row to its item page, whatever the name holds', async () => {
    const names = ['Half/Half', 'Ben & Jerry\'s "Chunky"', 'Why? Not#1 100%', 'Crème Fraîche']
    mappings = names.map(item => ({ ...beans, item }))
    registerEndpoint('/api/food-mappings/problems', () => ({ itemsWithoutPackageSize: names.map(item => ({ item, entries: 1 })) }))
    const wrapper = await openTab()
    names.forEach((name) => {
      const link = wrapper.findAll('button').find(candidate => candidate.attributes('aria-label') === `Add a package size for ${name}`)!
      // The link names the Mealie list as its origin, so the item page can send the person back here.
      expect(link.attributes('data-to')).toBe(`${itemPath(name)}?from=mealie`)
    })
  })

  it('gives broken rows no package size link', async () => {
    expect((await openTab()).find('[aria-label="Add a package size for Old Sauce"]').exists()).toBe(false)
  })

  it('explains the tab only while it is open', async () => {
    const wrapper = await mountMealie()
    expect(wrapper.text()).not.toContain('Mappings to fix before recipes')
    await wrapper.get('[data-tab="attention"]').trigger('click')
    expect(wrapper.text()).toContain('Mappings to fix before recipes')
  })

  it('shows nothing when no mapping needs fixing', async () => {
    mappings = [beans]
    registerEndpoint('/api/food-mappings/problems', () => ({ itemsWithoutPackageSize: [] }))
    const wrapper = await openTab()
    expect(wrapper.get('[data-tab="attention"]').text()).toBe('Needs attention (0)')
    expect(wrapper.text()).toContain('Nothing here.')
  })

  it('drops a mapping once it is cleared', async () => {
    mappings = [broken]
    const wrapper = await openTab()
    await button(wrapper, 'Clear mapping for Old Sauce').trigger('click')
    await buttonText(wrapper, 'Clear mapping').trigger('click')
    await vi.waitFor(() => expect(wrapper.get('[data-tab="attention"]').text()).toBe('Needs attention (0)'))
  })

  it('reports a failed package size check, still lists the other issues, and retries', async () => {
    registerEndpoint('/api/food-mappings/problems', () => { throw createError({ statusCode: 500 }) })
    const wrapper = await openTab()
    expect(wrapper.text()).toContain('Could not check for missing package sizes.')
    expect(rows(wrapper)).toEqual(['Old Sauce', 'Gone Item'])
    registerEndpoint('/api/food-mappings/problems', () => ({ itemsWithoutPackageSize: [{ item: 'Beans & Rice', entries: 1 }] }))
    await buttonText(wrapper, 'Try again').trigger('click')
    await vi.waitFor(() => expect(rows(wrapper)).toContain('Beans & Rice'))
    expect(wrapper.text()).not.toContain('Could not check for missing package sizes.')
  })
})

describe('focused food', () => {
  const panel = (wrapper: Wrapper) => wrapper.get('[data-testid="food-focus"]')
  const options = (wrapper: Wrapper) => optionTexts(panel(wrapper))
  const grocery = 'Grocery item'

  it('shows no panel without the query', async () => {
    const wrapper = await mountMealie()
    expect(wrapper.find('[data-testid="food-focus"]').exists()).toBe(false)
    expect(rows(wrapper)).toEqual(['Old Sauce', 'Gone Item', 'Flour', 'Sugar', 'Beans & Rice'])
  })

  it('lets one grocery item be mapped to an active food, closest names first', async () => {
    unmapped = [{ item: 'Flour', entries: 1 }, { item: 'Red lentil', entries: 2 }, { item: 'Sugar', entries: 3 }]
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})
    const wrapper = await mountMealie('/data/mealie?food=food-9&recipe=curry')
    await vi.waitFor(() => expect(panel(wrapper).text()).toContain('Map a grocery item to Lentils'))
    expect(options(wrapper)).toEqual(['Red lentil — 2 entries', 'Flour — 1 entry', 'Sugar — 3 entries'])
    expect(panel(wrapper).text()).toContain('no grocery items yet')
    expect(scroll).toHaveBeenCalled()
    scroll.mockRestore()

    const menu = panel(wrapper).findComponent(InputMenu)
    expect(menu.props()).toMatchObject({ virtualize: true, openOnFocus: true, openOnClick: true, placeholder: 'Search grocery items…', by: 'value' })
    expect(menu.props('defaultOpen')).toBeFalsy()
    expect(box(panel(wrapper), grocery).attributes('placeholder')).toBe('Search grocery items…')
    expect(panel(wrapper).findAll('input[role="combobox"]')).toHaveLength(1)

    await choose(panel(wrapper), 'Red lentil')
    await vi.waitFor(() => expect(puts).toEqual([{ item: 'Red lentil', mealieFoodId: 'food-9' }]))
    await vi.waitFor(() => expect(panel(wrapper).text()).toContain('Mapped “Red lentil” to Lentils.'))
    expect(panel(wrapper).get('[data-testid="food-focus-mapped"]').text()).toContain('Red lentil')
    expect(options(wrapper)).toEqual(['Flour — 1 entry', 'Sugar — 3 entries'])
  })

  it('narrows the grocery items as the box is typed in, without mapping', async () => {
    unmapped = [{ item: 'Flour', entries: 1 }, { item: 'Red lentil', entries: 2 }, { item: 'Sugar', entries: 3 }]
    const wrapper = await mountMealie('/data/mealie?food=food-9')
    await vi.waitFor(() => expect(options(wrapper)).toHaveLength(3))
    const input = box(panel(wrapper), grocery)
    await input.setValue('sug')
    await input.trigger('blur')
    await input.trigger('keydown', { key: 'Escape' })
    expect(options(wrapper)).toEqual(['Sugar — 3 entries'])
    await flushPromises()
    expect(puts).toEqual([])
  })

  it('clears the box after a successful mapping so another item can be mapped', async () => {
    unmapped = [{ item: 'Flour', entries: 1 }, { item: 'Red lentil', entries: 2 }, { item: 'Sugar', entries: 3 }]
    const wrapper = await mountMealie('/data/mealie?food=food-9')
    await vi.waitFor(() => expect(options(wrapper)).toHaveLength(3))
    await choose(panel(wrapper), 'Red lentil')
    await vi.waitFor(() => expect(panel(wrapper).text()).toContain('Mapped “Red lentil” to Lentils.'))
    await flushPromises()
    const input = box(panel(wrapper), grocery)
    expect((input.element as HTMLInputElement).value).toBe('')
    expect(input.attributes('disabled')).toBeUndefined()
    expect(panel(wrapper).get('[data-testid="food-focus-mapped"]').text()).toContain('Red lentil')

    await choose(panel(wrapper), 'Sugar')
    await vi.waitFor(() => expect(puts).toEqual([{ item: 'Red lentil', mealieFoodId: 'food-9' }, { item: 'Sugar', mealieFoodId: 'food-9' }]))
    await vi.waitFor(() => expect(panel(wrapper).text()).toContain('Mapped “Sugar” to Lentils.'))
    await flushPromises()
    expect((box(panel(wrapper), grocery).element as HTMLInputElement).value).toBe('')
  })

  it('disables the box while a mapping saves', async () => {
    let release!: () => void
    putGate = new Promise<void>((resolve) => { release = resolve })
    const wrapper = await mountMealie('/data/mealie?food=food-9')
    await vi.waitFor(() => expect(options(wrapper)).toContain('Flour — 1 entry'))
    await choose(panel(wrapper), 'Flour')
    await vi.waitFor(() => expect(box(panel(wrapper), grocery).attributes('disabled')).toBeDefined())
    expect(panel(wrapper).get('[data-loading]').attributes('data-loading')).toBe('true')
    release()
    await vi.waitFor(() => expect(box(panel(wrapper), grocery).attributes('disabled')).toBeUndefined())
    expect(panel(wrapper).get('[data-loading]').attributes('data-loading')).toBe('false')
  })

  it('shows why a mapping failed inside the panel and keeps the choice available', async () => {
    putFailure = createError({ statusCode: 409, statusMessage: 'That food is no longer active in Mealie' })
    const wrapper = await mountMealie('/data/mealie?food=food-9')
    await vi.waitFor(() => expect(options(wrapper)).toContain('Flour — 1 entry'))
    await choose(panel(wrapper), 'Flour')
    await vi.waitFor(() => expect(panel(wrapper).text()).toContain('no longer active in Mealie'))
    expect(wrapper.findAll('[role="alert"]').filter(alert => alert.text().includes('no longer active'))).toHaveLength(1)
    expect(puts).toEqual([])
    expect(options(wrapper)).toContain('Flour — 1 entry')
  })

  it('keeps the chosen item in the box after a failure and retries by choosing it again', async () => {
    putFailure = createError({ statusCode: 409, statusMessage: 'That food is no longer active in Mealie' })
    const wrapper = await mountMealie('/data/mealie?food=food-9')
    await vi.waitFor(() => expect(options(wrapper)).toContain('Flour — 1 entry'))
    await choose(panel(wrapper), 'Flour')
    await vi.waitFor(() => expect(panel(wrapper).text()).toContain('no longer active in Mealie'))
    await flushPromises()
    const input = box(panel(wrapper), grocery)
    expect((input.element as HTMLInputElement).value).toBe('Flour')
    expect(input.attributes('disabled')).toBeUndefined()

    putFailure = null
    await choose(panel(wrapper), 'Flour')
    await vi.waitFor(() => expect(puts).toEqual([{ item: 'Flour', mealieFoodId: 'food-9' }]))
    await vi.waitFor(() => expect(panel(wrapper).text()).toContain('Mapped “Flour” to Lentils.'))
    await flushPromises()
    expect((box(panel(wrapper), grocery).element as HTMLInputElement).value).toBe('')
    expect(panel(wrapper).text()).not.toContain('no longer active')
  })

  it('narrows the list to the broken mappings of an inactive food', async () => {
    const wrapper = await mountMealie('/data/mealie?food=food-2&recipe=curry')
    await vi.waitFor(() => expect(panel(wrapper).text()).toContain('Fix the mappings to Merged away'))
    expect(panel(wrapper).text()).toContain('This grocery item maps to a food that is inactive in Mealie')
    expect(panel(wrapper).find('input[role="combobox"]').exists()).toBe(false)
    expect(rows(wrapper)).toEqual(['Old Sauce'])
    expect(wrapper.find('button[aria-label="Choose food for Old Sauce"]').exists() || wrapper.find('button[aria-label="Change food for Old Sauce"]').exists()).toBe(true)

    await button(wrapper, 'Clear mapping for Old Sauce').trigger('click')
    await buttonText(wrapper, 'Clear mapping').trigger('click')
    await vi.waitFor(() => expect(panel(wrapper).text()).toContain('No grocery item maps to this food any more.'))
    expect(wrapper.text()).toContain('Nothing here.')
  })

  it('says an unsynced food is not in the catalog, then recovers after Sync now', async () => {
    const wrapper = await mountMealie('/data/mealie?food=food-new')
    await vi.waitFor(() => expect(panel(wrapper).text()).toContain('hasn\'t reached Receipt Box yet'))
    expect(panel(wrapper).text()).toContain('Sync now')
    expect(panel(wrapper).find('input[role="combobox"]').exists()).toBe(false)

    cachedFoods['food-new'] = { id: 'food-new', name: 'Saffron', active: true }
    await buttonText(wrapper, 'Sync now').trigger('click')
    await vi.waitFor(() => expect(panel(wrapper).text()).toContain('Map a grocery item to Saffron'))
  })

  it('fails clearly on an invalid food id without breaking the page', async () => {
    const wrapper = await mountMealie('/data/mealie?food=bad')
    await vi.waitFor(() => expect(panel(wrapper).text()).toContain('This link has an invalid food id.'))
    expect(panel(wrapper).find('input[role="combobox"]').exists()).toBe(false)
    expect(rows(wrapper)).toHaveLength(5)
  })

  it('offers a retry when the lookup itself fails', async () => {
    const wrapper = await mountMealie('/data/mealie?food=oops')
    await vi.waitFor(() => expect(panel(wrapper).text()).toContain('Lookup broke'))
    cachedFoods.oops = { id: 'oops', name: 'Lentils', active: true }
    await buttonText(panel(wrapper) as any, 'Try again').trigger('click')
    await vi.waitFor(() => expect(panel(wrapper).text()).toContain('Map a grocery item to Lentils'))
  })

  it('links back to the recipe with its slug encoded, only when one was given', async () => {
    const withRecipe = await mountMealie('/data/mealie?food=food-9&recipe=a%20b%2Fc')
    await vi.waitFor(() => expect(panel(withRecipe).text()).toContain('Lentils'))
    expect(panel(withRecipe).get('[data-to="/mealie-recipes/a%20b%2Fc"]').text()).toBe('Back to recipe')

    const without = await mountMealie('/data/mealie?food=food-9')
    expect(panel(without).text()).not.toContain('Back to recipe')
  })

  it('dismisses the focus and restores the full list', async () => {
    const wrapper = await mountMealie('/data/mealie?food=food-2&recipe=curry')
    await vi.waitFor(() => expect(rows(wrapper)).toEqual(['Old Sauce']))
    await button(wrapper, 'Dismiss food focus').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[data-testid="food-focus"]').exists()).toBe(false))
    expect(useRoute().query).toEqual({})
    expect(rows(wrapper)).toHaveLength(5)
  })

  it('keeps the query through the Manage page', async () => {
    const wrapper = await mountManage('/data/mealie?food=food-9&recipe=curry')
    await vi.waitFor(() => expect(wrapper.get('[data-testid="food-focus"]').text()).toContain('Lentils'))
    expect(useRoute().query).toEqual({ food: 'food-9', recipe: 'curry' })
  })
})

describe('searching the mappings', () => {
  const search = (wrapper: Wrapper) => box(wrapper, 'Search items and foods')
  const tabs = (wrapper: Wrapper) => wrapper.findAll('[data-tab]').map(tab => tab.text())

  it('matches the grocery item name, ignoring case, within the active tab', async () => {
    const wrapper = await mountMealie()
    await search(wrapper).setValue('FLO')
    expect(rows(wrapper)).toEqual(['Flour'])
    await wrapper.get('[data-tab="attention"]').trigger('click')
    expect(wrapper.text()).toContain('Nothing here.')
  })

  it('matches the mapped food name', async () => {
    const wrapper = await mountMealie()
    await search(wrapper).setValue('chickpea')
    expect(rows(wrapper)).toEqual(['Beans & Rice'])
    await search(wrapper).setValue('merged')
    expect(rows(wrapper)).toEqual(['Old Sauce'])
  })

  it('keeps the tab counts equal to what each tab lists under the search', async () => {
    const wrapper = await mountMealie()
    expect(tabs(wrapper)).toEqual(['All (5)', 'Mapped (1)', 'Unmapped (2)', 'Needs attention (3)'])
    await search(wrapper).setValue('s')
    expect(tabs(wrapper)).toEqual(['All (3)', 'Mapped (1)', 'Unmapped (1)', 'Needs attention (2)'])
  })

  it('says Nothing here. for no match and restores the list when cleared', async () => {
    const wrapper = await mountMealie()
    expect(wrapper.find('button[aria-label="Clear search"]').exists()).toBe(false)
    await search(wrapper).setValue('zzz')
    expect(wrapper.find('[data-testid="food-mapping-list"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Nothing here.')
    expect(tabs(wrapper)[0]).toBe('All (0)')
    await wrapper.get('button[aria-label="Clear search"]').trigger('click')
    expect(rows(wrapper)).toHaveLength(5)
    expect((search(wrapper).element as HTMLInputElement).value).toBe('')
    expect(wrapper.find('button[aria-label="Clear search"]').exists()).toBe(false)
  })

  it('returns to the first 30 rows when the search changes', async () => {
    mappings = []
    unmapped = Array.from({ length: 70 }, (_, index) => ({ item: `Item ${index}`, entries: 1 }))
    const wrapper = await mountMealie()
    await buttonText(wrapper, 'Show 30 more').trigger('click')
    expect(rows(wrapper)).toHaveLength(60)
    await search(wrapper).setValue('item')
    expect(rows(wrapper)).toHaveLength(30)
    await buttonText(wrapper, 'Show 30 more').trigger('click')
    await search(wrapper).setValue('item 1')
    expect(rows(wrapper)).toHaveLength(11)
  })
})

describe('focused food search', () => {
  const panel = (wrapper: Wrapper) => wrapper.get('[data-testid="food-focus"]')

  it('prefills the search with the ingredient name when the linked food is unknown', async () => {
    const wrapper = await mountMealie('/data/mealie?food=food-new&name=Lent%20%26%20co')
    await vi.waitFor(() => expect(panel(wrapper).text()).toContain('hasn\'t reached Receipt Box yet'))
    expect((box(panel(wrapper), 'Find another Mealie food').element as HTMLInputElement).value).toBe('Lent & co')
    await vi.waitFor(() => expect(foodQueries).toContain('Lent & co'))
  })

  it('does not prefill when the linked food resolves', async () => {
    const wrapper = await mountMealie('/data/mealie?food=food-9&name=Lentils')
    await vi.waitFor(() => expect(panel(wrapper).text()).toContain('Map a grocery item to Lentils'))
    expect((box(panel(wrapper), 'Find another Mealie food').element as HTMLInputElement).value).toBe('')
  })

  it('searches the cached foods and refocuses on the one picked', async () => {
    const wrapper = await mountMealie('/data/mealie?food=food-new&recipe=curry')
    await vi.waitFor(() => expect(panel(wrapper).text()).toContain('hasn\'t reached Receipt Box yet'))
    await box(panel(wrapper), 'Find another Mealie food').setValue('lent')
    await vi.waitFor(() => expect(panel(wrapper).get('[data-testid="food-focus-results"]').text()).toBe('Lentils'))
    await buttonText(panel(wrapper) as any, 'Lentils').trigger('click')
    await vi.waitFor(() => expect(panel(wrapper).text()).toContain('Map a grocery item to Lentils'))
    expect(useRoute().query).toEqual({ food: 'food-9', recipe: 'curry' })
  })

  it('shows a failed food search in the panel', async () => {
    registerEndpoint('/api/mealie/foods', () => { throw createError({ statusCode: 500, statusMessage: 'Search broke' }) })
    const wrapper = await mountMealie('/data/mealie?food=food-9')
    await box(panel(wrapper), 'Find another Mealie food').setValue('x')
    await vi.waitFor(() => expect(panel(wrapper).text()).toContain('Search broke'))
  })
})

describe('visible field labels', () => {
  const focused = '/data/mealie?food=food-9&recipe=curry'

  it('names every field with a visible label tied to its control, and keeps it while typing', async () => {
    const wrapper = await mountMealie(focused)
    await vi.waitFor(() => expect(wrapper.text()).toContain('Map a grocery item to Lentils'))
    await button(wrapper, 'Choose food for Flour').trigger('click')
    const fields = [
      ['Grocery item', 'combobox'], ['Find another Mealie food', undefined], ['Mealie food', 'combobox'], ['Search items and foods', undefined]
    ] as const
    for (const [label, role] of fields) {
      const captions = wrapper.findAll('label').filter(candidate => candidate.text() === label)
      expect(captions, label).toHaveLength(1)
      const control = box(wrapper, label)
      expect(control.element.tagName).toBe('INPUT')
      expect(control.attributes('role')).toBe(role)
      // The label is the name, not a second aria-label that could drift from what is visible.
      expect(control.attributes('aria-label')).toBeUndefined()
      expect(captions[0]!.classes()).not.toContain('sr-only')
    }
    for (const [label] of fields) {
      await box(wrapper, label).setValue('typed')
      expect(box(wrapper, label).element).toHaveProperty('value', 'typed')
      expect(wrapper.findAll('label').filter(candidate => candidate.text() === label)).toHaveLength(1)
    }
  })

  it('labels the grocery picker inside the panel and the row picker inside its row', async () => {
    const wrapper = await mountMealie(focused)
    await button(wrapper, 'Choose food for Sugar').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[data-testid="food-focus"] [role="combobox"]').exists()).toBe(true))
    const panelBox = box(wrapper.get('[data-testid="food-focus"]'), 'Grocery item')
    const rowBox = box(wrapper.get('[data-testid="food-mapping-list"]'), 'Mealie food')
    expect(panelBox.attributes('id')).not.toBe(rowBox.attributes('id'))
    expect(wrapper.get('[data-testid="food-mapping-list"]').text()).toContain('Sugar')
  })
})

describe('alternate food search status', () => {
  const panel = (wrapper: Wrapper) => wrapper.get('[data-testid="food-focus"]')
  const status = (wrapper: Wrapper) => panel(wrapper).get('[role="status"]:not([data-loading])')
  const searchBox = (wrapper: Wrapper) => box(panel(wrapper), 'Find another Mealie food')
  const resultNames = (wrapper: Wrapper) => panel(wrapper).findAll('[data-testid="food-focus-results"] button').map(result => result.text())
  const focused = '/data/mealie?food=food-new&recipe=curry'
  let pending: Record<string, () => void>

  // Answers each search from its own gate so a test decides the order the responses arrive in.
  beforeEach(() => {
    pending = {}
    registerEndpoint('/api/mealie/foods', async (event) => {
      const search = String(getQuery(event).search ?? '')
      foodQueries.push(search)
      if (search.startsWith('slow')) await new Promise<void>(resolve => { pending[search] = resolve })
      if (search === 'zzz') return { foods: [] }
      if (search === 'boom') throw createError({ statusCode: 500, statusMessage: 'Search broke' })
      return { foods: [{ id: `id-${search}`, name: `Match ${search}` }] }
    })
  })

  const open = async () => {
    const wrapper = await mountMealie(focused)
    await vi.waitFor(() => expect(panel(wrapper).text()).toContain('hasn\'t reached Receipt Box yet'))
    return wrapper
  }

  it('has an empty polite live region ready before anything is searched', async () => {
    const wrapper = await open()
    expect(status(wrapper).text()).toBe('')
    expect(status(wrapper).classes()).toContain('empty:hidden')
    expect(resultNames(wrapper)).toEqual([])
  })

  it('announces the search and withholds the results until it finishes', async () => {
    const wrapper = await open()
    await searchBox(wrapper).setValue('slow one')
    await vi.waitFor(() => expect(pending['slow one']).toBeDefined())
    expect(status(wrapper).text()).toBe('Searching Mealie foods…')
    expect(resultNames(wrapper)).toEqual([])
    pending['slow one']!()
    await vi.waitFor(() => expect(resultNames(wrapper)).toEqual(['Match slow one']))
    expect(status(wrapper).text()).toBe('')
  })

  it('hides the previous query\'s results while the next one loads, so they cannot be chosen', async () => {
    const wrapper = await open()
    await searchBox(wrapper).setValue('lent')
    await vi.waitFor(() => expect(resultNames(wrapper)).toEqual(['Match lent']))
    await searchBox(wrapper).setValue('slow two')
    await vi.waitFor(() => expect(pending['slow two']).toBeDefined())
    expect(wrapper.findAll('[data-testid="food-focus-results"]')).toHaveLength(0)
    expect(panel(wrapper).findAll('button').map(candidate => candidate.text())).not.toContain('Match lent')
    expect(status(wrapper).text()).toBe('Searching Mealie foods…')
    expect(useRoute().query.food).toBe('food-new')
    pending['slow two']!()
    await vi.waitFor(() => expect(resultNames(wrapper)).toEqual(['Match slow two']))
  })

  it('stays pending for the newest query when an older answer arrives late, and never shows the older results', async () => {
    const wrapper = await open()
    await searchBox(wrapper).setValue('slow old')
    await vi.waitFor(() => expect(pending['slow old']).toBeDefined())
    await searchBox(wrapper).setValue('slow new')
    await vi.waitFor(() => expect(pending['slow new']).toBeDefined())
    pending['slow old']!()
    await flushPromises()
    expect(status(wrapper).text()).toBe('Searching Mealie foods…')
    expect(resultNames(wrapper)).toEqual([])
    pending['slow new']!()
    await vi.waitFor(() => expect(resultNames(wrapper)).toEqual(['Match slow new']))
  })

  it('does not let a late older answer replace the finished newer one', async () => {
    const wrapper = await open()
    await searchBox(wrapper).setValue('slow old')
    await vi.waitFor(() => expect(pending['slow old']).toBeDefined())
    await searchBox(wrapper).setValue('fast')
    await vi.waitFor(() => expect(resultNames(wrapper)).toEqual(['Match fast']))
    pending['slow old']!()
    await flushPromises()
    expect(resultNames(wrapper)).toEqual(['Match fast'])
    expect(status(wrapper).text()).toBe('')
  })

  it('says nothing matched, naming the search, and recovers on the next query', async () => {
    const wrapper = await open()
    await searchBox(wrapper).setValue('  zzz ')
    await vi.waitFor(() => expect(status(wrapper).text()).toBe('No Mealie foods match “zzz”.'))
    expect(wrapper.findAll('[data-testid="food-focus-results"]')).toHaveLength(0)
    expect(panel(wrapper).find('p[role="alert"]').exists()).toBe(false)
    await searchBox(wrapper).setValue('lent')
    await vi.waitFor(() => expect(resultNames(wrapper)).toEqual(['Match lent']))
    expect(status(wrapper).text()).toBe('')
  })

  it('clears the message and the results when the search is emptied', async () => {
    const wrapper = await open()
    await searchBox(wrapper).setValue('zzz')
    await vi.waitFor(() => expect(status(wrapper).text()).toContain('No Mealie foods match'))
    await searchBox(wrapper).setValue('')
    await flushPromises()
    expect(status(wrapper).text()).toBe('')
    await searchBox(wrapper).setValue('lent')
    await vi.waitFor(() => expect(resultNames(wrapper)).toEqual(['Match lent']))
    await searchBox(wrapper).setValue('')
    await flushPromises()
    expect(resultNames(wrapper)).toEqual([])
    expect(status(wrapper).text()).toBe('')
  })

  it('keeps the error text, drops the stale results and does not claim a miss', async () => {
    const wrapper = await open()
    await searchBox(wrapper).setValue('lent')
    await vi.waitFor(() => expect(resultNames(wrapper)).toEqual(['Match lent']))
    await searchBox(wrapper).setValue('boom')
    await vi.waitFor(() => expect(panel(wrapper).get('p[role="alert"]').text()).toBe('Search broke'))
    expect(resultNames(wrapper)).toEqual([])
    expect(status(wrapper).text()).toBe('')
    expect(searchBox(wrapper).element).toHaveProperty('value', 'boom')
    await searchBox(wrapper).setValue('lent')
    await vi.waitFor(() => expect(resultNames(wrapper)).toEqual(['Match lent']))
    expect(panel(wrapper).find('p[role="alert"]').exists()).toBe(false)
  })
})

describe('button hierarchy and badges', () => {
  const lentilsSuggestion = { mealieFoodId: 'food-9', foodName: 'Lentils', matchType: 'exact_name', matchedText: 'Lentils', similarity: null }
  const quiet = (candidate: { attributes: (name: string) => string | undefined }) => [candidate.attributes('variant'), candidate.attributes('color')]

  it('leaves Sync now as the only solid primary button, even with suggestions, a focus panel and results showing', async () => {
    suggestionsByItem.Flour = [lentilsSuggestion]
    suggestionsByItem.Sugar = [lentilsSuggestion]
    const wrapper = await mountMealie('/data/mealie?food=food-9&recipe=curry')
    await vi.waitFor(() => expect(wrapper.find('button[aria-label="Accept Lentils for Flour"]').exists()).toBe(true))
    await box(wrapper, 'Find another Mealie food').setValue('lent')
    await vi.waitFor(() => expect(wrapper.find('[data-testid="food-focus-results"] button').exists()).toBe(true))
    await box(wrapper, 'Search items and foods').setValue('')
    const solid = wrapper.findAll('button[type="button"]').filter(candidate => !candidate.attributes('variant'))
    expect(solid.map(candidate => candidate.text())).toEqual(['Sync now'])
    expect(solid[0]!.attributes('color')).toBeUndefined()
  })

  it('makes Accept a ghost neutral button that keeps its check icon and touch target', async () => {
    suggestionsByItem.Flour = [lentilsSuggestion]
    const wrapper = await mountMealie()
    await vi.waitFor(() => expect(wrapper.find('button[aria-label="Accept Lentils for Flour"]').exists()).toBe(true))
    const accept = button(wrapper, 'Accept Lentils for Flour')
    expect(quiet(accept)).toEqual(['ghost', 'neutral'])
    expect(accept.attributes('icon')).toBe('i-lucide-check')
    expect(accept.classes()).toContain('touch-target')
    expect(accept.text()).toBe('Accept')
  })

  it('shows alternate food results as ghost neutral buttons at the default size, not xs', async () => {
    const wrapper = await mountMealie('/data/mealie?food=food-new')
    await vi.waitFor(() => expect(wrapper.text()).toContain('hasn\'t reached Receipt Box yet'))
    await box(wrapper, 'Find another Mealie food').setValue('lent')
    await vi.waitFor(() => expect(wrapper.find('[data-testid="food-focus-results"] button').exists()).toBe(true))
    const results = wrapper.findAll('[data-testid="food-focus-results"] button')
    expect(results.length).toBeGreaterThan(0)
    for (const result of results) {
      expect(quiet(result)).toEqual(['ghost', 'neutral'])
      expect(result.attributes('size')).toBeUndefined()
      expect(result.classes()).toContain('touch-target')
    }
  })

  it('makes Show 30 more a ghost neutral button at the default size, with no border-style outline', async () => {
    unmapped = Array.from({ length: 40 }, (_, index) => ({ item: `Item ${index}`, entries: 1 }))
    const wrapper = await mountMealie()
    const more = wrapper.findAll('button').filter(candidate => candidate.text() === 'Show 30 more')
    expect(more).toHaveLength(1)
    expect(quiet(more[0]!)).toEqual(['ghost', 'neutral'])
    expect(more[0]!.attributes('size')).toBeUndefined()
    expect(wrapper.findAll('[variant="outline"]').filter(candidate => candidate.text() === 'Back to recipe')).toHaveLength(0)
  })

  it('makes Back to recipe navigation a ghost neutral button', async () => {
    const wrapper = await mountMealie('/data/mealie?food=food-9&recipe=curry')
    await vi.waitFor(() => expect(wrapper.find('[data-to="/mealie-recipes/curry"]').exists()).toBe(true))
    expect(quiet(wrapper.get('[data-to="/mealie-recipes/curry"]'))).toEqual(['ghost', 'neutral'])
  })

  it('keeps amber for sales: No entries and No package size are neutral soft badges', async () => {
    const wrapper = await mountMealie()
    for (const label of ['No entries', 'No package size']) {
      const badges = wrapper.findAll('span').filter(candidate => candidate.text() === label)
      expect(badges).toHaveLength(1)
      expect(badges[0]!.attributes()).toMatchObject({ color: 'neutral', variant: 'soft' })
    }
    const broken = wrapper.findAll('span').filter(candidate => candidate.text() === 'Broken')
    expect(broken[0]!.attributes('color')).toBe('error')
    expect(wrapper.findAll('[color="warning"]')).toHaveLength(0)
  })
})
