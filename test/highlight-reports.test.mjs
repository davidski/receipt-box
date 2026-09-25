import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { categoryPriceChanges, priceIndex, shrinkflation, sparklinePoints, spendChanges } from '../shared/utils/highlight-reports.ts'

function row(overrides = {}) {
  return {
    purchasedOn: '2026-01-10', item: 'Coffee', size: 10, unit: 'oz', price: 10,
    costPerUnit: 1, saleItem: false, ...overrides
  }
}

describe('priceIndex', () => {
  test('chains prior-spend-weighted geometric mean price changes across months', () => {
    const result = priceIndex([
      row(),
      row({ purchasedOn: '2026-01-20' }),
      row({ item: 'Tea', price: 5, costPerUnit: 0.5 }),
      row({ item: 'Rice', price: 20, costPerUnit: 2 }),
      row({ purchasedOn: '2026-02-10', price: 11, costPerUnit: 1.1 }),
      row({ purchasedOn: '2026-02-20', price: 11, costPerUnit: 1.1 }),
      row({ purchasedOn: '2026-02-11', item: 'Tea', price: 6, costPerUnit: 0.6 }),
      row({ purchasedOn: '2026-02-11', item: 'Rice', price: 21, costPerUnit: 2.1 }),
      row({ purchasedOn: '2026-02-12', price: 7, costPerUnit: 0.7, saleItem: true })
    ])
    const expected = Number((Math.exp((20 * Math.log(1.1) + 5 * Math.log(1.2) + 20 * Math.log(1.05)) / 45) * 100).toFixed(2))
    assert.deepEqual(result, [
      { month: '2026-01-01', value: 100, matchedItems: 0 },
      { month: '2026-02-01', value: expected, matchedItems: 3 }
    ])
  })

  test('returns a gap when fewer than three compatible items are matched', () => {
    assert.deepEqual(priceIndex([
      row(), row({ item: 'Tea' }),
      row({ purchasedOn: '2026-02-10' }), row({ purchasedOn: '2026-02-10', item: 'Tea' })
    ]).at(-1), {
      month: '2026-02-01', value: null, matchedItems: 2
    })
  })

  test('falls back to identical package prices and ignores unusable free observations', () => {
    const result = priceIndex([
      row({ costPerUnit: null }),
      row({ purchasedOn: '2026-02-10', costPerUnit: null, price: 12 }),
      row({ item: 'Tea', costPerUnit: null }),
      row({ purchasedOn: '2026-02-10', item: 'Tea', costPerUnit: null, price: 12 }),
      row({ item: 'Rice', costPerUnit: null }),
      row({ purchasedOn: '2026-02-10', item: 'Rice', costPerUnit: null, price: 12 }),
      row({ item: 'Free sample', price: 0, costPerUnit: null }),
      row({ purchasedOn: '2026-02-10', item: 'Free sample', price: 0, costPerUnit: null })
    ])
    assert.deepEqual(result.at(-1), { month: '2026-02-01', value: 120, matchedItems: 3 })
  })
})

describe('categoryPriceChanges', () => {
  test('reports weighted regular-price changes by category with matched-item coverage', () => {
    const items = ['Coffee', 'Tea', 'Rice']
    const result = categoryPriceChanges([
      ...items.map(item => row({ item, category: 'Pantry' })),
      ...items.map(item => row({ item, category: 'Pantry', purchasedOn: '2026-02-10', price: 11, costPerUnit: 1.1 })),
      ...items.map(item => row({ item: `Baking ${item}`, category: 'Baking' })),
      ...items.map(item => row({ item: `Baking ${item}`, category: 'Baking', purchasedOn: '2026-02-10', price: 10.5, costPerUnit: 1.05 })),
      row({ item: 'Milk', category: 'Dairy' }),
      row({ item: 'Milk', category: 'Dairy', purchasedOn: '2026-02-10', price: 11, costPerUnit: 1.1 }),
      row({ item: 'No category', category: null, purchasedOn: '2026-02-10', price: 11, costPerUnit: 1.1 })
    ])
    assert.deepEqual(result, [{
      category: 'Pantry', change: 10, startMonth: '2026-01-01', endMonth: '2026-02-01', matchedItems: 3
    }, {
      category: 'Baking', change: 5, startMonth: '2026-01-01', endMonth: '2026-02-01', matchedItems: 3
    }])
  })

  test('does not report a category without three matched regular items', () => {
    assert.deepEqual(categoryPriceChanges([
      row({ category: 'Dairy' }), row({ item: 'Tea', category: 'Dairy' }),
      row({ category: 'Dairy', purchasedOn: '2026-02-10', price: 11 }),
      row({ item: 'Tea', category: 'Dairy', purchasedOn: '2026-02-10', price: 11 })
    ]), [])
  })
})

describe('spendChanges', () => {
  test('separates matched package-price movement from the remaining spend change', () => {
    const result = spendChanges([
      row({ price: 10 }), row({ item: 'Tea', price: 5, size: 20 }),
      row({ purchasedOn: '2026-02-10', price: 12 }),
      row({ purchasedOn: '2026-02-11', item: 'Bread', price: 8, size: 1, unit: 'loaf' })
    ]).at(-1)
    assert.deepEqual(result, {
      month: '2026-02-01', totalSpent: 20, change: 5, priceEffect: 2, basketEffect: 3, matchedItems: 1
    })
  })
})

describe('shrinkflation', () => {
  test('flags a smaller same-unit package whose shelf price did not fall', () => {
    assert.deepEqual(shrinkflation([
      row(), row({ purchasedOn: '2026-02-10', size: 8 }),
      row({ item: 'Tea', price: 5 }), row({ item: 'Tea', purchasedOn: '2026-02-10', size: 9, price: 5 })
    ]), [{
      item: 'Coffee', previousPurchasedOn: '2026-01-10', purchasedOn: '2026-02-10',
      previousSize: 10, size: 8, unit: 'oz', previousPrice: 10, price: 10,
      previousUnitPrice: 3.5274, unitPrice: 4.4092, unitPriceLabel: 'Per 100 g',
      sizeChangePercent: -20, unitCostChangePercent: 25
    }, {
      item: 'Tea', previousPurchasedOn: '2026-01-10', purchasedOn: '2026-02-10',
      previousSize: 10, size: 9, unit: 'oz', previousPrice: 5, price: 5,
      previousUnitPrice: 1.7637, unitPrice: 1.9597, unitPriceLabel: 'Per 100 g',
      sizeChangePercent: -10, unitCostChangePercent: 11.1
    }])
  })

  test('ignores cheaper, larger, missing-size, incompatible-unit, and variable-quantity purchases', () => {
    assert.deepEqual(shrinkflation([
      row(), row({ purchasedOn: '2026-02-01', size: 8, price: 7 }),
      row({ item: 'Tea', size: null }), row({ item: 'Tea', purchasedOn: '2026-02-01', size: 8 }),
      row({ item: 'Rice' }), row({ item: 'Rice', purchasedOn: '2026-02-01', size: 8, unit: 'lb' }),
      row({ item: 'Milk' }), row({ item: 'Milk', purchasedOn: '2026-02-01', size: 12 }),
      row({ item: 'Bananas', unit: 'lb', size: 3, price: 3 }), row({ item: 'Bananas', unit: 'lb', size: 2, price: 3, purchasedOn: '2026-02-01' }),
      row({ item: 'Avocados', unit: 'ea', size: 3, price: 5 }), row({ item: 'Avocados', unit: 'ea', size: 2, price: 5, purchasedOn: '2026-02-01' })
    ]), [])
  })
})

test('sparklinePoints handles changing, flat, empty, and single-value series', () => {
  assert.equal(sparklinePoints([]), '')
  assert.equal(sparklinePoints([5]), '60,16')
  assert.equal(sparklinePoints([5, 5]), '0,16 120,16')
  assert.equal(sparklinePoints([1, 3, 2]), '0,32 60,0 120,16')
})
