import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import PriceEntryForm from '../app/components/PriceEntryForm.vue'

const mounted: Array<{ unmount: () => void }> = []

beforeEach(() => {
  registerEndpoint('/api/suggestions', () => [])
})

afterEach(() => mounted.splice(0).forEach(wrapper => wrapper.unmount()))

describe('Price entry notes', () => {
  it('limits notes and displays a live character count', async () => {
    const wrapper = await mountSuspended(PriceEntryForm)
    mounted.push(wrapper)
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text().includes('More details'))!.trigger('click')

    const notes = wrapper.get('#notes')
    expect(notes.attributes('maxlength')).toBe('100')
    expect(wrapper.get('#notes-character-count').text()).toBe('0/100')
    await notes.setValue('x'.repeat(100))
    expect(wrapper.get('#notes-character-count').text()).toBe('100/100')
  })
})
