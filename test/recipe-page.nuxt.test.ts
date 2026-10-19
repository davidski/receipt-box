import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { createError, readBody } from 'h3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import RecipePage from '../app/pages/recipe.vue'

const mounted: Array<{ unmount: () => void }> = []
let bodies: Array<{ lines: Array<{ item: string, quantity: number, unit: string }> }>
let reply: () => unknown

beforeEach(() => {
  bodies = []
  reply = () => ({ lines: [], total: 0, excluded: 0 })
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
    expect(text).toContain('No purchases recorded for this item.')
    expect(text).toContain('This unit can\'t be converted to the unit it was bought in.')
    expect(text).toContain('The latest purchase has no package size.')
    expect(wrapper.get('[data-recipe-total]').text()).toContain('partial, 3 excluded')
  })

  it.each(['lb', 'g', 'ea', 'bunch'])('shows the latest purchase unit %s when conversion is impossible', async (purchaseUnit) => {
    reply = () => ({
      lines: [{ item: 'Flour', cost: null, sale: false, error: 'INCOMPATIBLE_UNIT', purchaseUnit }],
      total: 0, excluded: 1
    })
    const wrapper = await mountAt('?l=Flour|1|cup')
    expect(wrapper.get('[data-recipe-cost]').text()).toBe(`This unit can't be converted to ${purchaseUnit}, the unit of the latest purchase.`)
    expect(bodies).toHaveLength(1)
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
    expect(wrapper.findAll('[data-recipe-cost]')[1]!.text()).toBe('')
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

    await wrapper.findAll('button').find(button => button.text().includes('Add item'))!.trigger('click')
    expect(wrapper.findAll('[data-recipe-line]')).toHaveLength(2)
    await wrapper.get('button[aria-label="Remove line"]').trigger('click')
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
})
