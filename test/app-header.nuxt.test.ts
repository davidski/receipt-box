import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import AppHeader from '../app/components/AppHeader.vue'

const mounted: Array<{ unmount: () => void }> = []
beforeEach(() => registerEndpoint('/api/auth/config', () => ({ enabled: false })))
afterEach(() => mounted.splice(0).forEach(wrapper => wrapper.unmount()))

async function navAt(route: string) {
  const wrapper = await mountSuspended(AppHeader, { route })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper.get('nav[aria-label="Main navigation"]')
}

describe('App header recipe navigation', () => {
  it('has one Recipes entry linking to /recipes and no separate Recipe entry', async () => {
    const nav = await navAt('/')
    const labels = nav.findAll('a').map(a => a.text())
    expect(labels.filter(label => label.startsWith('Recipe'))).toEqual(['Recipes'])
    expect(nav.findAll('a').find(a => a.text() === 'Recipes')!.attributes('href')).toBe('/recipes')
  })

  it.each(['/recipes', '/recipe'])('marks Recipes active on %s', async (route) => {
    const nav = await navAt(route)
    expect(nav.findAll('a').find(a => a.text() === 'Recipes')!.attributes('aria-current')).toBe('page')
  })

  it('does not mark Recipes active elsewhere', async () => {
    const nav = await navAt('/highlights')
    expect(nav.findAll('a').find(a => a.text() === 'Recipes')!.attributes('aria-current')).toBeUndefined()
  })
})
