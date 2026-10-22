import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import PriceChange from '../app/components/PriceChange.vue'

const mounted: Array<{ unmount: () => void }> = []
afterEach(() => mounted.splice(0).forEach(wrapper => wrapper.unmount()))

async function mountChange(props: Record<string, unknown>, attrs: Record<string, unknown> = {}) {
  const wrapper = await mountSuspended(PriceChange, { props: { ...props, ...attrs } })
  mounted.push(wrapper)
  return wrapper
}

const shown = (wrapper: Awaited<ReturnType<typeof mountChange>>) => wrapper.get('[data-figure]').text()
const spoken = (wrapper: Awaited<ReturnType<typeof mountChange>>) => wrapper.find('.sr-only').exists() ? wrapper.get('.sr-only').text() : null
// Nuxt UI draws a soft badge as `bg-<color>/10 text-<color>`; neutral is `bg-elevated`.
const classes = (wrapper: Awaited<ReturnType<typeof mountChange>>) => wrapper.classes().join(' ')

describe('PriceChange', () => {
  it('marks an increase with the error chip, an up glyph, a plus sign, and "up" for screen readers', async () => {
    const wrapper = await mountChange({ value: 0.4 })
    expect(shown(wrapper)).toBe('+$0.40')
    expect(spoken(wrapper)).toBe('up $0.40')
    expect(classes(wrapper)).toContain('error')
    expect(wrapper.html()).toContain('i-lucide:trending-up')
  })

  it('marks a decrease with the success chip, a down glyph, and a true minus sign', async () => {
    const wrapper = await mountChange({ value: -0.4 })
    expect(shown(wrapper)).toBe('−$0.40')
    expect(shown(wrapper)).not.toContain('-')
    expect(spoken(wrapper)).toBe('down $0.40')
    expect(classes(wrapper)).toContain('success')
    expect(wrapper.html()).toContain('i-lucide:trending-down')
  })

  it('shows zero as a neutral "No change"', async () => {
    const wrapper = await mountChange({ value: 0 })
    expect(shown(wrapper)).toBe('No change')
    expect(spoken(wrapper)).toBeNull()
    expect(wrapper.get('[data-figure]').attributes('aria-hidden')).toBeUndefined()
    expect(classes(wrapper)).toContain('bg-elevated')
    expect(wrapper.html()).toContain('i-lucide:minus')
  })

  it('shows an amount that rounds to zero as flat, with no sign, instead of claiming no change', async () => {
    const cents = await mountChange({ value: -0.004 })
    expect(shown(cents)).toBe('$0.00')
    expect(spoken(cents)).toBe('flat, $0.00')
    const whole = await mountChange({ value: 0.4, whole: true })
    expect(shown(whole)).toBe('$0')
    expect(classes(whole)).toContain('bg-elevated')
    expect(shown(await mountChange({ value: 0.2, unit: 'percent' }))).toBe('0%')
  })

  it('shows a missing comparison as a neutral dash', async () => {
    const wrapper = await mountChange({ value: null })
    expect(shown(wrapper)).toBe('—')
    expect(spoken(wrapper)).toBe('no comparison')
    expect(classes(wrapper)).toContain('bg-elevated')
  })

  it('formats percent changes, with the requested decimals', async () => {
    const up = await mountChange({ value: 12.46, unit: 'percent' })
    expect(shown(up)).toBe('+12%')
    expect(spoken(up)).toBe('up 12%')
    const down = await mountChange({ value: -6.54, unit: 'percent', digits: 1 })
    expect(shown(down)).toBe('−6.5%')
    expect(spoken(down)).toBe('down 6.5%')
  })

  it('shows whole dollars for aggregates', async () => {
    const wrapper = await mountChange({ value: -3.29, whole: true })
    expect(shown(wrapper)).toBe('−$3')
    expect(spoken(wrapper)).toBe('down $3')
  })

  it('keeps the signed figure but a neutral chip when the caller calls the move flat', async () => {
    const wrapper = await mountChange({ value: 1.2, unit: 'percent', digits: 1, flat: true })
    expect(shown(wrapper)).toBe('+1.2%')
    expect(spoken(wrapper)).toBe('flat, +1.2%')
    expect(classes(wrapper)).toContain('bg-elevated')
    expect(wrapper.html()).not.toContain('i-lucide-trending')
  })

  it('hides the visible figure and the glyph from assistive technology and passes attributes to the badge', async () => {
    const wrapper = await mountChange({ value: 5, unit: 'percent' }, { title: 'versus last week' })
    expect(wrapper.attributes('title')).toBe('versus last week')
    expect(wrapper.get('[data-figure]').text()).toBe('+5%')
    expect(wrapper.find('.sr-only').attributes('aria-hidden')).toBeUndefined()
    expect(wrapper.find('svg, [class*="i-lucide"]').attributes('aria-hidden')).toBe('true')
  })
})
