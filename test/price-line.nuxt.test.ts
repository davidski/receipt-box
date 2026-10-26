import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import PriceLine from '../app/components/PriceLine.vue'

const mount = (props: { values: number[], sale?: boolean[], label?: string }) =>
  mountSuspended(PriceLine, { props: { label: 'Eggs price line', ...props } })

describe('PriceLine', () => {
  it('draws the line, a diamond per sale purchase, and a dot on the latest regular price', async () => {
    const wrapper = await mount({ values: [4, 3, 5, 4.5], sale: [false, true, false, false] })

    expect(wrapper.get('svg').attributes('aria-label')).toBe('Eggs price line')
    expect(wrapper.get('polyline').attributes('points')!.split(' ')).toHaveLength(4)
    const diamonds = wrapper.findAll('[data-sale-point]')
    expect(diamonds).toHaveLength(1)
    // The sale low sits at the bottom of the inset box (32 - 4).
    expect(diamonds[0]!.attributes('d')).toContain(' 28 L ')
    expect(wrapper.find('[data-latest-point]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('marks a latest sale purchase with its diamond instead of the dot', async () => {
    const wrapper = await mount({ values: [4, 3], sale: [false, true] })

    expect(wrapper.findAll('[data-sale-point]')).toHaveLength(1)
    expect(wrapper.find('[data-latest-point]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('treats a missing or short sale series as all regular purchases', async () => {
    const wrapper = await mount({ values: [4, 4.2, 4.4], sale: [true] })
    expect(wrapper.findAll('[data-sale-point]')).toHaveLength(1)
    wrapper.unmount()

    const plain = await mount({ values: [4, 4.2] })
    expect(plain.findAll('[data-sale-point]')).toHaveLength(0)
    expect(plain.find('[data-latest-point]').exists()).toBe(true)
    plain.unmount()
  })
})
