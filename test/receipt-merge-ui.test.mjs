import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  addedReceiptMessage,
  receiptLineIsComplete,
  receiptLineSaveSnapshot,
  shouldLoadMatchingReceipt
} from '../app/utils/receipt-merge.ts'

const saved = {
  id: '8',
  purchasedOn: '2026-08-06',
  location: 'Market',
  itemCount: 4,
  total: '12.50'
}

describe('receipt merge UI copy', () => {
  test('reports newly saved lines separately from the combined receipt total', () => {
    assert.equal(addedReceiptMessage(2, saved), 'Added 2 items to the Market receipt · 4 items total · $12.50')
    assert.equal(
      addedReceiptMessage(1, { ...saved, itemCount: 1, total: '3' }),
      '1 item saved · $3.00'
    )
  })

})

describe('receipt row autosave state', () => {
  const line = {
    item: 'Milk', price: '3.99', size: '1', unit: 'gal',
    saleItem: false, nonGrocery: false, notes: ''
  }

  test('recognizes complete rows, including free items', () => {
    assert.equal(receiptLineIsComplete(line), true)
    assert.equal(receiptLineIsComplete({ ...line, price: '0' }), true)
  })

  test('keeps partial and invalid rows unsaved', () => {
    assert.equal(receiptLineIsComplete({ ...line, item: '' }), false)
    assert.equal(receiptLineIsComplete({ ...line, price: '' }), false)
    assert.equal(receiptLineIsComplete({ ...line, price: '-1' }), false)
    assert.equal(receiptLineIsComplete({ ...line, price: 'not-a-price' }), false)
  })

  test('tracks receipt metadata and every persisted row field', () => {
    const snapshot = receiptLineSaveSnapshot('2026-08-06', 'Market', line)
    assert.equal(snapshot, receiptLineSaveSnapshot('2026-08-06', 'Market', { ...line }))
    assert.notEqual(snapshot, receiptLineSaveSnapshot('2026-08-07', 'Market', line))
    assert.notEqual(snapshot, receiptLineSaveSnapshot('2026-08-06', 'Other Store', line))
    assert.notEqual(snapshot, receiptLineSaveSnapshot('2026-08-06', 'Market', { ...line, notes: 'Coupon' }))
  })
})

describe('unified receipt editor selection', () => {
  test('loads an existing receipt only into an empty editor', () => {
    assert.equal(shouldLoadMatchingReceipt(null, 0), true)
    assert.equal(shouldLoadMatchingReceipt('12', 0), false)
    assert.equal(shouldLoadMatchingReceipt(null, 1), false)
  })
})
