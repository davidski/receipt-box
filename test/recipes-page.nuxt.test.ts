import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createError } from 'h3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import RecipesPage from '../app/pages/recipes.vue'

const SAVED_AT = '2026-09-02T12:00:00.000Z'
const savedDate = new Date(SAVED_AT).toLocaleDateString(undefined, { dateStyle: 'medium' })
const row = (id: number | string, name: string, savedTotal: number | null, currentTotal: number | null, lineCount = 2) =>
  ({ id: String(id), name, lineCount, savedTotal, savedAt: SAVED_AT, updatedAt: SAVED_AT, currentTotal })

const mounted: Array<{ unmount: () => void }> = []
let reply: () => unknown
let requests: number

beforeEach(() => {
  requests = 0
  reply = () => [
    row(1, 'Pancakes', 10, 12),
    row(2, 'Bread', 10, 9),
    row(3, 'Salad', 10, 10),
    row(4, 'Soup', null, 5),
    row(5, 'Curry', 8, 11.5),
    row(6, 'Mystery', 4, null)
  ]
  registerEndpoint('/api/auth/config', () => ({ enabled: false }))
  registerEndpoint('/api/recipes', () => {
    requests++
    return reply()
  })
})

afterEach(() => {
  mounted.splice(0).forEach(wrapper => wrapper.unmount())
})

async function mountPage() {
  const wrapper = await mountSuspended(RecipesPage, { route: '/recipes', attachTo: document.body })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}

const names = (wrapper: Awaited<ReturnType<typeof mountPage>>) => wrapper.findAll('[data-recipes-row]').map(r => r.find('a').text())
const header = (wrapper: Awaited<ReturnType<typeof mountPage>>, label: string) => wrapper.findAll('thead button').find(b => b.text() === label)!

describe('Recipes page', () => {
  it('renders a row per recipe with totals, saved date and change chips', async () => {
    const wrapper = await mountPage()
    const pancakes = wrapper.findAll('[data-recipes-row]').find(r => r.text().includes('Pancakes'))!

    expect(wrapper.find('h1').text()).toBe('Recipes')
    expect(wrapper.findAll('[data-recipes-row]')).toHaveLength(6)
    expect(pancakes.get('[data-col="now"]').text()).toBe('$12.00')
    expect(pancakes.get('[data-col="saved"]').text()).toBe(`$10.00${savedDate}`)
    expect(pancakes.get('[data-col="change"]').text()).toBe('+$2.00')
    expect(pancakes.get('[data-col="change"] span').classes().join(' ')).toContain('warning')
    const bread = wrapper.findAll('[data-recipes-row]').find(r => r.text().includes('Bread'))!
    expect(bread.get('[data-col="change"]').text()).toBe('-$1.00')
    expect(bread.get('[data-col="change"] span').classes().join(' ')).toContain('success')
    const salad = wrapper.findAll('[data-recipes-row]').find(r => r.text().includes('Salad'))!
    expect(salad.get('[data-col="change"]').text()).toBe('No change')
  })

  it('shows a dash and no chip when a total is missing', async () => {
    const wrapper = await mountPage()
    const soup = wrapper.findAll('[data-recipes-row]').find(r => r.text().includes('Soup'))!
    const mystery = wrapper.findAll('[data-recipes-row]').find(r => r.text().includes('Mystery'))!

    expect(soup.get('[data-col="saved"]').text()).toContain('—')
    expect(soup.get('[data-col="change"]').text()).toBe('')
    expect(mystery.get('[data-col="now"]').text()).toBe('—')
    expect(mystery.get('[data-col="change"]').text()).toBe('')
  })

  it('links each recipe to /recipe?recipe=<id> and offers a New recipe button', async () => {
    const wrapper = await mountPage()
    const hrefs = wrapper.findAll('[data-recipes-row] a').map(a => a.attributes('href'))

    expect(hrefs).toContain('/recipe?recipe=1')
    expect(hrefs).toContain('/recipe?recipe=6')
    expect(wrapper.findAll('a').find(a => a.text().includes('New recipe'))!.attributes('href')).toBe('/recipe')
    // The create action sits with the list it adds to, beside search, not in the page header.
    const toolbar = wrapper.get('[data-recipes-toolbar]')
    expect(toolbar.find('input[aria-label="Search recipes"]').exists()).toBe(true)
    expect(toolbar.find('a[href="/recipe"]').text()).toContain('New recipe')
    expect(wrapper.get('header.page-heading').find('a[href="/recipe"]').exists()).toBe(false)
  })

  it('sorts by change, largest increase first, with missing values last by default', async () => {
    const wrapper = await mountPage()
    expect(names(wrapper)).toEqual(['Curry', 'Pancakes', 'Salad', 'Bread', 'Soup', 'Mystery'])
    expect(wrapper.get('th[aria-sort="descending"]').text()).toBe('Change')
  })

  it('aligns sortable header labels with the cell text below them', async () => {
    const wrapper = await mountPage()
    const sortButtons = wrapper.findAll('th button')
    expect(sortButtons.length).toBe(3)
    // Cancel the ghost button padding so labels sit on the column edge.
    for (const button of sortButtons) expect(button.classes()).toContain('-mx-2')
    // Right-aligned columns put the sort arrow before the label so the label ends on the column edge.
    const change = wrapper.get('th[aria-sort="descending"] button')
    expect(change.find('[data-slot="leadingIcon"]').exists()).toBe(true)
    expect(change.find('[data-slot="trailingIcon"]').exists()).toBe(false)
  })

  it('toggles the change sort ascending while still putting missing values last', async () => {
    const wrapper = await mountPage()
    await header(wrapper, 'Change').trigger('click')

    expect(names(wrapper)).toEqual(['Bread', 'Salad', 'Pancakes', 'Curry', 'Soup', 'Mystery'])
    expect(wrapper.get('th[aria-sort="ascending"]').text()).toBe('Change')
  })

  it('sorts by Now, highest first then lowest first, missing last', async () => {
    const wrapper = await mountPage()
    await header(wrapper, 'Now').trigger('click')
    expect(names(wrapper)).toEqual(['Pancakes', 'Curry', 'Salad', 'Bread', 'Soup', 'Mystery'])

    await header(wrapper, 'Now').trigger('click')
    expect(names(wrapper)).toEqual(['Soup', 'Bread', 'Salad', 'Curry', 'Pancakes', 'Mystery'])
  })

  it('sorts by name ascending, then descending', async () => {
    const wrapper = await mountPage()
    await header(wrapper, 'Recipe').trigger('click')
    expect(names(wrapper)).toEqual(['Bread', 'Curry', 'Mystery', 'Pancakes', 'Salad', 'Soup'])

    await header(wrapper, 'Recipe').trigger('click')
    expect(names(wrapper)).toEqual(['Soup', 'Salad', 'Pancakes', 'Mystery', 'Curry', 'Bread'])
  })

  it('filters by name case-insensitively and explains when nothing matches', async () => {
    const wrapper = await mountPage()
    const search = wrapper.get('input[aria-label="Search recipes"]')

    await search.setValue('  SO ')
    expect(names(wrapper)).toEqual(['Soup'])

    await search.setValue('zzz')
    expect(wrapper.find('[data-recipes-table]').exists()).toBe(false)
    expect(wrapper.get('[data-recipes-no-match]').text()).toBe('No recipes match “zzz”.')

    await search.setValue('')
    expect(wrapper.findAll('[data-recipes-row]')).toHaveLength(6)
  })

  it('shows a loading indicator until the first response arrives', async () => {
    const wrapper = await mountSuspended(RecipesPage, { route: '/recipes', attachTo: document.body })
    mounted.push(wrapper)
    expect(wrapper.find('[data-recipes-loading]').exists()).toBe(true)
    await flushPromises()
    expect(wrapper.find('[data-recipes-loading]').exists()).toBe(false)
    expect(wrapper.findAll('[data-recipes-row]').length).toBeGreaterThan(0)
  })

  it('styles sortable and plain column headers alike', async () => {
    const wrapper = await mountPage()
    expect(header(wrapper, 'Recipe').classes()).toContain('uppercase')
    expect(wrapper.get('thead').classes()).toContain('uppercase')
  })

  it('shows an empty state linking to /recipe when nothing is saved', async () => {
    reply = () => []
    const wrapper = await mountPage()

    expect(wrapper.get('[data-recipes-empty]').text()).toContain('No saved recipes yet')
    expect(wrapper.get('[data-recipes-empty] a').attributes('href')).toBe('/recipe')
    expect(wrapper.find('input[aria-label="Search recipes"]').exists()).toBe(false)
  })

  it('shows a load error and recovers on Retry', async () => {
    reply = () => { throw createError({ statusCode: 500, statusMessage: 'Database unavailable' }) }
    const wrapper = await mountPage()

    expect(wrapper.get('[data-recipes-error]').text()).toContain('Database unavailable')
    expect(wrapper.get('[data-recipes-error]').attributes('role')).toBe('alert')
    expect(wrapper.find('[data-recipes-table]').exists()).toBe(false)

    const before = requests
    reply = () => [row(1, 'Pancakes', 10, 12)]
    await wrapper.findAll('button').find(b => b.text() === 'Retry')!.trigger('click')
    await nextTick()
    expect(wrapper.find('[data-recipes-error]').exists()).toBe(true)
    expect(wrapper.findAll('button').find(b => b.text() === 'Retry')!.attributes('disabled')).toBeDefined()
    await flushPromises()

    expect(requests).toBeGreaterThan(before)
    expect(wrapper.find('[data-recipes-error]').exists()).toBe(false)
    expect(names(wrapper)).toEqual(['Pancakes'])
  })
})
