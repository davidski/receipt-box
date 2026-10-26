import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import ReceiptEntryLine from '../app/components/ReceiptEntryLine.vue'

const entry = { id: '1', item: 'Coffee', category: 'Pantry', saleItem: false, nonGrocery: false, notes: null, price: '12.5' }

describe('ReceiptEntryLine', () => {
  it('shows the price through the shared money formatter, with cents', async () => {
    const wrapper = await mountSuspended(ReceiptEntryLine, { props: { entry, size: '340 g' } })
    expect(wrapper.get('strong.tabular-nums').text()).toBe('$12.50')
    expect(wrapper.text()).not.toContain('Sale')
    wrapper.unmount()
  })

  it('groups thousands and keeps the sale and note details', async () => {
    const wrapper = await mountSuspended(ReceiptEntryLine, {
      props: { entry: { ...entry, price: '1234.5', saleItem: true, notes: 'Bulk' }, size: '' }
    })
    expect(wrapper.get('strong.tabular-nums').text()).toBe('$1,234.50')
    expect(wrapper.text()).toContain('Sale')
    // Sale is the shared gold diamond, not a tag-icon badge.
    expect(wrapper.find('.rotate-45.bg-sale-mark').exists()).toBe(true)
    expect(wrapper.html()).not.toContain('i-lucide:tag')
    expect(wrapper.text()).toContain('Bulk')
    wrapper.unmount()
  })
})
