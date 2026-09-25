import assert from 'node:assert/strict'
import test from 'node:test'
import { canonicalRecord } from '../app/utils/import-record.ts'

test('maps exported category columns for import', () => {
  assert.deepEqual(canonicalRecord({
    purchase_date: '2026-09-24',
    item: 'Peaches',
    category: 'Produce',
    store: 'Market'
  }), {
    food_Date: '2026-09-24',
    Item: 'Peaches',
    category: 'Produce',
    Location: 'Market'
  })
})

test('treats a blank category column as uncategorized and leaves absent columns absent', () => {
  assert.deepEqual(canonicalRecord({ item: 'Peaches', category: '' }), { Item: 'Peaches', category: null })
  assert.deepEqual(canonicalRecord({ item: 'Peaches' }), { Item: 'Peaches' })
})

test('unwraps spreadsheet formula result cells', () => {
  assert.deepEqual(canonicalRecord({ Category: { formula: '"Produce"', result: 'Produce' } }), { category: 'Produce' })
})
