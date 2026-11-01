import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'
import CostPage from '../app/pages/mealie-recipes/[slug].vue'
import ListPage from '../app/pages/mealie-recipes/index.vue'
import RecipesPage from '../app/pages/recipes.vue'
import { cardCell, cardRow, cardTable } from '../app/utils/data-table'
import { clearNuxtData, useRoute, useRouter } from '#imports'

type Line = Record<string, unknown>
// Postgres returns NUMERIC columns as strings with trailing zeros.
const purchase = { id: '1', item: 'AP Flour', price: '4.79', size: '5.000', unit: 'lb', saleItem: false, purchasedOn: '2026-01-02', usedSalePrice: false }
const line = (name: string | null, overrides: Line = {}): Line => ({
  food: name ? { id: name, name } : null, note: null, recipe: null, quantity: 1, unit: null, normalizedQuantity: null,
  item: null, purchase: null, normalizedPackageQuantity: null, cost: null, status: 'uncosted', error: null, ...overrides
})
const costed = (name: string, cost: number, overrides: Line = {}) => line(name, { cost, status: 'exact', purchase, normalizedQuantity: { base: 'g', amount: 100 }, normalizedPackageQuantity: { base: 'g', amount: 2267.96 }, ...overrides })
const unmapped = (name: string, error = 'NO_PRODUCT_MAPPING', food?: { id: string, name: string }) => line(name, { error, quantity: null, ...(food ? { food } : {}) })
const recipe = (ingredients: Line[], extra: Line = {}, summary: Line = {}) => {
  const done = ingredients.filter(item => !item.error)
  return {
    slug: 'curry', name: 'Chickpea Curry', servings: 6, ingredients,
    summary: {
      cost: done.reduce((sum, item) => sum + Math.round(Number(item.cost) * 100), 0) / 100, costPerServing: 1.46, costedIngredients: done.length,
      totalIngredients: ingredients.length, coverage: 0, uncosted: ingredients.filter(item => item.error).map(item => ({ name: null, error: item.error })), ...summary
    },
    ...extra
  }
}

let status: Record<string, unknown>
let costReply: () => unknown
let costRequests: string[]
let listReply: () => unknown

enableAutoUnmount(afterEach)

beforeEach(() => {
  clearNuxtData()
  status = { configured: true }
  costReply = () => recipe([costed('Chickpeas', 8.73)])
  costRequests = []
  listReply = () => ({ recipes: [{ slug: 'curry', name: 'Chickpea Curry', servings: 6 }, { slug: 'a b/c', name: 'Odd Slug', servings: null }] })
  registerEndpoint('/api/auth/config', () => ({ enabled: false }))
  registerEndpoint('/api/mealie/status', () => status)
  registerEndpoint('/api/recipes', () => [])
  registerEndpoint('/api/mealie/recipes', () => listReply())
  registerEndpoint('/api/mealie/recipes/curry/cost', (event) => {
    costRequests.push(event.path)
    return costReply()
  })
})

async function mountCost(path = '/mealie-recipes/curry') {
  const wrapper = await mountSuspended(CostPage, { route: path })
  await flushPromises()
  return wrapper
}
const summaryOf = (wrapper: Awaited<ReturnType<typeof mountCost>>, key: string) => wrapper.get(`[data-summary="${key}"]`).text()
const missingLines = (wrapper: Awaited<ReturnType<typeof mountCost>>) => wrapper.findAll('[data-summary="missing"] li').map(item => item.text())
const buttonNamed = (wrapper: VueWrapper, label: string) => wrapper.findAllComponents({ name: 'UButton' }).find(button => button.text() === label)!

describe('Mealie link', () => {
  it('opens the recipe in Mealie in a new window', async () => {
    costReply = () => recipe([costed('Chickpeas', 8.73)], { url: 'https://mealie.example/g/home/r/curry' })
    const link = (await mountCost()).get('a[aria-label="Open Chickpea Curry in Mealie, in a new window"]')
    expect(link.attributes('href')).toBe('https://mealie.example/g/home/r/curry')
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toContain('noopener')
  })

  it('styles the link as a ghost neutral button at md, not an outlined control', async () => {
    costReply = () => recipe([costed('Chickpeas', 8.73)], { url: 'https://mealie.example/g/home/r/curry' })
    const button = buttonNamed(await mountCost(), 'Open in Mealie')

    expect(button.props()).toMatchObject({ variant: 'ghost', color: 'neutral', size: 'md' })
    expect(button.classes().join(' ')).not.toMatch(/\bring\b/)
  })

  it('leaves the link out when the address is unknown', async () => {
    costReply = () => recipe([costed('Chickpeas', 8.73)], { url: null })
    expect((await mountCost()).text()).not.toContain('Open in Mealie')
  })
})

describe('summary', () => {
  it.each([
    [[costed('Chickpeas', 8.73), unmapped('Saffron')], '≥ $8.73', '≥ $1.45 / serving', '1 / 2 ingredients'],
    [[costed('Chickpeas', 8.73)], '$8.73', '$1.46 / serving', '1 / 1 ingredients']
  ])('shows ≥ only below full coverage, rounding a lower bound down', async (ingredients, total, perServing, coverage) => {
    costReply = () => recipe(ingredients as Line[])
    const wrapper = await mountCost()
    expect(summaryOf(wrapper, 'cost')).toBe(total)
    expect(summaryOf(wrapper, 'per-serving')).toBe(perServing)
    expect(summaryOf(wrapper, 'coverage')).toBe(coverage)
  })

  it('treats a $0 line as costed and an unmapped line as unpriced, not $0', async () => {
    costReply = () => recipe([costed('Chickpeas', 8.73), costed('Water', 0), unmapped('Saffron')])
    const wrapper = await mountCost()
    const rows = wrapper.findAll('[data-mealie-cost-row]')
    const cost = (name: string) => rows.find(row => row.text().includes(name))!.get('[data-col="cost"]').text()

    expect(cost('Chickpeas')).toBe('$8.73')
    expect(cost('Water')).toBe('$0.00')
    expect(cost('Saffron')).toBe('—')
    expect(summaryOf(wrapper, 'coverage')).toBe('2 / 3 ingredients')
    expect(summaryOf(wrapper, 'cost')).toBe('≥ $8.73')
  })

  it('names every missing reason beside the estimate with its count, one reason per line', async () => {
    costReply = () => recipe([costed('Chickpeas', 8.73), unmapped('Saffron'), unmapped('Mace'), unmapped('Salt', 'NO_PRICE')])
    const wrapper = await mountCost()

    expect(missingLines(wrapper)).toEqual(['Not mapped to a grocery item (2)', 'No purchase recorded (1)'])
    expect(wrapper.get('[data-summary="missing"]').find('ul').exists()).toBe(true)
    expect(summaryOf(wrapper, 'missing')).not.toContain('·')
  })

  it('lists a single missing reason as one line', async () => {
    costReply = () => recipe([costed('Chickpeas', 8.73), unmapped('Saffron')])
    expect(missingLines(await mountCost())).toEqual(['Not mapped to a grocery item (1)'])
  })

  it('has no missing reasons at full coverage', async () => {
    expect((await mountCost()).find('[data-summary="missing"]').exists()).toBe(false)
  })

  it('explains every failure code in words', async () => {
    const codes = ['NO_PRICE', 'NO_PACKAGE_SIZE', 'NO_QUANTITY', 'NO_UNIT', 'UNSTANDARDIZED_UNIT', 'DIMENSION_MISMATCH', 'SUBRECIPE_UNSUPPORTED', 'NO_FOOD', 'UNKNOWN_FOOD', 'INACTIVE_MEALIE_FOOD', 'NO_PRODUCT_MAPPING']
    costReply = () => recipe(codes.map(code => unmapped(code, code)))
    const wrapper = await mountCost()

    for (const code of codes) {
      const row = wrapper.findAll('[data-mealie-cost-row]').find(item => item.text().startsWith(code))!
      const reason = row.text().slice(code.length)
      expect(reason, code).toMatch(/^[A-Z][a-z]/)
      expect(reason, code).not.toMatch(/[A-Z]_[A-Z]/)
    }
    expect(missingLines(wrapper)).toHaveLength(codes.length)
    expect(wrapper.get('[data-summary="missing"]').text()).not.toMatch(/[A-Z]_[A-Z]/)
  })

  it('words an unsynced food without cache or catalog jargon', async () => {
    costReply = () => recipe([unmapped('Saffron', 'UNKNOWN_FOOD')])
    const wrapper = await mountCost()
    expect(wrapper.get('[data-mealie-cost-row]').text()).toContain('Food hasn\'t reached Receipt Box yet')
    expect(missingLines(wrapper)).toEqual(['Food hasn\'t reached Receipt Box yet (1)'])
  })

  it('shows no per-serving figure when servings is null', async () => {
    costReply = () => recipe([costed('Chickpeas', 8.73)], { servings: null }, { costPerServing: null })
    const wrapper = await mountCost()
    expect(summaryOf(wrapper, 'per-serving')).toBe('Not set in Mealie')
    expect(summaryOf(wrapper, 'cost')).toBe('$8.73')
  })

  it('shows no estimate for a recipe with zero ingredients', async () => {
    costReply = () => recipe([], {}, { costPerServing: 0 })
    const wrapper = await mountCost()
    expect(summaryOf(wrapper, 'cost')).toBe('—')
    expect(summaryOf(wrapper, 'per-serving')).toBe('—')
    expect(summaryOf(wrapper, 'coverage')).toBe('0 / 0 ingredients')
    expect(wrapper.get('[data-mealie-cost-empty]').text()).toContain('no ingredients')
    expect(wrapper.find('[data-mealie-cost-table]').exists()).toBe(false)
  })

  it('names an unnamed line by its recipe, note or a placeholder', async () => {
    costReply = () => recipe([line(null, { recipe: 'Pie crust', error: 'SUBRECIPE_UNSUPPORTED', quantity: null }), line(null, { note: 'to taste', error: 'NO_FOOD', quantity: null }), line(null, { error: 'NO_FOOD', quantity: null })])
    const text = (await mountCost()).findAll('[data-mealie-cost-row]').map(row => row.text())
    expect(text.map(item => item.split(/Sub|No /)[0])).toEqual(['Pie crust', 'to taste', 'Unnamed ingredient'])
  })
})

describe('ingredient table and line breakdowns', () => {
  const toggle = (wrapper: Awaited<ReturnType<typeof mountCost>>, line: number) => wrapper.get(`button[aria-label="How line ${line} was priced"]`)
  const toggles = (wrapper: Awaited<ReturnType<typeof mountCost>>) => wrapper.findAll('button[aria-label^="How line "]')
  const breakdowns = (wrapper: Awaited<ReturnType<typeof mountCost>>) => wrapper.findAll('[data-mealie-cost-breakdown]')

  it('puts a collapsed chevron beside each priced cost and opens its breakdown beneath that row', async () => {
    costReply = () => recipe([
      costed('Flour', 0.5, { quantity: 2, unit: { id: 'u', name: 'cup' }, status: 'unit_converted', purchase: { ...purchase, usedSalePrice: true } }),
      unmapped('Saffron'),
      costed('Odd', 1, { purchase: { ...purchase, size: null, unit: null, purchasedOn: 'not-a-date' }, normalizedQuantity: null })
    ])
    const wrapper = await mountCost()
    const rows = wrapper.findAll('[data-mealie-cost-row]')

    expect(rows[0]!.text()).toContain('2 cup')
    expect(rows[0]!.get('[data-col="cost"]').text()).toContain('Sale')
    expect(toggle(wrapper, 1).attributes('aria-expanded')).toBe('false')
    expect(toggles(wrapper).map(button => button.attributes('aria-label'))).toEqual(['How line 1 was priced', 'How line 3 was priced'])
    expect(breakdowns(wrapper)).toHaveLength(0)

    await toggle(wrapper, 1).trigger('click')
    expect(toggle(wrapper, 1).attributes('aria-expanded')).toBe('true')
    expect(toggle(wrapper, 1).html()).toContain('chevron-up')
    const [flour] = breakdowns(wrapper)
    expect(flour!.element.previousElementSibling!.hasAttribute('data-mealie-cost-row')).toBe(true)
    expect(flour!.text()).toContain('AP Flour')
    expect(flour!.text()).toContain('5 lb on Jan 2, 2026')
    expect(flour!.text()).toContain('$4.79')
    expect(flour!.html()).toContain('bg-sale-mark')
    expect(flour!.text()).toContain('4% of the package')
    expect(flour!.text()).toContain('100 of 2,267.96 g, units converted')

    await toggle(wrapper, 1).trigger('click')
    expect(breakdowns(wrapper)).toHaveLength(0)
  })

  it('keeps several breakdowns open and shows a null size as the purchase date alone', async () => {
    costReply = () => recipe([
      costed('Flour', 0.5),
      unmapped('Saffron'),
      costed('Odd', 1, { purchase: { ...purchase, size: null, unit: null, purchasedOn: 'not-a-date' }, normalizedQuantity: null })
    ])
    const wrapper = await mountCost()
    await toggle(wrapper, 1).trigger('click')
    await toggle(wrapper, 3).trigger('click')

    expect(breakdowns(wrapper)).toHaveLength(2)
    expect(breakdowns(wrapper)[1]!.text()).toContain('Bought not-a-date')
    expect(breakdowns(wrapper)[1]!.text()).not.toContain('Recipe uses')
    expect(toggle(wrapper, 3).attributes('aria-expanded')).toBe('true')
  })

  it('sets the breakdown figures in tabular figures', async () => {
    const wrapper = await mountCost()
    await toggle(wrapper, 1).trigger('click')

    expect(breakdowns(wrapper)[0]!.find('dl').classes()).toContain('tabular-nums')
  })

  it('gives no chevron when no line has a purchase, so there is nothing to open', async () => {
    costReply = () => recipe([unmapped('Saffron')])
    const wrapper = await mountCost()

    expect(toggles(wrapper)).toHaveLength(0)
    expect(breakdowns(wrapper)).toHaveLength(0)
  })

  it('links only mapping failures, and a line without a food has nothing to open', async () => {
    costReply = () => recipe([unmapped('Saffron'), unmapped('Bunch', 'UNSTANDARDIZED_UNIT'), line(null, { error: 'UNKNOWN_FOOD' }), costed('Chickpeas', 1)])
    const wrapper = await mountCost()
    const rows = wrapper.findAll('[data-mealie-cost-row]')

    expect(rows[0]!.get('a').attributes('href')).toContain('/data/mealie?food=Saffron&recipe=curry&name=Saffron')
    expect(rows[1]!.find('a').exists()).toBe(false)
    expect(rows[2]!.find('a').exists()).toBe(false)
    expect(toggles(wrapper).map(button => button.attributes('aria-label'))).toEqual(['How line 4 was priced'])
    expect(wrapper.find('a[href="/data/mealie"]').exists()).toBe(true)
  })
})

describe('table layout', () => {
  const phoneClasses = (el: { classes: () => string[] }) => el.classes().filter(name => name.startsWith('max-sm:'))
  // The card an ingredient's rows share on a phone: one tbody, so an open breakdown sits inside it.
  const phoneCard = ['max-sm:gap-0!', 'max-sm:rounded-card', 'max-sm:border', 'max-sm:border-line', 'max-sm:bg-surface', 'max-sm:shadow-(--shadow)']

  it('names the ingredient table, labels every cell and turns rows into cards on a phone', async () => {
    costReply = () => recipe([costed('Chickpeas', 8.73), unmapped('Saffron')])
    const wrapper = await mountCost()
    const table = wrapper.get('[data-mealie-cost-table]')

    expect(table.get('caption').text()).toBe('Ingredients and what each costs')
    expect(table.classes()).toEqual(expect.arrayContaining(cardTable.split(' ')))
    expect(table.findAll('thead th').map(th => [th.text(), th.attributes('scope')])).toEqual([['Ingredient', 'col'], ['Cost', 'col']])
    expect(table.findAll('[data-mealie-cost-group]')).toHaveLength(2)
    for (const group of table.findAll('[data-mealie-cost-group]')) {
      expect(group.element.tagName).toBe('TBODY')
      expect(group.classes()).toEqual(expect.arrayContaining(phoneCard))
      // Desktop rows carry no card chrome; the card is phone-only.
      expect(group.classes()).not.toContain('rounded-card')
    }
    for (const row of table.findAll('[data-mealie-cost-row]')) {
      expect(row.classes()).toEqual(expect.arrayContaining(['max-sm:grid', 'max-sm:gap-2.5', 'max-sm:p-4']))
      const cells = row.findAll('td')
      expect(cells.map(cell => cell.attributes('data-label'))).toEqual(['Ingredient', 'Cost'])
      cells.forEach(cell => expect(cell.classes()).toEqual(expect.arrayContaining(cardCell.split(' '))))
    }
    expect(table.element.parentElement!.classList).toContain('rounded-card')
    expect(table.element.parentElement!.className).not.toContain('rounded-[')
  })

  it('keeps an open breakdown inside its ingredient card on a phone, filling the width', async () => {
    costReply = () => recipe([costed('Chickpeas', 8.73), unmapped('Saffron'), costed('Flour', 0.5)])
    const wrapper = await mountCost()
    await wrapper.get('button[aria-label="How line 1 was priced"]').trigger('click')
    const [chickpeas, saffron, flour] = wrapper.findAll('[data-mealie-cost-group]')
    const breakdown = wrapper.get('[data-mealie-cost-breakdown]')
    const cell = breakdown.get('td')

    // Same tbody as its own row, directly after it: the card holds both.
    expect(breakdown.element.parentElement).toBe(chickpeas!.element)
    expect(breakdown.element.previousElementSibling).toBe(chickpeas!.get('[data-mealie-cost-row]').element)
    expect(saffron!.find('[data-mealie-cost-breakdown]').exists()).toBe(false)
    expect(flour!.find('[data-mealie-cost-breakdown]').exists()).toBe(false)
    // Spans both columns and is a block on a phone, so it takes the card's width instead of shrinking to its content.
    expect(cell.attributes('colspan')).toBe('2')
    expect(cell.classes()).toEqual(expect.arrayContaining(['px-4', 'pb-4', 'max-sm:block']))
    expect(cell.find('dl').exists()).toBe(true)
    // The gap between the row and its breakdown is the card's own, so it is zero.
    expect(chickpeas!.classes()).toContain('max-sm:gap-0!')
  })

  it('keeps the quantity beside the name on wide screens only', async () => {
    costReply = () => recipe([costed('Flour', 0.5, { quantity: 2, unit: { id: 'u', name: 'cup' } })])
    const quantity = (await mountCost()).get('[data-mealie-cost-row] span.text-sm')

    expect(quantity.text()).toBe('2 cup')
    expect(quantity.classes()).toContain('sm:ml-2')
    expect(quantity.classes()).not.toContain('ml-2')
  })

  it('left-aligns the cost under its label on a phone', async () => {
    const cell = (await mountCost()).get('[data-col="cost"]')
    expect(cell.classes()).toEqual(expect.arrayContaining(['text-right', 'max-sm:text-left']))
    expect(phoneClasses(cell)).toContain('max-sm:grid')
  })
})

describe('errors', () => {
  it('says the recipe was not found on 404 and offers no retry', async () => {
    costReply = () => { throw createError({ statusCode: 404, statusMessage: 'Recipe not found in Mealie' }) }
    const alert = (await mountCost()).get('[data-mealie-cost-error]')
    expect(alert.text()).toContain('not found in Mealie')
    expect(alert.find('button').exists()).toBe(false)
  })

  it('reports an unreachable Mealie on 502 and retries', async () => {
    costReply = () => { throw createError({ statusCode: 502, statusMessage: 'Mealie is unreachable: timeout' }) }
    const wrapper = await mountCost()
    const alert = wrapper.get('[data-mealie-cost-error]')
    expect(alert.text()).toContain('Mealie couldn\'t be reached or returned an error. Mealie is unreachable: timeout')

    costReply = () => recipe([costed('Chickpeas', 8.73)])
    await alert.get('button').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[data-summary="cost"]').exists()).toBe(true))
    expect(wrapper.find('[data-mealie-cost-error]').exists()).toBe(false)
  })

  it('shows the server message for other failures', async () => {
    costReply = () => { throw createError({ statusCode: 409, statusMessage: 'Mealie is not configured' }) }
    expect((await mountCost()).get('[data-mealie-cost-error]').text()).toContain('Mealie is not configured')
  })

  it('requests the cost of the slug in the address', async () => {
    await mountCost()
    expect(costRequests).toHaveLength(1)
    expect(costRequests[0]).toContain('/curry/cost')
  })
})

describe('navigation back', () => {
  it('leads from the Mealie list to the native recipes with a ghost arrow button', async () => {
    const wrapper = await mountSuspended(ListPage, { route: '/mealie-recipes' })
    await flushPromises()
    const back = wrapper.get('a[href="/recipes"]')

    expect(back.text()).toBe('Recipes')
    expect(back.find('[class*="arrow-left"]').exists()).toBe(true)
  })

  it.each([
    ['no recipes', () => ({ recipes: [] })],
    ['a Mealie failure', () => { throw createError({ statusCode: 502, statusMessage: 'Mealie is unreachable: timeout' }) }]
  ])('keeps the way back to native recipes with %s', async (_label, reply) => {
    listReply = reply
    const wrapper = await mountSuspended(ListPage, { route: '/mealie-recipes' })
    await flushPromises()
    expect(wrapper.get('a[href="/recipes"]').text()).toBe('Recipes')
  })

  it('keeps the cost page link to the Mealie list, not the native recipes', async () => {
    const wrapper = await mountCost()
    expect(wrapper.get('a[href="/mealie-recipes"]').text()).toBe('Mealie recipes')
    expect(wrapper.find('a[href="/recipes"]').exists()).toBe(false)
  })
})

describe('recipe list', () => {
  it('links each recipe to its cost view with an encoded slug and shows servings', async () => {
    const wrapper = await mountSuspended(ListPage, { route: '/mealie-recipes' })
    await flushPromises()
    const rows = wrapper.findAll('[data-mealie-recipe-row]')

    expect(rows.map(row => row.get('a').attributes('href'))).toEqual(['/mealie-recipes/curry', '/mealie-recipes/a%20b%2Fc'])
    expect(rows.map(row => row.findAll('td')[1]!.text())).toEqual(['6', '—'])
  })

  it('names the table, labels every cell and turns rows into cards on a phone', async () => {
    const wrapper = await mountSuspended(ListPage, { route: '/mealie-recipes' })
    await flushPromises()
    const table = wrapper.get('table')

    expect(table.get('caption').text()).toBe('Mealie recipes and their servings')
    expect(table.classes()).toEqual(expect.arrayContaining(cardTable.split(' ')))
    expect(table.element.parentElement!.classList).toContain('rounded-card')
    expect(table.element.parentElement!.className).not.toContain('rounded-[')
    for (const row of table.findAll('[data-mealie-recipe-row]')) {
      expect(row.classes()).toEqual(expect.arrayContaining(cardRow.split(' ')))
      const cells = row.findAll('td')
      expect(cells.map(cell => cell.attributes('data-label'))).toEqual(['Recipe', 'Servings'])
      cells.forEach(cell => expect(cell.classes()).toEqual(expect.arrayContaining(cardCell.split(' '))))
      expect(cells[1]!.classes()).toEqual(expect.arrayContaining(['tabular-nums', 'text-right', 'max-sm:text-left']))
    }
  })

  it('labels the search with visible text tied to the input, which stays once typed in', async () => {
    const wrapper = await mountSuspended(ListPage, { route: '/mealie-recipes' })
    await flushPromises()
    const input = wrapper.get('input')
    const label = wrapper.get('label')

    expect(label.text()).toBe('Search recipes')
    expect(label.attributes('for')).toBe(input.attributes('id'))
    expect(input.attributes('aria-label')).toBeUndefined()
    expect(input.attributes('placeholder')).toBe('Name of a recipe')
    await input.setValue('curry')
    expect(wrapper.get('label').text()).toBe('Search recipes')
  })

  it('filters by name and reports no match', async () => {
    const wrapper = await mountSuspended(ListPage, { route: '/mealie-recipes' })
    await flushPromises()
    await wrapper.get('input').setValue('odd')
    expect(wrapper.findAll('[data-mealie-recipe-row]')).toHaveLength(1)
    await wrapper.get('input').setValue('zzz')
    expect(wrapper.get('[data-mealie-recipes-no-match]').text()).toContain('zzz')
  })

  it('says when Mealie has no recipes', async () => {
    listReply = () => ({ recipes: [] })
    const wrapper = await mountSuspended(ListPage, { route: '/mealie-recipes' })
    await flushPromises()
    expect(wrapper.find('[data-mealie-recipes-empty]').exists()).toBe(true)
  })

  it('shows a 502 with a retry that recovers', async () => {
    listReply = () => { throw createError({ statusCode: 502, statusMessage: 'Mealie is unreachable: timeout' }) }
    const wrapper = await mountSuspended(ListPage, { route: '/mealie-recipes' })
    await flushPromises()
    expect(wrapper.get('[data-mealie-recipes-error]').text()).toContain('Mealie is unreachable: timeout')

    listReply = () => ({ recipes: [{ slug: 'curry', name: 'Chickpea Curry', servings: 6 }] })
    await wrapper.get('[data-mealie-recipes-error] button').trigger('click')
    await vi.waitFor(() => expect(wrapper.findAll('[data-mealie-recipe-row]')).toHaveLength(1))
  })
})

describe('recipe list sorting and paging', () => {
  const recipe = (name: string, servings: number | null = 4) => ({ slug: name.toLowerCase().replace(/ /g, '-'), name, servings })
  const numbered = (count: number, prefix = 'Recipe') => Array.from({ length: count }, (_, index) => recipe(`${prefix} ${String(index + 1).padStart(2, '0')}`))
  const mountList = async () => {
    const wrapper = await mountSuspended(ListPage, { route: '/mealie-recipes' })
    await flushPromises()
    return wrapper
  }
  const names = (wrapper: Awaited<ReturnType<typeof mountList>>) => wrapper.findAll('[data-mealie-recipe-row]').map(row => row.get('a').text())
  const header = (wrapper: Awaited<ReturnType<typeof mountList>>, label: string) => wrapper.findAll('th').find(th => th.text() === label)!
  const clickHeader = async (wrapper: Awaited<ReturnType<typeof mountList>>, label: string) => {
    await header(wrapper, label).get('button').trigger('click')
    await flushPromises()
  }
  const pagination = (wrapper: Awaited<ReturnType<typeof mountList>>) => wrapper.findComponent({ name: 'UPagination' })
  const goToPage = async (wrapper: Awaited<ReturnType<typeof mountList>>, number: number) => {
    await wrapper.findAll('button').find(button => button.text() === String(number))!.trigger('click')
    await flushPromises()
  }

  it('sorts names A–Z, ignoring case, by default', async () => {
    listReply = () => ({ recipes: [recipe('banana'), recipe('Apple'), recipe('cherry'), recipe('apricot')] })
    const wrapper = await mountList()
    expect(names(wrapper)).toEqual(['Apple', 'apricot', 'banana', 'cherry'])
    expect(header(wrapper, 'Recipe').attributes('aria-sort')).toBe('ascending')
    expect(header(wrapper, 'Servings').attributes('aria-sort')).toBe('none')
  })

  it('reverses the name order on a second click', async () => {
    listReply = () => ({ recipes: [recipe('banana'), recipe('Apple'), recipe('cherry'), recipe('apricot')] })
    const wrapper = await mountList()
    await clickHeader(wrapper, 'Recipe')
    expect(names(wrapper)).toEqual(['cherry', 'banana', 'apricot', 'Apple'])
    expect(header(wrapper, 'Recipe').attributes('aria-sort')).toBe('descending')
    await clickHeader(wrapper, 'Recipe')
    expect(names(wrapper)).toEqual(['Apple', 'apricot', 'banana', 'cherry'])
  })

  it('sorts servings high to low first, then low to high, with missing servings last both ways', async () => {
    listReply = () => ({ recipes: [recipe('A', 2), recipe('B', null), recipe('C', 10), recipe('D', 4)] })
    const wrapper = await mountList()
    await clickHeader(wrapper, 'Servings')
    expect(names(wrapper)).toEqual(['C', 'D', 'A', 'B'])
    expect(header(wrapper, 'Servings').attributes('aria-sort')).toBe('descending')
    expect(header(wrapper, 'Recipe').attributes('aria-sort')).toBe('none')
    await clickHeader(wrapper, 'Servings')
    expect(names(wrapper)).toEqual(['A', 'D', 'C', 'B'])
    expect(header(wrapper, 'Servings').attributes('aria-sort')).toBe('ascending')
  })

  it('keeps the name order between equal servings', async () => {
    listReply = () => ({ recipes: [recipe('Pie', 4), recipe('Cake', 4)] })
    const wrapper = await mountList()
    await clickHeader(wrapper, 'Servings')
    expect(names(wrapper)).toEqual(['Cake', 'Pie'])
  })

  it('shows the count and no pagination when all recipes fit on one page', async () => {
    listReply = () => ({ recipes: numbered(25) })
    const wrapper = await mountList()
    expect(names(wrapper)).toHaveLength(25)
    expect(wrapper.get('[data-mealie-recipes-count]').text()).toBe('25 recipes')
    expect(pagination(wrapper).exists()).toBe(false)
  })

  it('pages 26 recipes as 25 then 1', async () => {
    listReply = () => ({ recipes: numbered(26) })
    const wrapper = await mountList()
    expect(wrapper.get('[data-mealie-recipes-count]').text()).toBe('26 recipes')
    expect(names(wrapper)).toHaveLength(25)
    expect(pagination(wrapper).exists()).toBe(true)

    await goToPage(wrapper, 2)
    expect(names(wrapper)).toEqual(['Recipe 26'])
  })

  it('filters before paging and reports the matching count', async () => {
    listReply = () => ({ recipes: [...numbered(26), recipe('Cake 1')] })
    const wrapper = await mountList()
    await wrapper.get('input').setValue('cake')
    expect(names(wrapper)).toEqual(['Cake 1'])
    expect(wrapper.get('[data-mealie-recipes-count]').text()).toBe('1 recipe')
    expect(pagination(wrapper).exists()).toBe(false)
  })

  it('returns to page 1 when the search changes', async () => {
    listReply = () => ({ recipes: [...numbered(26, 'Pie'), recipe('Cake 1'), recipe('Cake 2'), recipe('Cake 3')] })
    const wrapper = await mountList()
    await goToPage(wrapper, 2)
    expect(names(wrapper)).toHaveLength(4)

    await wrapper.get('input').setValue('pie')
    expect(names(wrapper)).toHaveLength(25)
    expect(names(wrapper)[0]).toBe('Pie 01')
  })

  it('returns to page 1 when the sort changes', async () => {
    listReply = () => ({ recipes: [...numbered(26, 'Pie'), recipe('Cake 1'), recipe('Cake 2'), recipe('Cake 3')] })
    const wrapper = await mountList()
    await goToPage(wrapper, 2)
    expect(names(wrapper)).toHaveLength(4)

    await clickHeader(wrapper, 'Recipe')
    expect(names(wrapper)).toHaveLength(25)
    expect(names(wrapper)[0]).toBe('Pie 26')
  })
})

describe('hidden without Mealie', () => {
  // Mounting at the current address would not navigate, so the route middleware would not run.
  beforeEach(async () => {
    status = { configured: false }
    await useRouter().push('/highlights')
  })

  it('redirects the list and cost addresses to /recipes', async () => {
    await mountSuspended(ListPage, { route: '/mealie-recipes' })
    await vi.waitFor(() => expect(useRoute().path).toBe('/recipes'))
    await mountSuspended(CostPage, { route: '/mealie-recipes/curry' })
    await vi.waitFor(() => expect(useRoute().path).toBe('/recipes'))
    expect(costRequests).toEqual([])
  })

  it('redirects when the status cannot be read', async () => {
    registerEndpoint('/api/mealie/status', () => { throw createError({ statusCode: 500 }) })
    await mountSuspended(ListPage, { route: '/mealie-recipes' })
    await vi.waitFor(() => expect(useRoute().path).toBe('/recipes'))
  })

  it('shows no link on /recipes while native recipes still load', async () => {
    const wrapper = await mountSuspended(RecipesPage, { route: '/recipes' })
    await flushPromises()
    expect(wrapper.find('a[href="/mealie-recipes"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('No saved recipes yet')
  })
})

it('links /recipes to the Mealie recipes when configured, as a ghost neutral button', async () => {
  const wrapper = await mountSuspended(RecipesPage, { route: '/recipes' })
  await flushPromises()
  expect(wrapper.get('a[href="/mealie-recipes"]').text()).toBe('Mealie recipes')
  expect(buttonNamed(wrapper, 'Mealie recipes').props()).toMatchObject({ variant: 'ghost', color: 'neutral', size: 'md' })
})
