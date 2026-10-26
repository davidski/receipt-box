import assert from 'node:assert/strict'
import { test } from 'node:test'
import { priceLine } from '../shared/utils/price-line.ts'

const purchase = (price, overrides = {}) => ({ price, size: '500', unit: 'g', costPerUnit: null, saleItem: false, ...overrides })

test('normalizes each purchase and flags sales, in date order', () => {
  const line = priceLine([purchase('5.00'), purchase('4.00', { saleItem: true }), purchase('6.00')])
  assert.deepEqual(line, { values: [1, 0.8, 1.2], sale: [false, true, false] })
})

test("keeps only the latest purchase's basis, as the item page chart does", () => {
  // Bought by weight, then by the each: the line follows the latest (each) and drops the per-100 g points.
  const line = priceLine([purchase('5.00'), purchase('3.00', { size: '2', unit: 'ea' }), purchase('4.00', { size: '2', unit: 'ea' })])
  assert.deepEqual(line, { values: [1.5, 2], sale: [false, false] })
})

test('skips purchases that cannot be normalized and handles no purchases', () => {
  const line = priceLine([purchase('2.00', { size: null, unit: null }), purchase('5.00')])
  assert.deepEqual(line, { values: [1], sale: [false] })
  assert.deepEqual(priceLine([]), { values: [], sale: [] })
})
