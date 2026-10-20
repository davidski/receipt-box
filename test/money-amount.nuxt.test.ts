import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import MoneyAmount from '../app/components/MoneyAmount.vue'

describe('MoneyAmount', () => {
  it('reads as one full amount and sets the cents smaller and muted', async () => {
    const wrapper = await mountSuspended(MoneyAmount, { props: { value: 111.49 } })
    expect(wrapper.text()).toBe('$111.49')
    expect(wrapper.classes()).toContain('tabular-nums')
    const cents = wrapper.get('.text-cents')
    expect(cents.text()).toBe('.49')
    expect(cents.classes()).toContain('text-(--muted)')
    wrapper.unmount()
  })

  it('shows two decimals for whole amounts', async () => {
    const wrapper = await mountSuspended(MoneyAmount, { props: { value: 6794 } })
    expect(wrapper.text()).toBe('$6,794.00')
    wrapper.unmount()
  })
})
