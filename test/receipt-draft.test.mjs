import assert from 'node:assert/strict'
import test from 'node:test'

import { receiptDraftSnapshot } from '../app/utils/receipt-draft.ts'

function draft(overrides = {}) {
  return {
    purchasedOn: '2026-08-06',
    location: '',
    lines: [{
      item: '', price: '', size: '', unit: '', saleItem: false,
      nonGrocery: false, notes: ''
    }],
    ...overrides
  }
}

test('unchanged receipt data produces the same snapshot', () => {
  assert.equal(receiptDraftSnapshot(draft()), receiptDraftSnapshot(draft()))
})

test('receipt field changes produce a different snapshot', () => {
  const initial = receiptDraftSnapshot(draft())

  assert.notEqual(receiptDraftSnapshot(draft({ purchasedOn: '2026-08-05' })), initial)
  assert.notEqual(receiptDraftSnapshot(draft({ location: 'Market' })), initial)
  assert.notEqual(receiptDraftSnapshot(draft({
    lines: [{
      item: 'Milk', price: '3.99', size: '1', unit: 'gal', saleItem: true,
      nonGrocery: false, notes: 'Coupon'
    }]
  })), initial)
})

test('extra empty lines do not mark a receipt as changed', () => {
  const initial = draft()
  const withExtraEmptyLine = draft({ lines: [...initial.lines, { ...initial.lines[0] }] })

  assert.equal(receiptDraftSnapshot(withExtraEmptyLine), receiptDraftSnapshot(initial))
})

test('explicit category edits remain in the receipt draft snapshot', () => {
  const line = {
    item: 'Coffee', price: '4.99', size: '', unit: '', saleItem: false,
    nonGrocery: false, notes: '', category: 'Beverages', categoryChanged: true
  }

  assert.notEqual(receiptDraftSnapshot(draft({ lines: [line] })), receiptDraftSnapshot(draft({ lines: [{ ...line, category: null }] })))
  assert.equal(
    receiptDraftSnapshot(draft({ lines: [line] })),
    receiptDraftSnapshot(draft({ lines: [{ ...line, categoryChanged: true }] }))
  )
})
