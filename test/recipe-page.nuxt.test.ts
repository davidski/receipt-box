import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { createError, readBody } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RecipePage from '../app/pages/recipe.vue'

const SAVED_AT = '2026-09-02T12:00:00.000Z'
const savedRecipe = { id: '7', name: 'Pancakes', lines: [{ item: 'Flour', quantity: 500, unit: 'g' }], savedTotal: 12.35, savedAt: SAVED_AT, createdBy: null, updatedAt: SAVED_AT }
const savedDate = new Date(SAVED_AT).toLocaleDateString(undefined, { dateStyle: 'medium' })
const mounted: Array<{ unmount: () => void }> = []
let bodies: Array<{ lines: Array<{ item: string, quantity: number, unit: string }> }>
let reply: () => unknown
let calls: Array<{ method: string, url: string, body?: any }>
let listFails: boolean
let recipeOverride: Record<string, unknown>
let failWith: { statusCode: number, statusMessage: string } | null

beforeEach(() => {
  bodies = []
  reply = () => ({ lines: [], total: 0, excluded: 0 })
  calls = []
  failWith = null
  recipeOverride = {}
  listFails = false
  const recipeHandler = async (event: any) => {
    const body = event.method === 'GET' || event.method === 'DELETE' ? undefined : await readBody(event)
    const path = event.path.replace(/^\/_/, '')
    calls.push({ method: event.method, url: path, body })
    if (failWith && event.method !== 'GET') throw createError(failWith)
    if (event.method === 'DELETE') return null
    if (path === '/api/recipes' && event.method === 'GET' && listFails) throw createError({ statusCode: 500, statusMessage: 'down' })
    if (path === '/api/recipes' && event.method === 'GET') return [{ id: '7', name: 'Pancakes', lineCount: 1, savedTotal: 12.35, savedAt: SAVED_AT, updatedAt: SAVED_AT }]
    if (event.method === 'GET') return { ...savedRecipe, ...recipeOverride }
    return event.method === 'POST' ? { ...savedRecipe, id: '8', name: body.name, lines: body.lines } : { ...savedRecipe, ...body, savedTotal: body.updateSavedPrice ? 14.2 : 12.35 }
  }
  registerEndpoint('/api/recipes', { method: 'GET', handler: recipeHandler })
  registerEndpoint('/api/recipes', { method: 'POST', handler: recipeHandler })
  registerEndpoint('/api/recipes/7', { method: 'GET', handler: recipeHandler })
  registerEndpoint('/api/recipes/7', { method: 'PUT', handler: recipeHandler })
  registerEndpoint('/api/recipes/7', { method: 'DELETE', handler: recipeHandler })
  registerEndpoint('/api/recipes/99', { method: 'GET', handler: () => { throw createError({ statusCode: 404, statusMessage: 'Recipe not found' }) } })
  registerEndpoint('/api/auth/config', () => ({ enabled: false }))
  registerEndpoint('/api/suggestions', () => [])
  registerEndpoint('/api/recipe-cost', {
    method: 'POST',
    handler: async (event) => {
      bodies.push(await readBody(event))
      return reply()
    }
  })
})

afterEach(() => {
  mounted.splice(0).forEach(wrapper => wrapper.unmount())
})

async function mountAt(query: string) {
  const wrapper = await mountSuspended(RecipePage, { route: `/recipe${query}`, attachTo: document.body })
  mounted.push(wrapper)
  await new Promise(resolve => setTimeout(resolve, 450))
  await flushPromises()
  return wrapper
}

const expectQuery = (wrapper: Awaited<ReturnType<typeof mountAt>>, expected: string[]) => vi.waitFor(() => expect(wrapper.vm.$router.currentRoute.value.query.l).toEqual(expected))

function layoutRows(wrapper: Awaited<ReturnType<typeof mountAt>>) {
  wrapper.findAll('[data-recipe-line]').forEach((row, index) => {
    row.element.getBoundingClientRect = () => ({ top: index * 50, bottom: index * 50 + 50, height: 50 } as DOMRect)
  })
}

function pointer(handle: Element, type: string, clientY: number) {
  handle.dispatchEvent(new PointerEvent(type, { bubbles: true, clientY, button: 0, pointerId: 1 }))
}

const order = (wrapper: Awaited<ReturnType<typeof mountAt>>) => wrapper.findAll('[data-recipe-line] input[role="combobox"]').map(input => (input.element as HTMLInputElement).value)

describe('Recipe cost page', () => {
  it('restores lines from the query and shows cost, sale badge, errors and a partial total', async () => {
    reply = () => ({
      lines: [
        { item: 'Flour', quantity: 500, unit: 'g', cost: 1.25, sale: true, error: null },
        { item: 'Saffron', quantity: 1, unit: 'g', cost: null, sale: false, error: 'NO_PRICE' },
        { item: 'Milk', quantity: 2, unit: 'cup', cost: null, sale: false, error: 'INCOMPATIBLE_UNIT' },
        { item: 'Rice', quantity: 1, unit: 'cup', cost: null, sale: false, error: 'NO_PACKAGE_SIZE' }
      ],
      total: 1.25,
      excluded: 3
    })
    const wrapper = await mountAt('?l=Flour|500|g&l=Saffron|1|g&l=Milk|2|cup&l=Rice|1|cup')

    expect(bodies).toHaveLength(1)
    expect(bodies[0]!.lines).toEqual([
      { item: 'Flour', quantity: 500, unit: 'g' },
      { item: 'Saffron', quantity: 1, unit: 'g' },
      { item: 'Milk', quantity: 2, unit: 'cup' },
      { item: 'Rice', quantity: 1, unit: 'cup' }
    ])
    const text = wrapper.text()
    expect(text).toContain('$1.25')
    expect(text).toContain('Sale')
    expect(wrapper.findAll('[data-recipe-cost]')[0]!.html()).toContain('bg-sale-mark')
    expect(text).toContain('No purchases recorded for this item.')
    expect(text).toContain('This unit can\'t be converted to the unit it was bought in.')
    expect(text).toContain('The latest purchase has no package size.')
    expect(wrapper.get('[data-recipe-total]').text()).toContain('partial, 3 excluded')
    expect(wrapper.get('[data-recipe-total] .text-cents').exists()).toBe(true)
    // The editor is set off by rules, not a card.
    expect(wrapper.get('[data-recipe-editor]').classes()).toContain('border-y')
    expect(wrapper.find('[data-slot="root"].rounded-lg').exists()).toBe(false)
  })

  it.each(['lb', 'g', 'ea', 'bunch'])('shows the latest purchase unit %s when conversion is impossible', async (purchaseUnit) => {
    reply = () => ({
      lines: [{ item: 'Flour', cost: null, sale: false, error: 'INCOMPATIBLE_UNIT', purchaseUnit }],
      total: 0, excluded: 1
    })
    const wrapper = await mountAt('?l=Flour|1|cup')
    expect(wrapper.get('[data-recipe-cost] p').text()).toBe(`This unit can't be converted to ${purchaseUnit}, the unit of the latest purchase.`)
    expect(wrapper.get('[data-recipe-cost]').find('strong').exists()).toBe(false)
    expect(bodies).toHaveLength(1)
  })

  it('uses shared column headers, accessible row labels, and an X remove button', async () => {
    const wrapper = await mountAt('')
    expect(wrapper.get('[data-recipe-headers]').text()).toBe('ItemQuantityUnitCost')
    expect(wrapper.findAll('label').map(label => label.text())).toEqual(['Item', 'Quantity', 'Unit'])
    const remove = wrapper.get('button[aria-label="Remove line 1"]')
    expect(remove.html()).toContain('i-lucide:x')
    expect(remove.find('.i-lucide-trash-2').exists()).toBe(false)
    await remove.trigger('click')
    expect(wrapper.findAll('[data-recipe-line]')).toHaveLength(0)
  })

  it('counts only the response lines beside the total when blank or duplicate rows exist', async () => {
    reply = () => ({ lines: [{ item: 'Flour', cost: 1, sale: false, error: null }], total: 1, excluded: 0 })
    const wrapper = await mountAt('?l=Flour|100|g&l=flour|100|g')
    expect(wrapper.get('[data-recipe-total]').text()).toContain('1 line')
    await wrapper.findAll('button').find(button => button.text().includes('Add another line'))!.trigger('click')
    expect(wrapper.findAll('[data-recipe-line]')).toHaveLength(3)
    expect(wrapper.get('[data-recipe-total]').text()).toContain('1 line')
    expect(wrapper.get('[data-recipe-total]').text()).not.toContain('3 lines')
    expect(wrapper.find('button[aria-label="Remove line 3"]').exists()).toBe(true)
  })

  it('offers grams for a pound ingredient and sends the selected unit', async () => {
    const wrapper = await mountAt('?l=Flour|100|lb')
    const unit = wrapper.findAll('input[role="combobox"]')[1]!
    await unit.trigger('focus')
    await unit.trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    const options = Array.from(document.querySelectorAll('[role="option"]'))
    expect(options.map(option => option.textContent?.trim())).toContain('g')
    const grams = options.find(option => option.textContent?.trim() === 'g')!
    ;(grams as HTMLElement).click()
    await new Promise(resolve => setTimeout(resolve, 450))
    await flushPromises()
    expect(bodies.at(-1)!.lines).toEqual([{ item: 'Flour', quantity: 100, unit: 'g' }])
  })

  it('flags a duplicate item and does not send it', async () => {
    reply = () => ({ lines: [{ item: 'Flour', quantity: 500, unit: 'g', cost: 1, sale: false, error: null }], total: 1, excluded: 0 })
    const wrapper = await mountAt('?l=Flour|500|g&l=flour|100|g')

    expect(wrapper.text()).toContain('flour is already in this recipe')
    expect(wrapper.text()).not.toContain('Flour is already in this recipe')
    expect(bodies[0]!.lines).toEqual([{ item: 'Flour', quantity: 500, unit: 'g' }])
    expect(wrapper.findAll('[data-recipe-cost]')[1]!.find('strong').exists()).toBe(false)
    expect(wrapper.findAll('[data-recipe-cost]')[1]!.find('p').exists()).toBe(false)
  })

  it('keeps an item name containing a pipe and skips incomplete lines', async () => {
    const wrapper = await mountAt('?l=A|B|2|ea&l=Salt||g')

    expect(bodies[0]!.lines).toEqual([{ item: 'A|B', quantity: 2, unit: 'ea' }])
    expect(wrapper.find('[data-recipe-total]').exists()).toBe(true)
  })

  it('sends nothing and shows no total for an empty recipe, and supports add and remove', async () => {
    const wrapper = await mountAt('')

    expect(bodies).toHaveLength(0)
    expect(wrapper.find('[data-recipe-total]').exists()).toBe(false)
    expect(wrapper.findAll('[data-recipe-line]')).toHaveLength(1)

    await wrapper.findAll('button').find(button => button.text().includes('Add another line'))!.trigger('click')
    expect(wrapper.findAll('[data-recipe-line]')).toHaveLength(2)
    await wrapper.get('button[aria-label="Remove line 1"]').trigger('click')
    expect(wrapper.findAll('[data-recipe-line]')).toHaveLength(1)
  })

  it('shows the request error when the calculation fails', async () => {
    registerEndpoint('/api/recipe-cost', {
      method: 'POST',
      handler: () => { throw createError({ statusCode: 400, statusMessage: 'Flour needs a quantity above zero' }) }
    })
    const wrapper = await mountAt('?l=Flour|500|g')

    expect(wrapper.text()).toContain('Flour needs a quantity above zero')
    expect(wrapper.find('[data-recipe-total]').exists()).toBe(false)
  })

  describe('saved recipes', () => {
    const settle = async () => { await new Promise(resolve => setTimeout(resolve, 60)); await flushPromises() }
    const costOf = (total: number) => () => ({ lines: [{ item: 'Flour', cost: total, sale: false, error: null }], total, excluded: 0 })
    const button = (wrapper: any, label: string) => wrapper.findAll('button').find((b: any) => b.text().includes(label))
    const typeName = async (wrapper: any, value: string) => wrapper.get('input[aria-label="Recipe name"]').setValue(value)

    it('links to the recipe list page', async () => {
      const wrapper = await mountAt('')
      expect(wrapper.findAll('a').find(a => a.text().includes('All recipes'))!.attributes('href')).toBe('/recipes')
    })

    it('lists saved recipes and creates a new one with POST', async () => {
      reply = costOf(12.35)
      const wrapper = await mountAt('?l=Flour|500|g')
      expect(button(wrapper, 'Save recipe')!.attributes('disabled')).toBeDefined()
      await typeName(wrapper, '  Crepes ')
      await button(wrapper, 'Save recipe')!.trigger('click')
      await settle()

      const post = calls.find(call => call.method === 'POST')!
      expect(post.body).toEqual({ name: 'Crepes', lines: [{ item: 'Flour', quantity: 500, unit: 'g' }] })
      expect(wrapper.get('[data-recipe-snapshot]').text()).toContain('Saved at $12.35')
      expect(button(wrapper, 'Save changes')!.attributes('disabled')).toBeDefined()
      expect(button(wrapper, 'Delete')).toBeTruthy()
    })

    it('loads a recipe by ?recipe= and ignores ?l= lines', async () => {
      reply = costOf(14.2)
      const wrapper = await mountAt('?recipe=7&l=Salt|1|g')

      expect(calls.some(call => call.method === 'GET' && call.url === '/api/recipes/7')).toBe(true)
      expect((wrapper.get('input[aria-label="Recipe name"]').element as HTMLInputElement).value).toBe('Pancakes')
      expect(bodies.at(-1)!.lines).toEqual([{ item: 'Flour', quantity: 500, unit: 'g' }])
      expect(bodies.every(body => !body.lines.some(line => line.item === 'Salt'))).toBe(true)
    })

    it('shows the saved snapshot with an upward change in the shared increase treatment', async () => {
      reply = costOf(14.2)
      const wrapper = await mountAt('?recipe=7')
      const snapshot = wrapper.get('[data-recipe-snapshot]')

      expect(snapshot.text()).toContain(`Saved at $12.35 on ${savedDate} · now $14.20`)
      const change = snapshot.get('[data-recipe-change]')
      expect(change.get('[data-figure]').text()).toBe('+$1.85')
      expect(change.get('.sr-only').text()).toBe('up $1.85')
      expect(change.classes().join(' ')).toContain('error')
    })

    it('shows a downward change in the shared decrease treatment', async () => {
      reply = costOf(10.35)
      const wrapper = await mountAt('?recipe=7')
      const change = wrapper.get('[data-recipe-change]')
      expect(change.get('[data-figure]').text()).toBe('−$2.00')
      expect(change.get('.sr-only').text()).toBe('down $2.00')
      expect(change.classes().join(' ')).toContain('success')
    })

    it('hides the change and the Update saved price button when the price is unchanged', async () => {
      reply = costOf(12.35)
      const wrapper = await mountAt('?recipe=7')
      expect(wrapper.get('[data-recipe-snapshot]').text()).toContain('now $12.35')
      expect(wrapper.find('[data-recipe-change]').exists()).toBe(false)
      expect(button(wrapper, 'Update saved price')).toBeUndefined()
    })

    it('hides the change when there is no live total', async () => {
      const wrapper = await mountAt('?recipe=7')
      reply = () => ({ lines: [], total: 0, excluded: 0 })
      await wrapper.get('button[aria-label="Remove line 1"]').trigger('click')
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(wrapper.get('[data-recipe-snapshot]').text()).not.toContain('now')
      expect(wrapper.find('[data-recipe-change]').exists()).toBe(false)
      expect(button(wrapper, 'Update saved price')).toBeUndefined()
    })

    const allExcluded = () => ({ lines: [{ item: 'Flour', cost: null, sale: false, error: 'NO_PRICE' }], total: 0, excluded: 1 })

    it('treats an all-excluded response as no live total for a recipe with no saved price', async () => {
      recipeOverride = { savedTotal: null }
      reply = allExcluded
      const wrapper = await mountAt('?recipe=7')

      expect(wrapper.get('[data-recipe-snapshot]').text()).toContain('with no priced lines')
      expect(wrapper.get('[data-recipe-snapshot]').text()).not.toContain('$0.00')
      expect(button(wrapper, 'Update saved price')).toBeUndefined()
    })

    it('shows no "now" or change for a priced recipe whose lines have all become unpriceable', async () => {
      reply = allExcluded
      const wrapper = await mountAt('?recipe=7')

      expect(wrapper.get('[data-recipe-snapshot]').text()).toContain('Saved at $12.35')
      expect(wrapper.get('[data-recipe-snapshot]').text()).not.toContain('now')
      expect(wrapper.get('[data-recipe-snapshot]').text()).not.toContain('$0.00')
      expect(wrapper.find('[data-recipe-change]').exists()).toBe(false)
      expect(button(wrapper, 'Update saved price')).toBeUndefined()
    })

    it('offers Update saved price when a recipe saved without a price becomes priceable', async () => {
      recipeOverride = { savedTotal: null }
      reply = costOf(5)
      const wrapper = await mountAt('?recipe=7')
      expect(button(wrapper, 'Update saved price')).toBeTruthy()
    })

    it('hides Update saved price while there are unsaved edits and restores it when they are undone', async () => {
      reply = costOf(14.2)
      const wrapper = await mountAt('?recipe=7')
      expect(button(wrapper, 'Update saved price')).toBeTruthy()

      await typeName(wrapper, 'Pancakes v2')
      expect(button(wrapper, 'Update saved price')).toBeUndefined()
      expect(calls.some(call => call.method === 'PUT')).toBe(false)

      await typeName(wrapper, 'Pancakes')
      expect(button(wrapper, 'Update saved price')).toBeTruthy()
    })

    it('names the picker after the selected recipe and announces errors', async () => {
      const wrapper = await mountAt('?recipe=7')
      expect(wrapper.get('button[aria-haspopup="listbox"]').attributes('aria-label')).toBe('Saved recipe: Pancakes')

      failWith = { statusCode: 409, statusMessage: 'duplicate' }
      await typeName(wrapper, 'Crepes')
      await button(wrapper, 'Save changes')!.trigger('click')
      await settle()
      expect(wrapper.get('[data-recipe-error]').attributes('role')).toBe('alert')
    })

    it('shows an inline error when the saved recipe list cannot load', async () => {
      listFails = true
      const wrapper = await mountAt('')
      expect(wrapper.get('[data-recipe-list-error]').text()).toContain('Could not load the saved recipes')
      expect(wrapper.get('[data-recipe-list-error]').attributes('role')).toBe('alert')
    })

    it('Update saved price sends the flag', async () => {
      reply = costOf(14.2)
      const wrapper = await mountAt('?recipe=7')
      await button(wrapper, 'Update saved price')!.trigger('click')
      await settle()

      const put = calls.find(call => call.method === 'PUT')!
      expect(put.url).toBe('/api/recipes/7')
      expect(put.body).toMatchObject({ name: 'Pancakes', updateSavedPrice: true })
      expect(wrapper.get('[data-recipe-snapshot]').text()).toContain('Saved at $14.20')
      expect(button(wrapper, 'Update saved price')).toBeUndefined()
    })

    it('saving edits sends a PUT without the update flag', async () => {
      reply = costOf(12.35)
      const wrapper = await mountAt('?recipe=7')
      expect(button(wrapper, 'Save changes')!.attributes('disabled')).toBeDefined()
      await typeName(wrapper, 'Crepes')
      await button(wrapper, 'Save changes')!.trigger('click')
      await settle()

      const put = calls.find(call => call.method === 'PUT')!
      expect(put.body.name).toBe('Crepes')
      expect(put.body).not.toHaveProperty('updateSavedPrice')
    })

    it('shows a plain error when the name is taken', async () => {
      reply = costOf(12.35)
      failWith = { statusCode: 409, statusMessage: 'duplicate' }
      const wrapper = await mountAt('?l=Flour|500|g')
      await typeName(wrapper, 'pancakes')
      await button(wrapper, 'Save recipe')!.trigger('click')
      await settle()

      expect(wrapper.get('[data-recipe-error]').text()).toBe('A recipe named “pancakes” already exists. Choose a different name.')
      expect(wrapper.find('[data-recipe-snapshot]').exists()).toBe(false)
    })

    it('reports a recipe deleted elsewhere when saving and detaches it', async () => {
      reply = costOf(12.35)
      const wrapper = await mountAt('?recipe=7')
      failWith = { statusCode: 404, statusMessage: 'gone' }
      await typeName(wrapper, 'Crepes')
      await button(wrapper, 'Save changes')!.trigger('click')
      await settle()

      expect(wrapper.get('[data-recipe-error]').text()).toContain('no longer exists')
      expect(wrapper.find('[data-recipe-snapshot]').exists()).toBe(false)
      expect(button(wrapper, 'Save recipe')).toBeTruthy()
    })

    it('shows an error and falls back to a blank recipe when ?recipe= is missing', async () => {
      const wrapper = await mountAt('?recipe=99')
      expect(wrapper.get('[data-recipe-error]').text()).toContain('no longer exists')
      expect(wrapper.findAll('[data-recipe-line]')).toHaveLength(1)
      expect(wrapper.find('[data-recipe-snapshot]').exists()).toBe(false)
    })

    it('requires confirmation before deleting', async () => {
      reply = costOf(12.35)
      const wrapper = await mountAt('?recipe=7')
      await button(wrapper, 'Delete')!.trigger('click')
      await settle()

      expect(calls.some(call => call.method === 'DELETE')).toBe(false)
      expect(document.body.textContent).toContain('Delete recipe?')
      const confirm = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Delete recipe')!
      confirm.click()
      await settle()

      expect(calls.filter(call => call.method === 'DELETE')).toHaveLength(1)
      expect(wrapper.find('[data-recipe-snapshot]').exists()).toBe(false)
      expect((wrapper.get('input[aria-label="Recipe name"]').element as HTMLInputElement).value).toBe('')
    })

    it('cancelling the confirmation keeps the recipe', async () => {
      reply = costOf(12.35)
      const wrapper = await mountAt('?recipe=7')
      await button(wrapper, 'Delete')!.trigger('click')
      await settle()
      Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Cancel')!.click()
      await settle()

      expect(calls.some(call => call.method === 'DELETE')).toBe(false)
      expect(wrapper.find('[data-recipe-snapshot]').exists()).toBe(true)
    })
  })

  it('reorders a line from the keyboard, keeps focus on its handle and syncs the query', async () => {
    const wrapper = await mountAt('?l=Flour|1|g&l=Salt|2|g&l=Rice|3|g')
    const handle = wrapper.get('button[aria-label="Reorder line 1, Flour"]')
    expect(handle.text()).toBe('1')

    await handle.trigger('keydown', { key: 'ArrowDown', altKey: true })
    await flushPromises()

    expect(wrapper.findAll('[data-recipe-line] input[role="combobox"]').filter((_, i) => i % 2 === 0).map(input => (input.element as HTMLInputElement).value)).toEqual(['Salt', 'Flour', 'Rice'])
    await expectQuery(wrapper, ['Salt|2|g', 'Flour|1|g', 'Rice|3|g'])
    expect(document.activeElement).toBe(wrapper.get('button[aria-label="Reorder line 2, Flour"]').element)

    await wrapper.get('button[aria-label="Reorder line 2, Flour"]').trigger('keydown', { key: 'ArrowUp', altKey: true })
    await flushPromises()
    await expectQuery(wrapper, ['Flour|1|g', 'Salt|2|g', 'Rice|3|g'])
    expect(document.activeElement).toBe(wrapper.get('button[aria-label="Reorder line 1, Flour"]').element)
  })

  it('ignores plain arrows and moves past either end', async () => {
    const wrapper = await mountAt('?l=Flour|1|g&l=Salt|2|g')
    await wrapper.get('button[aria-label="Reorder line 1, Flour"]').trigger('keydown', { key: 'ArrowDown' })
    await wrapper.get('button[aria-label="Reorder line 1, Flour"]').trigger('keydown', { key: 'ArrowUp', altKey: true })
    await wrapper.get('button[aria-label="Reorder line 2, Salt"]').trigger('keydown', { key: 'ArrowDown', altKey: true })
    await flushPromises()
    await expectQuery(wrapper, ['Flour|1|g', 'Salt|2|g'])
  })

  it('drags a line past the others with live room-making and drops it in place', async () => {
    const wrapper = await mountAt('?l=Flour|1|g&l=Salt|2|g&l=Rice|3|g')
    layoutRows(wrapper)
    const handle = wrapper.get('button[aria-label="Reorder line 1, Flour"]').element
    handle.setPointerCapture = () => {}

    pointer(handle, 'pointerdown', 25)
    pointer(handle, 'pointermove', 27)
    await flushPromises()
    expect(wrapper.findAll('[data-recipe-line]')[0]!.attributes('style') ?? '').not.toContain('translateY')

    pointer(handle, 'pointermove', 100)
    await flushPromises()
    const rows = wrapper.findAll('[data-recipe-line]')
    expect(rows[0]!.attributes('style')).toContain('translateY(75px)')
    expect(rows[0]!.classes()).toContain('bg-(--accent-soft)')
    expect(rows[1]!.attributes('style')).toContain('translateY(-50px)')
    expect(rows[2]!.attributes('style') ?? '').not.toContain('translateY')

    pointer(handle, 'pointermove', 400)
    await flushPromises()
    expect(wrapper.findAll('[data-recipe-line]')[2]!.attributes('style')).toContain('translateY(-50px)')
    pointer(handle, 'pointerup', 400)
    await flushPromises()

    await expectQuery(wrapper, ['Salt|2|g', 'Rice|3|g', 'Flour|1|g'])
    expect(wrapper.findAll('[data-recipe-line]').every(row => !(row.attributes('style') ?? '').includes('translateY'))).toBe(true)
  })

  it('drags a line upward, and cancelled or tiny drags change nothing', async () => {
    const wrapper = await mountAt('?l=Flour|1|g&l=Salt|2|g&l=Rice|3|g')
    layoutRows(wrapper)
    const handle = wrapper.get('button[aria-label="Reorder line 3, Rice"]').element
    handle.setPointerCapture = () => {}

    pointer(handle, 'pointerdown', 125)
    pointer(handle, 'pointermove', 128)
    pointer(handle, 'pointerup', 128)
    pointer(handle, 'pointerdown', 125)
    pointer(handle, 'pointermove', 40)
    pointer(handle, 'pointercancel', 40)
    pointer(handle, 'pointermove', 40)
    await flushPromises()
    await expectQuery(wrapper, ['Flour|1|g', 'Salt|2|g', 'Rice|3|g'])

    pointer(handle, 'pointerdown', 125)
    pointer(handle, 'pointermove', 20)
    await flushPromises()
    expect(wrapper.findAll('[data-recipe-line]')[0]!.attributes('style')).toContain('translateY(50px)')
    pointer(handle, 'pointerup', 20)
    await flushPromises()
    await expectQuery(wrapper, ['Rice|3|g', 'Flour|1|g', 'Salt|2|g'])
  })
})
